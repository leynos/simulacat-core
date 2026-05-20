/**
 * @file Request-scoped actor parsing and selection helpers.
 *
 * This module keeps simulator actor policy out of REST and GraphQL adapters.
 * Adapters provide headers; selectors provide fixture rows; this module owns
 * the shared interpretation.
 */
import type {GitHubAppInstallation, GitHubUser} from './entities.ts';

/** Header used to select the request actor for REST and GraphQL calls. */
export const requestActorHeader = 'x-simulacat-actor';

/** Legacy header that selects an authenticated user actor by login. */
export const legacySimulacatUserHeader = 'x-simulacat-user';

/** GitHub-compatible legacy header that selects a user actor by login. */
export const legacyGitHubUserHeader = 'x-github-user';

/** Minimal header reader accepted by request actor parsing helpers. */
export type HeaderReader = {
  /** Return the header value for `name`, or nullish when it is absent. */
  get(name: string): string | null | undefined;
};

/** Anonymous request actor used when no authenticated principal is selected. */
export type AnonymousActor = {
  /** Discriminator for unauthenticated simulator requests. */
  kind: 'anonymous';
};

/** User request actor identified by a GitHub login, for example `user:dev`. */
export type UserActor = {
  /** Discriminator for authenticated user requests. */
  kind: 'user';

  /** Login used to resolve the actor against seeded `GitHubUser` rows. */
  login: string;
};

/** GitHub App request actor identified by either app id or slug. */
export type AppActor = {
  /** Discriminator for GitHub App requests. */
  kind: 'app';

  /** Numeric app id parsed from `app:<id>` when the identifier is numeric. */
  appId?: number;

  /** App slug parsed from `app:<slug>` when the identifier is non-numeric. */
  slug?: string;
};

/** Installation request actor identified by a GitHub App installation id. */
export type InstallationActor = {
  /** Discriminator for installation-scoped requests. */
  kind: 'installation';

  /** Installation id parsed from `installation:<id>`. */
  installationId: number;
};

/** Parsed request actor before fixture-backed store resolution. */
export type RequestActor = AnonymousActor | UserActor | AppActor | InstallationActor;

/**
 * Request actor after matching against seeded users or installations.
 *
 * User actors include a `GitHubUser` only when their login resolves. App and
 * installation actors may include a `GitHubAppInstallation` for later policy
 * decisions.
 */
export type ResolvedRequestActor =
  | AnonymousActor
  | (UserActor & {user: GitHubUser})
  | (AppActor & {installation?: GitHubAppInstallation})
  | (InstallationActor & {installation?: GitHubAppInstallation});

const positiveIntegerPattern = /^[1-9]\d*$/;
const integerPattern = /^-?\d+$/;

/** In-process counters keyed by actor observation event dimensions. */
const actorObservationCounters: Record<string, number> = {};

/** Structured payload recorded for actor parsing and resolution diagnostics. */
type ActorObservation = {
  event: string;
  actorKind?: RequestActor['kind'];
  outcome?: string;
  reason?: string;
  actor?: string;
};

/**
 * Returns the non-sensitive actor label used in diagnostic actor events.
 */
const actorDiagnosticLabel = (actor: RequestActor | ResolvedRequestActor): string => {
  switch (actor.kind) {
    case 'anonymous':
      return 'anonymous';
    case 'user':
      return `user:${actor.login}`;
    case 'app':
      return actor.appId === undefined ? `app:${actor.slug}` : `app:${actor.appId}`;
    case 'installation':
      return `installation:${actor.installationId}`;
    default: {
      const exhaustive: never = actor;
      return JSON.stringify(exhaustive);
    }
  }
};

/**
 * Reports whether actor diagnostic events should be emitted to stderr.
 */
const isActorObservationEnabled = (): boolean => {
  const {SIMULACAT_ACTOR_OBSERVABILITY: enabled} = process.env;
  return ['1', 'true'].includes(enabled ?? '');
};

/**
 * Records an actor parse or resolution observation and optionally logs it.
 */
const recordActorObservation = (observation: ActorObservation): void => {
  const key = [observation.event, observation.actorKind, observation.outcome, observation.reason]
    .filter((part) => part !== undefined)
    .join('.');
  actorObservationCounters[key] = (actorObservationCounters[key] ?? 0) + 1;

  if (isActorObservationEnabled()) {
    console.debug(JSON.stringify({component: 'simulacat.actor', ...observation}));
  }
};

/**
 * Returns a snapshot of actor parse and resolution counters.
 */
