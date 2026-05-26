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

/** Preferred request correlation header included in actor diagnostic logs. */
export const requestIdHeader = 'x-request-id';

/** Alternate request correlation header included in actor diagnostic logs. */
export const correlationIdHeader = 'x-correlation-id';

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

/**
 * Matches canonical positive integer text without leading zeroes.
 *
 * Used when parsing numeric app and installation identifiers where `007`
 * must not be treated as the number `7`.
 */
const positiveIntegerPattern = /^[1-9]\d*$/;

/**
 * Matches integer-shaped text, including non-positive and leading-zero input.
 *
 * App identifiers use this broader shape to reject invalid integer-like input
 * instead of silently treating it as an app slug.
 */
const integerPattern = /^-?\d+$/;

/**
 * In-process counters keyed by actor-observation event dimensions.
 *
 * Concurrency model: This module assumes a single-threaded event loop (Node.js/Bun)
 * with no Worker threads mutating this state. The increment
 * `actorObservationCounters[key] = (actorObservationCounters[key] ?? 0) + 1`
 * relies on that guarantee; it is not atomic across threads.
 *
 * Constraint: Do not access or mutate these counters from Worker threads or
 * other processes. If a multi-threaded model is introduced, replace this map
 * with a SharedArrayBuffer-backed view and use Atomics.add, and update this
 * docstring accordingly. See `#14`.
 *
 * Tests reset this map via `resetActorObservationCounters()` for isolation.
 */
const actorObservationCounters: Record<string, number> = {};

/**
 * Structured payload recorded for actor parsing and resolution diagnostics.
 *
 * The payload intentionally uses non-sensitive actor labels and stable outcome
 * strings so optional debug logs can be correlated with counter keys.
 */
type ActorObservation = {
  /** Event family, for example `rest-parse` or `graphql-authentication`. */
  event: string;
  /** Actor kind associated with the observation when one is available. */
  actorKind?: RequestActor['kind'];
  /** Stable outcome label such as `parsed`, `resolved`, or `failure`. */
  outcome?: string;
  /** Optional failure or fallback reason used in counter keys. */
  reason?: string;
  /** Non-sensitive actor label suitable for diagnostics. */
  actor?: string;
  /** Header source used by parse observations. */
  source?: string;
  /** Route or GraphQL field used by authentication-failure observations. */
  surface?: string;
  /** Optional request identifier used only in structured logs, not metrics. */
  requestId?: string;
};

/** Correlation context attached to actor observations at adapter boundaries. */
export type ActorObservationContext = {
  /** Request identifier copied from `x-request-id` or `x-correlation-id`. */
  requestId?: string;
};

/**
 * Parsed request actor with non-sensitive diagnostic context.
 *
 * Adapters use this value to observe whether a header parsed directly, fell
 * back to anonymous, or defaulted because no actor header was present.
 */
export type RequestActorParseResult = {
  /** Actor selected from the request headers. */
  actor: RequestActor;
  /** Header source that selected the actor. */
  source: 'default' | 'legacy-github-user' | 'legacy-simulacat-user' | 'preferred';
  /** Whether parsing used an explicit actor or fell back to anonymous. */
  outcome: 'default' | 'fallback' | 'parsed';
  /** Optional reason for fallback outcomes. */
  reason?: string;
};

/**
 * Returns the non-sensitive actor label used in diagnostic actor events.
 *
 * @param actor Parsed or resolved actor to label.
 * @returns A stable label that avoids embedding seeded user fixture details.
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
 *
 * @returns True when `SIMULACAT_ACTOR_OBSERVABILITY` is `1` or `true`.
 */
const isActorObservationEnabled = (): boolean => {
  const {SIMULACAT_ACTOR_OBSERVABILITY: enabled} = process.env;
  return ['1', 'true'].includes(enabled ?? '');
};

/**
 * Extracts a request correlation identifier from supported headers.
 *
 * @param headers Header reader supplied by REST or GraphQL adapters.
 * @returns The first non-blank request id, or undefined when none is present.
 */
export const requestIdFromHeaders = (headers: HeaderReader): string | undefined => {
  const requestId = headers.get(requestIdHeader)?.trim();
  if (requestId) return requestId;
  const correlationId = headers.get(correlationIdHeader)?.trim();
  return correlationId || undefined;
};

/**
 * Adds request correlation context to a structured observation.
 *
 * @param observation Base actor observation.
 * @param context Optional request correlation context.
 * @returns Observation enriched with request id when one is available.
 */
