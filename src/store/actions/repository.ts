/** @file Pure repository write policy for shared store actions. */
import {z} from 'zod';
import type {GitHubRepository} from '../entities.ts';

/** Repository fields this roadmap slice may mutate. */
export const REPOSITORY_WRITABLE_FIELDS = ['description', 'homepage'] as const;

/** A repository field accepted by the shared repository update action. */
export type RepositoryWritableField = (typeof REPOSITORY_WRITABLE_FIELDS)[number];

/** Command payload used to update benign repository metadata. */
export type UpdateRepositoryCommand = {
  /** Login of the account or organization owning the repository. */
  owner: string;
  /** Repository name within the owner's namespace. */
  name: string;
  /** Writable fields to apply; absent and non-string values are ignored. */
  changes: Partial<Record<RepositoryWritableField, string | undefined>>;
};

const repositoryWritableFieldSet = new Set<string>(REPOSITORY_WRITABLE_FIELDS);

/**
 * Validates one writable field value from a parsed command.
 *
 * The public action payloads may arrive from untrusted runtime callers even
 * though the TypeScript contract only permits strings, so non-string values are
 * discarded rather than trusted.
 */
const writableFieldValueSchema = z.string();

/**
 * Returns true when a field is accepted by repository write policy.
 *
 * @param field Candidate repository field name.
 * @returns Whether `field` is a supported repository write field.
 */
export const isRepositoryWritableField = (field: string): field is RepositoryWritableField => {
  return repositoryWritableFieldSet.has(field);
};

/**
 * Applies an update command without mutating the current repository fixture.
 *
 * @example
 * ```ts
 * applyRepositoryUpdate(repository, {
 *   owner: 'acme',
 *   name: 'widgets',
 *   changes: {description: 'Ready'}
 * });
 * ```
 *
 * @param current Existing repository fixture.
 * @param command Whitelisted repository update command.
 * @returns A new repository value with supported changes applied.
 */
export const applyRepositoryUpdate = (
  current: GitHubRepository,
  command: UpdateRepositoryCommand
): GitHubRepository => {
  const acceptedChanges = Object.entries(command.changes).flatMap(([field, value]) => {
    if (!isRepositoryWritableField(field)) {
      return [];
    }

    const validated = writableFieldValueSchema.safeParse(value);
    return validated.success ? [[field, validated.data]] : [];
  });

  return {...current, ...Object.fromEntries(acceptedChanges)};
};