export const getActorObservabilityCounters = (): Readonly<Record<string, number>> => {
  return {...actorObservationCounters};
};

/**
 * Parses a string as a positive (> 0) safe integer.
 *
 * Returns the numeric value when the input matches a whole positive-integer
 * pattern and falls within `Number.MAX_SAFE_INTEGER`; returns undefined
 * otherwise.
 */
const parsePositiveInteger = (input: string): number | undefined => {
  if (!positiveIntegerPattern.test(input)) return undefined;
  const value = Number(input);
  return Number.isSafeInteger(value) ? value : undefined;
};

/**
 * Parses the identifier portion of an `app:` actor value.
 *
 * Returns `{kind: 'app', appId}` when the identifier is a positive integer,
 * `{kind: 'app', slug}` for non-numeric identifiers, and undefined for
 * integer-shaped identifiers that are not positive.
 */
const parseAppActor = (rawIdentifier: string): RequestActor | undefined => {
  const appId = parsePositiveInteger(rawIdentifier);
  if (appId !== undefined) return {kind: 'app', appId};
  return integerPattern.test(rawIdentifier) ? undefined : {kind: 'app', slug: rawIdentifier};
};

/**
 * Parses the identifier portion of an `installation:` actor value.
 *
 * Returns `{kind: 'installation', installationId}` for a positive integer, or
 * undefined for any other input.
 */
const parseInstallationActor = (rawIdentifier: string): RequestActor | undefined => {
  const installationId = parsePositiveInteger(rawIdentifier);
  return installationId === undefined ? undefined : {kind: 'installation', installationId};
};

/**
 * Dispatches to the per-kind parse helper based on `kind`.
 *
 * Returns undefined for any kind that is not `user`, `app`, or
 * `installation`.
 */
const parseKindedActor = (kind: string, rawIdentifier: string): RequestActor | undefined => {
  switch (kind) {
    case 'user':
      return {kind: 'user', login: rawIdentifier};
    case 'app':
      return parseAppActor(rawIdentifier);
    case 'installation':
      return parseInstallationActor(rawIdentifier);
    default:
      return undefined;
  }
};

/**
 * Parses a single actor header value into a request actor.
 *
 * Trims the value; returns the anonymous actor for an empty string or the
 * literal `anonymous`; returns undefined for an unknown kind, a missing
 * separator, or an empty identifier; delegates per-kind parsing to private
 * helpers.
 */
export const parseActorHeaderValue = (headerValue: string): RequestActor | undefined => {
  const value = headerValue.trim();
  if (!value || value === 'anonymous') {
    recordActorObservation({event: 'parse', actorKind: 'anonymous', outcome: 'accepted'});
    return {kind: 'anonymous'};
  }

  const separatorIndex = value.indexOf(':');
  if (separatorIndex < 0) {
    recordActorObservation({event: 'parse', outcome: 'rejected', reason: 'missing-separator'});
    return undefined;
  }

  const kind = value.slice(0, separatorIndex);
  const rawIdentifier = value.slice(separatorIndex + 1).trim();
  if (!rawIdentifier) {
    recordActorObservation({event: 'parse', outcome: 'rejected', reason: 'empty-identifier'});
    return undefined;
  }

  const actor = parseKindedActor(kind, rawIdentifier);
  recordActorObservation({
    event: 'parse',
    outcome: actor === undefined ? 'rejected' : 'accepted',
    ...(actor === undefined
      ? {reason: 'unknown-or-invalid-kind'}
      : {actorKind: actor.kind, actor: actorDiagnosticLabel(actor)})
  });
  return actor;
};

/**
 * Selects the request actor from preferred and legacy actor headers.
 *
 * Prefers the `x-simulacat-actor` header, falling back to anonymous on parse
 * failure. Otherwise reads `x-simulacat-user` then `x-github-user` as
 * compatibility aliases, and defaults to anonymous when neither is present.
 */
export const parseRequestActor = (headers: HeaderReader): RequestActor => {
  const actorHeader = headers.get(requestActorHeader);
  if (actorHeader !== null && actorHeader !== undefined) {
    return parseActorHeaderValue(actorHeader) ?? {kind: 'anonymous'};
  }

  const legacyLogin = headers.get(legacySimulacatUserHeader) ?? headers.get(legacyGitHubUserHeader);
  if (legacyLogin?.trim()) {
    return {kind: 'user', login: legacyLogin.trim()};
  }

  return {kind: 'anonymous'};
};

/**
 * Resolves a user actor against the seeded users table.
 *
 * Returns `{...actor, user}` when a seeded user login matches `actor.login`,
 * otherwise collapses to `{kind: 'anonymous'}`.
 */