const withObservationContext = (
  observation: ActorObservation,
  context: ActorObservationContext | undefined
): ActorObservation => {
  return context?.requestId ? {...observation, requestId: context.requestId} : observation;
};

/**
 * Records an actor selection observation and optionally logs it.
 *
 * @param observation Structured observation to count and, when enabled, emit
 * as a JSON debug line.
 */
const recordActorObservation = (observation: ActorObservation): void => {
  const key = [
    observation.event,
    observation.actorKind,
    observation.outcome,
    observation.source ?? '',
    observation.reason
  ]
    .filter((part) => part !== undefined)
    .join('.');
  actorObservationCounters[key] = (actorObservationCounters[key] ?? 0) + 1;

  if (isActorObservationEnabled()) {
    console.debug(JSON.stringify({component: 'simulacat.actor', ...observation}));
  }
};

/**
 * Returns a snapshot of actor selection counters.
 *
 * @returns Copy of the current process-local actor observability counters.
 */
export const getActorObservabilityCounters = (): Readonly<Record<string, number>> => {
  return Object.fromEntries(
    Object.entries(actorObservationCounters).map(([key, value]) => {
      const [event = '', actorKind = '', outcome = '', source = '', ...reasonParts] = key.split('.');
      const publicKey = [event, actorKind, outcome, source || undefined, ...reasonParts]
        .filter((part) => part !== undefined)
        .join('.');
      return [publicKey, value];
    })
  );
};

/**
 * Escapes a Prometheus label value for text exposition.
 *
 * @param value Raw label value.
 * @returns Label value with backslashes, quotes, and newlines escaped.
 */
const escapePrometheusLabel = (value: string): string => {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
};

/**
 * Exports actor observation counters in Prometheus text exposition format.
 *
 * Labels are deliberately bounded to event, actor kind, outcome, source, and
 * reason; request ids and actor labels are emitted only in structured logs.
 */
export const getActorObservabilityMetrics = (): string => {
  const lines = [
    '# HELP simulacat_actor_observations_total Actor authentication observations.',
    '# TYPE simulacat_actor_observations_total counter'
  ];
  for (const [key, value] of Object.entries(actorObservationCounters).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const [event = '', actorKind = '', outcome = '', source = '', ...reasonParts] = key.split('.');
    const reason = reasonParts.join('.');
    const labels = [
      `event="${escapePrometheusLabel(event)}"`,
      `actor_kind="${escapePrometheusLabel(actorKind)}"`,
      `outcome="${escapePrometheusLabel(outcome)}"`,
      `source="${escapePrometheusLabel(source)}"`,
      `reason="${escapePrometheusLabel(reason)}"`
    ].join(',');
    lines.push(`simulacat_actor_observations_total{${labels}} ${value}`);
  }
  return `${lines.join('\n')}\n`;
};

/**
 * Clears actor observability counters for test isolation.
 *
 * Removes every process-local counter so subsequent tests start from a known
 * empty observation state.
 */
export const resetActorObservationCounters = (): void => {
  for (const key of Object.keys(actorObservationCounters)) {
    delete actorObservationCounters[key];
  }
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
 * The two string parts extracted from a kinded actor header value.
 *
 * Produced by `parseActorHeaderValue` and consumed exclusively by
 * `parseKindedActor` to keep string-argument density within threshold.
 */
type SplitHeaderValue = {
  /** Actor kind string extracted from the header (e.g. 'user', 'app'). */
  kind: string;
  /** Raw identifier portion following the colon separator. */
  rawIdentifier: string;
};

/**
 * Dispatches to the per-kind parse helper based on `kind`.
 *
 * Returns undefined for any kind that is not `user`, `app`, or
 * `installation`.
 */
const parseKindedActor = ({kind, rawIdentifier}: SplitHeaderValue): RequestActor | undefined => {
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
    return {kind: 'anonymous'};
  }

  const separatorIndex = value.indexOf(':');
  if (separatorIndex < 0) {
    return undefined;
  }

  const kind = value.slice(0, separatorIndex);
  const rawIdentifier = value.slice(separatorIndex + 1).trim();
  if (!rawIdentifier) {
    return undefined;
  }

  return parseKindedActor({kind, rawIdentifier});
};

/**
 * Selects the request actor from preferred and legacy actor headers.
 *
 * Prefers the `x-simulacat-actor` header, falling back to anonymous on parse
 * failure. Otherwise reads `x-simulacat-user` then `x-github-user` as
 * compatibility aliases, and defaults to anonymous when neither is present.
 */
export const parseRequestActor = (headers: HeaderReader): RequestActor => {
  return parseRequestActorWithDiagnostics(headers).actor;
};

