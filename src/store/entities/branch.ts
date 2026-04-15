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
    protection: z.any().optional(),
    protection_url: z.string().optional()
  })
  .transform((branch) => {
    const sha = branch.commit.sha ?? faker.git.commitSha();

    branch.commit = {
      sha,
      url: branch.commit.url ?? `https://api.github.com/repos/${branch.owner}/${branch.repo}/commits/${sha}`
    };
    branch.protection_url ??= `https://api.github.com/repos/${branch.owner}/${branch.repo}/branches/${branch.name}/protection`;

    return branch;
  });

export type GitHubBranch = z.infer<typeof githubBranchSchema>;

export const branchStoreKey = (branch: GitHubBranch) => `${branch.owner}/${branch.repo}:${branch.name}`;
