/** @file Step definitions for shared repository write behaviour. */
import {expect} from 'bun:test';
import {withState} from './cucumber.js';
import {simulation} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

type ScenarioState = {
  server?: SimulationServer;
  baseUrl?: string;
  response?: Response;
};

type GraphQLDescriptionResponse = {
  data?: {
    repository?: {
      description?: string;
    };
  };
  errors?: Array<{message: string}>;
};

const gql = String.raw;

const {Given, When, Then} = withState<ScenarioState>();

/** Reads a positional Cucumber step argument. */
const requireStepArg = (args: string[], index: number): string => {
  const value = args[index];
  if (value === undefined) throw new Error(`Missing step argument ${index}`);
  return value;
};

/** Parses an owner-qualified repository name. */
const parseFullName = (fullName: string): {owner: string; name: string} => {
  const [owner, name, extra] = fullName.split('/');
  if (!owner || !name) throw new Error(`Expected owner/name, got "${fullName}"`);
  if (extra !== undefined) throw new Error(`Expected owner/name, got "${fullName}"`);
  return {owner, name};
};

Given('a write-capable simulator seeded with organization {string} and repository {string}', async (state, args) => {
  const owner = requireStepArg(args, 0);
  const name = requireStepArg(args, 1);
  const server = await simulation({
    initialState: {
      users: [],
      organizations: [{login: owner}],
      repositories: [{owner, name, description: 'Original description'}],
      branches: [],
      blobs: []
    }
  }).listen(0);

  return {...state, server, baseUrl: `http://127.0.0.1:${server.port}`};
});

When('the client PATCHes repository {string} with description {string}', async (state, args) => {
  expect(state.baseUrl).toBeDefined();
  const {owner, name} = parseFullName(requireStepArg(args, 0));
  const description = requireStepArg(args, 1);
  const response = await fetch(`${state.baseUrl}/repos/${owner}/${name}`, {
    method: 'PATCH',
    headers: {
      authorization: 'Bearer local-token',
      'content-type': 'application/json'
    },
    body: JSON.stringify({description})
  });

  return {...state, response};
});

Then('REST repository {string} has description {string}', async (state, args) => {
  expect(state.baseUrl).toBeDefined();
  const {owner, name} = parseFullName(requireStepArg(args, 0));
  const expectedDescription = requireStepArg(args, 1);
  const response = await fetch(`${state.baseUrl}/repos/${owner}/${name}`);
  const body = (await response.json()) as {description?: string};

  expect(response.status).toBe(200);
  expect(body.description).toBe(expectedDescription);
  return state;
});

Then('GraphQL repository {string} has description {string}', async (state, args) => {
  expect(state.baseUrl).toBeDefined();
  const {owner, name} = parseFullName(requireStepArg(args, 0));
  const expectedDescription = requireStepArg(args, 1);
  const response = await fetch(`${state.baseUrl}/graphql`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      query: gql`
        query RepositoryDescription($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            description
          }
        }
      `,
      variables: {owner, name}
    })
  });
  const body = (await response.json()) as GraphQLDescriptionResponse;

  expect(body.errors).toBeUndefined();
  expect(body.data?.repository?.description).toBe(expectedDescription);
  return state;
});
