/**
 * @file Repository entity conversion helpers for GraphQL responses.
 */
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Baseline converter predates the new complexity gate.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: Baseline converter predates the new length gate.
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
import type {BaseUrls} from '../../http/request-url.ts';
import type {ExtendedSimulationStore} from '../../store/index.ts';
import {branchStoreKey, repositoryNodeId} from '../../store/keys.ts';
import {projectRepositoryUrls} from '../../urls/index.ts';
import {RepositoryVisibility} from '../../__generated__/resolvers-types.ts';
import type {User} from '../../__generated__/resolvers-types.ts';

/**
 * Normalizes a Git ref name for repository ref lookup.
 *
 * @param qualifiedName Ref name supplied by GraphQL, such as
 * `refs/heads/main`.
 * @returns The lookup ref name with a leading `refs/heads/` or `refs/tags/`
 * prefix removed.
 *
 * @example
 * ```ts
 * normalizeRefLookup('refs/heads/main') // 'main'
 * ```
 */
const normalizeRefLookup = (qualifiedName: string) => qualifiedName.replace(/^refs\/(heads|tags)\//, '');

interface ConversionContext {
  simulationStore: ExtendedSimulationStore;
  toGraphql: ToGraphqlDispatcher;
}

/**
 * Paginates repository issue or pull request fixtures and converts each node.
 *
 * @typeParam K Repository item type, constrained to `Issue` or `PullRequest`.
 * @param items Repository-scoped fixture items to paginate.
 * @param pageArgs Relay pagination arguments.
 * @param typeName GraphQL fixture discriminator for each item.
 * @param context Conversion context containing the simulation store and
 * dispatcher.
 * @returns A Relay connection whose nodes are GraphQL representations of the
 * input items.
 *
 * Items are paginated with `applyRelayPagination`; each item is converted via
 * `context.toGraphql(context.simulationStore, typeName, item)`. Empty item
 * arrays return an empty connection according to the relay helper.
 */
function paginateRepoItems<K extends 'Issue' | 'PullRequest'>(
  items: DataSchemas[K][],
  pageArgs: PageArgs,
  typeName: K,
  context: ConversionContext
) {
  return applyRelayPagination(items, pageArgs, (item) => context.toGraphql(context.simulationStore, typeName, item));
}

/**
 * Converts an optional repository issue or pull request fixture to GraphQL.
 *
 * @param item Repository item fixture to convert, or `undefined`.
 * @param typeName GraphQL fixture discriminator for the item.
 * @param context Conversion context containing `simulationStore` and
 * `toGraphql`.
 * @returns The GraphQL representation, or `undefined` when `item` is
 * undefined.
 *
 * Conversion is delegated to `context.toGraphql` using
 * `context.simulationStore`.
 */
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
 * @param baseUrls Request-derived API and web bases for URL projection.
 * @returns `GraphQLData['Repository']` with non-null `id`, `nameWithOwner`,
 * `url`, `createdAt`, and `defaultBranchRef`; relation fields stay lazy or
 * placeholder-backed instead of being fully resolved here.
 * @throws Error when request-scoped projection cannot produce a string
 * repository URL.
 */
// Repository GraphQL conversion intentionally assembles several lazy relation adapters.
// oxlint-disable-next-line complexity
export function convertRepositoryToGraphql(
  simulationStore: ExtendedSimulationStore,
  repo: DataSchemas['Repository'],
  toGraphql: ToGraphqlDispatcher,
  baseUrls: BaseUrls
): GraphQLData['Repository'] {
  const defaultBranchName = repo.default_branch ?? 'main';
  const state = simulationStore.store?.getState();
  const getRef = simulationStore.selectors?.getRef;
  let seededDefaultRef: DataSchemas['Ref'] | undefined;
  if (state && getRef) {
    seededDefaultRef = getRef(state, {
      owner: repo.owner,
      repo: repo.name,
      qualifiedName: defaultBranchName
    });
  }
  const defaultBranchId =
    seededDefaultRef?.node_id ??
    Buffer.from(`Branch:${branchStoreKey({owner: repo.owner, repo: repo.name, name: defaultBranchName})}`).toString(
      'base64'
    );
  const projectedRepository = projectRepositoryUrls(repo, baseUrls);
  const repositoryUrl = projectedRepository.html_url;
  if (typeof repositoryUrl !== 'string') {
    throw new Error(`GraphQL repository URL could not be projected for ${repo.full_name}`);
  }

  return {
    __typename: 'Repository',
    id: repo.node_id ?? repositoryNodeId({owner: repo.owner, name: repo.name}),
    name: repo.name,
    nameWithOwner: repo.full_name,
    url: repositoryUrl,
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
      const getIssue = simulationStore.selectors?.getIssue;
      let item: DataSchemas['Issue'] | undefined;
      if (state && getIssue) {
        item = getIssue(state, {owner: repo.owner, repo: repo.name, number});
      }
      return resolveRepoItem(item, 'Issue', {simulationStore, toGraphql});
    },
    issues(pageArgs: PageArgs) {
      const listIssues = simulationStore.selectors?.listIssuesForRepository;
      let items: DataSchemas['Issue'][] = [];
      if (state && listIssues) {
        items = listIssues(state, {owner: repo.owner, repo: repo.name});
      }
      return paginateRepoItems(items, pageArgs, 'Issue', {simulationStore, toGraphql});
    },
    pullRequest({number}: {number: number}) {
      const getPullRequest = simulationStore.selectors?.getPullRequest;
      let item: DataSchemas['PullRequest'] | undefined;
      if (state && getPullRequest) {
        item = getPullRequest(state, {owner: repo.owner, repo: repo.name, number});
      }
      return resolveRepoItem(item, 'PullRequest', {simulationStore, toGraphql});
    },
    pullRequests(pageArgs: PageArgs) {
      const listPullRequests = simulationStore.selectors?.listPullRequestsForRepository;
      let items: DataSchemas['PullRequest'][] = [];
      if (state && listPullRequests) {
        items = listPullRequests(state, {owner: repo.owner, repo: repo.name});
      }
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
          url: `${repositoryUrl}/topics/${topicName}`
        }))
      );
    },
    visibility: repo.visibility === 'public' ? RepositoryVisibility.Public : RepositoryVisibility.Private,
    isArchived: repo.archived,
    isFork: repo.fork
  };
}
