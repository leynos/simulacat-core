/** @file Request-scoped URL projection for pull request payloads. */
import type {BaseUrls} from '../http/request-url.ts';
import type {GitHubPullRequest} from '../store/entities/pull-request.ts';
import {apiUrl, classifyUrlFields, projectDerivedFields, webUrl, type UrlFieldClassification} from './shared.ts';

export const pullRequestApiUrlFields = ['url', 'issue_url'] as const;
export const pullRequestWebUrlFields = ['html_url'] as const;
export const pullRequestUrlFields = [...pullRequestApiUrlFields, ...pullRequestWebUrlFields] as const;
export type PullRequestUrlField = (typeof pullRequestUrlFields)[number];
export type PullRequestUrlPayload = Omit<GitHubPullRequest, PullRequestUrlField> &
  Partial<Record<PullRequestUrlField, string>>;

const pullRequestUrlBuilders = {
  url: (pullRequest, baseUrls) =>
    apiUrl(baseUrls, `/repos/${pullRequest.owner}/${pullRequest.repo}/pulls/${pullRequest.number}`),
  html_url: (pullRequest, baseUrls) =>
    webUrl(baseUrls, `/${pullRequest.owner}/${pullRequest.repo}/pull/${pullRequest.number}`),
  issue_url: (pullRequest, baseUrls) =>
    apiUrl(baseUrls, `/repos/${pullRequest.owner}/${pullRequest.repo}/issues/${pullRequest.issue_number}`)
} satisfies Record<PullRequestUrlField, (pullRequest: PullRequestUrlPayload, baseUrls: BaseUrls) => string>;

export const pullRequestUrlFieldClassifications: UrlFieldClassification<PullRequestUrlField>[] = [
  ...classifyUrlFields(pullRequestApiUrlFields, 'api'),
  ...classifyUrlFields(pullRequestWebUrlFields, 'web')
];

/**
 * Projects missing pull request URL fields from request-scoped base URLs.
 *
 * @param pullRequest Stored pull request entity with optional URL overrides.
 * @param baseUrls Request-derived API and web bases.
 * @returns Pull request payload with URL fields populated.
 */
export const projectPullRequestUrls = (pullRequest: PullRequestUrlPayload, baseUrls: BaseUrls): PullRequestUrlPayload =>
  projectDerivedFields(pullRequest, baseUrls, pullRequestUrlFields, pullRequestUrlBuilders);
