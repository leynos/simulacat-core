/** @file Git branch fixture schema and canonical branch keys. */
import {faker} from '@faker-js/faker';
import {z} from 'zod';

export const githubBranchSchema = z
  .object({
    owner: z.string(),
    repo: z.string(),
    name: z.string().optional().default('main'),
    commit: z
      .object({
        sha: z.string().optional(),
        url: z.string().optional()
      })
      .optional()
      .default({}),
    protected: z.boolean().optional().default(true),
    protection: z.record(z.string(), z.unknown()).optional(),
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

export type GitHubBranch = z.infer<typeof githubBranchSchema>;

export const branchStoreKey = (branch: Pick<GitHubBranch, 'owner' | 'repo' | 'name'>) =>
  `${branch.owner}/${branch.repo}:${branch.name}`;
