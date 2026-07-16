/** @file Unit and store-level tests for shared repository write actions. */
import {describe, expect, it} from 'bun:test';
import fc from 'fast-check';
import {simulation, type InitialState, buildRepositoryFixture} from '../src/index.ts';
import {applyRepositoryUpdate, type UpdateRepositoryCommand} from '../src/store/actions/repository.ts';
import {updateRepositoryUseCase} from '../src/store/actions/repository-use-case.ts';

/** Builds a repository fixture used by reducer property tests. */
const repositoryFixture = () =>
  buildRepositoryFixture({
    owner: 'acme',
    name: 'awesome-repo',
    description: 'Original description',
    homepage: 'https://old.example.test'
  });

const initialState: InitialState = {
  users: [],
  organizations: [{login: 'acme'}, {login: 'globex'}],
  repositories: [
    {owner: 'acme', name: 'awesome-repo', description: 'Original description'},
    {owner: 'globex', name: 'awesome-repo', description: 'Other description'}
  ],
  branches: [],
  blobs: []
};

const command: UpdateRepositoryCommand = {
  owner: 'acme',
  name: 'awesome-repo',
  changes: {description: 'Updated description'}
};

const writeableString = fc.string({maxLength: 80});
const commandArbitrary = fc.record({
  owner: fc.constant('acme'),
  name: fc.constant('awesome-repo'),
  changes: fc.record(
    {
      description: fc.option(writeableString, {nil: undefined}),
      homepage: fc.option(writeableString, {nil: undefined})
    },
    {requiredKeys: []}
  )
});

describe('repository write action reducer', () => {
  it('applies whitelisted repository fields without mutating the current repository', () => {
    const current = repositoryFixture();
    const updated = applyRepositoryUpdate(current, {
      owner: current.owner,
      name: current.name,
      changes: {
        description: 'New description',
        homepage: 'https://new.example.test',
        private: 'ignored'
      } as UpdateRepositoryCommand['changes']
    });

    expect(updated).not.toBe(current);
    expect(updated.description).toBe('New description');
    expect(updated.homepage).toBe('https://new.example.test');
    expect(updated.private).toBe(current.private);
    expect(current.description).toBe('Original description');
  });

  it('leaves the repository equal-valued for an empty update', () => {
    const current = repositoryFixture();
    const updated = applyRepositoryUpdate(current, {
      owner: current.owner,
      name: current.name,
      changes: {}
    });

    expect(updated).toEqual(current);
    expect(updated).not.toBe(current);
  });

  it('is idempotent for repeated commands', () => {
    fc.assert(
      fc.property(commandArbitrary, (generatedCommand) => {
        const current = repositoryFixture();
        const once = applyRepositoryUpdate(current, generatedCommand);
        const twice = applyRepositoryUpdate(once, generatedCommand);

        expect(twice).toEqual(once);
      })
    );
  });

  it('is deterministic and keeps the input repository unchanged', () => {
    fc.assert(
      fc.property(commandArbitrary, (generatedCommand) => {
        const current = repositoryFixture();
        const snapshot = structuredClone(current);

        expect(applyRepositoryUpdate(current, generatedCommand)).toEqual(
          applyRepositoryUpdate(structuredClone(snapshot), structuredClone(generatedCommand))
        );
        expect(current).toEqual(snapshot);
      })
    );
  });

  it('preserves fields outside the repository write whitelist', () => {
    fc.assert(
      fc.property(writeableString, (policyValue) => {
        const current = repositoryFixture();
        const updated = applyRepositoryUpdate(current, {
          ...command,
          changes: {description: 'Allowed', private: policyValue} as UpdateRepositoryCommand['changes']
        });

        expect(updated.private).toBe(current.private);
        expect(updated.description).toBe('Allowed');
      })
    );
  });
});

