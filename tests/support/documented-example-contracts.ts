/** @file Checks observable results produced by users-guide examples. */
import assert from 'node:assert/strict';
import {z} from 'zod';

/** Captured command output paired with the label used for diagnostics. */
export interface CapturedOutput {
  readonly stdout: string;
  readonly label: string;
}

/**
 * A JSON scalar the guide examples emit.
 *
 * The contracts assert against decoded command output rather than trusting a
 * producer-supplied type, so every leaf is narrowed from this union before it
 * is compared.
 */
export type JsonScalar = string | number | boolean | null;

/** A decoded JSON object whose fields are validated on access. */
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/** Any value a JSON document can contain. */
export type JsonValue = JsonScalar | JsonObject | JsonValue[];

const jsonValueSchema: z.ZodType<JsonValue, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), jsonObjectSchema])
);

const jsonObjectSchema: z.ZodType<JsonObject, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.record(z.string(), jsonValueSchema)
);

const jsonOutputSchema = z.union([jsonValueSchema, z.null()]);

/**
 * Parses a command's final JSON line, rejecting lines that are not JSON.
 *
 * @param output Captured command output and its diagnostic label.
 * @returns Decoded JSON value for the contract under test.
 * @throws Error when output has no final line or contains invalid JSON.
 */
export const parseJsonOutput = (output: CapturedOutput): JsonValue => {
  const line = output.stdout.trim().split(/\r?\n/).at(-1);

  if (!line) {
    throw new Error(`${output.label} produced no JSON output`);
  }

  return parseJsonDocument(line, output.label);
};

/**
 * Decodes a JSON document such as an HTTP response body.
 *
 * @param text Raw JSON text.
 * @param label Diagnostic name for the document.
 * @returns Decoded JSON value for the contract under test.
 * @throws Error when the text is not valid JSON.
 */
export const parseJsonDocument = (text: string, label: string): JsonValue => {
  let decoded: JsonValue;
  try {
    decoded = parseJsonLine(text);
  } catch (error) {
    throw new Error(`${label} produced invalid JSON`, {cause: error});
  }

  return decoded;
};

/** Decodes one line of JSON, preserving the parser's error as the cause. */
const parseJsonLine = (line: string): JsonValue => {
  const decoded = jsonOutputSchema.safeParse(JSON.parse(line));
  if (!decoded.success) {
    throw new TypeError('JSON output has an unsupported shape', {cause: decoded.error});
  }
  return decoded.data;
};

/**
 * Checks that the repository node ID encodes its documented canonical value.
 *
 * @param stdout Captured ID from the documented program.
 */
export const assertRepositoryNodeId = (stdout: string): void => {
  const nodeId = stdout.trim();
  assert.equal(Buffer.from(nodeId, 'base64').toString(), 'Repository:acme/awesome-repo');
};

/**
 * Checks all six fixture builders preserve the supplied entity coordinates.
 *
 * @param value Parsed builder output.
 */
export const assertFixtureBuilders = (value: JsonValue): void => {
  const results = asObject(value, 'fixture builder results');
  assert.equal(stringAt(objectAt(results, 'repo', 'repo'), 'full_name'), 'acme/awesome-repo');
  assert.equal(stringAt(objectAt(results, 'branch', 'branch'), 'name'), 'main');
  assert.equal(stringAt(objectAt(results, 'commit', 'commit'), 'sha'), 'abc123');
  assert.equal(stringAt(objectAt(results, 'ref', 'ref'), 'qualifiedName'), 'main');
  assert.equal(numberAt(objectAt(results, 'issue', 'issue'), 'number'), 1);
  assert.equal(numberAt(objectAt(results, 'pullRequest', 'pull request'), 'number'), 2);
};

/**
 * Checks seeded collaboration entities through REST and repository GraphQL.
 *
 * @param value Parsed REST and GraphQL output.
 */
export const assertCollaborationEntities = (value: JsonValue): void => {
  const result = asObject(value, 'collaboration results');
  const rest = arrayAt(result, 'rest', 'REST results');
  assert.equal(rest.length, 4);

  for (const [index, response] of rest.entries()) {
    assert.equal(numberAt(asObject(response, `REST response ${index}`), 'status'), 200);
  }

  assert.equal(stringAt(bodyOf(rest, 0, 'ref response'), 'ref'), 'refs/heads/main');
  assert.equal(stringAt(bodyOf(rest, 1, 'commit response'), 'sha'), 'abc123');
  assert.equal(numberAt(bodyOf(rest, 2, 'issue response'), 'number'), 1);
  assert.equal(numberAt(bodyOf(rest, 3, 'pull request response'), 'number'), 2);

  const graphQl = objectAt(result, 'graphQl', 'GraphQL response');
  assert.equal(propertyAt(graphQl, 'errors'), undefined);
  const repository = objectAt(objectAt(graphQl, 'data', 'GraphQL data'), 'repository', 'GraphQL repository');
  assert.equal(stringAt(objectAt(repository, 'defaultBranchRef', 'default branch ref'), 'name'), 'main');
  assert.equal(stringAt(objectAt(repository, 'ref', 'branch ref'), 'name'), 'main');
  assert.equal(numberAt(firstNode(repository, 'issues'), 'number'), 1);
  assert.equal(numberAt(firstNode(repository, 'pullRequests'), 'number'), 2);
};

/**
 * Checks PATCH persistence through its response, REST reads, and GraphQL.
 *
 * @param value Parsed write and read output.
 */
