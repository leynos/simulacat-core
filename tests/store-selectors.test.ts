/** @file Regression tests for targeted repository owner selectors. */
import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {simulation, type InitialState} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const initialState: InitialState = {
  users: [{id: 5, login: 'octocat', organizations: []}],
  organizations: [
    {id: 42, login: 'acme'},
    {id: 7, login: 'globex'}
  ],
  repositories: [
    // Same repository name under three distinct owners proves owner-scoped isolation.
    {id: 101, owner: 'acme', name: 'shared-name'},
    {id: 102, owner: 'globex', name: 'shared-name'},
    {id: 103, owner: 'octocat', name: 'shared-name'},
    // Owner is neither a seeded organization nor a seeded user: scalar fallback.
    {id: 104, owner: 'ghost', name: 'orphan-repo'}
  ],
  branches: [],
  blobs: []
};

type SelectorCase = {
  readonly title: string;
  readonly owner: string;
  readonly name: string;
  readonly expectedId: number;
  readonly expectedOwner:
    | {readonly kind: 'organization'; readonly login: string; readonly id: number}
    | {readonly kind: 'user'; readonly login: string; readonly id: number}
    | {readonly kind: 'scalar'; readonly login: string};
};

const selectorCases: readonly SelectorCase[] = [
  {
    title: 'shapes an organization owner and selects only that owner-scoped repository',
    owner: 'acme',
    name: 'shared-name',
    expectedId: 101,
    expectedOwner: {kind: 'organization', login: 'acme', id: 42}
  },
  {
    title: 'distinguishes a same-name repository under a second organization owner',
    owner: 'globex',
    name: 'shared-name',
    expectedId: 102,
    expectedOwner: {kind: 'organization', login: 'globex', id: 7}
  },
  {
    title: 'shapes a same-name repository under a user owner without leaking internal fields',
    owner: 'octocat',
    name: 'shared-name',
    expectedId: 103,
    expectedOwner: {kind: 'user', login: 'octocat', id: 5}
  },
  {
    title: 'preserves the scalar owner when the owner is neither an organization nor a user',
    owner: 'ghost',
    name: 'orphan-repo',
    expectedId: 104,
    expectedOwner: {kind: 'scalar', login: 'ghost'}
  }
];

const absentCases: readonly {readonly title: string; readonly owner: string; readonly name: string}[] = [
  {title: 'a missing repository under a known organization owner', owner: 'acme', name: 'missing-repository'},
  {title: 'a known repository name under an unknown owner', owner: 'nobody', name: 'shared-name'}
];

describe('targeted repository owner selector', () => {
  let server: SimulationServer;

  beforeAll(async () => {
    server = await simulation({initialState}).listen(0);
  });

  afterAll(async () => {
    await server.ensureClose();
  });

  const select = (owner: string, name: string) =>
    server.simulationStore.selectors.getRepositoryWithOwner(server.simulationStore.store.getState(), owner, name);

  for (const testCase of selectorCases) {
    it(testCase.title, () => {
      const repository = select(testCase.owner, testCase.name);

      expect(repository).toEqual(expect.objectContaining({id: testCase.expectedId}));

      const {expectedOwner} = testCase;
      if (expectedOwner.kind === 'scalar') {
        expect(repository?.owner).toBe(expectedOwner.login);
        return;
      }

      const type = expectedOwner.kind === 'organization' ? 'Organization' : 'User';
      expect(repository?.owner).toEqual(
        expect.objectContaining({id: expectedOwner.id, login: expectedOwner.login, type})
      );
      // The projected owner object never exposes internal-only user fields.
      expect(repository?.owner).not.toHaveProperty('email');
      expect(repository?.owner).not.toHaveProperty('bio');
    });
  }

  for (const absentCase of absentCases) {
    it(`returns undefined for ${absentCase.title}`, () => {
      expect(select(absentCase.owner, absentCase.name)).toBeUndefined();
    });
  }
});
