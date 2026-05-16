/** @file Public fixture builders backed by the GitHub entity schemas. */
import type {z} from 'zod';
import {githubBranchSchema} from './entities/branch.ts';
import {githubCommitSchema} from './entities/commit.ts';
import {githubIssueSchema} from './entities/issue.ts';
import {githubPullRequestSchema} from './entities/pull-request.ts';
import {githubRefSchema} from './entities/ref.ts';
import {githubRepositorySchema} from './entities/repository.ts';

/** Input shape for building a GitHub repository fixture. */
export type RepositoryFixtureInput = z.input<typeof githubRepositorySchema>;

/** Input shape for building a GitHub branch fixture. */
export type BranchFixtureInput = z.input<typeof githubBranchSchema>;
/** Input shape for building a Git ref fixture. */
export type RefFixtureInput = z.input<typeof githubRefSchema>;
/** Input shape for building a Git commit fixture. */
export type CommitFixtureInput = z.input<typeof githubCommitSchema>;
/** Input shape for building a GitHub issue fixture. */
export type IssueFixtureInput = z.input<typeof githubIssueSchema>;
/** Input shape for building a GitHub pull request fixture. */
export type PullRequestFixtureInput = z.input<typeof githubPullRequestSchema>;

/**
 * Validates and returns a repository fixture from input.
 *
 * @param input Repository fixture input to parse.
 * @returns Parsed GitHub repository fixture.
 * @throws {ZodError} When `input` does not satisfy the repository schema.
 */
export const buildRepositoryFixture = (input: RepositoryFixtureInput) => {
  return githubRepositorySchema.parse(input);
};

/**
 * Validates and returns a branch fixture from input.
 *
 * @param input Branch fixture input to parse.
 * @returns Parsed GitHub branch fixture.
 * @throws {ZodError} When `input` does not satisfy the branch schema.
 */
export const buildBranchFixture = (input: BranchFixtureInput) => {
  return githubBranchSchema.parse(input);
};

/** Validates and returns a Git ref fixture from input. */
export const buildRefFixture = (input: RefFixtureInput) => {
  return githubRefSchema.parse(input);
};

/** Validates and returns a Git commit fixture from input. */
export const buildCommitFixture = (input: CommitFixtureInput) => {
  return githubCommitSchema.parse(input);
};

/** Validates and returns a GitHub issue fixture from input. */
export const buildIssueFixture = (input: IssueFixtureInput) => {
  return githubIssueSchema.parse(input);
};

/** Validates and returns a GitHub pull request fixture from input. */
export const buildPullRequestFixture = (input: PullRequestFixtureInput) => {
  return githubPullRequestSchema.parse(input);
};
