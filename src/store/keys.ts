/** @file Canonical store key helpers for GitHub repository-owned entities. */
import {blobStoreKey} from './entities/blob.ts';
import {branchStoreKey} from './entities/branch.ts';
import {repositoryStoreKey} from './entities/repository.ts';

export {blobStoreKey, branchStoreKey, repositoryStoreKey};

export type RepositoryStoreKeyParts = {
  owner: string;
  name: string;
};

export type BranchStoreKeyParts = {
  owner: string;
  repo: string;
  name: string;
};

export const repositoryNodeId = (owner: string, name: string): string => {
  return Buffer.from(`Repository:${repositoryStoreKey({owner, name})}`).toString('base64');
};

export const parseRepositoryStoreKey = (key: string): RepositoryStoreKeyParts => {
  const separator = key.indexOf('/');

  if (separator <= 0 || separator === key.length - 1) {
    throw new Error(`Malformed repository store key "${key}"; expected "owner/name"`);
  }

  return {
    owner: key.slice(0, separator),
    name: key.slice(separator + 1)
  };
};

export const parseBranchStoreKey = (key: string): BranchStoreKeyParts => {
  const repository = parseRepositoryStoreKey(key);
  const separator = repository.name.indexOf(':');

  if (separator <= 0 || separator === repository.name.length - 1) {
    throw new Error(`Malformed branch store key "${key}"; expected "owner/repo:name"`);
  }

  return {
    owner: repository.owner,
    repo: repository.name.slice(0, separator),
    name: repository.name.slice(separator + 1)
  };
};
