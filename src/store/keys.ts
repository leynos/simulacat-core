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

/** The `owner` and `name` parts of a repository store key. */
export type RepositoryStoreKeyParts = {
  owner: string;
  name: string;
};

/** The `owner`, `repo`, and `name` parts of a branch store key. */
export type BranchStoreKeyParts = {
  owner: string;
  repo: string;
  name: string;
};

/** The `owner`, `repo`, and `reference` parts of a blob store key. */
export type BlobStoreKeyParts = {
  owner: string;
  repo: string;
  reference: string;
};

/** The `owner`, `repo`, and `qualifiedName` parts of a ref store key. */
export type RefStoreKeyParts = {
  owner: string;
  repo: string;
  qualifiedName: string;
};

/** The `owner`, `repo`, and `sha` parts of a commit store key. */
export type CommitStoreKeyParts = {
  owner: string;
  repo: string;
  sha: string;
};

/** The `owner`, `repo`, and positive `number` parts of an issue store key. */
export type IssueStoreKeyParts = {
  owner: string;
  repo: string;
  number: number;
};

/**
 * The `owner`, `repo`, and positive `number` parts of a pull-request store
 * key.
 */
export type PullRequestStoreKeyParts = IssueStoreKeyParts;

/** Shared coordinates for any repository-scoped entity. */
export type RepositoryCoords = {
  owner: string;
  repo: string;
};

/**
 * Serialises a repository store key as a GitHub GraphQL-compatible Node ID.
 *
 * @example
 * ```ts
 * repositoryNodeId({owner: 'acme', name: 'widgets'});
 * // 'UmVwb3NpdG9yeTphY21lL3dpZGdldHM='
 * ```
 *
 * @param owner Repository owner login.
 * @param name Repository name.
 * @returns Base64-encoded Repository node id.
 */
export const repositoryNodeId = ({owner, name}: RepositoryStoreKeyParts): string => {
  return Buffer.from(`Repository:${repositoryStoreKey({owner, name})}`).toString('base64');
};

/**
 * Serialises a ref store key as a GitHub GraphQL-compatible Node ID.
 *
 * @example
 * ```ts
 * refNodeId({owner: 'acme', repo: 'widgets', qualifiedName: 'refs/heads/main'});
 * // 'UmVmOmFjbWUvd2lkZ2V0czpyZWZzL2hlYWRzL21haW4='
 * ```
 *
 * @param owner Repository owner login.
 * @param repo Repository name.
 * @param qualifiedName Qualified ref name.
 * @returns Base64-encoded Ref node id.
 */
export const refNodeId = ({owner, repo, qualifiedName}: RefStoreKeyParts): string => {
  return Buffer.from(`Ref:${refStoreKey({owner, repo, qualifiedName})}`).toString('base64');
};

/**
 * Serialises a commit store key as a GitHub GraphQL-compatible Node ID.
 *
 * @example
 * ```ts
 * commitNodeId({owner: 'acme', repo: 'widgets', sha: 'abc123'});
 * // 'Q29tbWl0OmFjbWUvd2lkZ2V0czphYmMxMjM='
 * ```
 *
 * @param owner Repository owner login.
 * @param repo Repository name.
 * @param sha Commit SHA.
 * @returns Base64-encoded Commit node id.
 */
export const commitNodeId = ({owner, repo, sha}: CommitStoreKeyParts): string => {
  return Buffer.from(`Commit:${commitStoreKey({owner, repo, sha})}`).toString('base64');
};

/**
 * Serialises an issue store key as a GitHub GraphQL-compatible Node ID.
 *
 * @example
 * ```ts
 * issueNodeId({owner: 'acme', repo: 'widgets', number: 7});
 * // 'SXNzdWU6YWNtZS93aWRnZXRzIzc='
 * ```
 *
 * @param owner Repository owner login.
 * @param repo Repository name.
 * @param number Positive issue number.
 * @returns Base64-encoded Issue node id.
 */
export const issueNodeId = ({owner, repo, number}: IssueStoreKeyParts): string => {
  return Buffer.from(`Issue:${issueStoreKey({owner, repo, number})}`).toString('base64');
};

