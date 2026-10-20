/** @file Yoga boundary diagnostics for pure GraphQL projection failures. */
import {isAsyncIterable} from '@graphql-tools/utils';
import type {ExecutionResult} from 'graphql';
import type {Plugin} from 'graphql-yoga';
import {observeGraphqlProjectionFailure} from '../http/url-observability.ts';
import type {BaseUrls} from '../http/request-url.ts';
import {GraphqlProjectionError} from './projection-error.ts';
import type {GraphQLContext} from './resolvers.ts';

/** Records typed projection failures after GraphQL has collected resolver errors. */
const observeProjectionErrors = (result: ExecutionResult, baseUrls: BaseUrls): void => {
  for (const error of result.errors ?? []) {
    if (error.cause instanceof GraphqlProjectionError) {
      observeGraphqlProjectionFailure(baseUrls, error.cause.entity);
    }
  }
};

/** Observes regular and streamed execution results with their request URL context. */
export const graphqlProjectionObserver: Plugin<GraphQLContext> = {
  onExecute() {
    return {
      onExecuteDone({args, result}) {
        const {baseUrls} = args.contextValue;
        if (isAsyncIterable(result)) {
          return {
            onNext({result: nextResult}) {
              observeProjectionErrors(nextResult, baseUrls);
            }
          };
        }
        observeProjectionErrors(result, baseUrls);
      }
    };
  }
};
