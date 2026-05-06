/** @file Step definitions for cross-owner repository identity features. */
import {expect} from 'bun:test';
import {withState} from '@aboviq/bun-test-cucumber';
import {simulation} from '../src/index.ts';
import {githubInitialStoreSchema} from '../src/store/entities.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

type RepositoryResponse = {
  full_name?: string;
  node_id?: string;
};

type BranchResponse = {
  owner?: string;
  repo?: string;
};

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
const port = 3521;

const {After, Given, When, Then} = withState<ScenarioState>();

After(async (state) => {
  await state.server?.ensureClose();
  return {...state, server: undefined};
});

Given('a simulator seeded with organizations {string} and {string}', async (state, [firstOwner, secondOwner]) => {
  const owners = [firstOwner, secondOwner];
  const repositoryName = state.repositoryName ?? 'awesome-repo';
  const branchName = state.branchName ?? 'main';
  const blobPath = state.blobPath ?? 'README.md';
  const app = simulation({
    initialState: {
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
    }
  });
  const server = await app.listen(port);

  return {
    ...state,
    owners,
    repositoryName,
    branchName,
    blobPath,
    server,
    baseUrl: `http://localhost:${port}`
  };
});

Given('each organization owns a repository named {string}', (state, [repositoryName]) => {
  return {...state, repositoryName};
});

Given('each repository has a {string} branch', (state, [branchName]) => {
  return {...state, branchName};
});

Given('each repository has a {string} blob', (state, [blobPath]) => {
  return {...state, blobPath};
});

When('the client GETs {string}', async (state, [path]) => {
  expect(state.baseUrl).toBeDefined();
  const response = await fetch(`${state.baseUrl}${path}`);
  const json = await response.json();
  return {...state, response, json};
});

When('the client queries GraphQL for repository {string}', async (state, [fullName]) => {
  expect(state.baseUrl).toBeDefined();
  const [owner, name] = fullName.split('/');
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

  return {...state, response, json: body, graphQlRepository: body.data?.repository};
});

When('the simulator is seeded with two repositories whose owner and name are both {string}', (state, [fullName]) => {
  const [owner, name] = fullName.split('/');

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
    return {...state, seedError: undefined};
  } catch (error) {
    return {...state, seedError: error instanceof Error ? error : new Error(String(error))};
  }
});

Then('the response status is {int}', (state, [status]) => {
  expect(state.response?.status).toBe(status);
  return state;
});

Then('the response contains exactly one repository', (state) => {
  expect(state.json).toBeArrayOfSize(1);
  return state;
});

Then('the repository {string} is {string}', (state, [fieldName, expected]) => {
  const [repo] = state.json as RepositoryResponse[];
  expect(repo?.[fieldName as keyof RepositoryResponse]).toBe(expected);
  return state;
});

Then('the response contains exactly one branch', (state) => {
  expect(state.json).toBeArrayOfSize(1);
  return state;
});

Then('the branch belongs to {string}', (state, [fullName]) => {
  const [owner, repo] = fullName.split('/');
  const [branch] = state.json as BranchResponse[];
  expect(branch).toEqual(expect.objectContaining({owner, repo}));
  return state;
});

Then('the result has nameWithOwner {string}', (state, [nameWithOwner]) => {
  expect(state.graphQlRepository?.nameWithOwner).toBe(nameWithOwner);
  return state;
});

Then('the result has a Repository.id distinct from {string}', (state, [otherFullName]) => {
  expect(state.graphQlRepository?.id).toBeDefined();
  expect(state.graphQlRepository?.id).not.toBe(otherFullName);
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

Then('every node_id begins with {string}', (state, [prefix]) => {
  expect(state.json).toEqual([
    expect.stringMatching(new RegExp(`^${prefix}`)),
    expect.stringMatching(new RegExp(`^${prefix}`))
  ]);
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
