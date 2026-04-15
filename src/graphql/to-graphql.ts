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
import {deriveOwner as deriveOwnerFromStore} from './owners.ts';
import type {DataSchemas, GraphQLData} from './to-graphql-shapes.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';

/**
 * Converts a stored entity into the corresponding GraphQL resolver shape.
 *
 * @example
 * ```ts
 * const gqlRepo = toGraphql(simulationStore, 'Repository', repository);
 * ```
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
  switch (__typename) {
    case 'User':
      return convertUserToGraphql(simulationStore, entity as DataSchemas['User'], toGraphql);
    case 'Organization':
      return convertOrganizationToGraphql(simulationStore, entity as DataSchemas['Organization'], toGraphql);
    case 'Repository':
      return convertRepositoryToGraphql(simulationStore, entity as DataSchemas['Repository'], toGraphql);
    default:
      console.error(`toGraphql: unhandled __typename ${__typename}`, {
        entity
      });
      throw new Error(`toGraphql: unhandled __typename ${__typename} for entity ${JSON.stringify(entity)}`);
  }
}

/**
 * Resolves a login to either an organisation or a user GraphQL owner.
 *
 * @example
 * ```ts
 * const owner = deriveOwner(simulationStore, 'frontside');
 * ```
 */
export function deriveOwner(simulationStore: ExtendedSimulationStore, login: string) {
  return deriveOwnerFromStore(simulationStore, login, toGraphql);
}
