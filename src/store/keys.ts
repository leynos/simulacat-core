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

export type BlobStoreKeyParts = {
  owner: string;
  repo: string;
  reference: string;
};

export const repositoryNodeId = (owner: string, name: string): string => {
  return Buffer.from(`Repository:${repositoryStoreKey({owner, name})}`).toString('base64');
};

export const parseRepositoryStoreKey = (key: string): RepositoryStoreKeyParts => {
  const separator = key.indexOf('/');

  if (separator <= 0) {
    throw new Error(`Malformed repository store key "${key}"; expected "owner/name"`);
  }

  if (separator === key.length - 1) {
    throw new Error(`Malformed repository store key "${key}"; expected "owner/name"`);
  }

  if (separator !== key.lastIndexOf('/')) {
    throw new Error(`Malformed repository store key "${key}"; expected "owner/name"`);
  }

  return {
    owner: key.slice(0, separator),
    name: key.slice(separator + 1)
  };
};

export const parseBranchStoreKey = (key: string): BranchStoreKeyParts => {
  const separator = key.indexOf(':');
  const malformedError = new Error(`Malformed branch store key "${key}"; expected "owner/repo:name"`);

  if (separator <= 0 || separator === key.length - 1) {
    throw malformedError;
  }

  let repository: RepositoryStoreKeyParts;

  try {
    repository = parseRepositoryStoreKey(key.slice(0, separator));
  } catch (error) {
    throw new Error(malformedError.message, {cause: error});
  }

  const name = key.slice(separator + 1);

  return {
    owner: repository.owner,
    repo: repository.name,
    name
  };
};

export const parseBlobStoreKey = (key: string): BlobStoreKeyParts => {
  const separator = key.indexOf(':');
  const malformedError = new Error(`Malformed blob store key "${key}"; expected "owner/repo:reference"`);

  if (separator <= 0 || separator === key.length - 1) {
    throw malformedError;
  }

  let repository: RepositoryStoreKeyParts;

  try {
    repository = parseRepositoryStoreKey(key.slice(0, separator));
  } catch (error) {
    throw new Error(malformedError.message, {cause: error});
  }

  const reference = key.slice(separator + 1);

  return {
    owner: repository.owner,
    repo: repository.name,
    reference
  };
};
