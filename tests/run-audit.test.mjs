/**
 * @file Tests for the audit exception runner.
 *
 * Unit tests drive the pure decision (`evaluateAudit`), the report parser and
 * the ledger check with constructed input; a property test checks the
 * covered/unexpected partition; snapshots pin the stable output text; and
 * behavioural tests run the real CLI against a fake `bun` executable, so the
 * exit codes and output CI sees are asserted end to end.
 */

import {describe, expect, it} from 'bun:test';
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import fc from 'fast-check';

import {
  AuditReportError,
  checkLedger,
  evaluateAudit,
  formatOutcome,
  parseAdvisories,
  runBunAudit
} from '../scripts/run-audit.mjs';
import {propertyTestSeed} from './support/property-test-seed.ts';

const BRACES = 'GHSA-vfj7-8cjw-p6xm';
const OTHER = 'GHSA-aaaa-bbbb-cccc';
const URL_PREFIX = 'https://github.com/advisories/';
const LEDGER = [{id: 'BRACES', package: 'simulacat-core', advisory: BRACES, expiresAt: '2026-12-09'}];
const BEFORE_EXPIRY = new Date('2026-12-09T23:59:59Z');
const AFTER_EXPIRY = new Date('2026-12-10T00:00:00Z');
const repositoryRoot = path.join(import.meta.dir, '..');

/** Build an advisory summary. */
const advisory = (id, name = 'braces') => ({package: name, id, title: `${name} advisory`});
/** Build a Bun report for one advisory. */
const report = (id, name = 'braces') => ({[name]: [{url: `${URL_PREFIX}${id}`, title: `${name} advisory`}]});

describe('parseAdvisories', () => {
  it('reads a top-level report and extracts the identifier from the url', () => {
    expect(parseAdvisories(report(BRACES))).toEqual([advisory(BRACES)]);
  });

  it('reads a report nested under `advisories` and prefers github_advisory_id', () => {
    const nested = {advisories: {braces: [{github_advisory_id: OTHER, url: `${URL_PREFIX}${BRACES}`}]}};
    expect(parseAdvisories(nested).map(({id}) => id)).toEqual([OTHER]);
  });

  it('returns no identifier when the advisory carries none', () => {
    expect(parseAdvisories({pkg: [{title: 'x'}]})[0].id).toBeNull();
  });

  it('accepts an empty report', () => {
    expect(parseAdvisories({})).toEqual([]);
  });

  it.each([
    [null],
    ['text'],
    [[]],
    [{advisories: 3}],
    [{braces: 'not an array'}]
  ])('rejects the malformed report %j instead of reading it as clean', (bad) => {
    expect(() => parseAdvisories(bad)).toThrow(AuditReportError);
  });
});

describe('checkLedger', () => {
  it('accepts an entry on its last day', () => {
    expect(checkLedger(LEDGER, BEFORE_EXPIRY)).toEqual([]);
  });

  it('reports an entry from the day after its date', () => {
    expect(checkLedger(LEDGER, AFTER_EXPIRY)).toEqual([`Audit exception BRACES for ${BRACES} expired on 2026-12-09.`]);
  });

  it.each([
    ['2026-02-30'],
    ['2026-13-01'],
    ['2026-12-09T00:00:00Z'],
    ['soon'],
    [undefined]
  ])('rejects the expiry %j', (expiresAt) => {
    const problems = checkLedger([{id: 'X', advisory: BRACES, expiresAt}], BEFORE_EXPIRY);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('YYYY-MM-DD');
  });

  it('reports a duplicated entry id', () => {
    expect(checkLedger([...LEDGER, ...LEDGER], BEFORE_EXPIRY)).toEqual([
      'Audit exception BRACES is listed more than once.'
    ]);
  });
});

describe('invalid reference date', () => {
  it('is rejected by the ledger check instead of disabling expiry', () => {
    expect(() => checkLedger(LEDGER, new Date('not-a-date'))).toThrow('Invalid audit reference date');
  });

  it('is rejected by the decision', () => {
    expect(() =>
      evaluateAudit({advisories: [advisory(BRACES)], ledger: LEDGER, now: new Date(Number.NaN), status: 1})
    ).toThrow(TypeError);
  });
});

describe('evaluateAudit', () => {
  const evaluate = (advisories, now = BEFORE_EXPIRY, status = 1, ledger = LEDGER) =>
    evaluateAudit({advisories, ledger, now, status});

  it('passes a covered advisory before its entry expires', () => {
    expect(evaluate([advisory(BRACES)]).code).toBe(0);
  });

  it('fails a covered advisory once its entry has expired', () => {
    expect(evaluate([advisory(BRACES)], AFTER_EXPIRY).code).toBe(1);
  });

  it('fails an expired entry even when its advisory is no longer reported', () => {
    expect(evaluate([], AFTER_EXPIRY, 0).code).toBe(1);
  });

  it('fails an uncovered advisory beside a covered one', () => {
    const outcome = evaluate([advisory(BRACES), advisory(OTHER, 'other')]);
    expect(outcome.code).toBe(1);
    expect(outcome.unexpected.map(({id}) => id)).toEqual([OTHER]);
  });

  it('fails an advisory without an identifier', () => {
    expect(evaluate([advisory(null)]).code).toBe(1);
  });

  it('keeps Bun status when nothing is covered', () => {
    expect(evaluate([], BEFORE_EXPIRY, 0).code).toBe(0);
    expect(evaluate([], BEFORE_EXPIRY, 1).code).toBe(1);
  });
});

