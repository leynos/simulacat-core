/**
 * @file Fails `bun audit` only for advisories that the audit exception ledger
 * does not cover.
 *
 * `security/audit-exceptions.json` lists the advisories this repository has
 * accepted for a stated period. The gate fails when `bun audit` reports an
 * advisory the ledger does not name, and when any ledger entry is undated,
 * misdated or past its expiry, whether or not its advisory is still reported,
 * so an exception cannot outlive its review.
 *
 * The decision (`evaluateAudit`) is a pure query; only `main` reads the
 * clock, spawns `bun` and writes to the console.
 */

import {spawnSync} from 'node:child_process';
import {readFileSync, realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const GHSA_PATTERN = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const LEDGER_URL = new URL('../security/audit-exceptions.json', import.meta.url);

/** A `bun audit --json` report that does not have the expected shape. */
export class AuditReportError extends Error {}

/** Read the `GHSA-…` identifier from one advisory record, or null. */
function advisoryId(advisory) {
  if (typeof advisory.github_advisory_id === 'string') {
    return advisory.github_advisory_id;
  }
  const match = typeof advisory.url === 'string' ? advisory.url.match(GHSA_PATTERN) : null;
  return match ? match[0] : null;
}

/** Tell whether a value is a plain object (not null, not an array). */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Turn one package's advisory list into advisory summaries. */
function summarisePackage(name, entries) {
  if (!Array.isArray(entries)) {
    throw new AuditReportError(`bun audit reported a non-array entry for ${name}`);
  }
  return entries.map((advisory) => ({
    package: name,
    id: advisoryId(advisory ?? {}),
    title: typeof advisory?.title === 'string' ? advisory.title : ''
  }));
}

/**
 * Flatten Bun's audit report into a list of advisories.
 *
 * Bun keys the report by package name, with an array of advisories per
 * package; a payload that nests that object under `advisories` is accepted
 * too. Anything else is rejected rather than read as clean, so a malformed
 * report cannot pass the gate.
 *
 * @param report The parsed `bun audit --json` output.
 * @returns One summary per advisory, with its package, identifier and title.
 * @throws {AuditReportError} When the report or a package entry is malformed.
 *
 * @example
 * parseAdvisories({braces: [{url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc'}]});
 * // => [{package: 'braces', id: 'GHSA-aaaa-bbbb-cccc', title: ''}]
 */
export function parseAdvisories(report) {
  if (!isPlainObject(report)) {
    throw new AuditReportError('bun audit did not report a JSON object');
  }
  const byPackage = report.advisories ?? report;
  if (!isPlainObject(byPackage)) {
    throw new AuditReportError('bun audit reported a malformed advisories value');
  }
  return Object.entries(byPackage).flatMap(([name, entries]) => summarisePackage(name, entries));
}

/** Tell whether a year, month and day name a real calendar date. */
function isRealDate(instant, year, month, day) {
  return instant.getUTCFullYear() === year && instant.getUTCMonth() === month - 1 && instant.getUTCDate() === day;
}

/** Return the first instant (ms) an entry no longer covers, or null if not a real date. */
function expiryBoundary(expiresAt) {
  const match = DATE_ONLY.exec(expiresAt);
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls 2026-02-30 over to March; a round trip rejects it.
  return isRealDate(instant, year, month, day) ? instant.getTime() + DAY_MS : null;
}

/** Label a ledger entry for messages. */
function entryLabel(entry) {
  return `Audit exception ${entry.id ?? entry.advisory}`;
}

/** Name an entry that the ledger lists more than once. */
function duplicateProblem(entry, repeated) {
  return repeated ? [`${entryLabel(entry)} is listed more than once.`] : [];
}

/** Name an entry whose expiry is missing, not a calendar date, or passed. */
function expiryProblem(entry, now) {
  const boundary = typeof entry.expiresAt === 'string' ? expiryBoundary(entry.expiresAt) : null;
  if (boundary === null) {
    return [`${entryLabel(entry)} for ${entry.advisory} needs an expiresAt calendar date in YYYY-MM-DD form.`];
  }
  return boundary <= now.getTime() ? [`${entryLabel(entry)} for ${entry.advisory} expired on ${entry.expiresAt}.`] : [];
}

/**
 * Check every ledger entry, independently of what `bun audit` reports.
 *
 * An entry covers the whole of its stated `YYYY-MM-DD` day, so it fails from
 * the day after.
 *
 * @param entries The ledger entries.
 * @param now The reference time.
 * @returns One message per problem; empty when the ledger is sound.
 * @throws {TypeError} When `now` is not a valid date, which would otherwise make
 * every expiry comparison false.
 *
 * @example
 * checkLedger([{id: 'X', advisory: 'GHSA-a', expiresAt: '2026-01-01'}], new Date('2026-06-01'));
 * // => ['Audit exception X for GHSA-a expired on 2026-01-01.']
 */
export function checkLedger(entries, now) {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError('Invalid audit reference date');
  }
  const seen = new Set();
  return entries.flatMap((entry) => {
    const repeated = entry.id !== undefined && seen.has(entry.id);
    seen.add(entry.id);
    return [...duplicateProblem(entry, repeated), ...expiryProblem(entry, now)];
  });
}

