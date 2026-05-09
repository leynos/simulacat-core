/** @file Public fixture builders backed by the GitHub entity schemas. */
import type {z} from 'zod';
import {githubBranchSchema} from './entities/branch.ts';
import {githubRepositorySchema} from './entities/repository.ts';

/** Input shape for building a GitHub repository fixture. */
export type RepositoryFixtureInput = z.input<typeof githubRepositorySchema>;

/** Input shape for building a GitHub branch fixture. */
export type BranchFixtureInput = z.input<typeof githubBranchSchema>;

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
