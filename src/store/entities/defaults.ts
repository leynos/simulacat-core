/** @file Shared default generators for first-class entity fixtures. */
import {faker} from '@faker-js/faker';

/**
 * Generates a default ISO timestamp for optional fixture fields.
 *
 * Tests or callers that need repeatable generated values should seed Faker
 * once at the test/bootstrap boundary rather than inside individual schemas.
 */
export const defaultTimestamp = () => faker.date.recent().toISOString();

/**
 * Generates a Git commit SHA for commit-shaped fixtures.
 *
 * Tests or callers that need repeatable generated values should seed Faker
 * once at the test/bootstrap boundary rather than inside individual schemas.
 */
export const defaultCommitSha = () => faker.git.commitSha();
