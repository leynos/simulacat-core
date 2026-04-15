/**
 * @file Aggregated GitHub fixture schemas and store-table conversion helpers.
 *
 * This module keeps the package's public fixture-schema surface stable whilst
 * delegating entity-specific defaults to smaller files under `entities/`.
 */
import {convertObjToProp} from '@simulacrum/foundation-simulator';
import {faker} from '@faker-js/faker';
import {z} from 'zod';
import {blobStoreKey, githubBlobSchema, type GitHubBlob} from './entities/blob.ts';
import {branchStoreKey, githubBranchSchema, type GitHubBranch} from './entities/branch.ts';
import {githubAppInstallationSchema, type GitHubAppInstallation} from './entities/installation.ts';
import {githubOrganizationSchema, type GitHubOrganization} from './entities/organization.ts';
import {githubRepositorySchema, repositoryStoreKey, type GitHubRepository} from './entities/repository.ts';

export const githubUserSchema = z
  .object({
    id: z.number().default(() => faker.number.int({min: 1000})),
    login: z.string(),
    name: z.string().optional(),
    bio: z.string().default(''),
    email: z.string().optional(),
    url: z.string().url().optional(),
    avatar_url: z.string().optional().default('https://github.com/images/error/octocat_happy.gif'),
    organizations: z.array(z.string()),
    created_at: z
      .string()
      .optional()
      .default(() => faker.date.recent().toISOString())
  })
  .transform((user) => {
    if (!user.name) {
      user.name = user.login;
    }
    if (!user.email) {
      user.email = faker.internet.email({firstName: user.name});
    }
    return user;
  });

export type GitHubUser = z.infer<typeof githubUserSchema>;

export const githubInitialStoreSchema = z
  .object({
    users: z.array(githubUserSchema),
    installations: z.array(githubAppInstallationSchema).optional().default([]),
    organizations: z.array(githubOrganizationSchema),
    repositories: z.array(githubRepositorySchema),
    branches: z.array(githubBranchSchema),
    blobs: z.array(githubBlobSchema)
  })
  .transform((initialStore) => {
    const existingAccounts = new Set(initialStore.installations.map((installation) => installation.account));

    const generatedInstallations = initialStore.organizations
      .filter((org) => !existingAccounts.has(org.login))
      .map((org) =>
        githubAppInstallationSchema.parse({
          account: org.login,
          target_id: org.id,
          target_type: org.type
        })
      );

    initialStore.installations = [...initialStore.installations, ...generatedInstallations];
    return initialStore;
  });

export type GitHubStore = z.output<typeof githubInitialStoreSchema>;
export type GitHubInitialStore = z.input<typeof githubInitialStoreSchema>;

export const convertObjByKey = <T>(objects: T[], key: (object: T) => string) =>
  Object.fromEntries(objects.map((object) => [key(object), object])) as Record<string, T>;

/**
 * Converts parsed initial state into the keyed tables expected by the
 * foundation simulator.
 *
 * @example
 * ```ts
 * const tables = convertInitialStateToStoreState(parsedInitialState);
 * ```
 */
export const convertInitialStateToStoreState = (initialState: GitHubStore | undefined) => {
  if (!initialState) {
    return undefined;
  }

  return {
    users: convertObjToProp(initialState.users, 'login'),
    installations: convertObjToProp(initialState.installations, 'id'),
    repositories: convertObjByKey(initialState.repositories, repositoryStoreKey),
    branches: convertObjByKey(initialState.branches, branchStoreKey),
    organizations: convertObjToProp(initialState.organizations, 'login'),
    blobs: convertObjByKey(
      initialState.blobs.map((blob) => ({
        ...blob,
        sha: blobStoreKey(blob)!
      })),
      (blob) => blob.sha
    )
  };
};

export {
  blobStoreKey,
  branchStoreKey,
  githubAppInstallationSchema,
  githubBlobSchema,
  githubBranchSchema,
  githubOrganizationSchema,
  githubRepositorySchema,
  repositoryStoreKey
};
export type {GitHubAppInstallation, GitHubBlob, GitHubBranch, GitHubOrganization, GitHubRepository};
