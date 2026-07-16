/** @file REST request parsing for the repository metadata PATCH endpoint. */
import {z} from 'zod';
import {
  REPOSITORY_WRITABLE_FIELDS,
  type RepositoryWritableField,
  type UpdateRepositoryCommand
} from '../store/actions/repository.ts';

/** Input accepted when building an update command from an HTTP request body. */
export type BuildUpdateRepositoryCommandInput = {
  owner: string;
  name: string;
  body: unknown;
};

const repositoryPatchBodyShape = Object.fromEntries(
  REPOSITORY_WRITABLE_FIELDS.map((field) => [field, z.string().optional().catch(undefined)])
) as Record<RepositoryWritableField, z.ZodCatch<z.ZodOptional<z.ZodString>>>;

const repositoryPatchBodySchema = z.object(repositoryPatchBodyShape).passthrough();

/**
 * Builds a repository update command from an untrusted REST request body.
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
  const parsedBody = repositoryPatchBodySchema.safeParse(input.body);

  if (parsedBody.success) {
    for (const field of REPOSITORY_WRITABLE_FIELDS) {
      const value = parsedBody.data[field];
      if (typeof value === 'string') changes[field] = value;
    }
  }

  return {owner: input.owner, name: input.name, changes};
};
