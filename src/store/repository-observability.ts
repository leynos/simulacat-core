/** @file Repository write observability counters and optional diagnostic logs. */

type RepositoryWriteOperation = 'get' | 'patch';
type RepositoryWriteOutcome = 'not-found' | 'success';

type RepositoryWriteObservation = {
  operation: RepositoryWriteOperation;
  outcome: RepositoryWriteOutcome;
  reason?: string;
};

const repositoryWriteCounters: Record<string, number> = {};

/** Builds a stable key for one bounded observation. */
const counterKey = (observation: RepositoryWriteObservation): string => {
  return [observation.operation, observation.outcome, observation.reason ?? ''].join('.');
};

/**
 * Records a bounded repository read or write outcome.
 *
 * @param observation Operation outcome to count and optionally log.
 */
export const observeRepositoryWrite = (observation: RepositoryWriteObservation): void => {
  const key = counterKey(observation);
  repositoryWriteCounters[key] = (repositoryWriteCounters[key] ?? 0) + 1;

  // biome-ignore lint/complexity/useLiteralKeys: strict TypeScript requires index access for ProcessEnv.
  if (process.env['SIMULACAT_REPOSITORY_OBSERVABILITY'] === 'true') {
    console.debug(JSON.stringify({component: 'simulacat.repository-write', ...observation}));
  }
};

/**
 * Renders repository write counters in Prometheus text format.
 *
 * @returns Prometheus exposition text for repository write observations.
 */
export const getRepositoryWriteObservabilityMetrics = (): string => {
  const lines = [
    '# HELP simulacat_repository_write_observations_total Repository write and read-after-write observations.',
    '# TYPE simulacat_repository_write_observations_total counter'
  ];

  for (const [key, value] of Object.entries(repositoryWriteCounters).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const [operation = '', outcome = '', reason = ''] = key.split('.');
    lines.push(
      `simulacat_repository_write_observations_total{operation="${operation}",outcome="${outcome}",reason="${reason}"} ${value}`
    );
  }

  return `${lines.join('\n')}\n`;
};

/** Clears repository write counters between isolated tests. */
export const resetRepositoryWriteObservabilityCounters = (): void => {
  for (const key of Object.keys(repositoryWriteCounters)) delete repositoryWriteCounters[key];
};
