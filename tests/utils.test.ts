/** @file Unit tests for schema file loading and error reporting helpers. */

import {afterEach, describe, expect, it} from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {getSchema} from '../src/utils.ts';

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (target) => {
      await fs.rm(target, {force: true});
    })
  );
});

describe('getSchema', () => {
  it('loads JSON files as parsed objects', async () => {
    const tempFile = path.join(os.tmpdir(), `simulacat-schema-${Date.now()}.json`);
    tempPaths.push(tempFile);
    await fs.writeFile(tempFile, JSON.stringify({hello: 'world'}), 'utf8');

    expect(getSchema(tempFile)).toEqual({hello: 'world'});
  });

  it('loads GraphQL schema files as strings', async () => {
    const tempFile = path.join(os.tmpdir(), `simulacat-schema-${Date.now()}.graphql`);
    tempPaths.push(tempFile);
    await fs.writeFile(tempFile, 'type Query { hello: String! }', 'utf8');

    expect(getSchema(tempFile)).toBe('type Query { hello: String! }');
  });

  it('throws when the schema path does not exist', () => {
    expect(() => getSchema('/tmp/this-file-does-not-exist.graphql')).toThrow();
  });

  it('loads bundled schema defaults by name', () => {
    const schema = getSchema('schema.docs.graphql');

    expect(typeof schema).toBe('string');
    expect(schema).toContain('type Query');
  });
});
