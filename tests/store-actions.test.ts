/** @file Unit and store-level tests for shared repository write actions. */
import {describe, expect, it} from 'bun:test';
import fc from 'fast-check';
import {simulation, type InitialState, buildRepositoryFixture} from '../src/index.ts';
import type {GitHubRepository} from '../src/store/entities.ts';
import {createEntityUpdateThunk, processEntityUpdateQueue} from '../src/store/actions/index.ts';
import {applyRepositoryUpdate, type UpdateRepositoryCommand} from '../src/store/actions/repository.ts';
import {updateRepositoryUseCase} from '../src/store/actions/repository-use-case.ts';
import {repositoryStoreKey} from '../src/store/keys.ts';

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

type EntityUpdateOperation = Parameters<typeof processEntityUpdateQueue>[2];
type QueueInstruction =
  ReturnType<ReturnType<EntityUpdateOperation>[typeof Symbol.iterator]> extends Iterator<infer Yield> ? Yield : never;
type QueueDrain = ReturnType<ReturnType<typeof processEntityUpdateQueue>>;

/** Pauses a manually advanced queue operation exactly once. */
const pauseOnce = function* () {
  yield undefined as unknown as QueueInstruction;
};

/** Views the operation as an iterator for deterministic queue-draining tests. */
const manuallyAdvanceQueueDrain = (operation: QueueDrain): Iterator<QueueInstruction, void> =>
  operation as unknown as Iterator<QueueInstruction, void>;

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

describe('repository write action queue', () => {
  it('drains same-key updates FIFO while another key proceeds independently', () => {
    const first = {type: 'first'};
    const second = {type: 'second'};
    const other = {type: 'other'};
    const queues = new Map([
      ['acme/awesome-repo', [first]],
      ['globex/awesome-repo', [other]]
    ]);
    const persisted: string[] = [];
    const repositoryValues = new Map([
      ['acme/awesome-repo', 'Original description'],
      ['globex/awesome-repo', 'Other description']
    ]);
    const observedBeforeSecond: string[] = [];
    const operation: Parameters<typeof processEntityUpdateQueue>[2] = function* (action) {
      if (action.type === 'first') {
        repositoryValues.set('acme/awesome-repo', 'first');
        persisted.push('first');
        yield* pauseOnce();
        return;
      }
      if (action.type === 'second') {
        observedBeforeSecond.push(repositoryValues.get('acme/awesome-repo') ?? '');
        repositoryValues.set('acme/awesome-repo', 'second');
        persisted.push('second');
        return;
      }
      repositoryValues.set('globex/awesome-repo', 'other');
      persisted.push('other');
    };

    const sameKeyDrain = manuallyAdvanceQueueDrain(processEntityUpdateQueue(queues, 'acme/awesome-repo', operation)());
    expect(sameKeyDrain.next().value).toBeUndefined();

    queues.get('acme/awesome-repo')?.push(second);
    const otherKeyDrain = manuallyAdvanceQueueDrain(
      processEntityUpdateQueue(queues, 'globex/awesome-repo', operation)()
    );
    expect(otherKeyDrain.next().done).toBe(true);

    expect(sameKeyDrain.next().done).toBe(true);
    expect(persisted).toEqual(['first', 'other', 'second']);
    expect(observedBeforeSecond).toEqual(['first']);
    expect(queues.size).toBe(0);
  });
});

describe('repository write action queue failures', () => {
  it('retains the failing and later actions after a queued operation fails', () => {
    const first = {type: 'first'};
    const second = {type: 'second'};
    const queues = new Map([['acme/awesome-repo', [first, second]]]);
    const processed: string[] = [];
    let shouldFail = true;
    const operation: Parameters<typeof processEntityUpdateQueue>[2] = function* (action) {
      if (action.type === 'first' && shouldFail) throw new Error('first write failed');
      processed.push(action.type);
      yield* [];
    };

    const failedDrain = manuallyAdvanceQueueDrain(processEntityUpdateQueue(queues, 'acme/awesome-repo', operation)());
    expect(() => failedDrain.next()).toThrow('first write failed');
    expect(queues.get('acme/awesome-repo')).toEqual([first, second]);
    expect(processed).toEqual([]);

    shouldFail = false;
    expect(
      manuallyAdvanceQueueDrain(processEntityUpdateQueue(queues, 'acme/awesome-repo', operation)()).next().done
    ).toBe(true);
    expect(processed).toEqual(['first', 'second']);
    expect(queues.size).toBe(0);
  });
});