/** Pick the exit code: any failure is 1, otherwise Bun's status stands when nothing was covered. */
function exitCode(failed, coveredCount, status) {
  if (failed) {
    return 1;
  }
  return coveredCount === 0 ? status : 0;
}

/**
 * Decide whether the audit passes. A pure query: it reads no clock and writes
 * nothing.
 *
 * @param input The audit facts: `advisories` (what Bun reported), `ledger`
 * (the exception entries), `now` (the reference time) and `status` (Bun's exit
 * status).
 * @returns The exit `code` and the `covered` and `unexpected` advisories and
 * the ledger `problems`.
 *
 * @example
 * evaluateAudit({advisories: [], ledger: [], now: new Date(), status: 0}).code; // => 0
 */
export function evaluateAudit(input) {
  const {advisories, ledger, now, status} = input;
  const allowed = new Set(ledger.map((entry) => entry.advisory));
  const covered = advisories.filter((advisory) => allowed.has(advisory.id));
  const unexpected = advisories.filter((advisory) => !covered.includes(advisory));
  const problems = checkLedger(ledger, now);
  const failed = unexpected.length > 0 || problems.length > 0;
  return {code: exitCode(failed, covered.length, status), covered, unexpected, problems};
}

/** List the lines that name the unexpected advisories. */
function unexpectedLines(unexpected) {
  if (unexpected.length === 0) {
    return [];
  }
  const lines = unexpected.map((advisory) => `- ${advisory.id ?? 'unknown'} (${advisory.package}): ${advisory.title}`);
  return ['Unexpected vulnerabilities detected by bun audit:', ...lines];
}

/** Write the all-clear line, or nothing when anything failed. */
function coveredLine(coveredCount, errorCount) {
  if (coveredCount === 0 || errorCount > 0) {
    return [];
  }
  const noun = coveredCount === 1 ? 'advisory' : 'advisories';
  return [`All reported advisories are covered by the audit exception ledger (${coveredCount} ${noun}).`];
}

/**
 * Render an outcome as the lines `main` prints.
 *
 * @param outcome The result of `evaluateAudit`.
 * @returns The lines for stdout (`out`) and stderr (`err`).
 *
 * @example
 * formatOutcome({code: 0, covered: [], unexpected: [], problems: []}); // => {out: [], err: []}
 */
export function formatOutcome(outcome) {
  const err = [...outcome.problems, ...unexpectedLines(outcome.unexpected)];
  return {out: coveredLine(outcome.covered.length, err.length), err};
}

/** Throw when Bun could not start or did not end normally. */
function assertNormalExit(result) {
  if (result.error) {
    throw result.error;
  }
  if (result.status === null) {
    throw new Error(`bun audit did not exit normally${result.signal ? ` (signal: ${result.signal})` : ''}`);
  }
}

/**
 * Run `bun audit --json` and parse its report.
 *
 * @param spawn The process runner, replaceable in tests.
 * @returns The parsed `report` and Bun's exit `status`.
 * @throws {Error} When Bun cannot start, ends on a signal, or prints invalid JSON.
 *
 * @example
 * const {report, status} = runBunAudit();
 */
export function runBunAudit(spawn = spawnSync) {
  const result = spawn('bun', ['audit', '--json'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
  assertNormalExit(result);
  const raw = (result.stdout ?? '').trim();
  try {
    return {report: raw === '' ? {} : JSON.parse(raw), status: result.status};
  } catch (error) {
    throw new AuditReportError(`Failed to parse bun audit JSON: ${error.message}`, {cause: error});
  }
}

/** Read the reference time, honouring `AUDIT_REFERENCE_DATE` when it is set. */
function referenceTime(env) {
  return env.AUDIT_REFERENCE_DATE ? new Date(env.AUDIT_REFERENCE_DATE) : new Date();
}

/** Print the lines of a formatted outcome. */
function printOutcome(log, lines) {
  for (const line of lines.out) log.info(line);
  for (const line of lines.err) log.error(line);
}

/**
 * Run the audit, print the outcome and return the exit code.
 *
 * `AUDIT_REFERENCE_DATE` (an ISO date) replaces the clock so the expiry
 * behaviour can be tested deterministically.
 *
 * @param deps Replaceable collaborators: `spawn`, `env` and `log`.
 * @returns The process exit code.
 *
 * @example
 * process.exit(main());
 */
export function main(deps = {}) {
  const {spawn = spawnSync, env = process.env, log = console} = deps;
  try {
    const ledger = JSON.parse(readFileSync(LEDGER_URL, 'utf8'));
    const {report, status} = runBunAudit(spawn);
    const advisories = parseAdvisories(report);
    const outcome = evaluateAudit({advisories, ledger, now: referenceTime(env), status});
    printOutcome(log, formatOutcome(outcome));
    return outcome.code;
  } catch (error) {
    log.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
