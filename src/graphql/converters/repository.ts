/**
 * @file Repository entity conversion helpers for GraphQL responses.
 */
import type {PageArgs} from '../relay.ts';
import {applyRelayPagination} from '../relay.ts';
import {
  convertLanguageConnection,
  convertRepositoryCollaboratorConnection,
  convertRepositoryTopicConnection,
  emptyRepositoryConnection,
  emptyStargazerConnection
} from '../connections.ts';
import {deriveOwner} from '../owners.ts';
import type {DataSchemas, GraphQLData, ToGraphqlDispatcher} from '../to-graphql-shapes.ts';
import type {ExtendedSimulationStore} from '../../store/index.ts';
import {RepositoryVisibility} from '../../__generated__/resolvers-types.ts';
import type {User} from '../../__generated__/resolvers-types.ts';

export function convertRepositoryToGraphql(
  simulationStore: ExtendedSimulationStore,
  repo: DataSchemas['Repository'],
  toGraphql: ToGraphqlDispatcher
): GraphQLData['Repository'] {
  return {
    __typename: 'Repository',
    id: String(repo.id),
    name: repo.name,
    nameWithOwner: repo.full_name,
    url: repo.url,
    createdAt: repo.created_at ?? new Date(0).toISOString(),
    ...(repo.description ? {description: repo.description} : {}),
    collaborators(pageArgs: PageArgs) {
      return convertRepositoryCollaboratorConnection(applyRelayPagination([], pageArgs, (user: User) => user));
    },
    get owner() {
      return deriveOwner(simulationStore, repo.owner, toGraphql);
    },
    defaultBranchRef: {
      id: repo.default_branch ?? 'main',
      name: repo.default_branch ?? 'main'
    },
    languages(pageArgs: PageArgs) {
      return convertLanguageConnection(
        applyRelayPagination(repo.language ? [{id: repo.language, name: repo.language, size: 0}] : [], pageArgs)
      );
    },
    repositoryTopics(pageArgs: PageArgs) {
      return convertRepositoryTopicConnection(
        applyRelayPagination(repo.topics, pageArgs, (topicName) => ({
          id: `${repo.full_name}:${topicName}`,
          resourcePath: `/${repo.full_name}/topics/${topicName}`,
          topic: {
            id: topicName,
            name: topicName,
            relatedTopics: [],
            repositories: emptyRepositoryConnection(),
            stargazerCount: 0,
            stargazers: emptyStargazerConnection(),
            viewerHasStarred: false
          },
          url: `${repo.url}/topics/${topicName}`
        }))
      );
    },
    visibility: repo.visibility === 'public' ? RepositoryVisibility.Public : RepositoryVisibility.Private,
    isArchived: repo.archived,
    isFork: repo.fork
  };
}