describe('repository write action queue batches', () => {
  it('executes every queued repository write batch action once and in order', () => {
    const actions = Array.from({length: 128}, (_, index) => ({type: `Batch update ${index}`}));
    const queues = new Map([['acme/awesome-repo', actions]]);
    const processed: string[] = [];
    let description = 'Original description';
    const operation: Parameters<typeof processEntityUpdateQueue>[2] = function* (action) {
      description = action.type;
      processed.push(action.type);
      yield* [];
    };

    expect(
      manuallyAdvanceQueueDrain(processEntityUpdateQueue(queues, 'acme/awesome-repo', operation)()).next().done
    ).toBe(true);
    expect(processed).toEqual(actions.map((action) => action.type));
    expect(description).toBe('Batch update 127');
    expect(queues.size).toBe(0);
  });

  it('preserves the final repository state from a queued repository write batch', async () => {
    const server = await simulation({initialState}).listen(0);
    try {
      await Promise.all(
        Array.from({length: 128}, (_, index) =>
          server.simulationStore.store.dispatch(
            server.simulationStore.actions.updateRepository({
              owner: 'acme',
              name: 'awesome-repo',
              changes: {description: `Batch update ${index}`}
            })
          )
        )
      );
      const state = server.simulationStore.store.getState();

      expect(server.simulationStore.selectors.getRepository(state, 'acme', 'awesome-repo')?.description).toBe(
        'Batch update 127'
      );
    } finally {
      await server.ensureClose();
    }
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

describe('repository write action supervisor failure isolation', () => {
  it("keeps processing other entity keys after one key's write throws in the real store", async () => {
    const server = await simulation({
      initialState,
      extend: {
        extendStore: {
          actions: ({thunks, schema}) => ({
            failingUpdate: createEntityUpdateThunk({
              name: 'failingUpdate',
              thunks,
              update: schema.update,
              table: schema.repositories,
              keyOf: repositoryStoreKey,
              reduce: (current: GitHubRepository, command: UpdateRepositoryCommand): GitHubRepository => {
                if (command.owner === 'acme') throw new Error('forced repository write failure');
                return applyRepositoryUpdate(current, command);
              }
            })
          })
        }
      }
    }).listen(0);

    const extendedActions = server.simulationStore.actions as unknown as {
      failingUpdate: typeof server.simulationStore.actions.updateRepository;
    };
    const failingUpdate = extendedActions.failingUpdate;

    try {
      // The 'acme' write throws inside its spawned drain. The supervisor must
      // contain that failure rather than tearing down; whether the error is
      // surfaced synchronously or swallowed, it must not abort the test.
      try {
        await server.simulationStore.store.dispatch(
          failingUpdate({owner: 'acme', name: 'awesome-repo', changes: {description: 'never persisted'}})
        );
      } catch {
        // The forced failure is expected; isolation is asserted below.
      }

      // A write for a different key must still be processed afterwards. If the
      // supervisor had torn down on the 'acme' failure, this key would never
      // persist.
      await server.simulationStore.store.dispatch(
        failingUpdate({owner: 'globex', name: 'awesome-repo', changes: {description: 'globex still writes'}})
      );

      const state = server.simulationStore.store.getState();
      expect(server.simulationStore.selectors.getRepository(state, 'globex', 'awesome-repo')?.description).toBe(
        'globex still writes'
      );
      // The failing key was never mutated.
      expect(server.simulationStore.selectors.getRepository(state, 'acme', 'awesome-repo')?.description).toBe(
        'Original description'
      );
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