describe('evaluateAudit partition (property)', () => {
  const identifier = fc.constantFrom(BRACES, OTHER, 'GHSA-1111-2222-3333', null);
  const advisories = fc.array(fc.record({package: fc.constantFrom('a', 'b'), id: identifier, title: fc.constant('t')}));
  const allowed = fc.uniqueArray(fc.constantFrom(BRACES, OTHER, 'GHSA-1111-2222-3333'));

  it('puts every advisory in exactly one group, whatever the order', () => {
    fc.assert(
      fc.property(advisories, allowed, (items, ids) => {
        const ledger = ids.map((advisoryId, index) => ({
          id: `E${index}`,
          advisory: advisoryId,
          expiresAt: '2099-01-01'
        }));
        const run = (list) => evaluateAudit({advisories: list, ledger, now: BEFORE_EXPIRY, status: 1});
        const forward = run(items);
        const reversed = run([...items].reverse());
        expect(forward.covered.length + forward.unexpected.length).toBe(items.length);
        expect(forward.covered.every((item) => ids.includes(item.id))).toBe(true);
        expect(forward.unexpected.every((item) => item.id === null || !ids.includes(item.id))).toBe(true);
        expect(reversed.code).toBe(forward.code);
        expect(reversed.covered.length).toBe(forward.covered.length);
      }),
      {numRuns: 200, seed: propertyTestSeed}
    );
  });
});

describe('formatOutcome', () => {
  it('prints the covered summary', () => {
    expect(
      formatOutcome(evaluateAudit({advisories: [advisory(BRACES)], ledger: LEDGER, now: BEFORE_EXPIRY, status: 1}))
    ).toMatchSnapshot();
  });

  it('prints the unexpected advisories under their heading', () => {
    expect(
      formatOutcome(
        evaluateAudit({advisories: [advisory(OTHER, 'other')], ledger: LEDGER, now: BEFORE_EXPIRY, status: 1})
      )
    ).toMatchSnapshot();
  });

  it('prints the expiry problem', () => {
    expect(
      formatOutcome(evaluateAudit({advisories: [advisory(BRACES)], ledger: LEDGER, now: AFTER_EXPIRY, status: 1}))
    ).toMatchSnapshot();
  });
});

describe('runBunAudit', () => {
  const spawn = (result) => () => result;

  it('parses the report and keeps the status', () => {
    expect(runBunAudit(spawn({status: 1, stdout: ' {"a": []} '}))).toEqual({report: {a: []}, status: 1});
  });

  it('treats empty output as an empty report', () => {
    expect(runBunAudit(spawn({status: 0, stdout: '  '}))).toEqual({report: {}, status: 0});
  });

  it('rethrows a spawn error', () => {
    expect(() => runBunAudit(spawn({error: new Error('ENOENT')}))).toThrow('ENOENT');
  });

  it('rejects a run ended by a signal', () => {
    expect(() => runBunAudit(spawn({status: null, signal: 'SIGKILL'}))).toThrow('signal: SIGKILL');
  });

  it('rejects output that is not JSON', () => {
    expect(() => runBunAudit(spawn({status: 1, stdout: 'oops'}))).toThrow(AuditReportError);
  });
});

describe('scripts/run-audit.mjs (fake bun)', () => {
  /** Run the CLI with a `bun` on PATH that prints `stdout` and exits with `status`. */
  function runCli({stdout, status, referenceDate}) {
    const directory = mkdtempSync(path.join(tmpdir(), 'run-audit-'));
    try {
      const fixture = path.join(directory, 'report.json');
      writeFileSync(fixture, stdout);
      const bun = path.join(directory, 'bun');
      writeFileSync(bun, `#!/bin/sh\ncat '${fixture}'\nexit ${status}\n`);
      chmodSync(bun, 0o755);
      const env = {...process.env, PATH: `${directory}:${process.env.PATH}`};
      if (referenceDate) env.AUDIT_REFERENCE_DATE = referenceDate;
      const result = spawnSync(process.execPath, ['scripts/run-audit.mjs'], {
        cwd: repositoryRoot,
        env,
        encoding: 'utf8'
      });
      return {code: result.status, stdout: result.stdout, stderr: result.stderr};
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  }

  const braces = JSON.stringify(report(BRACES));

  it('passes a covered advisory', () => {
    const result = runCli({stdout: braces, status: 1, referenceDate: '2026-10-09'});
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('covered by the audit exception ledger (1 advisory)');
  });

  it('fails an uncovered advisory and names it', () => {
    const result = runCli({stdout: JSON.stringify(report(OTHER, 'other')), status: 1, referenceDate: '2026-10-09'});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`- ${OTHER} (other)`);
  });

  it('fails once the exception has expired', () => {
    const result = runCli({stdout: braces, status: 1, referenceDate: '2026-12-10'});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('expired on 2026-12-09');
  });

  it('fails an expired exception even with an empty report', () => {
    expect(runCli({stdout: '', status: 0, referenceDate: '2026-12-10'}).code).toBe(1);
  });

  it('passes an empty report before expiry', () => {
    expect(runCli({stdout: '', status: 0, referenceDate: '2026-10-09'}).code).toBe(0);
  });

  it('fails an invalid AUDIT_REFERENCE_DATE and says why', () => {
    const result = runCli({stdout: braces, status: 1, referenceDate: 'not-a-date'});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Invalid audit reference date');
  });

  it('fails output that is not JSON', () => {
    const result = runCli({stdout: 'not json', status: 1, referenceDate: '2026-10-09'});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Failed to parse bun audit JSON');
  });
});
