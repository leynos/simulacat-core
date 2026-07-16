/** @file Integration tests for repository writes through shared actions. */
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'bun:test';
import {simulation, type InitialState} from '../src/index.ts';
import {
  getRepositoryWriteObservabilityMetrics,
  observeRepositoryWrite,
  resetRepositoryWriteObservabilityCounters
} from '../src/store/repository-observability.ts';
import {fetchGraphQLDescription} from './repository-description-helper.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

type RepositoryResponse = {
  description?: string;
  full_name?: string;
  homepage?: string;
  private?: boolean;
};

type ValidationErrorResponse = {
  err: Array<{
    instancePath: string;
    message: string;
  }>;
};

const fixtureState: InitialState = {
  users: [{login: 'octocat', organizations: []}],
  organizations: [{login: 'acme'}],
  repositories: [
    {owner: 'acme', name: 'awesome-repo', description: 'Original description'},
    {owner: 'octocat', name: 'personal-repo', description: 'Original user description'}
  ],
  branches: [],
  blobs: []
};

/** Fetches JSON and preserves the HTTP status for assertions. */
const fetchJson = async <T>(url: string, init?: RequestInit): Promise<{status: number; body: T}> => {
  const response = await fetch(url, init);
  return {status: response.status, body: (await response.json()) as T};
};

describe('repository writes through shared actions', () => {
  let server: SimulationServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await simulation({initialState: fixtureState}).listen(0);
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.ensureClose();
  });

  beforeEach(() => {
    resetRepositoryWriteObservabilityCounters();
  });

  it('makes one repository description write visible through REST and GraphQL reads', async () => {
    const patch = await fetchJson<RepositoryResponse>(`${baseUrl}/repos/acme/awesome-repo`, {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer local-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        description: 'Patched via shared action',
        homepage: 'https://docs.example.test',
        private: true
      })
    });
    const get = await fetchJson<RepositoryResponse>(`${baseUrl}/repos/acme/awesome-repo`);
    const list = await fetchJson<RepositoryResponse[]>(`${baseUrl}/orgs/acme/repos`);
    const graphql = await fetchGraphQLDescription(baseUrl, 'acme', 'awesome-repo');

    expect(patch.status).toBe(200);
    expect(patch.body).toEqual(
      expect.objectContaining({
        full_name: 'acme/awesome-repo',
        description: 'Patched via shared action',
        homepage: 'https://docs.example.test',
        private: false
      })
    );
    expect(get.status).toBe(200);
    expect(get.body.description).toBe('Patched via shared action');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([expect.objectContaining({description: 'Patched via shared action'})]);
    expect(graphql.errors).toBeUndefined();
    expect(graphql.data?.repository?.description).toBe('Patched via shared action');
  });

  it('round-trips a user-owned repository through PATCH, GET, and GraphQL', async () => {
    const patch = await fetchJson<RepositoryResponse>(`${baseUrl}/repos/octocat/personal-repo`, {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer local-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({description: 'Patched user repository'})
    });
    const get = await fetchJson<RepositoryResponse>(`${baseUrl}/repos/octocat/personal-repo`);
    const graphql = await fetchGraphQLDescription(baseUrl, 'octocat', 'personal-repo');

    expect(patch.status).toBe(200);
    expect(patch.body.description).toBe('Patched user repository');
    expect(get.status).toBe(200);
    expect(get.body.description).toBe('Patched user repository');
    expect(graphql.errors).toBeUndefined();
    expect(graphql.data?.repository?.description).toBe('Patched user repository');
    expect(getRepositoryWriteObservabilityMetrics()).toContain(
      'simulacat_repository_write_observations_total{operation="patch",outcome="success",reason=""} 1'
    );
  });
});

describe('repository PATCH malformed payloads', () => {
  let server: SimulationServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await simulation({initialState: fixtureState}).listen(0);
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.ensureClose();
  });

  it('keeps persisted writable fields when PATCH values are malformed', async () => {
    const before = await fetchJson<RepositoryResponse>(`${baseUrl}/repos/acme/awesome-repo`);
    const patch = await fetchJson<ValidationErrorResponse>(`${baseUrl}/repos/acme/awesome-repo`, {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer local-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({description: null, homepage: {invalid: true}})
    });
    const after = await fetchJson<RepositoryResponse>(`${baseUrl}/repos/acme/awesome-repo`);

    expect(before.status).toBe(200);
    expect(patch.status).toBe(400);
    expect(patch.body.err).toEqual(
      expect.arrayContaining([
        expect.objectContaining({instancePath: '/requestBody/description', message: 'must be string'})
      ])
    );
    expect(after.status).toBe(200);
    expect(after.body).toEqual(
      expect.objectContaining({description: before.body.description, homepage: before.body.homepage})
    );
  });
});

describe('repository write observability', () => {
  beforeEach(() => {
    resetRepositoryWriteObservabilityCounters();
  });

  it('escapes multi-segment repository observation reasons in Prometheus output', () => {
    observeRepositoryWrite({
      operation: 'patch',
      outcome: 'not-found',
      reason: 'request."path"\\line\nmore'
    });

    expect(getRepositoryWriteObservabilityMetrics()).toContain('reason="request.\\"path\\"\\\\line\\nmore"');
  });

  it('counts concurrent PATCH observations in the process-local event loop', async () => {
    await Promise.all(
      Array.from({length: 3}, async () => {
        observeRepositoryWrite({operation: 'patch', outcome: 'success'});
      })
    );

    expect(getRepositoryWriteObservabilityMetrics()).toContain(
      'simulacat_repository_write_observations_total{operation="patch",outcome="success",reason=""} 3'
    );
  });

  it('removes stale observations on reset and restarts subsequent counts at one', () => {
    observeRepositoryWrite({operation: 'patch', outcome: 'success'});
    resetRepositoryWriteObservabilityCounters();

    expect(getRepositoryWriteObservabilityMetrics()).not.toContain('operation="patch"');

    observeRepositoryWrite({operation: 'patch', outcome: 'success'});

    expect(getRepositoryWriteObservabilityMetrics()).toContain(
      'simulacat_repository_write_observations_total{operation="patch",outcome="success",reason=""} 1'
    );
  });
});
