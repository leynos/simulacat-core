/** @file Request-scoped URL projection for Git ref payloads. */
import type {BaseUrls} from '../http/request-url.ts';
import type {GitHubRef} from '../store/entities/ref.ts';
import {apiUrl, classifyUrlFields, projectDerivedFields, type UrlFieldClassification} from './shared.ts';

export const refUrlFields = ['url'] as const;
export type RefUrlField = (typeof refUrlFields)[number];
export type RefUrlPayload = Omit<GitHubRef, RefUrlField> & Partial<Record<RefUrlField, string | undefined>>;

/** Maps a Git ref object type to its REST API path segment. */
const refObjectApiPath = (objectType: GitHubRef['object']['type']): string => {
  switch (objectType) {
    case 'commit':
      return 'commits';
    case 'tag':
      return 'tags';
    default: {
      const exhaustive: never = objectType;
      throw new Error(`Unsupported ref object type: ${exhaustive}`);
    }
  }
};

const refUrlBuilders = {
  url: (ref, baseUrls) => apiUrl(baseUrls, `/repos/${ref.owner}/${ref.repo}/git/${ref.ref}`)
} satisfies Record<RefUrlField, (ref: RefUrlPayload, baseUrls: BaseUrls) => string>;

export const refUrlFieldClassifications: UrlFieldClassification<RefUrlField | 'object.url'>[] = [
  ...classifyUrlFields(refUrlFields, 'api'),
  ...classifyUrlFields(['object.url'], 'api')
];

/**
 * Projects missing Git ref URL fields from request-scoped base URLs.
 *
 * @param ref Stored Git ref entity with optional URL overrides.
 * @param baseUrls Request-derived API and web bases.
 * @returns Git ref payload with URL fields populated.
 */
export const projectRefUrls = (ref: RefUrlPayload, baseUrls: BaseUrls): RefUrlPayload => {
  const projected = projectDerivedFields(ref, baseUrls, refUrlFields, refUrlBuilders);
  return {
    ...projected,
    object: {
      ...projected.object,
      url:
        projected.object.url ??
        apiUrl(baseUrls, `/repos/${ref.owner}/${ref.repo}/git/${refObjectApiPath(ref.object.type)}/${ref.object.sha}`)
    }
  };
};