/**
 * Serialises a pull request store key as a GitHub GraphQL-compatible Node ID.
 *
 * @example
 * ```ts
 * pullRequestNodeId({owner: 'acme', repo: 'widgets', number: 3});
 * // encodes 'PullRequest:acme/widgets!3'
 * // 'UHVsbFJlcXVlc3Q6YWNtZS93aWRnZXRzITM='
 * ```
 *
 * @param owner Repository owner login.
 * @param repo Repository name.
 * @param number Positive pull request number.
 * @returns Base64-encoded PullRequest node id.
 */
export const pullRequestNodeId = ({owner, repo, number}: PullRequestStoreKeyParts): string => {
  return Buffer.from(`PullRequest:${pullRequestStoreKey({owner, repo, number})}`).toString('base64');
};

/**
 * Parses a repository store key in `owner/name` format.
 *
 * @param key Repository store key to parse.
 * @returns Parsed repository owner and name.
 * @throws Error when the key is missing either segment or has extra slashes.
 */
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

/**
 * Parses a branch store key in `owner/repo:name` format.
 *
 * @param key Branch store key to parse.
 * @returns Parsed owner, repository name, and branch name.
 * @throws Error when the key is missing repository coordinates or branch name.
 */
export const parseBranchStoreKey = (key: string): BranchStoreKeyParts => {
  const parsed = parseRepositoryScopedReferenceKey(key, 'branch', 'name');
  return {owner: parsed.owner, repo: parsed.name, name: parsed.reference};
};

/**
 * Parses a blob store key in `owner/repo:reference` format.
 *
 * @param key Blob store key to parse.
 * @returns Parsed owner, repository name, and blob reference.
 * @throws Error when the key is missing repository coordinates or reference.
 */
export const parseBlobStoreKey = (key: string): BlobStoreKeyParts => {
  const parsed = parseRepositoryScopedReferenceKey(key, 'blob', 'reference');
  return {owner: parsed.owner, repo: parsed.name, reference: parsed.reference};
};

/** Parses a `owner/repo:reference` store key into its constituent parts. */
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

/** Parses a `owner/repo{separator}number` store key into its constituent parts. */
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

/**
 * Parses a ref store key in `owner/repo:qualifiedName` format.
 *
 * @param key Ref store key to parse.
 * @returns Parsed owner, repository name, and qualified ref name.
 * @throws Error when the key is missing repository coordinates or ref name.
 */
export const parseRefStoreKey = (key: string): RefStoreKeyParts => {
  const parsed = parseRepositoryScopedReferenceKey(key, 'ref', 'qualifiedName');
  return {owner: parsed.owner, repo: parsed.name, qualifiedName: parsed.reference};
};

/**
 * Parses a commit store key in `owner/repo:sha` format.
 *
 * @param key Commit store key to parse.
 * @returns Parsed owner, repository name, and commit SHA.
 * @throws Error when the key is missing repository coordinates or SHA.
 */
export const parseCommitStoreKey = (key: string): CommitStoreKeyParts => {
  const parsed = parseRepositoryScopedReferenceKey(key, 'commit', 'sha');
  return {owner: parsed.owner, repo: parsed.name, sha: parsed.reference};
};

/**
 * Parses an issue store key in `owner/repo#number` format.
 *
 * @param key Issue store key to parse.
 * @returns Parsed owner, repository name, and positive issue number.
 * @throws Error when the key is malformed or the issue number is not positive.
 */
export const parseIssueStoreKey = (key: string): IssueStoreKeyParts => {
  const parsed = parseNumberedRepositoryKey(key, '#', 'issue');
  return {owner: parsed.owner, repo: parsed.name, number: parsed.number};
};

/**
 * Parses a pull request store key in `owner/repo!number` format.
 *
 * @param key Pull request store key to parse.
 * @returns Parsed owner, repository name, and positive pull request number.
 * @throws Error when the key is malformed or the pull request number is not positive.
 */
export const parsePullRequestStoreKey = (key: string): PullRequestStoreKeyParts => {
  const parsed = parseNumberedRepositoryKey(key, '!', 'pull request');
  return {owner: parsed.owner, repo: parsed.name, number: parsed.number};
};
