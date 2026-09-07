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
 *
 * @internal
 */
export const githubRefSchema = z
  .object({
    /** Login of the account that owns the repository the ref belongs to. */
    owner: z.string().trim().min(1),
    /** Name of the repository the ref belongs to. */
    repo: z.string().trim().min(1),
    /** Store-facing ref name, without the `refs/heads/` or `refs/tags/` prefix. */
    qualifiedName: z.string().trim().min(1),
    /** Fully qualified ref, for example `refs/heads/main`; takes precedence over `qualifiedName`. */
    ref: z.string().trim().min(1).optional(),
    /** The GraphQL global node identifier for the ref. */
    node_id: z.string().optional(),
    /** REST API URL for the ref. */
    url: z.string().optional(),
    /** Git object the ref points to. */
    object: z.object({
      /** Type of Git object the ref points to. */
      type: refObjectTypeSchema.default('commit'),
      /** Identifier of the object the ref points to, a SHA-1 hash by convention; any non-empty string is accepted. */
      sha: z.string().trim().min(1),
      /** API URL for the object the ref points to. */
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
      /** Store-facing ref name; the fully qualified `ref` input wins over the raw `qualifiedName`. */
      qualifiedName,
      /** Fully qualified ref path, prefixed from the object type when the input was unqualified. */
      ref: fullRef,
      /** The GraphQL global node identifier, derived from the store key when omitted. */
      node_id:
        ref.node_id ??
        Buffer.from(`Ref:${refStoreKey({owner: ref.owner, repo: ref.repo, qualifiedName})}`).toString('base64')
    };
  });

/** The normalized shape of a Git ref fixture produced by `githubRefSchema`. */
export interface GitHubRef extends z.infer<typeof githubRefSchema> {}
