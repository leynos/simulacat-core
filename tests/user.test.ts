/** @file Integration tests for authenticated-user REST endpoints. */
import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {simulation} from '../src/index.ts';
import {requestActorHeader} from '../src/store/actors.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

async function fetchMemberships(
  url: string,
  headers: Record<string, string>
): Promise<{status: number; body: unknown}> {
  const req = await fetch(`${url}/user/memberships/orgs`, {headers});
  return {status: req.status, body: await req.json()};
}

describe('GET user endpoints', () => {
  let server: SimulationServer;
  let url: string;

  beforeAll(async () => {
    const app = simulation({
      initialState: {
        users: [],
        organizations: [{login: 'lovely-org'}],
        repositories: [{owner: 'lovely-org', name: 'awesome-repo'}],
        branches: [{owner: 'lovely-org', repo: 'awesome-repo', name: 'main'}],
        blobs: []
      }
    });
    server = await app.listen(0);
    url = `http://localhost:${server.port}`;
  });
  afterAll(async () => {
    await server.ensureClose();
  });

  describe('/user/memberships/orgs', () => {
    it('returns 401 when no authenticated user is seeded', async () => {
      const request = await fetch(`${url}/user/memberships/orgs`);

      expect(request.status).toEqual(401);
    });
  });

  describe('/user', () => {
    it('returns 401 when no authenticated user is seeded', async () => {
      const request = await fetch(`${url}/user`);
      const response = await request.json();

      expect(request.status).toEqual(401);
      expect(response).toEqual({message: 'Authentication required'});
    });
  });
});

describe('GET user membership endpoints with an authenticated user', () => {
  let server: SimulationServer;
  let authUrl: string;

  beforeAll(async () => {
    const app = simulation({
      initialState: {
        users: [
          {login: 'dev', email: 'dev@example.test', organizations: ['lovely-org']},
          {login: 'reviewer', email: 'reviewer@example.test', organizations: ['other-org']}
        ],
        organizations: [{login: 'lovely-org'}, {login: 'other-org'}],
        repositories: [{owner: 'lovely-org', name: 'awesome-repo'}],
        branches: [{owner: 'lovely-org', repo: 'awesome-repo', name: 'main'}],
        blobs: []
      }
    });
    server = await app.listen(0);
    authUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.ensureClose();
  });

  it('returns the selected authenticated user from the request actor', async () => {
    const request = await fetch(`${authUrl}/user`, {
      headers: {
        [requestActorHeader]: 'user:reviewer'
      }
    });
    const response = await request.json();

    expect(request.status).toEqual(200);
    expect(response).toEqual(
      expect.objectContaining({
        login: 'reviewer',
        email: 'reviewer@example.test',
        name: 'reviewer'
      })
    );
  });

  it('returns 401 instead of falling back to the first seeded user without an actor', async () => {
    const request = await fetch(`${authUrl}/user`);
    const response = await request.json();

    expect(request.status).toEqual(401);
    expect(response).toEqual({message: 'Authentication required'});
  });

  it('returns a stable 401 body shape when no actor header is present', async () => {
    const req = await fetch(`${authUrl}/user`);
    const body = await req.json();
    expect(req.status).toBe(401);
    expect(body).toMatchSnapshot();
  });

  it('returns 401 for app and installation actors on authenticated-user routes', async () => {
    for (const actor of ['app:1', 'installation:1']) {
      const request = await fetch(`${authUrl}/user`, {
        headers: {
          [requestActorHeader]: actor
        }
      });
      const response = await request.json();

      expect(request.status).toEqual(401);
      expect(response).toEqual({message: 'Authentication required'});
    }
  });

  it('returns only organizations with memberships for the authenticated user', async () => {
    const {status, body} = await fetchMemberships(authUrl, {'x-simulacat-user': 'dev'});

    expect(status).toEqual(200);
    expect(body).toEqual([
      expect.objectContaining({
        state: 'active',
        role: 'member',
        organization: expect.objectContaining({login: 'lovely-org'}),
        organization_url: expect.stringContaining('/orgs/lovely-org'),
        user: expect.objectContaining({login: 'dev'})
      })
    ]);
  });

  it('scopes memberships to the preferred request actor header', async () => {
    const {status, body} = await fetchMemberships(authUrl, {[requestActorHeader]: 'user:reviewer'});

    expect(status).toEqual(200);
    expect(body).toEqual([
      expect.objectContaining({
        organization: expect.objectContaining({login: 'other-org'}),
        organization_url: expect.stringContaining('/orgs/other-org'),
        user: expect.objectContaining({login: 'reviewer'})
      })
    ]);
  });

  it('returns 401 for app and installation actors on membership routes', async () => {
    for (const actor of ['app:1', 'installation:1']) {
      const {status, body} = await fetchMemberships(authUrl, {[requestActorHeader]: actor});

      expect(status).toEqual(401);
      expect(body).toEqual({message: 'Authentication required'});
    }
  });
});
