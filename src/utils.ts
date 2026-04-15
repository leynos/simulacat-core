/** @file Filesystem helpers for loading bundled or caller-provided schemas. */
import path from 'path';
import fs from 'fs';
import {z} from 'zod';

const schemaDefaults = ['schema.docs-enterprise.graphql', 'schema.docs.graphql', 'api.github.com.json'] as const;
export type SchemaFile = (typeof schemaDefaults)[number];
const openApiSchema = z
  .object({
    paths: z.record(z.unknown())
  })
  .passthrough();
type OpenApiSchema = z.infer<typeof openApiSchema>;

/**
 * Loads a bundled schema file or an explicit schema path from disk.
 *
 * @example
 * ```ts
 * const restSchema = getSchema('api.github.com.json');
 * const gqlSchema = getSchema('/tmp/schema.docs-enterprise.graphql');
 * ```
 */
export function getSchema(schemaFile: 'api.github.com.json'): OpenApiSchema;
export function getSchema(schemaFile: 'schema.docs.graphql' | 'schema.docs-enterprise.graphql'): string;
export function getSchema(schemaFile: `${string}.json`): OpenApiSchema;
export function getSchema(schemaFile: string): string;
export function getSchema(schemaFile: SchemaFile | string): string | OpenApiSchema {
  const root = path.join(import.meta.dirname, '..');
  const schemaPath = (schemaDefaults as readonly string[]).includes(schemaFile)
    ? path.join(root, 'schema', schemaFile)
    : schemaFile;

  try {
    const fileString = fs.readFileSync(schemaPath, 'utf-8');

    if (!schemaFile.endsWith('.json')) {
      return fileString;
    }

    try {
      const parsed = JSON.parse(fileString);
      const validated = openApiSchema.safeParse(parsed);
      if (!validated.success) {
        throw new Error(validated.error.message);
      }
      return validated.data;
    } catch (error) {
      throw new Error(
        `Failed to parse JSON schema from ${schemaPath}: ${error instanceof Error ? error.message : String(error)}`,
        {cause: error}
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to load schema ${schemaFile} from ${schemaPath}: ${error instanceof Error ? error.message : String(error)}`,
      {cause: error}
    );
  }
}
