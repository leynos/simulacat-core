/** @file Unit tests for schema file loading and error reporting helpers. */

import {afterEach, describe, expect, it} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getSchema} from '../src/utils.ts';

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (target) => {
      await fs.rm(target, {force: true});
    })
  );
});

let schemaSequence = 0;

/** Builds a unique temporary JSON schema path for one test. */
const tempJsonSchemaPath = (): `${string}.json` => {
  schemaSequence += 1;
  return `${path.join(os.tmpdir(), `simulacat-schema-${Date.now()}-${schemaSequence}`)}.json`;
};

describe('getSchema', () => {
  it('loads JSON files as parsed objects', async () => {
    const tempFile = tempJsonSchemaPath();
    tempPaths.push(tempFile);
    await fs.writeFile(tempFile, JSON.stringify({openapi: '3.1.0', paths: {}}), 'utf8');

    expect(getSchema(tempFile)).toEqual({openapi: '3.1.0', paths: {}});
  });

  it('loads GraphQL schema files as strings', async () => {
    const tempFile = path.join(os.tmpdir(), `simulacat-schema-${Date.now()}.graphql`);
    tempPaths.push(tempFile);
    await fs.writeFile(tempFile, 'type Query { hello: String! }', 'utf8');

    expect(getSchema(tempFile)).toBe('type Query { hello: String! }');
  });

  it('throws when the schema path does not exist', () => {
    const missingSchema = path.join(os.tmpdir(), 'this-file-does-not-exist.graphql');

    expect(() => getSchema(missingSchema)).toThrow();
  });

  it('throws when a JSON schema does not match the expected OpenAPI shape', async () => {
    const tempFile = tempJsonSchemaPath();
    tempPaths.push(tempFile);
    await fs.writeFile(tempFile, JSON.stringify({hello: 'world'}), 'utf8');

    expect(() => getSchema(tempFile)).toThrow('Failed to parse JSON schema');
  });

  it('throws a parse-specific error for syntactically invalid JSON', async () => {
    const tempFile = tempJsonSchemaPath();
    tempPaths.push(tempFile);
    await fs.writeFile(tempFile, '{"openapi": "3.1.0", "paths": {', 'utf8');

    expect(() => getSchema(tempFile)).toThrow('Failed to parse JSON schema');
  });

  it('loads bundled schema defaults by name', () => {
    const schema = getSchema('schema.docs.graphql');

    expect(schema).toEqual(expect.any(String));
    expect(schema).toContain('type Query');
  });
});
