/** @file Git branch fixture schema and canonical branch keys. */
import {faker} from '@faker-js/faker';
import {z} from 'zod';

/**
 * Validates and normalizes a minimal Git branch fixture, generating a commit
 * SHA when the fixture omits one.
 *
 * @internal
 */
export const githubBranchSchema = z
  .object({
    /** Login of the account that owns the repository the branch belongs to. */
    owner: z.string(),
    /** Name of the repository the branch belongs to. */
    repo: z.string(),
    /** Name of the branch, for example `main` or `feature/foo`. */
    name: z.string().optional().default('main'),
    commit: z
      .object({
        /** SHA of the commit the branch currently points to. */
        sha: z.string().optional(),
        /** API URL for the commit the branch currently points to. */
        url: z.string().optional()
      })
      .optional()
      .default({}),
    /** Whether branch protection rules are enforced for this branch. */
    protected: z.boolean().optional().default(true),
    /** Branch protection settings, present only when the branch is protected. */
    protection: z.record(z.string(), z.unknown()).optional(),
    /** API URL for retrieving the branch's protection settings. */
    protection_url: z.string().optional()
  })
  .transform((branch) => {
    const sha = branch.commit.sha ?? faker.git.commitSha();
    const commit = {
      ...branch.commit,
      sha
    };

    return {
      ...branch,
      commit
    };
  });

/** A validated Git branch fixture, addressed by repository and branch name. */
export interface GitHubBranch extends z.infer<typeof githubBranchSchema> {}

/**
 * Derives the canonical store key for a Git branch.
 *
 * @example
 * ```ts
 * branchStoreKey({owner: 'acme', repo: 'widgets', name: 'main'});
 * // 'acme/widgets:main'
 * ```
 *
 * @param branch Branch coordinate parts containing owner, repo, and name.
 * @returns The canonical key in `owner/repo:name` format.
 */
export const branchStoreKey = (branch: Pick<GitHubBranch, 'owner' | 'repo' | 'name'>) =>
  `${branch.owner}/${branch.repo}:${branch.name}`;
