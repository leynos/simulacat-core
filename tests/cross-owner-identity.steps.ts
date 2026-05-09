/** @file Step definitions for cross-owner repository identity features. */
import {expect} from 'bun:test';
import {z} from 'zod';
import {withState} from './cucumber.js';
import {simulation} from '../src/index.ts';
import {githubInitialStoreSchema} from '../src/store/entities.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

type RepositoryResponse = {
  full_name?: string;
  node_id?: string;
};

const repositoryResponseSchema = z.object({
  full_name: z.string().optional(),
  node_id: z.string().optional()
});
const repositoryResponsesSchema = z.array(repositoryResponseSchema);

const branchResponseSchema = z.object({
  owner: z.string().optional(),
  repo: z.string().optional()
});
const branchResponsesSchema = z.array(branchResponseSchema);

type GraphqlRepositoryResponse = {
  data?: {
    repository?: {
      id: string;
      nameWithOwner: string;
    };
  };
  errors?: unknown;
};

type ScenarioState = {
  owners: string[];
  repositoryName: string;
  branchName: string;
  blobPath: string;
  server?: SimulationServer;
  baseUrl?: string;
  response?: Response;
  json?: unknown;
  graphQlRepository?: {
    id: string;
    nameWithOwner: string;
  };
  seedError?: Error;
};

const gql = String.raw;

const {After, Given, When, Then} = withState<ScenarioState>();

/**
 * Reads a positional Cucumber step argument.
 *
 * @param args Step arguments captured from the feature text.
 * @param index Zero-based argument index to read.
 * @returns The argument string at the requested index.
 * @throws Error when the argument is missing.
 */
const requireStepArg = (args: string[], index: number): string => {
  const arg = args[index];

  if (arg === undefined) {
    throw new Error(`Missing step argument ${index}`);
  }

  return arg;
};

/**
 * Parses an owner-qualified repository name.
 *
 * @param fullName Repository name in `owner/name` format.
 * @returns Parsed owner and repository name parts.
 * @throws Error when the input is not exactly `owner/name`.
 */
const parseFullName = (fullName: string): {owner: string; name: string} => {
  const parts = fullName.split('/');

  if (parts.length !== 2) {
    throw new Error(`Expected owner/name, got "${fullName}"`);
  }

  const [owner, name] = parts;

  if (!owner || !name) {
    throw new Error(`Expected owner/name, got "${fullName}"`);
  }

  return {owner, name};
};

After(async (state) => {
  await state.server?.ensureClose();
  return state;
});

Given('a simulator seeded with organizations {string} and {string}', async (state, args) => {
  const firstOwner = requireStepArg(args, 0);
  const secondOwner = requireStepArg(args, 1);
  const owners = [firstOwner, secondOwner];
  const repositoryName = state.repositoryName ?? 'awesome-repo';
  const branchName = state.branchName ?? 'main';
  const blobPath = state.blobPath ?? 'README.md';
  const initialState = githubInitialStoreSchema.parse({
    users: [],
    organizations: owners.map((login) => ({login})),
    repositories: owners.map((owner) => ({owner, name: repositoryName})),
    branches: owners.map((owner) => ({owner, repo: repositoryName, name: branchName})),
    blobs: owners.map((owner) => ({
      owner,
      repo: repositoryName,
      path: blobPath,
      content: `${owner} readme`
    }))
  });
  const app = simulation({
    initialState
  });
  const server = await app.listen(0);

  return {
    ...state,
    owners,
    repositoryName,
    branchName,
    blobPath,
    server,
    baseUrl: `http://127.0.0.1:${server.port}`
  };
});

Given('each organization owns a repository named {string}', (state, args) => {
  return {...state, repositoryName: requireStepArg(args, 0)};
});

Given('each repository has a {string} branch', (state, args) => {
  return {...state, branchName: requireStepArg(args, 0)};
});

Given('each repository has a {string} blob', (state, args) => {
  return {...state, blobPath: requireStepArg(args, 0)};
});

When('the client GETs {string}', async (state, args) => {
  const path = requireStepArg(args, 0);
  expect(state.baseUrl).toBeDefined();
  const response = await fetch(`${state.baseUrl}${path}`);
  const json = await response.json();
  return {...state, response, json};
});

