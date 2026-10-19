/**
 * @file GraphQL Yoga handler creation for the simulated GitHub schema.
 *
 * This module loads the bundled GraphQL SDL, parses request actors from
 * incoming headers, builds Yoga context carrying the parsed `requestActor` for
 * resolver use, and applies the REST-compatible media-type processor used by
 * the simulator.
 */
import {createSchema, createYoga, processRegularResult} from 'graphql-yoga';
import {isAsyncIterable} from '@graphql-tools/utils';
import {createResolvers, type GraphQLContext} from './resolvers.ts';
import {buildBaseUrls} from '../http/request-url.ts';
import {makeUrlObservationContext} from '../http/url-observability.ts';
import {buildActorContext} from '../store/actors.ts';
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
 * router.use('/graphql', createHandler(simulationStore, '/api/v3'));
 * ```
 *
 * @param simulationStore Store and selectors used by resolvers.
 * @param apiRoot Configured API root used when projecting request URLs.
 * @returns A Yoga handler mounted by the Express adapter.
 */
export function createHandler(simulationStore: ExtendedSimulationStore, apiRoot = '/') {
  const schema = getSchema('schema.docs-enterprise.graphql');
  const resolvers = createResolvers(simulationStore);

  const yoga = createYoga<{}, GraphQLContext>({
    maskedErrors: false,
    schema: createSchema<GraphQLContext>({
      typeDefs: schema,
      resolvers
    }),
    context({request}) {
      const headers = {get: (name: string) => request.headers.get(name)};
      const requestActorContext = buildActorContext(headers);
      const requestUrl = new URL(request.url);
      const {SIMULACAT_GITHUB_API_URL: fallbackBaseUrl} = process.env;
      const requestId = requestActorContext.observationContext?.requestId;
      const baseUrls = buildBaseUrls(
        {
          protocol: requestUrl.protocol,
          host: request.headers.get('host') ?? ''
        },
        apiRoot,
        fallbackBaseUrl,
        makeUrlObservationContext('graphql', requestId)
      );
      const context: GraphQLContext = {
        baseUrls,
        requestActor: requestActorContext.actor,
        requestActorContext,
        requestActorParseResult: requestActorContext.parseResult
      };
      if (requestId) {
        context.requestId = requestId;
      }
      return context;
    },
    plugins: [customMediaTypeParser]
  });

  return yoga;
}
