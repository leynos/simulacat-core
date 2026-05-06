/** @file Public fixture builders backed by the GitHub entity schemas. */
import type {z} from 'zod';
import {githubBranchSchema} from './entities/branch.ts';
import {githubRepositorySchema} from './entities/repository.ts';

export type RepositoryFixtureInput = z.input<typeof githubRepositorySchema>;
export type BranchFixtureInput = z.input<typeof githubBranchSchema>;

export const buildRepositoryFixture = (input: RepositoryFixtureInput) => {
  return githubRepositorySchema.parse(input);
};

export const buildBranchFixture = (input: BranchFixtureInput) => {
  return githubBranchSchema.parse(input);
};
