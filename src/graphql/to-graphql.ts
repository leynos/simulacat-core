/**
 * @file Converters from stored GitHub entities to GraphQL resolver objects.
 *
 * This dispatcher coordinates the entity-specific conversion modules and the
 * shared owner helpers that turn seeded store records into resolver-ready
 * GraphQL shapes.
 */
import {convertOrganizationToGraphql} from './converters/organization.ts';
import {convertRepositoryToGraphql} from './converters/repository.ts';
import {convertUserToGraphql} from './converters/user.ts';
import {
  convertCommitToGraphql,
  convertIssueToGraphql,
  convertPullRequestToGraphql,
  convertRefToGraphql
} from './converters/early-entities.ts';
import {deriveOwner as deriveOwnerFromStore} from './owners.ts';
import type {DataSchemas, GraphQLData, ToGraphqlDispatcher} from './to-graphql-shapes.ts';
import type {BaseUrls} from '../http/request-url.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';

type GraphqlConverter<T extends keyof DataSchemas> = (entity: DataSchemas[T]) => GraphQLData[T];

type ConverterMap = {
  [T in keyof DataSchemas]: GraphqlConverter<T>;
};

/** Raises an unhandled-typename error without exposing the rejected entity. */
function throwUnhandledTypename(__typename: string): never {
  console.error(`toGraphql: unhandled __typename ${__typename}`);
  throw new Error(`toGraphql: unhandled __typename ${__typename}`);
}

/** Adapts entity-specific converters to a uniform request-bound dispatch shape. */
function makeConverterMap(
  simulationStore: ExtendedSimulationStore,
  baseUrls: BaseUrls,
  toGraphql: ToGraphqlDispatcher
): ConverterMap {
  return {
    User: (entity) => convertUserToGraphql(simulationStore, entity, toGraphql, baseUrls),
    Organization: (entity) => convertOrganizationToGraphql(simulationStore, entity, toGraphql, baseUrls),
    Repository: (entity) => convertRepositoryToGraphql(simulationStore, entity, toGraphql, baseUrls),
    Ref: (entity) => convertRefToGraphql(simulationStore, entity, toGraphql),
    Commit: (entity) => convertCommitToGraphql(simulationStore, entity, baseUrls),
    Issue: (entity) => convertIssueToGraphql(simulationStore, entity, baseUrls),
    PullRequest: (entity) => convertPullRequestToGraphql(simulationStore, entity, toGraphql, baseUrls)
  };
}

/**
 * Builds a request-bound dispatcher for stored GraphQL entities.
 *
 * @example
 * ```ts
 * const toGraphql = makeToGraphql(simulationStore, baseUrls);
 * const user = simulationStore.schema.users.selectTableAsList(simulationStore.store.getState())[0]!;
 * const graphqlUser = toGraphql(simulationStore, 'User', user);
 * ```
 *
 * @param simulationStore Store and selectors used by conversion helpers.
 * @param baseUrls Request-derived API and web bases for URL projection.
 * @returns Dispatcher that recursively converts stored entities.
 */
export const makeToGraphql = (simulationStore: ExtendedSimulationStore, baseUrls: BaseUrls): ToGraphqlDispatcher => {
  const toGraphql = (<T extends keyof DataSchemas>(
    _store: ExtendedSimulationStore,
    __typename: T,
    entity: DataSchemas[T]
  ): GraphQLData[T] => {
    const converter = converters[__typename] as GraphqlConverter<T> | undefined;
    if (!converter) {
      return throwUnhandledTypename(__typename);
    }

    return converter(entity);
  }) as ToGraphqlDispatcher;
  const converters = makeConverterMap(simulationStore, baseUrls, toGraphql);

  return toGraphql;
};

/**
 * Converts a stored entity into the corresponding GraphQL resolver shape.
 *
 * @param simulationStore Store and selectors used by conversion helpers.
 * @param __typename Entity discriminator.
 * @param entity Stored entity to convert.
 * @returns Converted GraphQL resolver shape.
 * @deprecated Prefer `makeToGraphql(simulationStore, baseUrls)` for
 * request-scoped URL projection.
 */
export function toGraphql<T extends keyof DataSchemas>(
  simulationStore: ExtendedSimulationStore,
  __typename: T,
  entity: DataSchemas[T]
): GraphQLData[T];
export function toGraphql(
  simulationStore: ExtendedSimulationStore,
  __typename: keyof DataSchemas,
  entity: DataSchemas[keyof DataSchemas]
): GraphQLData[keyof GraphQLData] {
  const fallbackBaseUrls = {
    apiBaseUrl: 'http://localhost:3300',
    webBaseUrl: 'http://localhost:3300'
  };
  return makeToGraphql(simulationStore, fallbackBaseUrls)(simulationStore, __typename, entity);
}

/**
 * Resolves a login to either an organisation or a user GraphQL owner.
 *
 * @example
 * ```ts
 * const owner = deriveOwner(simulationStore, 'frontside', baseUrls);
 * ```
 *
 * @param simulationStore Store and selectors used to resolve the owner.
 * @param login Organization or user login to resolve.
 * @param baseUrls Request-derived API and web bases for nested conversions.
 * @returns GraphQL organization or user owner.
 */
export function deriveOwner(simulationStore: ExtendedSimulationStore, login: string, baseUrls: BaseUrls) {
  return deriveOwnerFromStore(simulationStore, login, makeToGraphql(simulationStore, baseUrls));
}
