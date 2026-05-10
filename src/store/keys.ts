/** @file Canonical store key helpers for GitHub repository-owned entities. */
import {blobStoreKey} from './entities/blob.ts';
import {branchStoreKey} from './entities/branch.ts';
import {commitStoreKey} from './entities/commit.ts';
import {issueStoreKey} from './entities/issue.ts';
import {pullRequestStoreKey} from './entities/pull-request.ts';
import {refStoreKey} from './entities/ref.ts';
import {repositoryStoreKey} from './entities/repository.ts';

export {
  blobStoreKey,
  branchStoreKey,
  commitStoreKey,
  issueStoreKey,
  pullRequestStoreKey,
  refStoreKey,
  repositoryStoreKey
};

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

export type RefStoreKeyParts = {
  owner: string;
  repo: string;
  qualifiedName: string;
};

export type CommitStoreKeyParts = {
  owner: string;
  repo: string;
  sha: string;
};

export type IssueStoreKeyParts = {
  owner: string;
  repo: string;
  number: number;
};

export type PullRequestStoreKeyParts = IssueStoreKeyParts;

/** Shared coordinates for any repository-scoped entity. */
export type RepositoryCoords = {
  owner: string;
  repo: string;
};

export const repositoryNodeId = (owner: string, name: string): string => {
  return Buffer.from(`Repository:${repositoryStoreKey({owner, name})}`).toString('base64');
};

export const refNodeId = (owner: string, repo: string, qualifiedName: string): string => {
  return Buffer.from(`Ref:${refStoreKey({owner, repo, qualifiedName})}`).toString('base64');
};

export const commitNodeId = (owner: string, repo: string, sha: string): string => {
  return Buffer.from(`Commit:${commitStoreKey({owner, repo, sha})}`).toString('base64');
};

export const issueNodeId = (owner: string, repo: string, number: number): string => {
  return Buffer.from(`Issue:${issueStoreKey({owner, repo, number})}`).toString('base64');
};

export const pullRequestNodeId = (owner: string, repo: string, number: number): string => {
  return Buffer.from(`PullRequest:${pullRequestStoreKey({owner, repo, number})}`).toString('base64');
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

const parseRepositoryScopedReferenceKey = (
  key: string,
  entityName: string,
  referenceName: string
): RepositoryStoreKeyParts & {reference: string} => {
  const separator = key.indexOf(':');
  const malformedError = new Error(
    `Malformed ${entityName} store key "${key}"; expected "owner/repo:${referenceName}"`
  );

  if (separator <= 0 || separator === key.length - 1) {
    throw malformedError;
  }

  let repository: RepositoryStoreKeyParts;

  try {
    repository = parseRepositoryStoreKey(key.slice(0, separator));
  } catch (error) {
    throw new Error(malformedError.message, {cause: error});
  }

  return {
    ...repository,
    reference: key.slice(separator + 1)
  };
};

const parseNumberedRepositoryKey = (
  key: string,
  separatorToken: '#' | '!',
  entityName: string
): RepositoryStoreKeyParts & {number: number} => {
  const separator = key.indexOf(separatorToken);
  const malformedError = new Error(
    `Malformed ${entityName} store key "${key}"; expected "owner/repo${separatorToken}number"`
  );

  if (separator <= 0 || separator === key.length - 1) {
    throw malformedError;
  }

  let repository: RepositoryStoreKeyParts;

  try {
    repository = parseRepositoryStoreKey(key.slice(0, separator));
  } catch (error) {
    throw new Error(malformedError.message, {cause: error});
  }

  const number = Number(key.slice(separator + 1));
  if (!Number.isInteger(number) || number <= 0) {
    throw malformedError;
  }

  return {...repository, number};
};

export const parseRefStoreKey = (key: string): RefStoreKeyParts => {
  const parsed = parseRepositoryScopedReferenceKey(key, 'ref', 'qualifiedName');
  return {owner: parsed.owner, repo: parsed.name, qualifiedName: parsed.reference};
};

export const parseCommitStoreKey = (key: string): CommitStoreKeyParts => {
  const parsed = parseRepositoryScopedReferenceKey(key, 'commit', 'sha');
  return {owner: parsed.owner, repo: parsed.name, sha: parsed.reference};
};

export const parseIssueStoreKey = (key: string): IssueStoreKeyParts => {
  const parsed = parseNumberedRepositoryKey(key, '#', 'issue');
  return {owner: parsed.owner, repo: parsed.name, number: parsed.number};
};

export const parsePullRequestStoreKey = (key: string): PullRequestStoreKeyParts => {
  const parsed = parseNumberedRepositoryKey(key, '!', 'pull request');
  return {owner: parsed.owner, repo: parsed.name, number: parsed.number};
};
