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

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  bio: string;
  email: string;
  url?: string | undefined;
  avatar_url: string;
  organizations: string[];
  created_at: string;
}

const getNextInstallationId = (usedInstallationIds: Set<number>, nextInstallationId: number) => {
  let candidateId = nextInstallationId;

  while (usedInstallationIds.has(candidateId)) {
    candidateId += 1;
  }

  usedInstallationIds.add(candidateId);
  return {
    installationId: candidateId,
    nextInstallationId: candidateId + 1
  };
};

export const githubUserSchema = z
  .object({
    id: z
      .number()
      .optional()
      .default(() => faker.number.int({min: 1000})),
    login: z.string().trim().min(1),
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
  .transform((user): GitHubUser => {
    const id = user.id;
    const name = user.name ?? user.login;
    const email = user.email ?? faker.internet.email({firstName: name});

    return {
      ...user,
      id,
      name,
      email
    };
  });

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
    const usedInstallationIds = new Set(
      initialStore.installations.flatMap((installation) => (installation.id === undefined ? [] : [installation.id]))
    );
    let nextGeneratedInstallationId = Math.max(1999, ...usedInstallationIds) + 1;

    const normalizedInstallations = initialStore.installations.map((installation) => {
      if (installation.id !== undefined) {
        return installation;
      }

      const allocatedId = getNextInstallationId(usedInstallationIds, nextGeneratedInstallationId);
      nextGeneratedInstallationId = allocatedId.nextInstallationId;

      return githubAppInstallationSchema.parse({
        ...installation,
        id: allocatedId.installationId
      });
    });

    const existingAccounts = new Set(normalizedInstallations.map((installation) => installation.account));

    const generatedInstallations = initialStore.organizations
      .filter((org) => !existingAccounts.has(org.login))
      .map((org) => {
        const allocatedId = getNextInstallationId(usedInstallationIds, nextGeneratedInstallationId);
        nextGeneratedInstallationId = allocatedId.nextInstallationId;

        return githubAppInstallationSchema.parse({
          id: allocatedId.installationId,
          account: org.login,
          target_id: org.id,
          target_type: org.type
        });
      });

    return {
      ...initialStore,
      installations: [...normalizedInstallations, ...generatedInstallations]
    };
  });

export type GitHubStore = z.output<typeof githubInitialStoreSchema>;
export type GitHubInitialStore = z.input<typeof githubInitialStoreSchema>;

export const convertObjByKey = <T>(objects: T[], key: (object: T) => string) => {
  const keyedObjects = Object.create(null) as Record<string, T>;
  const keyIndexes = new Map<string, number>();

  for (const [index, object] of objects.entries()) {
    const currentKey = key(object);
    const existingIndex = keyIndexes.get(currentKey);

    if (existingIndex !== undefined) {
      throw new Error(`Duplicate key "${currentKey}" for objects at indices ${existingIndex} and ${index}`);
    }

    keyedObjects[currentKey] = object;
    keyIndexes.set(currentKey, index);
  }

  return keyedObjects;
};

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
    blobs: convertObjByKey(initialState.blobs, (blob) => blobStoreKey(blob))
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