/** Discriminates the two legacy login header sources. */
type LegacyHeaderSource = 'legacy-simulacat-user' | 'legacy-github-user';

/**
 * Parses the preferred `x-simulacat-actor` header value into diagnostics.
 *
 * Returns the parsed actor when `parseActorHeaderValue` succeeds. Falls back
 * to anonymous with reason `invalid-preferred-header` when the preferred
 * header cannot be parsed.
 */
const parsePreferredActorHeader = (actorHeader: string): RequestActorParseResult => {
  const actor = parseActorHeaderValue(actorHeader);
  return actor
    ? {actor, source: 'preferred', outcome: 'parsed'}
    : {
        actor: {kind: 'anonymous'},
        source: 'preferred',
        outcome: 'fallback',
        reason: 'invalid-preferred-header'
      };
};

/**
 * Parses a legacy login header value into actor parse diagnostics.
 *
 * Trims the header value and produces a user actor for non-empty login
 * strings. Blank legacy header values collapse to anonymous with reason
 * `blank-legacy-header`.
 */
const parseLegacyLoginHeader = (headerValue: string, source: LegacyHeaderSource): RequestActorParseResult => {
  const login = headerValue.trim();
  return login
    ? {actor: {kind: 'user', login}, source, outcome: 'parsed'}
    : {actor: {kind: 'anonymous'}, source, outcome: 'fallback', reason: 'blank-legacy-header'};
};

/**
 * Selects the request actor and returns parse diagnostics for adapters.
 *
 * This is a pure helper: it records no metrics and emits no logs. REST and
 * GraphQL adapters use the diagnostic result to observe parse outcomes at the
 * transport boundary.
 *
 * @param headers Header reader shim supplied by a transport adapter.
 * @returns The selected actor plus source, outcome, and fallback reason.
 */
