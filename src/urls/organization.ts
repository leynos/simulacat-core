/** @file Request-scoped URL projection for organization payloads. */
import type {BaseUrls} from '../http/request-url.ts';
import type {GitHubOrganization} from '../store/entities/organization.ts';
import {apiUrl, classifyUrlFields, projectDerivedFields, webUrl, type UrlFieldClassification} from './shared.ts';

export const organizationApiUrlFields = [
  'url',
  'repos_url',
  'events_url',
  'hooks_url',
  'issues_url',
  'members_url',
  'public_members_url'
] as const;
export const organizationWebUrlFields = ['html_url'] as const;
export const organizationExternalUrlFields = ['avatar_url'] as const;
export const organizationUrlFields = [
  ...organizationApiUrlFields,
  ...organizationWebUrlFields,
  ...organizationExternalUrlFields
] as const;

export type OrganizationUrlField = (typeof organizationUrlFields)[number];
export type OrganizationUrlPayload = Omit<GitHubOrganization, OrganizationUrlField> &
  Partial<Record<OrganizationUrlField, string>>;

const organizationUrlBuilders = {
  url: (organization, baseUrls) => apiUrl(baseUrls, `/orgs/${organization.login}`),
  html_url: (organization, baseUrls) => webUrl(baseUrls, `/orgs/${organization.login}`),
  repos_url: (organization, baseUrls) => apiUrl(baseUrls, `/orgs/${organization.login}/repos`),
  events_url: (organization, baseUrls) => apiUrl(baseUrls, `/orgs/${organization.login}/events`),
  hooks_url: (organization, baseUrls) => apiUrl(baseUrls, `/orgs/${organization.login}/hooks`),
  issues_url: (organization, baseUrls) => apiUrl(baseUrls, `/orgs/${organization.login}/issues`),
  members_url: (organization, baseUrls) => apiUrl(baseUrls, `/orgs/${organization.login}/members{/member}`),
  public_members_url: (organization, baseUrls) =>
    apiUrl(baseUrls, `/orgs/${organization.login}/public_members{/member}`),
  avatar_url: (organization) => `https://avatars.githubusercontent.com/u/${organization.id}?v=4`
} satisfies Record<OrganizationUrlField, (organization: OrganizationUrlPayload, baseUrls: BaseUrls) => string>;

export const organizationUrlFieldClassifications: UrlFieldClassification<OrganizationUrlField>[] = [
  ...classifyUrlFields(organizationApiUrlFields, 'api'),
  ...classifyUrlFields(organizationWebUrlFields, 'web'),
  ...classifyUrlFields(organizationExternalUrlFields, 'external')
];

/**
 * Projects missing organization URL fields from request-scoped base URLs.
 *
 * @param organization Stored organization entity with optional URL overrides.
 * @param baseUrls Request-derived API and web bases.
 * @returns Organization payload with URL fields populated.
 */
export const projectOrganizationUrls = (
  organization: OrganizationUrlPayload,
  baseUrls: BaseUrls
): OrganizationUrlPayload =>
  projectDerivedFields(organization, baseUrls, organizationUrlFields, organizationUrlBuilders);
