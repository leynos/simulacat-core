/** @file Unit tests for shared request actor context helpers. */
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'bun:test';
import type {Request} from 'express';
import {simulation} from '../src/index.ts';
import {requireRestUserActor} from '../src/rest/actor-context.ts';
import {
  buildActorContext,
  getActorContext,
  getActorObservabilityCounters,
  requireUserActor,
  requestActorHeader,
  resetActorObservationCounters,
  resolveActorContext
} from '../src/store/actors.ts';
import type {ExtendedSimulationStore} from '../src/store/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

/** Builds the transport-neutral header reader used by actor helper tests. */
const headers = (values: Record<string, string | undefined>) => ({
  get(name: string) {
    return values[name];
  }
});

/** Builds an Express request test double with actor context already attached. */
const requestWithActor = (actorHeader: string | undefined): Request => {
  const request = {
    get(name: string) {
      return name === requestActorHeader ? actorHeader : undefined;
    }
  } as unknown as Request;
  request.simulacatActor = buildActorContext(headers({[requestActorHeader]: actorHeader}));
  return request;
};

/** Registers tests for request actor context construction and retrieval. */
const describeActorContextBuilders = () => {
  describe('context construction', () => {
    it('builds the same actor context as the request actor parser', () => {
      expect(buildActorContext(headers({[requestActorHeader]: 'user:dev'}))).toMatchObject({
        actor: {kind: 'user', login: 'dev'},
        parseResult: {
          actor: {kind: 'user', login: 'dev'},
          outcome: 'parsed',
          source: 'preferred'
        }
      });
    });

    it('reads middleware-attached actor context from an Express request', () => {
      const request = requestWithActor('user:reviewer');

      expect(getActorContext(request)?.actor).toEqual({kind: 'user', login: 'reviewer'});
    });

    it('returns undefined when middleware has not attached actor context', () => {
      const request = {get: () => undefined} as unknown as Request;

      expect(getActorContext(request)).toBeUndefined();
    });
  });
};

/** Registers tests for resolving parsed actor contexts against store state. */
const describeActorResolution = (store: () => ExtendedSimulationStore) => {
  describe('actor resolution', () => {
    it('resolves all supported actor kinds against the simulation store', () => {
      const user = resolveActorContext(store(), buildActorContext(headers({[requestActorHeader]: 'user:dev'})));
      const app = resolveActorContext(store(), buildActorContext(headers({[requestActorHeader]: 'app:2000'})));
      const installation = resolveActorContext(
        store(),
        buildActorContext(headers({[requestActorHeader]: 'installation:2000'}))
      );
      const anonymous = resolveActorContext(store(), buildActorContext(headers({})));

      expect(user).toMatchObject({kind: 'authenticated', user: {login: 'dev'}});
      expect(app.resolvedActor.kind).toBe('app');
      expect(installation.resolvedActor.kind).toBe('installation');
      expect(anonymous.resolvedActor).toEqual({kind: 'anonymous'});
    });
  });
};

/** Registers tests for authenticated user selection from actor context. */
const describeRequiredActorSelection = (store: () => ExtendedSimulationStore) => {
  describe('required user selection', () => {
    it('selects a required user actor from a REST request', () => {
      const result = requireUserActor(
        {
          transport: 'rest',
          surface: 'GET /user',
          context: buildActorContext(headers({[requestActorHeader]: 'user:reviewer'}))
        },
        store()
      );

      expect(result).toMatchObject({
        user: expect.objectContaining({login: 'reviewer'})
      });
    });

    it('selects a required user actor from REST headers when middleware is absent', () => {
      const request = {
        get(name: string) {
          return name === requestActorHeader ? 'user:dev' : undefined;
        }
      } as unknown as Request;

      const result = requireRestUserActor(request, store(), 'GET /user');

      expect(result).toMatchObject({
        user: expect.objectContaining({login: 'dev'})
      });
      expect(getActorObservabilityCounters()).toMatchObject({
        'rest-resolution.user.resolved': 1,
        'rest-selected.user.selected': 1
      });
    });

    it('records authentication failure for unauthenticated REST requests', () => {
      const result = requireUserActor(
        {transport: 'rest', surface: 'GET /user', context: buildActorContext(headers({}))},
        store()
      );

      expect(result).toEqual({failure: 'unauthenticated', resolvedActor: {kind: 'anonymous'}});
      expect(getActorObservabilityCounters()).toMatchObject({
        'rest-authentication.anonymous.failure.GET /user': 1
      });
    });
  });
};

describe('actor context helpers', () => {
  let server: SimulationServer;
  let simulationStore: ExtendedSimulationStore;

  beforeAll(async () => {
    const app = simulation({
      initialState: {
        users: [
          {login: 'dev', email: 'dev@example.test', organizations: ['lovely-org']},
          {login: 'reviewer', email: 'reviewer@example.test', organizations: ['other-org']}
        ],
        installations: [{id: 2000, account: 'lovely-org'}],
        organizations: [{login: 'lovely-org'}, {login: 'other-org'}],
        repositories: [{owner: 'lovely-org', name: 'awesome-repo'}],
        branches: [{owner: 'lovely-org', repo: 'awesome-repo', name: 'main'}],
        blobs: []
      }
    });
    server = await app.listen(0);
    simulationStore = server.simulationStore;
  });

  afterAll(async () => {
    await server.ensureClose();
  });

  beforeEach(() => {
    resetActorObservationCounters();
  });

  describeActorContextBuilders();
  describeActorResolution(() => simulationStore);
  describeRequiredActorSelection(() => simulationStore);
});