describe('repository write action reducer runtime validation', () => {
  it('ignores runtime-invalid writable-field values without mutating the source repository', () => {
    const current = repositoryFixture();
    const snapshot = structuredClone(current);
    const updated = applyRepositoryUpdate(current, {
      owner: current.owner,
      name: current.name,
      changes: {
        description: 'Valid description',
        homepage: 'https://valid.example.test'
      }
    });

    expect(updated).toMatchObject({
      description: 'Valid description',
      homepage: 'https://valid.example.test'
    });

    for (const invalidValue of [null, 42, {}]) {
      const invalidUpdated = applyRepositoryUpdate(current, {
        owner: current.owner,
        name: current.name,
        changes: {
          description: invalidValue,
          homepage: invalidValue
        } as unknown as UpdateRepositoryCommand['changes']
      });

      expect(invalidUpdated.description).toBe(current.description);
      expect(invalidUpdated.homepage).toBe(current.homepage);
    }

    expect(current).toEqual(snapshot);
  });
});

describe('repository write action dispatch', () => {
  it('dispatches updates through the store without touching other owners', async () => {
    const server = await simulation({initialState}).listen(0);
    try {
      await server.simulationStore.store.dispatch(server.simulationStore.actions.updateRepository(command));
      const state = server.simulationStore.store.getState();

      expect(server.simulationStore.selectors.getRepository(state, 'acme', 'awesome-repo')?.description).toBe(
        'Updated description'
      );
      expect(server.simulationStore.selectors.getRepository(state, 'globex', 'awesome-repo')?.description).toBe(
        'Other description'
      );
    } finally {
      await server.ensureClose();
    }
  });

  it('preserves concurrent update changes and other repositories', async () => {
    const server = await simulation({initialState}).listen(0);
    try {
      await Promise.all([
        server.simulationStore.store.dispatch(
          server.simulationStore.actions.updateRepository({
            owner: 'acme',
            name: 'awesome-repo',
            changes: {description: 'Concurrent description'}
          })
        ),
        server.simulationStore.store.dispatch(
          server.simulationStore.actions.updateRepository({
            owner: 'acme',
            name: 'awesome-repo',
            changes: {homepage: 'https://concurrent.example.test'}
          })
        ),
        server.simulationStore.store.dispatch(
          server.simulationStore.actions.updateRepository({
            owner: 'globex',
            name: 'awesome-repo',
            changes: {description: 'Independent description'}
          })
        )
      ]);
      const state = server.simulationStore.store.getState();

      expect(server.simulationStore.selectors.getRepository(state, 'acme', 'awesome-repo')).toMatchObject({
        description: 'Concurrent description',
        homepage: 'https://concurrent.example.test'
      });
      expect(server.simulationStore.selectors.getRepository(state, 'globex', 'awesome-repo')).toMatchObject({
        description: 'Independent description'
      });
    } finally {
      await server.ensureClose();
    }
  });

  it('reports not-found updates through the shared use case', async () => {
    const server = await simulation({initialState}).listen(0);
    try {
      await expect(
        updateRepositoryUseCase(server.simulationStore, {
          owner: 'acme',
          name: 'missing',
          changes: {description: 'No repository'}
        })
      ).resolves.toEqual({ok: false, reason: 'not-found'});
    } finally {
      await server.ensureClose();
    }
  });
});

describe('repository write action direct runtime payloads', () => {
  it('ignores runtime-invalid public action payloads without touching either repository', async () => {
    const server = await simulation({initialState}).listen(0);
    try {
      const stateBefore = server.simulationStore.store.getState();
      const targetBefore = structuredClone(
        server.simulationStore.selectors.getRepository(stateBefore, 'acme', 'awesome-repo')
      );
      const unrelatedBefore = structuredClone(
        server.simulationStore.selectors.getRepository(stateBefore, 'globex', 'awesome-repo')
      );

      await Promise.all(
        [null, 42, {}].map((invalidValue) =>
          server.simulationStore.store.dispatch(
            server.simulationStore.actions.updateRepository({
              owner: 'acme',
              name: 'awesome-repo',
              changes: {
                description: invalidValue,
                homepage: invalidValue
              } as unknown as UpdateRepositoryCommand['changes']
            })
          )
        )
      );

      const stateAfter = server.simulationStore.store.getState();
      expect(server.simulationStore.selectors.getRepository(stateAfter, 'acme', 'awesome-repo')).toEqual(targetBefore);
      expect(server.simulationStore.selectors.getRepository(stateAfter, 'globex', 'awesome-repo')).toEqual(
        unrelatedBefore
      );
    } finally {
      await server.ensureClose();
    }
  });
});
