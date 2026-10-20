/** @file Integration tests for actor context in caller extension handlers. */
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'bun:test';
import {z} from 'zod';
import {type InitialState, simulation} from '../src/index.ts';
import {requireRestUserActor} from '../src/rest/actor-context.ts';
import type {Response} from 'express';
import type {UpdateRepositoryCommand} from '../src/store/actions/repository.ts';
import {requestActorHeader, resetActorObservationCounters} from '../src/store/actors.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const loginResponseSchema = z.object({login: z.string()});
const messageResponseSchema = z.object({message: z.string()});
const viewerSchema = z.object({login: z.string()});
const viewerDataSchema = z.object({viewer: viewerSchema.optional()});
const graphQLErrorSchema = z.object({message: z.string()});
const graphQLViewerResponseSchema = z.object({
  data: viewerDataSchema.nullable().optional(),
  errors: z.array(graphQLErrorSchema).optional()
});

const fixtureState: InitialState = {
  users: [
    {login: 'dev', email: 'dev@example.test', organizations: ['lovely-org']},
    {login: 'reviewer', email: 'reviewer@example.test', organizations: ['other-org']}
  ],
  organizations: [{login: 'lovely-org'}, {login: 'other-org'}],
  repositories: [{owner: 'lovely-org', name: 'awesome-repo'}],
  branches: [{owner: 'lovely-org', repo: 'awesome-repo', name: 'main'}],
  blobs: []
};

/** A response body decoded by a schema supplied by the caller. */
interface DecodedBody<T> {
  readonly status: number;
  readonly body: T;
}

/** Extracts a JSON response body with its HTTP status. */
const fetchJson = async <T>(
  url: string,
  schema: z.ZodType<T>,
  headers: Record<string, string> = {}
): Promise<DecodedBody<T>> => {
  const response = await fetch(url, {headers});
  const payload: unknown = await response.json();
  return {status: response.status, body: schema.parse(payload)};
};

/** Runs the GraphQL viewer query against the simulator. */
const fetchViewer = async (baseUrl: string, headers: Record<string, string> = {}) => {
  const response = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify({query: '{ viewer { login } }'})
  });
  return {status: response.status, body: graphQLViewerResponseSchema.parse(await response.json())};
};

/** Resolves the request actor for a REST surface. Writes a 401 response and returns null when authentication fails. */
const resolveUserActorOrReject = (
  surface: string,
  store: Parameters<typeof requireRestUserActor>[1],
  request: Parameters<typeof requireRestUserActor>[0],
  response: Response
) => {
  const result = requireRestUserActor(request, store, surface);
  if ('failure' in result) {
    response.status(401).json({message: 'Authentication required'});
    return null;
  }
  return result.user;
};

/** Builds the simulator fixture that exposes actor-aware extension handlers. */
const createAgreementSimulation = () =>
  simulation({
    initialState: fixtureState,
    extend: {
      openapiHandlers: (simulationStore) => ({
        'users/get-by-username': (_context, request, response) => {
          const user = resolveUserActorOrReject('GET /users/{username}', simulationStore, request, response);
          if (user === null) return;
          return response.status(200).json(user);
        }
      }),
      extendRouter: (router, simulationStore) => {
        router.get('/labs/whoami', (request, response) => {
          const user = resolveUserActorOrReject('GET /labs/whoami', simulationStore, request, response);
          if (user === null) return;
          return response.status(200).json({login: user.login});
        });
      }
    }
  });

/** Fetches all actor-aware success surfaces and returns their selected logins. */
const fetchSurfaceLogins = async (baseUrl: string, headers: Record<string, string>) => {
  const builtInRest = await fetchJson(`${baseUrl}/user`, loginResponseSchema, headers);
  const extensionRest = await fetchJson(`${baseUrl}/users/ignored`, loginResponseSchema, headers);
  const extensionRouter = await fetchJson(`${baseUrl}/labs/whoami`, loginResponseSchema, headers);
  const viewer = await fetchViewer(baseUrl, headers);

  return {
    statuses: [builtInRest.status, extensionRest.status, extensionRouter.status, viewer.status],
    logins: [
      builtInRest.body.login,
      extensionRest.body.login,
      extensionRouter.body.login,
      viewer.body.data?.viewer?.login
    ]
  };
};

describe('extension handlers with actor context', () => {
  let server: SimulationServer;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createAgreementSimulation();
    server = await app.listen(0);
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.ensureClose();
  });

  beforeEach(() => {
    resetActorObservationCounters();
  });

  it('selects the same user across built-in REST, extension REST, extension router, and GraphQL', async () => {
    const result = await fetchSurfaceLogins(baseUrl, {[requestActorHeader]: 'user:reviewer'});

    expect(result.statuses).toEqual([200, 200, 200, 200]);
    expect(result.logins).toEqual(['reviewer', 'reviewer', 'reviewer', 'reviewer']);
  });

  it('changes the selected user across all actor-aware surfaces when the actor header changes', async () => {
    const result = await fetchSurfaceLogins(baseUrl, {[requestActorHeader]: 'user:dev'});

    expect(result.logins).toEqual(['dev', 'dev', 'dev', 'dev']);
  });

  it('reports authentication failures consistently when no actor header is present', async () => {
    const builtInRest = await fetchJson(`${baseUrl}/user`, messageResponseSchema);
    const extensionRest = await fetchJson(`${baseUrl}/users/ignored`, messageResponseSchema);
    const extensionRouter = await fetchJson(`${baseUrl}/labs/whoami`, messageResponseSchema);
    const viewer = await fetchViewer(baseUrl);

    expect([builtInRest.status, extensionRest.status, extensionRouter.status, viewer.status]).toEqual([
      401, 401, 401, 200
    ]);
    expect([builtInRest.body.message, extensionRest.body.message, extensionRouter.body.message]).toEqual([
      'Authentication required',
      'Authentication required',
      'Authentication required'
    ]);
    expect(viewer.body.errors?.[0]?.message).toContain('Authentication required');
  });

  it('keeps caller action extensions alongside built-in repository write actions', async () => {
    let callerUpdateRepository: unknown;
    const app = simulation({
      initialState: fixtureState,
      extend: {
        extendStore: {
          actions: ({thunks}) => ({
            noteExtensionAction: thunks.create<{message: string}>('noteExtensionAction'),
            updateRepository: (() => {
              const replacement = thunks.create<UpdateRepositoryCommand>('callerUpdateRepository');
              callerUpdateRepository = replacement;
              return replacement;
            })()
          })
        }
      }
    });
    const extensionServer = await app.listen(0);
    const extensionActionName = 'noteExtensionAction';

    try {
      expect(extensionServer.simulationStore.actions.updateRepository).toBeFunction();
      expect(extensionServer.simulationStore.actions[extensionActionName]).toBeFunction();
      expect(extensionServer.simulationStore.actions.updateRepository).not.toBe(callerUpdateRepository);
    } finally {
      await extensionServer.ensureClose();
    }
  });
});
