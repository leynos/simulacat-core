/** @file Request-scoped URL projection for repository payloads. */
import type {BaseUrls} from '../http/request-url.ts';
import type {GitHubRepository} from '../store/entities/repository.ts';
import {apiUrl, classifyUrlFields, projectDerivedFields, webUrl, type UrlFieldClassification} from './shared.ts';

export const repositoryApiUrlFields = [
  'url',
  'archive_url',
  'assignees_url',
  'blobs_url',
  'branches_url',
  'collaborators_url',
  'comments_url',
  'commits_url',
  'compare_url',
  'contents_url',
  'contributors_url',
  'deployments_url',
  'downloads_url',
  'events_url',
  'forks_url',
  'git_commits_url',
  'git_refs_url',
  'git_tags_url',
  'hooks_url',
  'issue_comment_url',
  'issue_events_url',
  'issues_url',
  'keys_url',
  'labels_url',
  'languages_url',
  'merges_url',
  'milestones_url',
  'notifications_url',
  'pulls_url',
  'releases_url',
  'stargazers_url',
  'statuses_url',
  'subscribers_url',
  'subscription_url',
  'tags_url',
  'teams_url',
  'trees_url'
] as const;

export const repositoryWebUrlFields = ['html_url', 'clone_url', 'mirror_url', 'svn_url'] as const;
export const repositoryExternalUrlFields = ['git_url', 'ssh_url'] as const;
export const repositoryUrlFields = [
  ...repositoryApiUrlFields,
  ...repositoryWebUrlFields,
  ...repositoryExternalUrlFields
] as const;

export type RepositoryUrlField = (typeof repositoryUrlFields)[number];
export type RepositoryUrlPayload = Omit<GitHubRepository, RepositoryUrlField> &
  Partial<Record<RepositoryUrlField, string | null | undefined>>;

/** Builds the repository API path shared by derived fields. */
const apiPath = (repository: RepositoryUrlPayload) => `/repos/${repository.full_name}`;

/** Builds the GitHub web path for a repository. */
const webPath = (repository: RepositoryUrlPayload) => `/${repository.full_name}`;

const repositoryUrlBuilders = {
  url: (repository, baseUrls) => apiUrl(baseUrls, apiPath(repository)),
  archive_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/{archive_format}{/ref}`),
  assignees_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/assignees{/user}`),
  blobs_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/git/blobs{/sha}`),
  branches_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/branches{/branch}`),
  collaborators_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/collaborators{/collaborator}`),
  comments_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/comments{/number}`),
  commits_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/commits{/sha}`),
  compare_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/compare/{base}...{head}`),
  contents_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/contents/{+path}`),
  contributors_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/contributors`),
  deployments_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/deployments`),
  downloads_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/downloads`),
  events_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/events`),
  forks_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/forks`),
  git_commits_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/git/commits{/sha}`),
  git_refs_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/git/refs{/sha}`),
  git_tags_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/git/tags{/sha}`),
  hooks_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/hooks`),
  html_url: (repository, baseUrls) => webUrl(baseUrls, webPath(repository)),
  issue_comment_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/issues/comments{/number}`),
  issue_events_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/issues/events{/number}`),
  issues_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/issues{/number}`),
  keys_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/keys{/key_id}`),
  labels_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/labels{/name}`),
  languages_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/languages`),
  merges_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/merges`),
  milestones_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/milestones{/number}`),
  notifications_url: (repository, baseUrls) =>
    apiUrl(baseUrls, `${apiPath(repository)}/notifications{?since,all,participating}`),
  pulls_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/pulls{/number}`),
  releases_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/releases{/id}`),
  stargazers_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/stargazers`),
  statuses_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/statuses/{sha}`),
  subscribers_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/subscribers`),
  subscription_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/subscription`),
  tags_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/tags`),
  teams_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/teams`),
  trees_url: (repository, baseUrls) => apiUrl(baseUrls, `${apiPath(repository)}/git/trees{/sha}`),
  git_url: (repository) => `git://github.com/${repository.full_name}.git`,
  ssh_url: (repository) => `git@github.com:${repository.full_name}.git`,
  clone_url: (repository, baseUrls) => `${webUrl(baseUrls, webPath(repository))}.git`,
  mirror_url: (repository, baseUrls) => webUrl(baseUrls, webPath(repository)),
  svn_url: (repository, baseUrls) => webUrl(baseUrls, webPath(repository))
} satisfies Record<RepositoryUrlField, (repository: RepositoryUrlPayload, baseUrls: BaseUrls) => string | null>;

export const repositoryUrlFieldClassifications: UrlFieldClassification<RepositoryUrlField>[] = [
  ...classifyUrlFields(repositoryApiUrlFields, 'api'),
  ...classifyUrlFields(repositoryWebUrlFields, 'web'),
  ...classifyUrlFields(repositoryExternalUrlFields, 'external')
];

/**
 * Projects missing repository URL fields from request-scoped base URLs.
 *
 * @param repository Stored repository entity with optional URL overrides.
 * @param baseUrls Request-derived API and web bases.
 * @returns Repository payload with URL fields populated.
 */
export const projectRepositoryUrls = (repository: RepositoryUrlPayload, baseUrls: BaseUrls): RepositoryUrlPayload => {
  const projected = projectDerivedFields(repository, baseUrls, repositoryUrlFields, repositoryUrlBuilders);
  return {
    ...projected,
    homepage: projected.homepage ?? null
  };
};
