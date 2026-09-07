/** @file Git blob fixture schema and canonical blob keys. */
import {faker} from '@faker-js/faker';
import {z} from 'zod';

/**
 * Validates and normalizes a minimal Git blob fixture, requiring at least one
 * of `path` or `sha` to identify the blob.
 *
 * @internal
 */
export const githubBlobSchema = z
  .object({
    content: z.string().optional().default(faker.lorem.paragraphs),
    encoding: z.union([z.literal('string'), z.literal('base64')]).default('string'),
    owner: z.string(),
    repo: z.string(),
    path: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional()),
    sha: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional())
  })
  .transform((blob, ctx) => {
    if (!blob.path && !blob.sha) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Specify the path or sha of the blob'
      });
      return z.NEVER;
    }

    return blob;
  });

/** A validated Git blob fixture, addressed by repository, path, and SHA. */
export type GitHubBlob = z.infer<typeof githubBlobSchema>;

/**
 * Derives the canonical store key for a Git blob, preferring `path` over
 * `sha` when both are present.
 *
 * @example
 * ```ts
 * blobStoreKey({owner: 'acme', repo: 'widgets', path: 'README.md', sha: 'abc123'});
 * // 'acme/widgets:README.md'
 * ```
 *
 * @param blob Blob coordinate parts containing owner, repo, path, and sha.
 * @returns The canonical key in `owner/repo:reference` format.
 * @throws Error when neither `path` nor `sha` is provided.
 */
export const blobStoreKey = (blob: Pick<GitHubBlob, 'owner' | 'repo' | 'path' | 'sha'>) => {
  const reference = blob.path ?? blob.sha;

  if (!reference) {
    throw new Error('Blob store key requires a path or sha');
  }

  return `${blob.owner}/${blob.repo}:${reference}`;
};
