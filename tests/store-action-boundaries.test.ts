/** @file Regression tests for repository reducer and action decoding boundaries. */
import {describe, expect, it} from 'bun:test';
import {simulation, buildRepositoryFixture} from '../src/index.ts';
import {applyRepositoryUpdate, type UpdateRepositoryCommand} from '../src/store/actions/repository.ts';

describe('repository reducer undefined changes', () => {
  it('preserves undefined fields while applying a valid sibling', () => {
    const current = buildRepositoryFixture({
      owner: 'acme',
      name: 'widgets',
      description: 'Original',
      homepage: 'https://original.example.test'
    });
    const updated = applyRepositoryUpdate(current, {
      owner: 'acme',
      name: 'widgets',
      changes: {description: undefined, homepage: 'https://updated.example.test'}
    });

    expect(updated).toMatchObject({description: 'Original', homepage: 'https://updated.example.test'});
    expect(current).toMatchObject({description: 'Original', homepage: 'https://original.example.test'});
    expect(updated).not.toBe(current);
  });
});

describe('repository supervisor runtime payload boundary', () => {
  const malformedPayloads: unknown[] = [null, undefined];
  for (const payload of malformedPayloads) {
    it(`survives a ${payload} payload and processes the next valid write`, async () => {
      const server = await simulation({
        initialState: {
          users: [],
          organizations: [{login: 'acme'}],
          repositories: [{owner: 'acme', name: 'widgets', description: 'Original'}],
          branches: [],
          blobs: []
        }
      }).listen(0);

      try {
        const {actions, store, selectors} = server.simulationStore;
        // SAFETY: this intentionally bypasses the public action's static
        // contract to exercise decoding of malformed JavaScript payloads.
        await store.dispatch(actions.updateRepository(payload as UpdateRepositoryCommand));
        expect(selectors.getRepository(store.getState(), 'acme', 'widgets')?.description).toBe('Original');

        await store.dispatch(
          actions.updateRepository({owner: 'acme', name: 'widgets', changes: {description: 'Still running'}})
        );
        expect(selectors.getRepository(store.getState(), 'acme', 'widgets')?.description).toBe('Still running');
      } finally {
        await server.ensureClose();
      }
    });
  }
});
