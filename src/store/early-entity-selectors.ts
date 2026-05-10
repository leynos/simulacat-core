/** @file Selectors for early repository-owned GitHub entities. */
import type {AnyState} from '@simulacrum/foundation-simulator';
import type {GitHubCommit, GitHubIssue, GitHubPullRequest, GitHubRef} from './entities.ts';
import {commitStoreKey, issueStoreKey, pullRequestStoreKey, refStoreKey} from './keys.ts';

/** Extracts the owner parameter from selector arguments. */
const selectOwnerParam = (_state: AnyState, owner: string): string => owner;

/** Extracts the repo parameter from selector arguments. */
const selectRepoParam = (_state: AnyState, _owner: string, repo: string): string => repo;

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
  const listRefsForRepository = createSelector<
    [owner: string, repo: string],
    [GitHubRef[], string, string],
    GitHubRef[]
  >(
    schema.refs.selectTableAsList,
    selectOwnerParam,
    selectRepoParam,
    (refs: GitHubRef[], owner: string, repo: string) => refs.filter((ref) => ref.owner === owner && ref.repo === repo)
  );

  const getRef = (state: AnyState, owner: string, repo: string, qualifiedName: string): GitHubRef | undefined => {
    const key = refStoreKey({owner, repo, qualifiedName});
    return schema.refs.selectTable(state)?.[key];
  };

  const getCommit = (state: AnyState, owner: string, repo: string, sha: string): GitHubCommit | undefined => {
    const key = commitStoreKey({owner, repo, sha});
    return schema.commits.selectTable(state)?.[key];
  };

  const listCommitsForRepository = createSelector<
    [owner: string, repo: string],
    [GitHubCommit[], string, string],
    GitHubCommit[]
  >(
    schema.commits.selectTableAsList,
    selectOwnerParam,
    selectRepoParam,
    (commits: GitHubCommit[], owner: string, repo: string) =>
      commits.filter((commit) => commit.owner === owner && commit.repo === repo)
  );

  /** Returns only the direct commit target of a ref; graph traversal is deferred. */
  const listCommitsReachableFromRef = (
    state: AnyState,
    owner: string,
    repo: string,
    qualifiedName: string
  ): GitHubCommit[] => {
    const ref = getRef(state, owner, repo, qualifiedName);
    if (!ref) return [];
    const commit = getCommit(state, owner, repo, ref.object.sha);
    return commit ? [commit] : [];
  };

  const listIssuesForRepository = createSelector<
    [owner: string, repo: string],
    [GitHubIssue[], string, string],
    GitHubIssue[]
  >(
    schema.issues.selectTableAsList,
    selectOwnerParam,
    selectRepoParam,
    (issues: GitHubIssue[], owner: string, repo: string) =>
      issues.filter((issue) => issue.owner === owner && issue.repo === repo)
  );

  const getIssue = (state: AnyState, owner: string, repo: string, number: number): GitHubIssue | undefined => {
    const key = issueStoreKey({owner, repo, number});
    return schema.issues.selectTable(state)?.[key];
  };

  const listPullRequestsForRepository = createSelector<
    [owner: string, repo: string],
    [GitHubPullRequest[], string, string],
    GitHubPullRequest[]
  >(
    schema.pullRequests.selectTableAsList,
    selectOwnerParam,
    selectRepoParam,
    (pullRequests: GitHubPullRequest[], owner: string, repo: string) =>
      pullRequests.filter((pullRequest) => pullRequest.owner === owner && pullRequest.repo === repo)
  );

  const getPullRequest = (
    state: AnyState,
    owner: string,
    repo: string,
    number: number
  ): GitHubPullRequest | undefined => {
    const key = pullRequestStoreKey({owner, repo, number});
    return schema.pullRequests.selectTable(state)?.[key];
  };

  const resolvePullRequestRelations = (state: AnyState, pullRequest: GitHubPullRequest) => ({
    baseRef: getRef(state, pullRequest.base.owner, pullRequest.base.repo, pullRequest.base.ref),
    headRef: getRef(state, pullRequest.head.owner, pullRequest.head.repo, pullRequest.head.ref),
    issue: getIssue(state, pullRequest.owner, pullRequest.repo, pullRequest.issue_number)
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
