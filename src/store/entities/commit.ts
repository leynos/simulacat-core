/** @file Git commit fixture schema and canonical commit keys. */
import {z} from 'zod';
import {defaultCommitSha, defaultTimestamp} from './defaults.ts';

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

const actorSchema = z
  .object({
    name: z.string().optional().default('Simulacat Author'),
    email: z.string().email().optional().default('simulacat@example.test'),
    date: z.string().optional().default(defaultTimestamp)
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
 * transformation, `commit.tree.sha` falls back to the top-level `sha`, and
 * top-level `parents` take precedence over `commit.parents` when both fixture
 * forms are present. Missing `node_id`, `url`, `html_url`, tree URLs, and
 * parent URLs are synthesized from `commitStoreKey`, owner, repo, and sha.
 *
 * @returns The normalized `GitHubCommit` shape used by the store and adapters.
 */
export const githubCommitSchema = z
  .object({
    owner: z.string().trim().min(1),
    repo: z.string().trim().min(1),
    sha: z.string().trim().min(1).optional().default(defaultCommitSha),
    node_id: z.string().optional(),
    url: z.string().optional(),
    html_url: z.string().optional(),
    commit: z
      .object({
        message: z.string().optional().default('Seeded commit'),
        author: actorSchema,
        committer: actorSchema,
        tree: z
          .object({
            sha: z.string().optional(),
            url: z.string().optional()
          })
          .optional()
          .default({}),
        parents: z.array(z.object({sha: z.string().trim().min(1), url: z.string().optional()})).optional()
      })
      .optional()
      .default({}),
    parents: z.array(z.object({sha: z.string().trim().min(1), url: z.string().optional()})).optional()
  })
  .transform((input) => {
    // Early slices only need a stable tree link; callers can provide a real
    // tree SHA once tree objects become first-class fixtures.
    const treeSha = input.commit.tree.sha ?? input.sha;
    // Top-level REST commit parents take precedence over nested commit parents
    // when both fixture forms are present.
    const parentInputs = input.parents ?? input.commit.parents ?? [];
    const parents = parentInputs.map((parent) => ({
      ...parent,
      url: parent.url ?? `https://api.github.com/repos/${input.owner}/${input.repo}/git/commits/${parent.sha}`
    }));

    return {
      ...input,
      node_id: input.node_id ?? Buffer.from(`Commit:${commitStoreKey(input)}`).toString('base64'),
      url: input.url ?? `https://api.github.com/repos/${input.owner}/${input.repo}/git/commits/${input.sha}`,
      html_url: input.html_url ?? `https://github.com/${input.owner}/${input.repo}/commit/${input.sha}`,
      commit: {
        ...input.commit,
        tree: {
          sha: treeSha,
          url: input.commit.tree.url ?? `https://api.github.com/repos/${input.owner}/${input.repo}/git/trees/${treeSha}`
        },
        parents
      },
      parents
    };
  });

export type GitHubCommit = z.infer<typeof githubCommitSchema>;
