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
 * Yoga resolver context carrying the parsed simulator request actor.
 *
 * `GraphQLUserContext` is a semantic alias of `GraphQLContext`: use the alias
 * at Yoga handler boundaries where the context object is constructed, and use
 * `GraphQLContext` in resolver signatures where fields are consumed. The alias
 * has no runtime effect; both names describe the same request-scoped actor
 * fields.
 */
export type GraphQLUserContext = GraphQLContext;

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

  const yoga = createYoga<{}, GraphQLUserContext>({
    maskedErrors: false,
    schema: createSchema<GraphQLUserContext>({
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
      return {
        baseUrls,
        requestActor: requestActorContext.actor,
        requestActorContext,
        requestActorParseResult: requestActorContext.parseResult,
        ...(requestId ? {requestId} : {})
      };
    },
    plugins: [customMediaTypeParser]
  });

  return yoga;
}