const resolveUserActor = (actor: UserActor, users: readonly GitHubUser[]): ResolvedRequestActor => {
  const user = users.find((candidate) => candidate.login === actor.login);
  const resolvedActor: ResolvedRequestActor = user ? {...actor, user} : {kind: 'anonymous'};
  recordActorObservation({
    event: 'resolve-user',
    actorKind: actor.kind,
    outcome: user ? 'matched' : 'collapsed-to-anonymous',
    actor: actorDiagnosticLabel(actor),
    ...(user ? {} : {reason: 'unknown-user'})
  });
  return resolvedActor;
};

/**
 * Finds the installation that belongs to an app actor.
 *
 * Searches installations by `app_id` when `actor.appId` is set, or by
 * `app_slug` when only `actor.slug` is set.
 */
const findInstallationForApp = (
  actor: AppActor,
  installations: readonly GitHubAppInstallation[]
): GitHubAppInstallation | undefined => {
  if (actor.appId !== undefined) {
    return installations.find((candidate) => candidate.app_id === actor.appId);
  }

  return installations.find((candidate) => candidate.app_slug === actor.slug);
};

/**
 * Resolves an app actor against seeded installations.
 *
 * Returns `{...actor, installation}` when a matching installation is found,
 * otherwise returns `actor` unchanged.
 */
const resolveAppActor = (actor: AppActor, installations: readonly GitHubAppInstallation[]): ResolvedRequestActor => {
  const installation = findInstallationForApp(actor, installations);
  return installation ? {...actor, installation} : actor;
};

/**
 * Resolves an installation actor against seeded installations.
 *
 * Finds the installation whose `id` matches `actor.installationId`. Returns
 * `{...actor, installation}` when found, otherwise returns `actor` unchanged.
 */
const resolveInstallationActor = (
  actor: InstallationActor,
  installations: readonly GitHubAppInstallation[]
): ResolvedRequestActor => {
  const installation = installations.find((candidate) => candidate.id === actor.installationId);
  return installation ? {...actor, installation} : actor;
};

/**
 * Records whether an app or installation actor resolved to an installation.
 */
const observeResolvedActor = (
  actor: AppActor | InstallationActor,
  resolvedActor: ResolvedRequestActor
): ResolvedRequestActor => {
  recordActorObservation({
    event: 'resolve',
    actorKind: actor.kind,
    outcome: 'installation' in resolvedActor ? 'matched-installation' : 'unmatched-installation',
    actor: actorDiagnosticLabel(actor)
  });
  return resolvedActor;
};

/**
 * Enriches a parsed actor against seeded users and installations tables.
 *
 * Unknown user actors collapse to anonymous. App and installation actors are
 * enriched with the matching installation record when one is found.
 */
export const resolveRequestActor = (
  actor: RequestActor,
  input: {
    users: readonly GitHubUser[];
    installations: readonly GitHubAppInstallation[];
  }
): ResolvedRequestActor => {
  recordActorObservation({
    event: 'resolve',
    actorKind: actor.kind,
    outcome: 'started',
    actor: actorDiagnosticLabel(actor)
  });
  switch (actor.kind) {
    case 'anonymous':
      recordActorObservation({event: 'resolve', actorKind: actor.kind, outcome: 'anonymous'});
      return actor;
    case 'user':
      return resolveUserActor(actor, input.users);
    case 'app':
      return observeResolvedActor(actor, resolveAppActor(actor, input.installations));
    case 'installation':
      return observeResolvedActor(actor, resolveInstallationActor(actor, input.installations));
    default: {
      const exhaustive: never = actor;
      throw new Error(`Unsupported request actor kind: ${JSON.stringify(exhaustive)}`);
    }
  }
};

/**
 * Records the final selected request actor for a transport adapter boundary.
 */
export const observeSelectedActor = (transport: 'graphql' | 'rest', actor: ResolvedRequestActor): void => {
  recordActorObservation({
    event: `${transport}-selected`,
    actorKind: actor.kind,
    outcome: actor.kind === 'user' ? 'authenticated' : 'unauthenticated',
    actor: actorDiagnosticLabel(actor)
  });
};

/**
 * Returns the resolved GitHub user for user actors.
 *
 * Returns undefined for anonymous, app, installation, and unresolved actors.
 */
export const selectAuthenticatedUser = (actor: ResolvedRequestActor): GitHubUser | undefined => {
  return actor.kind === 'user' ? actor.user : undefined;
};