When('the client queries GraphQL for repository {string}', async (state, args) => {
  const fullName = requireStepArg(args, 0);
  expect(state.baseUrl).toBeDefined();
  const {owner, name} = parseFullName(fullName);
  const response = await fetch(`${state.baseUrl}/graphql`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer [REDACTED]',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: gql`
        query repository($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            id
            nameWithOwner
          }
        }
      `,
      variables: {owner, name}
    })
  });
  const body = (await response.json()) as GraphqlRepositoryResponse;
  expect(body.errors).toBeUndefined();
  expect(body.data?.repository).toBeDefined();
  const repository = body.data?.repository;

  if (!repository) {
    throw new Error('GraphQL repository response did not include a repository');
  }

  return {...state, response, json: body, graphQlRepository: repository};
});

When('the simulator is seeded with two repositories whose owner and name are both {string}', (state, args) => {
  const fullName = requireStepArg(args, 0);
  const {owner, name} = parseFullName(fullName);

  try {
    const parsed = githubInitialStoreSchema.parse({
      users: [],
      organizations: [{login: owner}],
      repositories: [
        {owner, name},
        {owner, name}
      ],
      branches: [],
      blobs: []
    });
    simulation({initialState: parsed});
    return state;
  } catch (error) {
    return {...state, seedError: error instanceof Error ? error : new Error(String(error))};
  }
});

Then('the response status is {int}', (state, args) => {
  expect(state.response?.status).toBe(Number(requireStepArg(args, 0)));
  return state;
});

Then('the response contains exactly one repository', (state) => {
  expect(state.json).toBeArrayOfSize(1);
  return state;
});

Then('the repository {string} is {string}', (state, args) => {
  const fieldName = requireStepArg(args, 0);
  const expected = requireStepArg(args, 1);
  const [repo] = repositoryResponsesSchema.parse(state.json);
  expect(repo?.[fieldName as keyof RepositoryResponse]).toBe(expected);
  return state;
});

Then('the response contains exactly one branch', (state) => {
  expect(branchResponsesSchema.parse(state.json)).toBeArrayOfSize(1);
  return state;
});

Then('the branch belongs to {string}', (state, args) => {
  const fullName = requireStepArg(args, 0);
  const {owner, name: repo} = parseFullName(fullName);
  const [branch] = branchResponsesSchema.parse(state.json);
  expect(branch).toEqual(expect.objectContaining({owner, repo}));
  return state;
});

Then('the result has nameWithOwner {string}', (state, args) => {
  expect(state.graphQlRepository?.nameWithOwner).toBe(requireStepArg(args, 0));
  return state;
});

Then('the result has Repository.id {string}', (state, args) => {
  const expected = requireStepArg(args, 0);
  expect(state.graphQlRepository?.id).toBeDefined();
  const decoded = Buffer.from(state.graphQlRepository?.id ?? '', 'base64').toString('utf8');
  expect(decoded).toBe(expected);
  return state;
});

Then('the seeded repositories have non-empty node_id values', async (state) => {
  expect(state.baseUrl).toBeDefined();
  const repositories = await Promise.all(
    state.owners.map(async (owner) => {
      const response = await fetch(`${state.baseUrl}/orgs/${owner}/repos`);
      const [repository] = (await response.json()) as RepositoryResponse[];
      return repository;
    })
  );

  expect(repositories.map((repo) => repo?.node_id)).toEqual([expect.any(String), expect.any(String)]);
  expect(repositories.every((repo) => repo?.node_id && repo.node_id.length > 0)).toBe(true);
  return {...state, json: repositories};
});

Then("the two repositories' node_id values decode to different strings", (state) => {
  const repositories = state.json as RepositoryResponse[];
  const decoded = repositories.map((repo) => Buffer.from(repo.node_id ?? '', 'base64').toString('utf8'));
  expect(decoded[0]).not.toBe(decoded[1]);
  return {...state, json: decoded};
});

Then('every node_id begins with {string}', (state, args) => {
  const prefix = requireStepArg(args, 0);
  const nodeIds = state.json as string[];

  for (const id of nodeIds) {
    expect(id.startsWith(prefix)).toBe(true);
  }

  return state;
});

Then('parsing the initial state throws an error', (state) => {
  expect(state.seedError).toBeInstanceOf(Error);
  return state;
});

Then('the error message includes the duplicated key', (state) => {
  expect(state.seedError?.message).toContain('acme/awesome-repo');
  return state;
});
