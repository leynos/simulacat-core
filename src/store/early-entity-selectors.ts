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
 * Builds a memoised owner/repo -> entity index from a flat list selector.
 * The index is rebuilt only when the underlying table slice changes;
 * subsequent lookups for any repository within that slice are O(1).
 */
const buildRepoIndex = <T extends RepositoryCoords>(
  selectAll: (state: AnyState) => T[],
  createSel: CreateSelector
): ((state: AnyState) => Map<string, T[]>) =>
  createSel(selectAll, (items: T[]): Map<string, T[]> => {
    const index = new Map<string, T[]>();
    for (const item of items) {
      const repoKey = `${item.owner}/${item.repo}`;
      const bucket = index.get(repoKey);
      if (bucket) {
        bucket.push(item);
      } else {
        index.set(repoKey, [item]);
      }
    }
    return index;
  });

/**
 * Builds repository-scoped selectors for early collaboration entities.
 *
 * @param args Selector construction dependencies, including `createSelector`
 * and the store schema slices for refs, commits, issues, and pull requests.
 * @returns Selector functions for resolving refs, commits, issues, and pull
 * requests by owner-scoped repository coordinates.
 */
export const buildEarlyEntitySelectors = ({createSelector, schema}: EarlyEntitySelectorArgs) => {
  const refsIndex = buildRepoIndex(schema.refs.selectTableAsList, createSelector);
  const commitsIndex = buildRepoIndex(schema.commits.selectTableAsList, createSelector);
  const issuesIndex = buildRepoIndex(schema.issues.selectTableAsList, createSelector);
  const pullRequestsIndex = buildRepoIndex(schema.pullRequests.selectTableAsList, createSelector);

  const listRefsForRepository = (state: AnyState, coords: RepositoryCoords): GitHubRef[] =>
    refsIndex(state).get(`${coords.owner}/${coords.repo}`) ?? [];

  const getRef = (state: AnyState, coords: RefStoreKeyParts): GitHubRef | undefined => {
    const key = refStoreKey(coords);
    return schema.refs.selectTable(state)?.[key];
  };

  const getCommit = (state: AnyState, coords: CommitStoreKeyParts): GitHubCommit | undefined => {
    const key = commitStoreKey(coords);
    return schema.commits.selectTable(state)?.[key];
  };

  const listCommitsForRepository = (state: AnyState, coords: RepositoryCoords): GitHubCommit[] =>
    commitsIndex(state).get(`${coords.owner}/${coords.repo}`) ?? [];

  /** Returns only the direct commit target of a ref; graph traversal is deferred. */
  const listCommitsReachableFromRef = (state: AnyState, coords: RefStoreKeyParts): GitHubCommit[] => {
    const ref = getRef(state, coords);
    if (!ref) return [];
    const commit = getCommit(state, {owner: ref.owner, repo: ref.repo, sha: ref.object.sha});
    return commit ? [commit] : [];
  };

  const listIssuesForRepository = (state: AnyState, coords: RepositoryCoords): GitHubIssue[] =>
    issuesIndex(state).get(`${coords.owner}/${coords.repo}`) ?? [];

  const getIssue = (state: AnyState, coords: IssueStoreKeyParts): GitHubIssue | undefined => {
    const key = issueStoreKey(coords);
    return schema.issues.selectTable(state)?.[key];
  };

  const listPullRequestsForRepository = (state: AnyState, coords: RepositoryCoords): GitHubPullRequest[] =>
    pullRequestsIndex(state).get(`${coords.owner}/${coords.repo}`) ?? [];

  const getPullRequest = (state: AnyState, coords: PullRequestStoreKeyParts): GitHubPullRequest | undefined => {
    const key = pullRequestStoreKey(coords);
    return schema.pullRequests.selectTable(state)?.[key];
  };

  // nosemgrep: simulacat.ts.private-jsdoc - Baseline helper predates private JSDoc enforcement.
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
