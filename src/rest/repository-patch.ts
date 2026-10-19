/** @file REST request parsing for the repository metadata PATCH endpoint. */
import {z} from 'zod';
import type {UpdateRepositoryCommand} from '../store/actions/repository.ts';

/** Input accepted when building an update command from an HTTP request body. */
export type BuildUpdateRepositoryCommandInput = {
  /** Login of the account or organization owning the repository. */
  owner: string;
  /** Repository name within the owner's namespace. */
  name: string;
  /** Untrusted request body; unsupported fields are discarded. */
  body: unknown;
};

/** Validates a value that must be a string to be accepted. */
const writableStringSchema = z.string();

/**
 * Optional writable string that discards malformed values.
 *
 * A non-string field is dropped rather than failing the whole body, so one
 * malformed key does not reject an otherwise valid press.
 */
const optionalWritableStringSchema = z.preprocess(
  (value) => (writableStringSchema.safeParse(value).success ? value : undefined),
  writableStringSchema.optional()
);

/**
 * Validator for the writable subset of a PATCH body.
 *
 * Unsupported keys are stripped by `z.object` while unknown keys are ignored.
 */
const repositoryPatchBodySchema = z
  .object({
    /** New repository description, when supplied as a string. */
    description: optionalWritableStringSchema,
    /** New repository homepage, when supplied as a string. */
    homepage: optionalWritableStringSchema
  })
  .passthrough();

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
    const {description, homepage} = parsedBody.data;
    if (description !== undefined) changes.description = description;
    if (homepage !== undefined) changes.homepage = homepage;
  }

  return {owner: input.owner, name: input.name, changes};
};
