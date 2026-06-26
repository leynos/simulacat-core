/** @file Pure repository write policy for shared store actions. */
import type {GitHubRepository} from '../entities.ts';

/** Repository fields this roadmap slice may mutate. */
export const REPOSITORY_WRITABLE_FIELDS = ['description', 'homepage'] as const;

/** A repository field accepted by the shared repository update action. */
export type RepositoryWritableField = (typeof REPOSITORY_WRITABLE_FIELDS)[number];

/** Command payload used to update benign repository metadata. */
export type UpdateRepositoryCommand = {
  owner: string;
  name: string;
  changes: Partial<Record<RepositoryWritableField, string | undefined>>;
};

/** Input accepted when building an update command from an adapter body. */
export type BuildUpdateRepositoryCommandInput = {
  owner: string;
  name: string;
  body: unknown;
};

const repositoryWritableFieldSet = new Set<string>(REPOSITORY_WRITABLE_FIELDS);

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
 * Builds a repository update command from an untrusted adapter body.
 *
 * @example
 * ```ts
 * buildUpdateRepositoryCommand({
 *   owner: 'acme',
 *   name: 'widgets',
 *   body: {description: 'New', private: true}
 * });
 * // {owner: 'acme', name: 'widgets', changes: {description: 'New'}}
 * ```
 *
 * @param input Repository coordinates and raw request body.
 * @returns A command containing only supported string changes.
 */
export const buildUpdateRepositoryCommand = (input: BuildUpdateRepositoryCommandInput): UpdateRepositoryCommand => {
  const changes: UpdateRepositoryCommand['changes'] = {};

  if (input.body && typeof input.body === 'object') {
    for (const [field, value] of Object.entries(input.body)) {
      if (isRepositoryWritableField(field) && typeof value === 'string') {
        changes[field] = value;
      }
    }
  }

  return {owner: input.owner, name: input.name, changes};
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
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(command.changes).filter(
        ([field, value]) => isRepositoryWritableField(field) && value !== undefined
      )
    )
  };
};
