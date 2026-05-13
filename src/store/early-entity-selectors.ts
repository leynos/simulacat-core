/** @file Selectors for early repository-owned GitHub entities. */
import type {AnyState} from '@simulacrum/foundation-simulator';
import type {GitHubCommit, GitHubIssue, GitHubPullRequest, GitHubRef} from './entities.ts';
import {
  commitStoreKey,
  issueStoreKey,
  pullRequestStoreKey,
  refStoreKey,
  type CommitStoreKeyParts,
  type IssueStoreKeyParts,
  type PullRequestStoreKeyParts,
  type RefStoreKeyParts,
  type RepositoryCoords
} from './keys.ts';

/** Extracts the owner parameter from selector arguments. */
const selectOwnerParam = (_state: AnyState, coords: RepositoryCoords): string => coords.owner;

/** Extracts the repo parameter from selector arguments. */
const selectRepoParam = (_state: AnyState, coords: RepositoryCoords): string => coords.repo;

const isInRepository = <T extends RepositoryCoords>(item: T, owner: string, repo: string) =>
  item.owner === owner && item.repo === repo;

type StoreTable<T> = {
  selectTableAsList: (state: AnyState) => T[];
  selectTable: (state: AnyState) => Record<string, T> | undefined;
};

type SelectorFunction<Args extends readonly unknown[], Result> = (state: AnyState, ...args: Args) => Result;

type CreateSelector = <Args extends readonly unknown[], Inputs extends readonly unknown[], Result>(
  ...inputs: [
    ...{
      [Index in keyof Inputs]: SelectorFunction<Args, Inputs[Index]>;
    },
    (...values: Inputs) => Result
  ]
) => SelectorFunction<Args, Result>;

export type EarlyEntitySelectorArgs = {
  createSelector: CreateSelector;
  schema: {
    refs: StoreTable<GitHubRef>;
    commits: StoreTable<GitHubCommit>;
    issues: StoreTable<GitHubIssue>;
    pullRequests: StoreTable<GitHubPullRequest>;
  };
};

/**
 * Builds repository-scoped selectors for early collaboration entities.
 *
 * @param args Selector construction dependencies, including `createSelector`
 * and the store schema slices for refs, commits, issues, and pull requests.
 * @returns Selector functions for resolving refs, commits, issues, and pull
 * requests by owner-scoped repository coordinates.
 */
export const buildEarlyEntitySelectors = ({createSelector, schema}: EarlyEntitySelectorArgs) => {
  const listRefsForRepository = createSelector<[coords: RepositoryCoords], [GitHubRef[], string, string], GitHubRef[]>(
    schema.refs.selectTableAsList,
    selectOwnerParam,
    selectRepoParam,
    (refs: GitHubRef[], owner: string, repo: string) => refs.filter((ref) => isInRepository(ref, owner, repo))
  );

  const getRef = (state: AnyState, coords: RefStoreKeyParts): GitHubRef | undefined => {
    const key = refStoreKey(coords);
    return schema.refs.selectTable(state)?.[key];
  };

  const getCommit = (state: AnyState, coords: CommitStoreKeyParts): GitHubCommit | undefined => {
    const key = commitStoreKey(coords);
    return schema.commits.selectTable(state)?.[key];
  };

  const listCommitsForRepository = createSelector<
    [coords: RepositoryCoords],
    [GitHubCommit[], string, string],
    GitHubCommit[]
  >(
    schema.commits.selectTableAsList,
    selectOwnerParam,
    selectRepoParam,
    (commits: GitHubCommit[], owner: string, repo: string) =>
      commits.filter((commit) => isInRepository(commit, owner, repo))
  );

  /** Returns only the direct commit target of a ref; graph traversal is deferred. */
  const listCommitsReachableFromRef = (state: AnyState, coords: RefStoreKeyParts): GitHubCommit[] => {
    const ref = getRef(state, coords);
    if (!ref) return [];
    const commit = getCommit(state, {owner: ref.owner, repo: ref.repo, sha: ref.object.sha});
    return commit ? [commit] : [];
  };

  const listIssuesForRepository = createSelector<
    [coords: RepositoryCoords],
    [GitHubIssue[], string, string],
    GitHubIssue[]
  >(
    schema.issues.selectTableAsList,
    selectOwnerParam,
    selectRepoParam,
    (issues: GitHubIssue[], owner: string, repo: string) => issues.filter((issue) => isInRepository(issue, owner, repo))
  );

  const getIssue = (state: AnyState, coords: IssueStoreKeyParts): GitHubIssue | undefined => {
    const key = issueStoreKey(coords);
    return schema.issues.selectTable(state)?.[key];
  };

  const listPullRequestsForRepository = createSelector<
    [coords: RepositoryCoords],
    [GitHubPullRequest[], string, string],
    GitHubPullRequest[]
  >(
    schema.pullRequests.selectTableAsList,
    selectOwnerParam,
    selectRepoParam,
    (pullRequests: GitHubPullRequest[], owner: string, repo: string) =>
      pullRequests.filter((pullRequest) => isInRepository(pullRequest, owner, repo))
  );

  const getPullRequest = (state: AnyState, coords: PullRequestStoreKeyParts): GitHubPullRequest | undefined => {
    const key = pullRequestStoreKey(coords);
    return schema.pullRequests.selectTable(state)?.[key];
  };

  const resolvePullRequestRelations = (state: AnyState, pullRequest: GitHubPullRequest) => ({
    baseRef: getRef(state, {
      owner: pullRequest.base.owner,
      repo: pullRequest.base.repo,
      qualifiedName: pullRequest.base.ref
    }),
    headRef: getRef(state, {
      owner: pullRequest.head.owner,
      repo: pullRequest.head.repo,
      qualifiedName: pullRequest.head.ref
    }),
    issue: getIssue(state, {owner: pullRequest.owner, repo: pullRequest.repo, number: pullRequest.issue_number})
  });

  return {
    getCommit,
    getIssue,
    getPullRequest,
    getRef,
    listCommitsForRepository,
    listCommitsReachableFromRef,
    listIssuesForRepository,
    listPullRequestsForRepository,
    listRefsForRepository,
    resolvePullRequestRelations
  };
};
