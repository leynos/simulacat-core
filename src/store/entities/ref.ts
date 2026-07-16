/** @file Git ref fixture schema and canonical ref keys. */
import {z} from 'zod';

type RefStoreKeyInput = {
  owner: string;
  repo: string;
  qualifiedName: string;
};

/**
 * Derives the canonical store key for a Git ref.
 *
 * @param ref Ref coordinate parts containing owner, repo, and qualifiedName.
 * @returns The canonical key in `owner/repo:qualifiedName` format.
 */
export const refStoreKey = (ref: RefStoreKeyInput): string => `${ref.owner}/${ref.repo}:${ref.qualifiedName}`;

const refObjectTypeSchema = z.enum(['commit', 'tag']);
type RefObjectType = z.infer<typeof refObjectTypeSchema>;

const defaultRefPrefix = (objectType: RefObjectType) => {
  return objectType === 'tag' ? 'refs/tags/' : 'refs/heads/';
};

/**
 * Validates and normalizes a minimal Git ref fixture.
 *
 * `githubRefSchema` accepts repository coordinates, a store-facing
 * `qualifiedName`, an optional fully qualified `ref` such as
 * `refs/heads/main`, and an object link whose `object.type` defaults to
 * `'commit'`. During transformation, `ref` takes precedence over
 * `qualifiedName`, so the output `qualifiedName` and `ref` may differ from the
 * input `qualifiedName` when both are provided. The `ref` value is prefixed
 * through `defaultRefPrefix(ref.object.type)` when it is not already fully
 * qualified, `node_id` is synthesized as Base64 of
 * `Ref:${refStoreKey({owner, repo, qualifiedName})}`.
 *
 * @returns The normalized `GitHubRef` shape used by the store and adapters.
 */
export const githubRefSchema = z
  .object({
    owner: z.string().trim().min(1),
    repo: z.string().trim().min(1),
    qualifiedName: z.string().trim().min(1),
    ref: z.string().trim().min(1).optional(),
    node_id: z.string().optional(),
    url: z.string().optional(),
    object: z.object({
      type: refObjectTypeSchema.default('commit'),
      sha: z.string().trim().min(1),
      url: z.string().optional()
    })
  })
  .transform((ref) => {
    const qualifiedName = ref.ref ?? ref.qualifiedName;
    const fullRef = qualifiedName.startsWith('refs/')
      ? qualifiedName
      : `${defaultRefPrefix(ref.object.type)}${qualifiedName}`;

    return {
      ...ref,
      qualifiedName,
      ref: fullRef,
      node_id:
        ref.node_id ??
        Buffer.from(`Ref:${refStoreKey({owner: ref.owner, repo: ref.repo, qualifiedName})}`).toString('base64')
    };
  });

export type GitHubRef = z.infer<typeof githubRefSchema>;
