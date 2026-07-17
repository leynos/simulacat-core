/** @file Integration tests for repository writes through shared actions. */
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'bun:test';
import {z} from 'zod';
import {simulation, type InitialState} from '../src/index.ts';
import {
  getRepositoryWriteObservabilityMetrics,
  observeRepositoryWrite,
  resetRepositoryWriteObservabilityCounters
} from '../src/store/repository-observability.ts';
import {fetchGraphQLDescription} from './repository-description-helper.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const repositoryResponseSchema = z
  .object({
    description: z.string().nullable().optional(),
    full_name: z.string().optional(),
    homepage: z.string().nullable().optional(),
    owner: z
      .union([z.object({login: z.string().optional(), type: z.string().optional()}).passthrough(), z.string()])
      .optional(),
    private: z.boolean().optional()
  })
  .passthrough();
const validationErrorResponseSchema = z.object({
  err: z.array(z.object({instancePath: z.string(), message: z.string()}))
});
const repositoryListResponseSchema = z.array(repositoryResponseSchema);

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
const fetchJson = async <T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit
): Promise<{status: number; body: T}> => {
  const response = await fetch(url, init);
  return {status: response.status, body: schema.parse(await response.json())};
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
    const patch = await fetchJson(`${baseUrl}/repos/acme/awesome-repo`, repositoryResponseSchema, {
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
    const get = await fetchJson(`${baseUrl}/repos/acme/awesome-repo`, repositoryResponseSchema);
    const list = await fetchJson(`${baseUrl}/orgs/acme/repos`, repositoryListResponseSchema);
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
    expect(patch.body.owner).toEqual(expect.objectContaining({login: 'acme', type: 'Organization'}));
    expect(get.status).toBe(200);
    expect(get.body.description).toBe('Patched via shared action');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([expect.objectContaining({description: 'Patched via shared action'})]);
    expect(graphql.errors).toBeUndefined();
    expect(graphql.data?.repository?.description).toBe('Patched via shared action');
  });

  it('round-trips a user-owned repository through PATCH, GET, and GraphQL', async () => {
    const patch = await fetchJson(`${baseUrl}/repos/octocat/personal-repo`, repositoryResponseSchema, {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer local-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({description: 'Patched user repository'})
    });
    const metricsAfterPatch = getRepositoryWriteObservabilityMetrics();
    const get = await fetchJson(`${baseUrl}/repos/octocat/personal-repo`, repositoryResponseSchema);
    const graphql = await fetchGraphQLDescription(baseUrl, 'octocat', 'personal-repo');

    expect(patch.status).toBe(200);
    expect(patch.body.description).toBe('Patched user repository');
    expect(patch.body.owner).toEqual(expect.objectContaining({login: 'octocat', type: 'User'}));
    expect(get.status).toBe(200);
    expect(get.body.description).toBe('Patched user repository');
    expect(get.body.owner).toEqual(expect.objectContaining({login: 'octocat', type: 'User'}));
    expect(graphql.errors).toBeUndefined();
    expect(graphql.data?.repository?.description).toBe('Patched user repository');
    expect(metricsAfterPatch).toContain(
      'simulacat_repository_write_observations_total{operation="patch",outcome="success",reason=""} 1'
    );
    expect(metricsAfterPatch).not.toContain('operation="get"');
    expect(getRepositoryWriteObservabilityMetrics()).toBe(metricsAfterPatch);
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

  it('rejects malformed writable fields without persisting either field', async () => {
    const invalidValues = [null, [], 42, false, {invalid: true}];

    for (const field of ['description', 'homepage'] as const) {
      for (const value of invalidValues) {
        const before = await fetchJson(`${baseUrl}/repos/acme/awesome-repo`, repositoryResponseSchema);
        const patch = await fetchJson(`${baseUrl}/repos/acme/awesome-repo`, validationErrorResponseSchema, {
          method: 'PATCH',
          headers: {
            authorization: 'Bearer local-token',
            'content-type': 'application/json'
          },
          body: JSON.stringify({[field]: value, ignored: 'unknown'})
        });
        const after = await fetchJson(`${baseUrl}/repos/acme/awesome-repo`, repositoryResponseSchema);

        expect(patch.status).toBe(400);
        expect(patch.body.err).toEqual(
          expect.arrayContaining([
            expect.objectContaining({instancePath: `/requestBody/${field}`, message: 'must be string'})
          ])
        );
        expect(after.status).toBe(200);
        expect(after.body).toEqual(
          expect.objectContaining({description: before.body.description, homepage: before.body.homepage})
        );
      }
    }
  });

  it('rejects mixed writable payloads without persisting their valid sibling', async () => {
    const invalidValues = [null, [], 42, false, {invalid: true}];
    const bodies = invalidValues.flatMap((invalidValue) => [
      {description: invalidValue, homepage: 'Accepted only by the parser'},
      {description: 'Accepted only by the parser', homepage: invalidValue}
    ]);

    for (const body of bodies) {
      const before = await fetchJson(`${baseUrl}/repos/acme/awesome-repo`, repositoryResponseSchema);
      const patch = await fetchJson(`${baseUrl}/repos/acme/awesome-repo`, validationErrorResponseSchema, {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer local-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const after = await fetchJson(`${baseUrl}/repos/acme/awesome-repo`, repositoryResponseSchema);

      expect(patch.status).toBe(400);
      expect(patch.body.err).toEqual(expect.arrayContaining([expect.objectContaining({message: 'must be string'})]));
      expect(after.body).toEqual(
        expect.objectContaining({description: before.body.description, homepage: before.body.homepage})
      );
    }
  });
});

describe('repository write observability', () => {
  beforeEach(() => {
    resetRepositoryWriteObservabilityCounters();
  });

  it('renders only finite repository write metric series', () => {
    observeRepositoryWrite({
      operation: 'patch',
      outcome: 'not-found',
      reason: 'missing-repository'
    });
    observeRepositoryWrite({operation: 'patch', outcome: 'not-found', reason: 'unshaped-repository'});
    observeRepositoryWrite({operation: 'patch', outcome: 'success'});

    expect(getRepositoryWriteObservabilityMetrics()).toBe(
      '# HELP simulacat_repository_write_observations_total Repository write observations.\n' +
        '# TYPE simulacat_repository_write_observations_total counter\n' +
        'simulacat_repository_write_observations_total{operation="patch",outcome="not-found",reason="missing-repository"} 1\n' +
        'simulacat_repository_write_observations_total{operation="patch",outcome="not-found",reason="unshaped-repository"} 1\n' +
        'simulacat_repository_write_observations_total{operation="patch",outcome="success",reason=""} 1\n'
    );
  });

  it('ignores forged observations outside the finite PATCH outcome contract', () => {
    observeRepositoryWrite({
      operation: 'patch',
      outcome: 'not-found',
      reason: 'caller-controlled' as unknown as 'missing-repository'
    });

    expect(getRepositoryWriteObservabilityMetrics()).not.toContain('caller-controlled');
    expect(getRepositoryWriteObservabilityMetrics()).not.toContain('operation="patch"');
  });

  it('counts concurrent PATCH observations in the process-local event loop', async () => {
    await Promise.all(
      Array.from(
        {length: 3},
        () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              observeRepositoryWrite({operation: 'patch', outcome: 'success'});
              resolve();
            }, 0);
          })
      )
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
