/** @file Integration tests for projection diagnostics at the Yoga boundary. */
import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {z} from 'zod';
import {createHandler} from '../src/graphql/handler.ts';
import {buildRepositoryFixture} from '../src/store/builders.ts';
import type {ExtendedSimulationStore} from '../src/store/index.ts';
import type {GitHubRepository} from '../src/store/entities.ts';
import {
  getUrlObservabilityCounters,
  getUrlObservabilityMetrics,
  resetUrlObservabilityCounters
} from '../src/http/url-observability.ts';

/** Builds the exact selector surface reached by a repository URL query. */
const makeProjectionStore = (repository: GitHubRepository): ExtendedSimulationStore => {
  // SAFETY: the query below reaches only getState, getRepository and getRef.
  // Other resolver paths are never queried by this deliberately partial store.
  const store = {} as ExtendedSimulationStore;
  return Object.assign(store, {
    store: {getState: () => ({})},
    selectors: {getRepository: () => repository, getRef: () => {}}
  });
};

const graphqlErrorSchema = z.object({message: z.string()});
const errorResponseSchema = z.object({errors: z.array(graphqlErrorSchema)});

/** Executes a real Yoga repository URL query with explicit request context. */
const queryRepository = (repository: GitHubRepository) => {
  const handler = createHandler(makeProjectionStore(repository));
  return handler.fetch(
    new Request('http://graphql.example.test/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'graphql.example.test',
        'x-request-id': 'projection-request-1'
      },
      body: JSON.stringify({query: '{ repository(owner: "private-owner", name: "private-repo") { url } }'})
    })
  );
};

const originalDebug = console.debug;
let originalEnabled: string | undefined;
let lines: string[] = [];

beforeEach(() => {
  resetUrlObservabilityCounters();
  const {SIMULACAT_URL_OBSERVABILITY: enabled} = process.env;
  originalEnabled = enabled;
  lines = [];
  console.debug = (message: string) => {
    lines.push(message);
  };
  Reflect.set(process.env, 'SIMULACAT_URL_OBSERVABILITY', 'true');
});

afterEach(() => {
  console.debug = originalDebug;
  if (originalEnabled === undefined) {
    Reflect.deleteProperty(process.env, 'SIMULACAT_URL_OBSERVABILITY');
  } else {
    Reflect.set(process.env, 'SIMULACAT_URL_OBSERVABILITY', originalEnabled);
  }
});

describe('GraphQL projection transport observability', () => {
  it('records one bounded failure with request context after Yoga catches the typed error', async () => {
    const repository = buildRepositoryFixture({owner: 'private-owner', name: 'private-repo'});
    // The fixture schema cannot express null; simulate data that bypassed it.
    Object.defineProperty(repository, 'html_url', {value: null, enumerable: true});
    const response = await queryRepository(repository);
    const body = errorResponseSchema.parse(await response.json());
    expect(body.errors).toEqual([{message: 'GraphQL repository URL could not be projected'}]);
    expect(getUrlObservabilityCounters()).toEqual({
      'base-url.graphql.request-origin.none': 1,
      'graphql-projection.graphql.failure.missing-projection': 1
    });
    const projectionLine = lines.find((line) => line.includes('graphql-projection'));
    expect(JSON.parse(projectionLine ?? '{}')).toEqual({
      component: 'simulacat.url',
      event: 'graphql-projection',
      transport: 'graphql',
      outcome: 'failure',
      reason: 'missing-projection',
      entity: 'repository',
      requestId: 'projection-request-1'
    });
    const metrics = getUrlObservabilityMetrics();
    for (const identity of ['private-owner', 'private-repo', 'projection-request-1']) {
      expect(metrics).not.toContain(identity);
    }
    expect(projectionLine).not.toContain('private-owner');
    expect(projectionLine).not.toContain('private-repo');
  });

  it('leaves the projection failure counter untouched for a valid URL', async () => {
    const repository = buildRepositoryFixture({owner: 'private-owner', name: 'private-repo'});
    const response = await queryRepository(repository);

    expect(await response.json()).toEqual({
      data: {repository: {url: 'http://graphql.example.test/private-owner/private-repo'}}
    });
    expect(getUrlObservabilityCounters()).toEqual({'base-url.graphql.request-origin.none': 1});
  });
});
