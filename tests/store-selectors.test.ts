/** @file Regression tests for targeted repository owner selectors. */
import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {simulation, type InitialState} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const initialState: InitialState = {
  users: [{login: 'octocat', organizations: []}],
  organizations: [{id: 42, login: 'acme'}],
  repositories: [
    {id: 101, owner: 'acme', name: 'organization-repository'},
    {id: 102, owner: 'octocat', name: 'user-repository'}
  ],
  branches: [],
  blobs: []
};

describe('targeted repository owner selector', () => {
  let server: SimulationServer;

  beforeAll(async () => {
    server = await simulation({initialState}).listen(0);
  });

  afterAll(async () => {
    await server.ensureClose();
  });

  it('shapes organization-owned repositories with a numeric repository id', () => {
    const repository = server.simulationStore.selectors.getRepositoryWithOwner(
      server.simulationStore.store.getState(),
      'acme',
      'organization-repository'
    );

    expect(repository).toEqual(
      expect.objectContaining({id: 101, owner: expect.objectContaining({id: 42, login: 'acme', type: 'Organization'})})
    );
  });

  it('preserves the scalar owner for user-owned repositories', () => {
    const repository = server.simulationStore.selectors.getRepositoryWithOwner(
      server.simulationStore.store.getState(),
      'octocat',
      'user-repository'
    );

    expect(repository).toEqual(expect.objectContaining({id: 102, owner: 'octocat'}));
  });

  it('returns undefined when the keyed repository is absent', () => {
    expect(
      server.simulationStore.selectors.getRepositoryWithOwner(
        server.simulationStore.store.getState(),
        'acme',
        'missing-repository'
      )
    ).toBeUndefined();
  });
});
