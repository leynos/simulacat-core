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
    expect(getRepositoryWriteObservabilityMetrics()).toContain(
      'simulacat_repository_write_observations_total{operation="get",outcome="success",reason=""} 1'
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
});
