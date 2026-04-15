/**
 * @file GraphQL Yoga handler creation for the simulated GitHub schema.
 *
 * This module loads the bundled GraphQL SDL, creates the Yoga schema, and
 * applies the REST-compatible media-type processor used by the simulator.
 */
import {createSchema, createYoga, processRegularResult} from 'graphql-yoga';
import {isAsyncIterable} from '@graphql-tools/utils';
import {createResolvers} from './resolvers.ts';
import {getSchema} from '../utils.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';

import type {Plugin} from 'graphql-yoga';

/**
 * Normalizes GitHub's custom media type to Yoga's regular JSON result
 * processor.
 */
const customMediaTypeParser: Plugin = {
  onResultProcess({request, result, setResultProcessor}) {
    const acceptHeader = request.headers.get('accept');
    if (acceptHeader?.includes('application/vnd.github.v3+json') && !isAsyncIterable(result)) {
      setResultProcessor(processRegularResult, 'application/json');
    }
  }
};

/**
 * Creates the GraphQL handler mounted under `/graphql`.
 *
 * @example
 * ```ts
 * router.use('/graphql', createHandler(simulationStore));
 * ```
 */
export function createHandler(simulationStore: ExtendedSimulationStore) {
  const schema = getSchema('schema.docs-enterprise.graphql');
  const resolvers = createResolvers(simulationStore);

  const yoga = createYoga({
    maskedErrors: false,
    schema: createSchema({
      typeDefs: schema,
      resolvers
    }),
    plugins: [customMediaTypeParser]
  });

  return yoga;
}
