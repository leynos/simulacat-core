/**
 * @file Repository write observability counters and optional diagnostic logs.
 *
 * Counters are process-local and use synchronous, no-`await` read-modify-write
 * operations. They are atomic with respect to JavaScript callbacks in the
 * current single-event-loop Bun/Node runtime, but are not shared across
 * processes. A Worker-thread or shared-memory runtime would need a redesign
 * with `worker_threads`, `SharedArrayBuffer`, or another shared-memory
 * primitive; see [GitHub issue #14](https://github.com/leynos/simulacat-core/issues/14).
 */

type RepositoryWriteReason = 'missing-repository' | 'unshaped-repository';

type RepositoryWriteObservation =
  | {operation: 'patch'; outcome: 'success'}
  | {operation: 'patch'; outcome: 'not-found'; reason: RepositoryWriteReason};

const repositoryWriteMetricSeries = {
  'patch.success': {operation: 'patch', outcome: 'success', reason: ''},
  'patch.not-found.missing-repository': {operation: 'patch', outcome: 'not-found', reason: 'missing-repository'},
  'patch.not-found.unshaped-repository': {operation: 'patch', outcome: 'not-found', reason: 'unshaped-repository'}
} as const;

type RepositoryWriteMetricKey = keyof typeof repositoryWriteMetricSeries;

/** Process-local, single-event-loop state; see GitHub issue #14 for worker-thread escalation. */
const repositoryWriteCounters: Partial<Record<RepositoryWriteMetricKey, number>> = {};

/** Returns the finite not-found metric key for one recognised reason. */
const notFoundCounterKey = (reason: unknown): RepositoryWriteMetricKey | undefined => {
  if (reason === 'missing-repository') return 'patch.not-found.missing-repository';
  if (reason === 'unshaped-repository') return 'patch.not-found.unshaped-repository';
  return undefined;
};

/** Builds a stable key for one bounded observation. */
const counterKey = (observation: unknown): RepositoryWriteMetricKey | undefined => {
  if (!observation || typeof observation !== 'object') return undefined;
  const {operation, outcome, reason} = observation as {operation?: unknown; outcome?: unknown; reason?: unknown};
  if (operation !== 'patch') return undefined;
  if (outcome === 'success' && reason === undefined) return 'patch.success';
  if (outcome !== 'not-found') return undefined;
  return notFoundCounterKey(reason);
};

/**
 * Records a bounded repository write outcome.
 *
 * @param observation Bounded PATCH outcome to count.
 * @example
 * ```ts
 * observeRepositoryWrite({operation: 'patch', outcome: 'success'});
 * // Increments the matching process-local counter.
 * ```
 */
export const observeRepositoryWrite = (observation: RepositoryWriteObservation): void => {
  const key = counterKey(observation);
  if (!key) return;
  repositoryWriteCounters[key] = (repositoryWriteCounters[key] ?? 0) + 1;
};

/**
 * Renders repository write counters in Prometheus text format.
 *
 * @returns Prometheus exposition text for repository write observations.
 * @example
 * ```ts
 * getRepositoryWriteObservabilityMetrics();
 * // Contains `simulacat_repository_write_observations_total`.
 * ```
 */
export const getRepositoryWriteObservabilityMetrics = (): string => {
  const lines = [
    '# HELP simulacat_repository_write_observations_total Repository write observations.',
    '# TYPE simulacat_repository_write_observations_total counter'
  ];

  for (const [key, value] of (
    Object.entries(repositoryWriteCounters) as Array<[RepositoryWriteMetricKey, number]>
  ).sort(([left], [right]) => left.localeCompare(right))) {
    const series = repositoryWriteMetricSeries[key];
    lines.push(
      `simulacat_repository_write_observations_total{operation="${series.operation}",outcome="${series.outcome}",reason="${series.reason}"} ${value}`
    );
  }

  return `${lines.join('\n')}\n`;
};

/**
 * Clears repository write counters between isolated tests.
 *
 * @example
 * ```ts
 * resetRepositoryWriteObservabilityCounters();
 * // Subsequent metric output has no repository observation samples.
 * ```
 */
export const resetRepositoryWriteObservabilityCounters = (): void => {
  for (const key of Object.keys(repositoryWriteCounters) as RepositoryWriteMetricKey[])
    delete repositoryWriteCounters[key];
};
