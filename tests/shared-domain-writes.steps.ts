/** @file Step definitions for shared repository write behaviour. */
import {expect} from 'bun:test';
import {z} from 'zod';
import {withState} from './cucumber.js';
import {fetchGraphQLDescription} from './repository-description-helper.ts';
import {simulation, type InitialState} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

type ScenarioState = {
  server?: SimulationServer;
  baseUrl?: string;
  response?: Response;
};

const repositoryDescriptionResponseSchema = z.object({description: z.string().nullable().optional()});

const {After, Given, When, Then} = withState<ScenarioState>();

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

/** Starts a simulator with one repository and a caller-selected owner shape. */
const seedWriteCapableSimulator = async (
  state: ScenarioState,
  owner: string,
  name: string,
  seed: Pick<InitialState, 'organizations' | 'users'>
): Promise<ScenarioState> => {
  const server = await simulation({
    initialState: {
      ...seed,
      repositories: [{owner, name, description: 'Original description'}],
      branches: [],
      blobs: []
    }
  }).listen(0);

  return {...state, server, baseUrl: `http://127.0.0.1:${server.port}`};
};

Given('a write-capable simulator seeded with organization {string} and repository {string}', async (state, args) => {
  const owner = requireStepArg(args, 0);
  const name = requireStepArg(args, 1);
  return seedWriteCapableSimulator(state, owner, name, {users: [], organizations: [{login: owner}]});
});

Given('a write-capable simulator seeded with user {string} and repository {string}', async (state, args) => {
  const owner = requireStepArg(args, 0);
  const name = requireStepArg(args, 1);
  return seedWriteCapableSimulator(state, owner, name, {
    users: [{login: owner, organizations: []}],
    organizations: []
  });
});

After({tags: '@shared-domain-writes'}, async (state) => {
  await state.server?.ensureClose();
  return state;
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
  const body = repositoryDescriptionResponseSchema.parse(await response.json());

  expect(response.status).toBe(200);
  expect(body.description).toBe(expectedDescription);
  return state;
});

Then('GraphQL repository {string} has description {string}', async (state, args) => {
  expect(state.baseUrl).toBeDefined();
  const {owner, name} = parseFullName(requireStepArg(args, 0));
  const expectedDescription = requireStepArg(args, 1);
  const body = await fetchGraphQLDescription(state.baseUrl ?? '', owner, name);

  expect(body.errors).toBeUndefined();
  expect(body.data?.repository?.description).toBe(expectedDescription);
  return state;
});