export const assertRepositoryMetadataPatch = (value: JsonValue): void => {
  const result = asObject(value, 'repository metadata results');
  const responseRepository = objectAt(result, 'repository', 'PATCH response repository');
  const persisted = objectAt(result, 'persisted', 'persisted repository');
  const organizationRepositories = arrayAt(result, 'organizationRepositories', 'organization repositories');
  const organizationRepository = asObject(organizationRepositories[0], 'organization repository');
  const graphQl = objectAt(result, 'graphQl', 'GraphQL response');
  assert.equal(propertyAt(graphQl, 'errors'), undefined);
  const graphQlRepository = objectAt(objectAt(graphQl, 'data', 'GraphQL data'), 'repository', 'GraphQL repository');

  for (const repository of [responseRepository, persisted, organizationRepository]) {
    assert.equal(stringAt(repository, 'description'), 'Patched via shared action');
    assert.equal(stringAt(repository, 'homepage'), 'https://docs.example.test');
    assert.equal(stringAt(repository, 'visibility'), 'public');
  }

  assert.equal(organizationRepositories.length, 1);
  assert.equal(stringAt(graphQlRepository, 'description'), 'Patched via shared action');
  assert.equal(stringAt(graphQlRepository, 'visibility'), 'PUBLIC');
};

/**
 * Checks configured API-root and web URLs use distinct expected paths.
 *
 * @param value Parsed repository response.
 */
export const assertMountedApiRoot = (value: JsonValue): void => {
  const repository = asObject(value, 'mounted API repository');
  const apiUrl = stringAt(repository, 'url');
  const webUrl = stringAt(repository, 'html_url');
  assert.match(apiUrl, /\/api\/v3\/repos\/acme\/awesome-repo$/);
  assert.match(webUrl, /\/acme\/awesome-repo$/);
  assert.doesNotMatch(webUrl, /\/api\/v3\//);
};

/**
 * Checks explicit and nullable fixture URL overrides survive REST projection.
 *
 * @param value Parsed repository response.
 */
export const assertFixtureUrlOverrides = (value: JsonValue): void => {
  const repository = asObject(value, 'fixture URL repository');
  assert.equal(stringAt(repository, 'html_url'), 'https://docs.example.test/acme/awesome-repo');
  assert.equal(propertyAt(repository, 'mirror_url'), null);
};

/**
 * Checks a curl client reads both the seeded repository and request actor.
 *
 * @param stdout Captured output from both curl commands.
 */
export const assertCurlResponses = (stdout: string): void => {
  const lines = stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  const repository = asObject(
    parseJsonOutput({stdout: lines[0] ?? '', label: 'repository curl'}),
    'repository curl response'
  );
  const user = asObject(parseJsonOutput({stdout: lines[1] ?? '', label: 'user curl'}), 'user curl response');
  assert.equal(stringAt(repository, 'full_name'), 'acme/awesome-repo');
  assert.equal(stringAt(user, 'login'), 'octocat');
};

/**
 * Checks the live quick-start server returns its seeded repository.
 *
 * @param value Parsed repository response.
 */
export const assertQuickStartRepository = (value: JsonValue): void => {
  assert.equal(stringAt(asObject(value, 'quick-start repository'), 'full_name'), 'acme/awesome-repo');
};

/** Returns an object after verifying an untrusted JSON value's shape. */
const asObject = (value: JsonValue | undefined, label: string): JsonObject => {
  const decoded = jsonObjectSchema.safeParse(value);
  if (!decoded.success) {
    throw new TypeError(`${label} must be a JSON object`, {cause: decoded.error});
  }
  return decoded.data;
};

/** Returns an array after verifying an untrusted JSON value's shape. */
const asArray = (value: JsonValue | undefined, label: string): JsonValue[] => {
  const decoded = z.array(jsonValueSchema).safeParse(value);
  if (!decoded.success) {
    throw new TypeError(`${label} must be a JSON array`, {cause: decoded.error});
  }
  return decoded.data;
};

/** Reads a field that the calling contract asserts is present. */
const propertyAt = (value: JsonObject, key: string): JsonValue | undefined => value[key];

/** Reads a nested object field, naming the source value in any failure. */
const objectAt = (value: JsonObject, key: string, label: string): JsonObject => asObject(propertyAt(value, key), label);

/** Reads an array field, naming the source value in any failure. */
const arrayAt = (value: JsonObject, key: string, label: string): JsonValue[] => asArray(propertyAt(value, key), label);

/** Reads the response body at one REST position. */
const bodyOf = (responses: JsonValue[], index: number, label: string): JsonObject =>
  objectAt(asObject(responses[index], label), 'body', `${label} body`);

/** Reads a required string property from a checked JSON object. */
const stringAt = (value: JsonObject, key: string): string => {
  const decoded = z.string().safeParse(value[key]);
  if (!decoded.success) {
    throw new TypeError(`Expected ${key} to be a string`, {cause: decoded.error});
  }
  return decoded.data;
};

/** Reads a required numeric property from a checked JSON object. */
const numberAt = (value: JsonObject, key: string): number => {
  const decoded = z.number().safeParse(value[key]);
  if (!decoded.success) {
    throw new TypeError(`Expected ${key} to be a number`, {cause: decoded.error});
  }
  return decoded.data;
};

/** Returns the first node in a connection after validating its shape. */
const firstNode = (repository: JsonObject, field: string): JsonObject => {
  const connection = objectAt(repository, field, field);
  const nodes = arrayAt(connection, 'nodes', `${field} nodes`);
  const first = nodes[0];

  if (first === undefined) {
    throw new Error(`Expected at least one ${field} node`);
  }

  return asObject(first, `${field} node`);
};
