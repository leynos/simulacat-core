/** @file Integration tests for actor context in caller extension handlers. */
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'bun:test';
import {type InitialState, simulation} from '../src/index.ts';
import {requireRestUserActor} from '../src/rest/actor-context.ts';
import {requestActorHeader, resetActorObservationCounters} from '../src/store/actors.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

type LoginResponse = {
  login: string;
};

type GraphQLViewerResponse = {
  data?: {
    viewer?: {
      login: string;
    };
  };
  errors?: Array<{message: string}>;
};

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

/** Extracts a JSON response body with its HTTP status. */
const fetchJson = async <T>(url: string, headers: Record<string, string> = {}): Promise<{status: number; body: T}> => {
  const response = await fetch(url, {headers});
  return {status: response.status, body: (await response.json()) as T};
};

/** Runs the GraphQL viewer query against the simulator. */
const fetchViewer = async (baseUrl: string, headers: Record<string, string> = {}) => {
  const response = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify({query: '{ viewer { login } }'})
  });
  return {status: response.status, body: (await response.json()) as GraphQLViewerResponse};
};

/** Resolves the request actor for a REST surface. Writes a 401 response and returns null when authentication fails. */
const resolveUserActorOrReject = (
  surface: string,
  store: Parameters<typeof requireRestUserActor>[1],
  request: Parameters<typeof requireRestUserActor>[0],
  response: {status: (statusCode: number) => {json: (body: unknown) => unknown}}
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
  const builtInRest = await fetchJson<LoginResponse>(`${baseUrl}/user`, headers);
  const extensionRest = await fetchJson<LoginResponse>(`${baseUrl}/users/ignored`, headers);
  const extensionRouter = await fetchJson<LoginResponse>(`${baseUrl}/labs/whoami`, headers);
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
    const builtInRest = await fetchJson<{message: string}>(`${baseUrl}/user`);
    const extensionRest = await fetchJson<{message: string}>(`${baseUrl}/users/ignored`);
    const extensionRouter = await fetchJson<{message: string}>(`${baseUrl}/labs/whoami`);
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
});