export const parseRequestActorWithDiagnostics = (headers: HeaderReader): RequestActorParseResult => {
  const actorHeader = headers.get(requestActorHeader);
  if (actorHeader !== null && actorHeader !== undefined) {
    return parsePreferredActorHeader(actorHeader);
  }

  const simulacatLogin = headers.get(legacySimulacatUserHeader);
  if (simulacatLogin !== null && simulacatLogin !== undefined) {
    return parseLegacyLoginHeader(simulacatLogin, 'legacy-simulacat-user');
  }

  const githubLogin = headers.get(legacyGitHubUserHeader);
  if (githubLogin !== null && githubLogin !== undefined) {
    return parseLegacyLoginHeader(githubLogin, 'legacy-github-user');
  }

  return {actor: {kind: 'anonymous'}, source: 'default', outcome: 'default'};
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
 * Records the final selected request actor for a transport adapter boundary.
 *
 * @param transport Adapter surface that selected the actor.
 * @param actor Resolved actor selected for the request.
 * @param context Optional request correlation context for structured logs.
 */
export const observeSelectedActor = (
  transport: 'graphql' | 'rest',
  actor: ResolvedRequestActor,
  context?: ActorObservationContext
): void => {
  recordActorObservation(
    withObservationContext(
      {
        event: `${transport}-selected`,
        actorKind: actor.kind,
        outcome: 'selected',
        actor: actorDiagnosticLabel(actor)
      },
      context
    )
  );
};

/** Outcome and optional reason returned by actor resolution classifiers. */
type ResolutionOutcome = {
  /** Stable resolution outcome label such as `resolved` or `unresolved`. */
  outcome: string;
  /** Optional bounded reason label explaining unresolved outcomes. */
  reason?: string;
};

/**
 * Returns the resolution outcome for a `user` actor.
 *
 * Produces `resolved` when the resolved actor kind is still `user`, otherwise
 * `unresolved` with reason `unknown-user`.
 */
const userResolutionOutcome = (resolvedActor: ResolvedRequestActor): ResolutionOutcome => {
  return resolvedActor.kind === 'user' ? {outcome: 'resolved'} : {outcome: 'unresolved', reason: 'unknown-user'};
};

/** Reports whether an app actor resolved to a seeded installation. */
const hasResolvedAppInstallation = (resolvedActor: ResolvedRequestActor): boolean => {
  return resolvedActor.kind === 'app' && resolvedActor.installation !== undefined;
};

/**
 * Returns the resolution outcome for an `app` actor.
 *
 * Produces `resolved` when the resolved actor kind is `app` and an
 * installation is attached; otherwise `unresolved` with reason
 * `unmatched-app`.
 */
const appResolutionOutcome = (resolvedActor: ResolvedRequestActor): ResolutionOutcome => {
  return hasResolvedAppInstallation(resolvedActor)
    ? {outcome: 'resolved'}
    : {outcome: 'unresolved', reason: 'unmatched-app'};
};

/** Reports whether an installation actor resolved to a seeded installation. */
const hasResolvedInstallation = (resolvedActor: ResolvedRequestActor): boolean => {
  return resolvedActor.kind === 'installation' && resolvedActor.installation !== undefined;
};

/**
 * Returns the resolution outcome for an `installation` actor.
 *
 * Produces `resolved` when the resolved actor kind is `installation` and an
 * installation is attached; otherwise `unresolved` with reason
 * `unmatched-installation`.
 */
const installationResolutionOutcome = (resolvedActor: ResolvedRequestActor): ResolutionOutcome => {
  return hasResolvedInstallation(resolvedActor)
    ? {outcome: 'resolved'}
    : {outcome: 'unresolved', reason: 'unmatched-installation'};
};

/**
 * Classifies the store-resolution outcome for a parsed request actor.
 *
 * @param actor Parsed actor before seeded fixture lookup.
 * @param resolvedActor Actor returned by `resolveRequestActor`.
 * @returns Stable outcome and optional reason labels for diagnostics.
 */
const actorResolutionOutcome = (actor: RequestActor, resolvedActor: ResolvedRequestActor): ResolutionOutcome => {
  switch (actor.kind) {
    case 'anonymous':
      return {outcome: 'anonymous'};
    case 'user':
      return userResolutionOutcome(resolvedActor);
    case 'app':
      return appResolutionOutcome(resolvedActor);
    case 'installation':
      return installationResolutionOutcome(resolvedActor);
    default: {
      const exhaustive: never = actor;
      throw new Error(`Unsupported request actor kind: ${JSON.stringify(exhaustive)}`);
    }
  }
};

/**
 * Records request actor parse diagnostics for a transport adapter boundary.
 *
 * @param transport Adapter surface that parsed the request actor.
 * @param result Parsed actor result returned by `parseRequestActorWithDiagnostics`.
 * @param context Optional request correlation context for structured logs.
 */
export const observeParsedRequestActor = (
  transport: 'graphql' | 'rest',
  result: RequestActorParseResult,
  context?: ActorObservationContext
): void => {
  const observation: ActorObservation = {
    event: `${transport}-parse`,
    actorKind: result.actor.kind,
    outcome: result.outcome,
    source: result.source,
    actor: actorDiagnosticLabel(result.actor)
  };
  if (result.reason !== undefined) {
    observation.reason = result.reason;
  }
  recordActorObservation(withObservationContext(observation, context));
};

/**
 * Records how a parsed request actor resolved against seeded store tables.
 *
 * @param transport Adapter surface that resolved the actor.
 * @param actor Parsed actor before fixture-backed resolution.
 * @param resolvedActor Actor after matching seeded users and installations.
 * @param context Optional request correlation context for structured logs.
 */
export const observeResolvedRequestActor = (
  transport: 'graphql' | 'rest',
  actor: RequestActor,
  resolvedActor: ResolvedRequestActor,
  context?: ActorObservationContext
): void => {
  const result = actorResolutionOutcome(actor, resolvedActor);
  const observation: ActorObservation = {
    event: `${transport}-resolution`,
    actorKind: actor.kind,
    outcome: result.outcome,
    actor: actorDiagnosticLabel(actor)
  };
  if (result.reason !== undefined) {
    observation.reason = result.reason;
  }
  recordActorObservation(withObservationContext(observation, context));
};

/**
 * Records a 401 or GraphQL authentication failure for a protected surface.
 *
 * @param transport Adapter surface that rejected the request.
 * @param actor Resolved actor that failed to authenticate as a user.
 * @param surface Route or GraphQL field that required authentication.
 * @param context Optional request correlation context for structured logs.
 */
export const observeAuthenticationFailure = (
  transport: 'graphql' | 'rest',
  actor: ResolvedRequestActor,
  surface: string,
  context?: ActorObservationContext
): void => {
  recordActorObservation(
    withObservationContext(
      {
        event: `${transport}-authentication`,
        actorKind: actor.kind,
        outcome: 'failure',
        reason: surface,
        surface,
        actor: actorDiagnosticLabel(actor)
      },
      context
    )
  );
};

/**
 * Returns the resolved GitHub user for user actors.
 *
 * Returns undefined for anonymous, app, installation, and unresolved actors.
 */
export const selectAuthenticatedUser = (actor: ResolvedRequestActor): GitHubUser | undefined => {
  return actor.kind === 'user' ? actor.user : undefined;
};
