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
import {branchStoreKey, repositoryNodeId} from '../../store/keys.ts';
import {RepositoryVisibility} from '../../__generated__/resolvers-types.ts';
import type {User} from '../../__generated__/resolvers-types.ts';

const normalizeRefLookup = (qualifiedName: string) => qualifiedName.replace(/^refs\/heads\//, '');

interface ConversionContext {
  simulationStore: ExtendedSimulationStore;
  toGraphql: ToGraphqlDispatcher;
}

function paginateRepoItems<K extends 'Issue' | 'PullRequest'>(
  items: DataSchemas[K][],
  pageArgs: PageArgs,
  typeName: K,
  context: ConversionContext
) {
  return applyRelayPagination(items, pageArgs, (item) => context.toGraphql(context.simulationStore, typeName, item));
}

function resolveRepoItem<K extends 'Issue' | 'PullRequest'>(
  item: DataSchemas[K] | undefined,
  typeName: K,
  context: ConversionContext
) {
  return item ? context.toGraphql(context.simulationStore, typeName, item) : undefined;
}

/**
 * Converts a seeded repository fixture into a `GraphQLData['Repository']`.
 *
 * @param simulationStore `ExtendedSimulationStore` used for linked owner lookups.
 * @param repo `DataSchemas['Repository']` source entity to expose.
 * @param toGraphql `ToGraphqlDispatcher` used for nested owner conversion.
 * @returns `GraphQLData['Repository']` with non-null `id`, `nameWithOwner`,
 * `url`, `createdAt`, and `defaultBranchRef`; relation fields stay lazy or
 * placeholder-backed instead of being fully resolved here.
 */
export function convertRepositoryToGraphql(
  simulationStore: ExtendedSimulationStore,
  repo: DataSchemas['Repository'],
  toGraphql: ToGraphqlDispatcher
): GraphQLData['Repository'] {
  const defaultBranchName = repo.default_branch ?? 'main';
  const state = simulationStore.store?.getState();
  const seededDefaultRef =
    state && simulationStore.selectors?.getRef
      ? simulationStore.selectors.getRef(state, {
          owner: repo.owner,
          repo: repo.name,
          qualifiedName: defaultBranchName
        })
      : undefined;
  const defaultBranchId =
    seededDefaultRef?.node_id ??
    Buffer.from(`Branch:${branchStoreKey({owner: repo.owner, repo: repo.name, name: defaultBranchName})}`).toString(
      'base64'
    );

  return {
    __typename: 'Repository',
    id: repo.node_id ?? repositoryNodeId({owner: repo.owner, name: repo.name}),
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
    defaultBranchRef: seededDefaultRef
      ? toGraphql(simulationStore, 'Ref', seededDefaultRef)
      : {
          id: defaultBranchId,
          name: defaultBranchName
        },
    ref({qualifiedName}: {qualifiedName: string}) {
      if (!state || !simulationStore.selectors?.getRef) return undefined;
      const ref = simulationStore.selectors.getRef(state, {
        owner: repo.owner,
        repo: repo.name,
        qualifiedName: normalizeRefLookup(qualifiedName)
      });
      return ref ? toGraphql(simulationStore, 'Ref', ref) : undefined;
    },
    refs(pageArgs: PageArgs & {refPrefix: string}) {
      if (!state || !simulationStore.selectors?.listRefsForRepository) {
        return applyRelayPagination([], pageArgs, (ref) => toGraphql(simulationStore, 'Ref', ref));
      }
      const refs = simulationStore.selectors
        .listRefsForRepository(state, {owner: repo.owner, repo: repo.name})
        .filter((ref) => ref.ref.startsWith(pageArgs.refPrefix));
      return applyRelayPagination(refs, pageArgs, (ref) => toGraphql(simulationStore, 'Ref', ref));
    },
    issue({number}: {number: number}) {
      const item =
        state && simulationStore.selectors?.getIssue
          ? simulationStore.selectors.getIssue(state, {owner: repo.owner, repo: repo.name, number})
          : undefined;
      return resolveRepoItem(item, 'Issue', {simulationStore, toGraphql});
    },
    issues(pageArgs: PageArgs) {
      const items =
        state && simulationStore.selectors?.listIssuesForRepository
          ? simulationStore.selectors.listIssuesForRepository(state, {owner: repo.owner, repo: repo.name})
          : [];
      return paginateRepoItems(items, pageArgs, 'Issue', {simulationStore, toGraphql});
    },
    pullRequest({number}: {number: number}) {
      const item =
        state && simulationStore.selectors?.getPullRequest
          ? simulationStore.selectors.getPullRequest(state, {owner: repo.owner, repo: repo.name, number})
          : undefined;
      return resolveRepoItem(item, 'PullRequest', {simulationStore, toGraphql});
    },
    pullRequests(pageArgs: PageArgs) {
      const items =
        state && simulationStore.selectors?.listPullRequestsForRepository
          ? simulationStore.selectors.listPullRequestsForRepository(state, {owner: repo.owner, repo: repo.name})
          : [];
      return paginateRepoItems(items, pageArgs, 'PullRequest', {simulationStore, toGraphql});
    },
    languages(pageArgs: PageArgs) {
      const languages = repo.language ? [{id: repo.language, name: repo.language, size: 0}] : [];
      const totalSize = languages.reduce((sum, language) => sum + language.size, 0);
      return convertLanguageConnection(applyRelayPagination(languages, pageArgs), totalSize);
    },
    repositoryTopics(pageArgs: PageArgs) {
      const topics = Array.isArray(repo.topics) ? repo.topics : [];

      return convertRepositoryTopicConnection(
        applyRelayPagination(topics, pageArgs, (topicName) => ({
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
