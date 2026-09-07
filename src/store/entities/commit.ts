/** @file Git commit fixture schema and canonical commit keys. */
import {z} from 'zod';

type CommitStoreKeyInput = {
  owner: string;
  repo: string;
  sha: string;
};

/**
 * Derives the canonical store key for a Git commit.
 *
 * @param commit Commit coordinate parts containing owner, repo, and sha.
 * @returns The canonical key in `owner/repo:sha` format.
 */
export const commitStoreKey = (commit: CommitStoreKeyInput): string => `${commit.owner}/${commit.repo}:${commit.sha}`;

const STATIC_DEFAULT_COMMIT_SHA = '0000000000000000000000000000000000000000';
const STATIC_DEFAULT_COMMIT_TIMESTAMP = '1970-01-01T00:00:00.000Z';

const actorSchema = z
  .object({
    /** Display name of the person who authored or committed the change. */
    name: z.string().optional().default('Simulacat Author'),
    /** Email address of the person who authored or committed the change. */
    email: z.string().email().optional().default('simulacat@example.test'),
    /** ISO 8601 timestamp recording when the authoring or committing action occurred. */
    date: z.string().optional().default(STATIC_DEFAULT_COMMIT_TIMESTAMP)
  })
  .optional()
  .default({});

/**
 * Validates and normalizes a minimal Git commit fixture.
 *
 * `githubCommitSchema` accepts repository coordinates plus an optional `sha`,
 * `node_id`, REST URLs, commit message, author/committer actors, tree, and
 * parent commit references. It defaults `sha`, `commit.message`,
 * `commit.author`, `commit.committer`, and `commit.tree` when omitted. During
 * transformation, `commit.tree.sha` falls back to the top-level `sha`,
 * top-level `parents` take precedence over `commit.parents` when both fixture
 * forms are present, and missing `node_id` values are synthesized from
 * `commitStoreKey`.
 *
 * @returns The normalized `GitHubCommit` shape used by the store and adapters.
 *
 * @internal
 */
export const githubCommitSchema = z
  .object({
    /** Login of the account that owns the repository the commit belongs to. */
    owner: z.string().trim().min(1),
    /** Name of the repository the commit belongs to. */
    repo: z.string().trim().min(1),
    /** SHA-1 hash identifying the commit. */
    sha: z.string().trim().min(1).optional().default(STATIC_DEFAULT_COMMIT_SHA),
    /** The GraphQL global node identifier for the commit. */
    node_id: z.string().optional(),
    /** REST API URL for the commit. */
    url: z.string().optional(),
    /** Web URL for viewing the commit. */
    html_url: z.string().optional(),
    /** Git commit object data, distinct from the REST-only fields above. */
    commit: z
      .object({
        /** Commit message text. */
        message: z.string().optional().default('Seeded commit'),
        /** Person who authored the change captured by the commit. */
        author: actorSchema,
        /** Person who committed the change, who may differ from the author. */
        committer: actorSchema,
        tree: z
          .object({
            /** SHA-1 hash of the tree object recorded by this commit. */
            sha: z.string().optional(),
            /** API URL for the tree object recorded by this commit. */
            url: z.string().optional()
          })
          .optional()
          .default({}),
        /** Parent commit references nested under the Git commit object. */
        parents: z
          .array(
            z.object({
              /** SHA-1 hash of the parent commit. */
              sha: z.string().trim().min(1),
              /** API URL for the parent commit. */
              url: z.string().optional()
            })
          )
          .optional()
      })
      .optional()
      .default({}),
    /** Top-level REST parent commit references, taking precedence over `commit.parents`. */
    parents: z
      .array(
        z.object({
          /** SHA-1 hash of the parent commit. */
          sha: z.string().trim().min(1),
          /** API URL for the parent commit. */
          url: z.string().optional()
        })
      )
      .optional()
  })
  .transform((input) => {
    // Early slices only need a stable tree link; callers can provide a real
    // tree SHA once tree objects become first-class fixtures.
    const treeSha = input.commit.tree.sha ?? input.sha;
    // Top-level REST commit parents take precedence over nested commit parents
    // when both fixture forms are present.
    const parentInputs = input.parents ?? input.commit.parents ?? [];
    const parents = parentInputs.map((parent) => ({...parent}));

    return {
      ...input,
      /** The GraphQL global node identifier, derived from the store key when omitted. */
      node_id: input.node_id ?? Buffer.from(`Commit:${commitStoreKey(input)}`).toString('base64'),
      /** Nested git-commit payload mirroring the REST API `commit` object. */
      commit: {
        ...input.commit,
        /** Tree pointer for the commit; the SHA falls back to the commit SHA for early slices. */
        tree: {
          ...input.commit.tree,
          /** SHA-1 of the tree, defaulting to the commit's own SHA when not supplied. */
          sha: treeSha
        },
        /** Parent commit references normalized from either fixture form. */
        parents
      },
      /** Top-level REST-style parent references, kept in step with `commit.parents`. */
      parents
    };
  });

/** The normalized shape of a Git commit fixture produced by `githubCommitSchema`. */
export interface GitHubCommit extends z.infer<typeof githubCommitSchema> {}
