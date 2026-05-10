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
      ? simulationStore.selectors.getRef(state, repo.owner, repo.name, defaultBranchName)
      : undefined;
  const defaultBranchId =
    seededDefaultRef?.node_id ??
    Buffer.from(`Branch:${branchStoreKey({owner: repo.owner, repo: repo.name, name: defaultBranchName})}`).toString(
      'base64'
    );

  return {
    __typename: 'Repository',
    id: repo.node_id ?? repositoryNodeId(repo.owner, repo.name),
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
      const ref = simulationStore.selectors.getRef(state, repo.owner, repo.name, normalizeRefLookup(qualifiedName));
      return ref ? toGraphql(simulationStore, 'Ref', ref) : undefined;
    },
    refs(pageArgs: PageArgs & {refPrefix: string}) {
      if (!state || !simulationStore.selectors?.listRefsForRepository) {
        return applyRelayPagination([], pageArgs, (ref) => toGraphql(simulationStore, 'Ref', ref));
      }
      const refs = simulationStore.selectors
        .listRefsForRepository(state, repo.owner, repo.name)
        .filter((ref) => ref.ref.startsWith(pageArgs.refPrefix));
      return applyRelayPagination(refs, pageArgs, (ref) => toGraphql(simulationStore, 'Ref', ref));
    },
    issue({number}: {number: number}) {
      if (!state || !simulationStore.selectors?.getIssue) return undefined;
      const issue = simulationStore.selectors.getIssue(state, repo.owner, repo.name, number);
      return issue ? toGraphql(simulationStore, 'Issue', issue) : undefined;
    },
    issues(pageArgs: PageArgs) {
      if (!state || !simulationStore.selectors?.listIssuesForRepository) {
        return applyRelayPagination([], pageArgs, (issue) => toGraphql(simulationStore, 'Issue', issue));
      }
      return applyRelayPagination(
        simulationStore.selectors.listIssuesForRepository(state, repo.owner, repo.name),
        pageArgs,
        (issue) => toGraphql(simulationStore, 'Issue', issue)
      );
    },
    pullRequest({number}: {number: number}) {
      if (!state || !simulationStore.selectors?.getPullRequest) return undefined;
      const pullRequest = simulationStore.selectors.getPullRequest(state, repo.owner, repo.name, number);
      return pullRequest ? toGraphql(simulationStore, 'PullRequest', pullRequest) : undefined;
    },
    pullRequests(pageArgs: PageArgs) {
      if (!state || !simulationStore.selectors?.listPullRequestsForRepository) {
        return applyRelayPagination([], pageArgs, (pullRequest) =>
          toGraphql(simulationStore, 'PullRequest', pullRequest)
        );
      }
      return applyRelayPagination(
        simulationStore.selectors.listPullRequestsForRepository(state, repo.owner, repo.name),
        pageArgs,
        (pullRequest) => toGraphql(simulationStore, 'PullRequest', pullRequest)
      );
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
