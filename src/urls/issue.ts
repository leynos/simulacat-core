/** @file Request-scoped URL projection for issue payloads. */
import type {BaseUrls} from '../http/request-url.ts';
import type {GitHubIssue} from '../store/entities/issue.ts';
import {apiUrl, classifyUrlFields, projectDerivedFields, webUrl, type UrlFieldClassification} from './shared.ts';

export const issueApiUrlFields = ['url', 'repository_url'] as const;
export const issueWebUrlFields = ['html_url'] as const;
export const issueUrlFields = [...issueApiUrlFields, ...issueWebUrlFields] as const;
export type IssueUrlField = (typeof issueUrlFields)[number];
export type IssueUrlPayload = Omit<GitHubIssue, IssueUrlField> & Partial<Record<IssueUrlField, string | undefined>>;

const issueUrlBuilders = {
  url: (issue, baseUrls) => apiUrl(baseUrls, `/repos/${issue.owner}/${issue.repo}/issues/${issue.number}`),
  html_url: (issue, baseUrls) => webUrl(baseUrls, `/${issue.owner}/${issue.repo}/issues/${issue.number}`),
  repository_url: (issue, baseUrls) => apiUrl(baseUrls, `/repos/${issue.owner}/${issue.repo}`)
} satisfies Record<IssueUrlField, (issue: IssueUrlPayload, baseUrls: BaseUrls) => string>;

export const issueUrlFieldClassifications: UrlFieldClassification<IssueUrlField>[] = [
  ...classifyUrlFields(issueApiUrlFields, 'api'),
  ...classifyUrlFields(issueWebUrlFields, 'web')
];

/**
 * Projects missing issue URL fields from request-scoped base URLs.
 *
 * @example
 * ```ts
 * const issue = {owner: 'octo', repo: 'demo', number: 42} as IssueUrlPayload;
 * const baseUrls = {apiBaseUrl: 'https://api.example.test/api/v3', webBaseUrl: 'https://example.test'};
 * projectIssueUrls(issue, baseUrls);
 * // {url: 'https://api.example.test/api/v3/repos/octo/demo/issues/42',
 * //  html_url: 'https://example.test/octo/demo/issues/42',
 * //  repository_url: 'https://api.example.test/api/v3/repos/octo/demo'}
 * ```
 *
 * @param issue Stored issue entity with optional URL overrides.
 * @param baseUrls Request-derived API and web bases.
 * @returns Issue payload with URL fields populated.
 */
export const projectIssueUrls = (issue: IssueUrlPayload, baseUrls: BaseUrls): IssueUrlPayload =>
  projectDerivedFields(issue, baseUrls, issueUrlFields, issueUrlBuilders);
