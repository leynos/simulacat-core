/** @file Request-scoped URL projection for commit payloads. */
import type {BaseUrls} from '../http/request-url.ts';
import type {GitHubCommit} from '../store/entities/commit.ts';
import {apiUrl, classifyUrlFields, projectDerivedFields, webUrl, type UrlFieldClassification} from './shared.ts';

export const commitUrlFields = ['url', 'html_url'] as const;
export type CommitUrlField = (typeof commitUrlFields)[number];
export type CommitUrlPayload = Omit<GitHubCommit, CommitUrlField> & Partial<Record<CommitUrlField, string | undefined>>;

const commitUrlBuilders = {
  url: (commit, baseUrls) => apiUrl(baseUrls, `/repos/${commit.owner}/${commit.repo}/commits/${commit.sha}`),
  html_url: (commit, baseUrls) => webUrl(baseUrls, `/${commit.owner}/${commit.repo}/commit/${commit.sha}`)
} satisfies Record<CommitUrlField, (commit: CommitUrlPayload, baseUrls: BaseUrls) => string>;

/** Builds the API URL for a nested commit object reference. */
const commitObjectUrl = (commit: Pick<GitHubCommit, 'owner' | 'repo'>, sha: string, baseUrls: BaseUrls) =>
  apiUrl(baseUrls, `/repos/${commit.owner}/${commit.repo}/git/commits/${sha}`);

/** Builds the API URL for a REST commit resource. */
const commitResourceUrl = (commit: Pick<GitHubCommit, 'owner' | 'repo'>, sha: string, baseUrls: BaseUrls) =>
  apiUrl(baseUrls, `/repos/${commit.owner}/${commit.repo}/commits/${sha}`);

export const commitUrlFieldClassifications: UrlFieldClassification<
  CommitUrlField | 'commit.tree.url' | 'parents.url' | 'commit.parents.url'
>[] = [
  ...classifyUrlFields(['url'], 'api'),
  ...classifyUrlFields(['html_url'], 'web'),
  ...classifyUrlFields(['commit.tree.url', 'parents.url', 'commit.parents.url'], 'api')
];

/**
 * Projects missing commit URL fields from request-scoped base URLs.
 *
 * @param commit Stored commit entity with optional URL overrides.
 * @param baseUrls Request-derived API and web bases.
 * @returns Commit payload with top-level and nested URL fields populated.
 */
export const projectCommitUrls = (commit: CommitUrlPayload, baseUrls: BaseUrls): CommitUrlPayload => {
  const projected = projectDerivedFields(commit, baseUrls, commitUrlFields, commitUrlBuilders);
  const tree = {
    ...projected.commit.tree,
    url:
      projected.commit.tree.url ??
      apiUrl(baseUrls, `/repos/${commit.owner}/${commit.repo}/git/trees/${projected.commit.tree.sha}`)
  };
  const parents = projected.parents.map((parent) => ({
    ...parent,
    url: parent.url ?? commitResourceUrl(commit, parent.sha, baseUrls)
  }));
  const commitParents = projected.commit.parents.map((parent) => ({
    ...parent,
    url: parent.url ?? commitObjectUrl(commit, parent.sha, baseUrls)
  }));

  return {
    ...projected,
    commit: {
      ...projected.commit,
      tree,
      parents: commitParents
    },
    parents
  };
};
