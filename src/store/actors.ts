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
  if (!value || value === 'anonymous') return {kind: 'anonymous'};

  const separatorIndex = value.indexOf(':');
  if (separatorIndex < 0) return undefined;

  const kind = value.slice(0, separatorIndex);
  const rawIdentifier = value.slice(separatorIndex + 1).trim();
  if (!rawIdentifier) return undefined;

  return parseKindedActor(kind, rawIdentifier);
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
  return user ? {...actor, user} : {kind: 'anonymous'};
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
  switch (actor.kind) {
    case 'anonymous':
      return actor;
    case 'user':
      return resolveUserActor(actor, input.users);
    case 'app':
      return resolveAppActor(actor, input.installations);
    case 'installation':
      return resolveInstallationActor(actor, input.installations);
    default: {
      const exhaustive: never = actor;
      throw new Error(`Unsupported request actor kind: ${JSON.stringify(exhaustive)}`);
    }
  }
};

/**
 * Returns the resolved GitHub user for user actors.
 *
 * Returns undefined for anonymous, app, installation, and unresolved actors.
 */
export const selectAuthenticatedUser = (actor: ResolvedRequestActor): GitHubUser | undefined => {
  return actor.kind === 'user' ? actor.user : undefined;
};
