/** @file Runtime decoding for untrusted repository update action payloads. */
import {z} from 'zod';
import type {RepositoryWritableField, UpdateRepositoryCommand} from './repository.ts';

/**
 * Optional writable string that discards malformed values.
 *
 * A non-string field is dropped rather than failing the whole payload, so one
 * malformed key cannot discard a valid sibling.
 */
const optionalWritableStringSchema = z.preprocess(
  (value) => (z.string().safeParse(value).success ? value : undefined),
  z.string().optional()
);

/**
 * Decodes the writable subset of a repository update payload.
 *
 * JavaScript callers can dispatch the public action with values outside the
 * TypeScript contract. Decoding here keeps the pure reducer free of runtime
 * validation while ensuring only strings reach it.
 */
const writableChangesFields = {
  description: optionalWritableStringSchema,
  homepage: optionalWritableStringSchema
};

/**
 * Decodes the `changes` member, replacing a malformed value with `{}`.
 *
 * A `safeParse` probe is used rather than `z.catch` so a malformed change set
 * yields an empty one while the owner and name stay usable.
 */
const writableChangesSchema = z.preprocess((value) => {
  const parsed = z.object(writableChangesFields).safeParse(value);
  return parsed.success ? parsed.data : {};
}, z.object(writableChangesFields));

/** Decodes the full command shape; malformed fields are handled above. */
const updateRepositoryCommandSchema = z.object({
  owner: z.string(),
  name: z.string(),
  changes: writableChangesSchema
});

/** Drops writable fields that decoded to `undefined`. */
// The preprocessor keeps a rejected key with an `undefined` value, and
// spreading that into the reducer would erase the current field. Filtering
// keeps "absent" and "invalid" indistinguishable to the reducer.
const definedChanges = (
  changes: Partial<Record<RepositoryWritableField, string | undefined>>
): Partial<Record<RepositoryWritableField, string>> =>
  Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));

/**
 * Decodes one repository update command at the public action boundary.
 *
 * Unrecognised payloads decode to an empty command, so the action finds no
 * repository and performs no write instead of throwing.
 *
 * @example
 * ```ts
 * decodeUpdateRepositoryCommand({owner: 'acme', name: 'widgets', changes: {description: 42}});
 * // {owner: 'acme', name: 'widgets', changes: {}}
 * ```
 *
 * @param command Untrusted payload received by the public action.
 * @returns A command containing only string-valued writable changes.
 */
export const decodeUpdateRepositoryCommand = (command: UpdateRepositoryCommand): UpdateRepositoryCommand => {
  const decoded = updateRepositoryCommandSchema.safeParse(command);
  if (!decoded.success) return {owner: '', name: '', changes: {}};
  return {...decoded.data, changes: definedChanges(decoded.data.changes)};
};
