/** @file Filesystem helpers for loading bundled or caller-provided schemas. */
import path from 'path';
import fs from 'fs';

const schemaDefaults = ['schema.docs-enterprise.graphql', 'schema.docs.graphql', 'api.github.com.json'] as const;
export type SchemaFile = (typeof schemaDefaults)[number];

/**
 * Loads a bundled schema file or an explicit schema path from disk.
 *
 * @example
 * ```ts
 * const restSchema = getSchema('api.github.com.json');
 * const gqlSchema = getSchema('/tmp/schema.docs-enterprise.graphql');
 * ```
 */
export function getSchema(schemaFile: SchemaFile | string) {
  const root = path.join(import.meta.dirname, '..');

  const fileString = fs.readFileSync(
    (schemaDefaults as unknown as string[]).includes(schemaFile) ? path.join(root, 'schema', schemaFile) : schemaFile,
    'utf-8'
  );

  return schemaFile.endsWith('.json') ? JSON.parse(fileString) : fileString;
}
