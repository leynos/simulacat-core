/** @file Bounded observability for request-derived URL construction. */
import type {BaseUrls} from './request-url.ts';

export type UrlObservationTransport = 'graphql' | 'internal' | 'rest';
export type UrlObservationOutcome = 'failure' | 'fallback' | 'request-origin' | 'unhandled-typename';
export type UrlObservationReason =
  | 'invalid-fallback'
  | 'invalid-host'
  | 'invalid-protocol'
  | 'missing-fallback'
  | 'missing-host'
  | 'none'
  | 'unknown-typename';

export type UrlObservationContext = {
  transport: UrlObservationTransport;
  requestId?: string;
};

type UrlObservation = {
  event: 'base-url' | 'graphql-dispatch' | 'request-host';
  transport: UrlObservationTransport;
  outcome: UrlObservationOutcome;
  reason: UrlObservationReason;
  requestId?: string;
  typename?: string;
};

const urlObservationCounters: Record<string, number> = {};
let baseUrlObservationContexts = new WeakMap<BaseUrls, UrlObservationContext>();

/**
 * Builds a framework-neutral URL observation context.
 *
 * @param transport Adapter transport that derived the URL.
 * @param requestId Optional correlation ID for diagnostics only.
 * @returns Bounded URL-observation context.
 */
export const makeUrlObservationContext = (
  transport: UrlObservationTransport,
  requestId: string | undefined
): UrlObservationContext => (requestId ? {transport, requestId} : {transport});

/** Reports whether URL derivation diagnostics are enabled. */
const isUrlObservationEnabled = (): boolean => {
  const {SIMULACAT_URL_OBSERVABILITY: enabled} = process.env;
  return ['1', 'true'].includes(enabled ?? '');
};

/** Escapes a Prometheus label value for text exposition. */
const escapePrometheusLabel = (value: string): string => {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
};

/** Records one bounded URL observation and emits optional structured diagnostics. */
const recordUrlObservation = (observation: UrlObservation): void => {
  const key = [observation.event, observation.transport, observation.outcome, observation.reason].join('.');
  urlObservationCounters[key] = (urlObservationCounters[key] ?? 0) + 1;

  if (isUrlObservationEnabled()) {
    console.debug(JSON.stringify({component: 'simulacat.url', ...observation}));
  }
};

/**
 * Records a rejected request-origin component before attempting a fallback.
 *
 * @param context Bounded transport and optional diagnostic correlation context.
 * @param reason Stable rejection reason.
 */
export const observeRejectedRequestOrigin = (context: UrlObservationContext, reason: UrlObservationReason): void => {
  recordUrlObservation({event: 'request-host', ...context, outcome: 'failure', reason});
};

/**
 * Records the base URL source selected for a request.
 *
 * @param context Bounded transport and optional diagnostic correlation context.
 * @param outcome Base URL derivation outcome.
 * @param reason Stable derivation reason.
 */
export const observeBaseUrl = (
  context: UrlObservationContext,
  outcome: Extract<UrlObservationOutcome, 'failure' | 'fallback' | 'request-origin'>,
  reason: UrlObservationReason
): void => {
  recordUrlObservation({event: 'base-url', ...context, outcome, reason});
};

/**
 * Associates non-sensitive request context with a derived base URL object.
 *
 * @param baseUrls Derived request URL bases.
 * @param context Bounded transport and optional diagnostic correlation context.
 */
export const rememberBaseUrlObservationContext = (baseUrls: BaseUrls, context: UrlObservationContext): void => {
  baseUrlObservationContexts.set(baseUrls, context);
};

/**
 * Records an unknown GraphQL typename without serialising the rejected entity.
 *
 * @param baseUrls Derived request URL bases carrying request context.
 * @param typename Stable GraphQL typename supplied to the dispatcher.
 */
export const observeUnhandledGraphqlTypename = (baseUrls: BaseUrls, typename: string): void => {
  const context = baseUrlObservationContexts.get(baseUrls) ?? {transport: 'graphql'};
  recordUrlObservation({
    event: 'graphql-dispatch',
    ...context,
    transport: 'graphql',
    outcome: 'unhandled-typename',
    reason: 'unknown-typename',
    typename
  });
};

/**
 * Returns a copy of process-local URL observability counters.
 *
 * @returns Current bounded counter values.
 */
export const getUrlObservabilityCounters = (): Readonly<Record<string, number>> => ({...urlObservationCounters});

/**
 * Exports bounded URL observations in Prometheus text exposition format.
 *
 * @returns Prometheus text exposition for URL observations.
 */
export const getUrlObservabilityMetrics = (): string => {
  const lines = [
    '# HELP simulacat_url_derivation_observations_total Request-derived URL observations.',
    '# TYPE simulacat_url_derivation_observations_total counter'
  ];
  for (const [key, value] of Object.entries(urlObservationCounters).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const [event = '', transport = '', outcome = '', reason = ''] = key.split('.');
    const labels = [
      `event="${escapePrometheusLabel(event)}"`,
      `transport="${escapePrometheusLabel(transport)}"`,
      `outcome="${escapePrometheusLabel(outcome)}"`,
      `reason="${escapePrometheusLabel(reason)}"`
    ].join(',');
    lines.push(`simulacat_url_derivation_observations_total{${labels}} ${value}`);
  }
  return `${lines.join('\n')}\n`;
};

/** Clears URL counters and request-context associations for test isolation. */
export const resetUrlObservabilityCounters = (): void => {
  for (const key of Object.keys(urlObservationCounters)) {
    delete urlObservationCounters[key];
  }
  baseUrlObservationContexts = new WeakMap<BaseUrls, UrlObservationContext>();
};
