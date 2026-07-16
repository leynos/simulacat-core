/** @file Request-scoped URL projection for Git ref payloads. */
import type {BaseUrls} from '../http/request-url.ts';
import type {GitHubRef} from '../store/entities/ref.ts';
import {
  apiUrl,
  classifyUrlFields,
  gitRefPath,
  projectDerivedFields,
  repositoryPath,
  urlPathSegment,
  type UrlFieldClassification
} from './shared.ts';

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
  url: (ref, baseUrls) => apiUrl(baseUrls, `/repos/${repositoryPath(ref.owner, ref.repo)}/git/${gitRefPath(ref.ref)}`)
} satisfies Record<RefUrlField, (ref: RefUrlPayload, baseUrls: BaseUrls) => string>;

export const refUrlFieldClassifications: UrlFieldClassification<RefUrlField | 'object.url'>[] = [
  ...classifyUrlFields(refUrlFields, 'api'),
  ...classifyUrlFields(['object.url'], 'api')
];

/**
 * Projects missing Git ref URL fields from request-scoped base URLs.
 *
 * @example
 * ```ts
 * const ref = {
 *   owner: 'octo',
 *   repo: 'demo',
 *   ref: 'refs/heads/feature#42',
 *   object: {type: 'commit', sha: 'abc123'}
 * } as RefUrlPayload;
 * const baseUrls = {apiBaseUrl: 'https://api.example.test/api/v3', webBaseUrl: 'https://example.test'};
 * projectRefUrls(ref, baseUrls);
 * // {url: 'https://api.example.test/api/v3/repos/octo/demo/git/refs/heads/feature%2342',
 * //  object: {type: 'commit', sha: 'abc123', url: 'https://api.example.test/api/v3/repos/octo/demo/git/commits/abc123'}}
 * ```
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
        apiUrl(
          baseUrls,
          `/repos/${repositoryPath(ref.owner, ref.repo)}/git/${refObjectApiPath(ref.object.type)}/${urlPathSegment(ref.object.sha)}`
        )
    }
  };
};
