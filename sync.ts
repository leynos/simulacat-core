/** @file Utility script for refreshing the bundled GitHub REST schema. */
import {main, type Operation, until} from 'effection';
import fs from 'fs/promises';
import path from 'path';

/** Runs the schema synchronisation task from the command line. */
main(function* sync() {
  // Sync the REST API schema
  yield* syncSchemaRest();
});

/**
 * Downloads the canonical GitHub REST schema and writes it into `schema/`.
 *
 * @example
 * ```bash
 * bun run sync:schema:rest
 * ```
 */
function* syncSchemaRest(): Operation<void> {
  const url =
    'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json';
  console.log('[syncSchemaRest] fetching schema from', url);

  const res = yield* until(fetch(url));
  if (!res.ok) {
    throw new Error(`[syncSchemaRest] failed to fetch schema: ${res.status} ${res.statusText}`);
  }

  const schema = yield* until(res.json());

  const schemaDir = path.join(import.meta.dirname, 'schema');
  yield* until(fs.mkdir(schemaDir, {recursive: true}));

  const outPath = path.join(schemaDir, 'api.github.com.json');
  yield* until(fs.writeFile(outPath, JSON.stringify(schema, null, 2), 'utf8'));

  console.log('[syncSchemaRest] wrote schema to', outPath);
}
