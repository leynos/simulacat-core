/** @file Checks observable results produced by users-guide examples. */
import assert from 'node:assert/strict';

type JsonObject = Record<string, unknown>;

/** Captured command output paired with the label used for diagnostics. */
export interface CapturedOutput {
  stdout: string;
  label: string;
}

/**
 * Parses a command's final JSON line as an untrusted value.
 *
 * @param output Captured command output and its diagnostic label.
 * @returns Parsed JSON value.
 * @throws Error when output has no final line or contains invalid JSON.
 */
export const parseJsonOutput = (output: CapturedOutput): unknown => {
  const line = output.stdout.trim().split(/\r?\n/).at(-1);

  if (!line) {
    throw new Error(`${output.label} produced no JSON output`);
  }

  try {
    return JSON.parse(line) as unknown;
  } catch (error) {
    throw new Error(`${output.label} produced invalid JSON`, {cause: error});
  }
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
export const assertFixtureBuilders = (value: unknown): void => {
  const results = asObject(value, 'fixture builder results');
  assert.equal(stringAt(asObject(propertyAt(results, 'repo'), 'repo'), 'full_name'), 'acme/awesome-repo');
  assert.equal(stringAt(asObject(propertyAt(results, 'branch'), 'branch'), 'name'), 'main');
  assert.equal(stringAt(asObject(propertyAt(results, 'commit'), 'commit'), 'sha'), 'abc123');
  assert.equal(stringAt(asObject(propertyAt(results, 'ref'), 'ref'), 'qualifiedName'), 'main');
  assert.equal(numberAt(asObject(propertyAt(results, 'issue'), 'issue'), 'number'), 1);
  assert.equal(numberAt(asObject(propertyAt(results, 'pullRequest'), 'pull request'), 'number'), 2);
};

/**
 * Checks seeded collaboration entities through REST and repository GraphQL.
 *
 * @param value Parsed REST and GraphQL output.
 */
export const assertCollaborationEntities = (value: unknown): void => {
  const result = asObject(value, 'collaboration results');
  const rest = asArray(propertyAt(result, 'rest'), 'REST results');
  assert.equal(rest.length, 4);

  for (const [index, response] of rest.entries()) {
    assert.equal(numberAt(asObject(response, `REST response ${index}`), 'status'), 200);
  }

  const ref = asObject(propertyAt(asObject(rest[0], 'ref response'), 'body'), 'ref body');
  const commit = asObject(propertyAt(asObject(rest[1], 'commit response'), 'body'), 'commit body');
  const issue = asObject(propertyAt(asObject(rest[2], 'issue response'), 'body'), 'issue body');
  const pullRequest = asObject(propertyAt(asObject(rest[3], 'pull request response'), 'body'), 'pull request body');
  assert.equal(stringAt(ref, 'ref'), 'refs/heads/main');
  assert.equal(stringAt(commit, 'sha'), 'abc123');
  assert.equal(numberAt(issue, 'number'), 1);
  assert.equal(numberAt(pullRequest, 'number'), 2);

  const graphQl = asObject(propertyAt(result, 'graphQl'), 'GraphQL response');
  assert.equal(propertyAt(graphQl, 'errors'), undefined);
  const data = asObject(propertyAt(graphQl, 'data'), 'GraphQL data');
  const repository = asObject(propertyAt(data, 'repository'), 'GraphQL repository');
  assert.equal(stringAt(asObject(propertyAt(repository, 'defaultBranchRef'), 'default branch ref'), 'name'), 'main');
  assert.equal(stringAt(asObject(propertyAt(repository, 'ref'), 'branch ref'), 'name'), 'main');
  assert.equal(numberAt(firstNode(repository, 'issues'), 'number'), 1);
  assert.equal(numberAt(firstNode(repository, 'pullRequests'), 'number'), 2);
};

/**
 * Checks PATCH persistence through its response, REST reads, and GraphQL.
 *
 * @param value Parsed write and read output.
 */
export const assertRepositoryMetadataPatch = (value: unknown): void => {
  const result = asObject(value, 'repository metadata results');
  const responseRepository = asObject(propertyAt(result, 'repository'), 'PATCH response repository');
  const persisted = asObject(propertyAt(result, 'persisted'), 'persisted repository');
  const organizationRepositories = asArray(propertyAt(result, 'organizationRepositories'), 'organization repositories');
  const organizationRepository = asObject(organizationRepositories[0], 'organization repository');
  const graphQl = asObject(propertyAt(result, 'graphQl'), 'GraphQL response');
  assert.equal(propertyAt(graphQl, 'errors'), undefined);
  const graphQlData = asObject(propertyAt(graphQl, 'data'), 'GraphQL data');
  const graphQlRepository = asObject(propertyAt(graphQlData, 'repository'), 'GraphQL repository');

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
export const assertMountedApiRoot = (value: unknown): void => {
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
export const assertFixtureUrlOverrides = (value: unknown): void => {
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
export const assertQuickStartRepository = (value: unknown): void => {
  assert.equal(stringAt(asObject(value, 'quick-start repository'), 'full_name'), 'acme/awesome-repo');
};

/** Returns an object after verifying an untrusted JSON value's shape. */
const asObject = (value: unknown, label: string): JsonObject => {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} must be a JSON object`);
  }

  if (Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return value as JsonObject;
};

/** Reads one JSON field without assuming its value type. */
const propertyAt = (value: JsonObject, key: string): unknown => {
  return value[key];
};

/** Returns an array after verifying an untrusted JSON value's shape. */
const asArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a JSON array`);
  }

  return value;
};

/** Reads a required string property from a checked JSON object. */
const stringAt = (value: JsonObject, key: string): string => {
  const property = value[key];

  if (typeof property !== 'string') {
    throw new Error(`Expected ${key} to be a string`);
  }

  return property;
};

/** Reads a required numeric property from a checked JSON object. */
const numberAt = (value: JsonObject, key: string): number => {
  const property = value[key];

  if (typeof property !== 'number') {
    throw new Error(`Expected ${key} to be a number`);
  }

  return property;
};

/** Returns the first node in a connection after validating its shape. */
const firstNode = (repository: JsonObject, field: string): JsonObject => {
  const connection = asObject(repository[field], field);
  const nodes = asArray(propertyAt(connection, 'nodes'), `${field} nodes`);
  const first = nodes[0];

  if (first === undefined) {
    throw new Error(`Expected at least one ${field} node`);
  }

  return asObject(first, `${field} node`);
};
