/**
 * @file Utility script for refreshing the bundled GitHub REST schema.
 *
 * This module orchestrates the Effection-based schema sync workflow, using
 * `fs/promises`, `path`, and `fetch` to download and persist the bundled REST
 * description.
 */
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
  const {SIMULACAT_SYNC_TIMEOUT_MS} = process.env;
  const timeoutMs = Number(SIMULACAT_SYNC_TIMEOUT_MS ?? '15000') || 15000;
  console.log('[syncSchemaRest] fetching schema from', url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = yield* until(fetch(url, {signal: controller.signal}));
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`[syncSchemaRest] timed out after ${timeoutMs}ms fetching schema from ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
