/** @file Request-scoped URL projection for branch payloads. */
import type {BaseUrls} from '../http/request-url.ts';
import type {GitHubBranch} from '../store/entities/branch.ts';
import {
  apiUrl,
  classifyUrlFields,
  projectDerivedFields,
  repositoryPath,
  urlPathSegment,
  type UrlFieldClassification
} from './shared.ts';

export const branchUrlFields = ['protection_url'] as const;
export type BranchUrlField = (typeof branchUrlFields)[number];
export type BranchUrlPayload = Omit<GitHubBranch, BranchUrlField> & Partial<Record<BranchUrlField, string | undefined>>;

const branchUrlBuilders = {
  protection_url: (branch, baseUrls) =>
    apiUrl(
      baseUrls,
      `/repos/${repositoryPath(branch.owner, branch.repo)}/branches/${urlPathSegment(branch.name)}/protection`
    )
} satisfies Record<BranchUrlField, (branch: BranchUrlPayload, baseUrls: BaseUrls) => string>;

export const branchUrlFieldClassifications: UrlFieldClassification<BranchUrlField | 'commit.url'>[] = [
  ...classifyUrlFields(branchUrlFields, 'api'),
  ...classifyUrlFields(['commit.url'], 'api')
];

/**
 * Projects missing branch URL fields from request-scoped base URLs.
 *
 * @param branch Stored branch entity with optional URL overrides.
 * @param baseUrls Request-derived API and web bases.
 * @returns Branch payload with URL fields populated.
 */
export const projectBranchUrls = (branch: BranchUrlPayload, baseUrls: BaseUrls): BranchUrlPayload => {
  const projected = projectDerivedFields(branch, baseUrls, branchUrlFields, branchUrlBuilders);
  return {
    ...projected,
    commit: {
      ...projected.commit,
      url:
        projected.commit.url ??
        apiUrl(
          baseUrls,
          `/repos/${repositoryPath(branch.owner, branch.repo)}/commits/${urlPathSegment(projected.commit.sha)}`
        )
    }
  };
};
