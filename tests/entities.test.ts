/** @file Unit tests for fixture schemas and state-table conversion helpers. */
import {beforeEach, describe, expect, it} from 'bun:test';
import {convertInitialStateToStoreState, githubBlobSchema, githubInitialStoreSchema} from '../src/store/entities.ts';
import {resetNextRepositoryId} from '../src/store/entities/repository.ts';

const minimalInitialState = (userOverrides = {}) =>
  githubInitialStoreSchema.parse({
    users: [{login: 'dev', organizations: [], ...userOverrides}],
    organizations: [{login: 'test-org'}],
    repositories: [{owner: 'test-org', name: 'test-repo'}],
    branches: [{owner: 'test-org', repo: 'test-repo', name: 'main'}],
    blobs: []
  });

describe('initialState user fields', () => {
  it('preserves all provided fields through to store state', () => {
    const parsed = minimalInitialState({
      id: 99887766,
      name: 'dev User',
      email: 'dev@example.io'
    });
    const store = convertInitialStateToStoreState(parsed)!;
    const {dev: user} = store.users;

    expect(user).toBeDefined();
    if (!user) {
      throw new Error('expected seeded user to be present');
    }
    expect(user.id).toBe(99887766);
    expect(user.login).toBe('dev');
    expect(user.name).toBe('dev User');
    expect(user.email).toBe('dev@example.io');
  });

  it('generates defaults for omitted fields', () => {
    const parsed = minimalInitialState();
    const store = convertInitialStateToStoreState(parsed)!;
    const {dev: user} = store.users;

    if (!user) {
      throw new Error('expected seeded user to be present');
    }
    expect(user.id).toBeGreaterThanOrEqual(1000);
    expect(user.email).toContain('@');
  });
});

describe('githubBlobSchema', () => {
  it('accepts path-only blobs', () => {
    const blob = githubBlobSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      path: 'README.md'
    });

    expect(blob.path).toBe('README.md');
    expect(blob.sha).toBeUndefined();
  });

  it('accepts sha-only blobs', () => {
    const blob = githubBlobSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      sha: 'abc123'
    });

    expect(blob.sha).toBe('abc123');
    expect(blob.path).toBeUndefined();
  });

  it('rejects blobs missing both path and sha', () => {
    expect(() =>
      githubBlobSchema.parse({
        owner: 'test-org',
        repo: 'test-repo'
      })
    ).toThrow('Specify the path or sha of the blob');
  });
});

describe('initialState blob fields', () => {
  it('stores path-only blobs using a stable fallback key', () => {
    const parsed = githubInitialStoreSchema.parse({
      users: [{login: 'dev', organizations: []}],
      organizations: [{login: 'test-org'}],
      repositories: [{owner: 'test-org', name: 'test-repo'}],
      branches: [{owner: 'test-org', repo: 'test-repo', name: 'main'}],
      blobs: [{owner: 'test-org', repo: 'test-repo', path: 'README.md'}]
    });
    const store = convertInitialStateToStoreState(parsed)!;

    expect(store.blobs['README.md']).toEqual(
      expect.objectContaining({
        owner: 'test-org',
        repo: 'test-repo',
        path: 'README.md',
        sha: 'README.md'
      })
    );
  });
});

describe('initialState schema transforms', () => {
  beforeEach(() => {
    resetNextRepositoryId();
  });

  it('creates installation fixtures for each seeded organization', () => {
    const parsed = minimalInitialState();

    expect(parsed.installations).toHaveLength(1);
    expect(parsed.installations[0]).toEqual(
      expect.objectContaining({
        account: 'test-org',
        target_type: 'Organization'
      })
    );
  });

  it('preserves caller-supplied installation fields', () => {
    const parsed = githubInitialStoreSchema.parse({
      users: [{login: 'dev', organizations: []}],
      installations: [
        {
          id: 4242,
          account: 'test-org',
          access_tokens_url: 'https://example.test/custom/access_tokens',
          repositories_url: 'https://example.test/custom/repositories',
          html_url: 'https://example.test/custom/html'
        }
      ],
      organizations: [{login: 'test-org'}],
      repositories: [{owner: 'test-org', name: 'test-repo'}],
      branches: [{owner: 'test-org', repo: 'test-repo', name: 'main'}],
      blobs: []
    });

    expect(parsed.installations).toEqual([
      expect.objectContaining({
        id: 4242,
        access_tokens_url: 'https://example.test/custom/access_tokens',
        repositories_url: 'https://example.test/custom/repositories',
        html_url: 'https://example.test/custom/html'
      })
    ]);
  });

  it('normalizes repository fields needed by REST and GraphQL responses', () => {
    const parsed = minimalInitialState();
    const repository = parsed.repositories[0];

    if (!repository) {
      throw new Error('expected seeded repository to be present');
    }
    expect(repository.full_name).toBe('test-org/test-repo');
    expect(repository.url).toContain('/repos/test-org/test-repo');
    expect(repository.visibility).toBe('public');
  });

  it('preserves caller-supplied repository and organization ids', () => {
    const parsed = githubInitialStoreSchema.parse({
      users: [{login: 'dev', organizations: []}],
      organizations: [{id: 4401, login: 'test-org'}],
      repositories: [{id: 3301, owner: 'test-org', name: 'test-repo'}],
      branches: [{owner: 'test-org', repo: 'test-repo', name: 'main'}],
      blobs: []
    });

    expect(parsed.organizations[0]?.id).toBe(4401);
    expect(parsed.repositories[0]?.id).toBe(3301);
  });

  it('assigns distinct generated ids to multiple seeded repositories', () => {
    const parsed = githubInitialStoreSchema.parse({
      users: [{login: 'dev', organizations: []}],
      organizations: [{login: 'test-org'}],
      repositories: [
        {owner: 'test-org', name: 'test-repo'},
        {owner: 'test-org', name: 'second-repo'}
      ],
      branches: [
        {owner: 'test-org', repo: 'test-repo', name: 'main'},
        {owner: 'test-org', repo: 'second-repo', name: 'main'}
      ],
      blobs: []
    });

    const firstRepository = parsed.repositories[0];
    const secondRepository = parsed.repositories[1];

    if (!firstRepository || !secondRepository) {
      throw new Error('expected seeded repositories to be present');
    }

    expect(firstRepository.id).not.toBe(secondRepository.id);
    expect(firstRepository.full_name).toBe('test-org/test-repo');
    expect(secondRepository.full_name).toBe('test-org/second-repo');
    expect(firstRepository.url).toContain('/repos/test-org/test-repo');
    expect(secondRepository.url).toContain('/repos/test-org/second-repo');
  });
});
