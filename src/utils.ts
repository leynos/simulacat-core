/** @file Filesystem helpers for loading bundled or caller-provided schemas. */
import path from 'node:path';
import fs from 'node:fs';
import {z} from 'zod';

const schemaDefaults = ['schema.docs-enterprise.graphql', 'schema.docs.graphql', 'api.github.com.json'] as const;

/**
 * Union of the bundled schema filenames that `getSchema` accepts without a
 * filesystem path.
 */
export type SchemaFile = (typeof schemaDefaults)[number];

/**
 * Zod validator for OpenAPI/Swagger documents.
 *
 * Requires either an `openapi` or a `swagger` version field alongside `paths`.
 */
const openApiSchema = z
  .object({
    openapi: z.string().optional(),
    swagger: z.string().optional(),
    paths: z.record(z.string(), z.unknown())
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (!value.openapi && !value.swagger) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'OpenAPI documents must declare either an openapi or swagger version'
      });
    }
  });

/** TypeScript type inferred from `openApiSchema`. */
export type OpenApiSchema = z.infer<typeof openApiSchema>;

/** Resolves bundled schema names to their repository schema path. */
const resolveSchemaPath = (schemaFile: SchemaFile | string): string => {
  const root = path.join(import.meta.dirname, '..');
  const bundledSchemaNames = new Set<string>(schemaDefaults);
  return bundledSchemaNames.has(schemaFile) ? path.join(root, 'schema', schemaFile) : schemaFile;
};

/** Loads schema file text with a schema-specific error message. */
const loadSchemaFile = (schemaFile: SchemaFile | string, schemaPath: string): string => {
  try {
    return fs.readFileSync(schemaPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Failed to load schema ${schemaFile} from ${schemaPath}: ${error instanceof Error ? error.message : String(error)}`,
      {cause: error}
    );
  }
};

/** Parses and validates JSON OpenAPI schema text. */
const parseAndValidateSchema = (schemaPath: string, fileString: string): OpenApiSchema => {
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
};

/**
 * Loads a bundled schema file or an explicit schema path from disk.
 *
 * @example
 * ```ts
 * const restSchema = getSchema('api.github.com.json');
 * const gqlSchema = getSchema('/tmp/schema.docs-enterprise.graphql');
 * ```
 *
 * @param schemaFile Bundled schema filename or explicit filesystem path.
 * @returns Parsed OpenAPI schema objects for JSON files, or raw text for
 * GraphQL schema files.
 * @throws Error when the file cannot be read or a JSON schema cannot be parsed
 * and validated as OpenAPI/Swagger.
 */
export function getSchema(schemaFile: 'api.github.com.json'): OpenApiSchema;
export function getSchema(schemaFile: 'schema.docs.graphql' | 'schema.docs-enterprise.graphql'): string;
export function getSchema(schemaFile: `${string}.json`): OpenApiSchema;
export function getSchema(schemaFile: string): string;
/**
 * Loads a bundled schema file or an explicit schema path from disk.
 *
 * @param schemaFile Bundled schema filename or explicit filesystem path.
 * @returns Parsed OpenAPI schema objects for JSON files, or raw text for
 * GraphQL schema files.
 * @throws Error when the file cannot be read or a JSON schema cannot be parsed
 * and validated as OpenAPI/Swagger.
 */
export function getSchema(schemaFile: SchemaFile | string): string | OpenApiSchema {
  const schemaPath = resolveSchemaPath(schemaFile);
  const fileString = loadSchemaFile(schemaFile, schemaPath);

  if (!schemaFile.endsWith('.json')) {
    return fileString;
  }

  return parseAndValidateSchema(schemaPath, fileString);
}

/**
 * Loads a JSON OpenAPI schema for the REST handler table.
 *
 * The validated schema carries `paths` and a version field, which is the part
 * of `openapi-backend`'s `Document` this simulator actually reads. GraphQL
 * schema names are rejected here rather than being handed to the REST server.
 *
 * @param schemaFile Bundled JSON schema filename or explicit filesystem path.
 * @returns Validated OpenAPI document.
 * @throws Error when the schema is not a JSON OpenAPI document.
 */
export const getOpenApiDocument = (schemaFile: SchemaFile | string): OpenApiSchema => {
  // `getSchema` selects its JSON branch from this same suffix, so checking it
  // here keeps the REST boundary aligned with what `getSchema` would return.
  if (!schemaFile.endsWith('.json')) {
    throw new TypeError(`SIMULACAT: REST handlers require an OpenAPI JSON schema, received ${schemaFile}`);
  }

  const schemaPath = resolveSchemaPath(schemaFile);
  return parseAndValidateSchema(schemaPath, loadSchemaFile(schemaFile, schemaPath));
};
