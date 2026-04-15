/** @file Integration tests for authenticated-user REST endpoints. */
import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {simulation} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

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
        users: [{login: 'dev', organizations: ['lovely-org']}],
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

  it('returns only organizations with memberships for the authenticated user', async () => {
    const request = await fetch(`${authUrl}/user/memberships/orgs`, {
      headers: {
        'x-simulacat-user': 'dev'
      }
    });
    const response = await request.json();

    expect(request.status).toEqual(200);
    expect(response).toEqual([
      expect.objectContaining({
        state: 'active',
        role: 'member',
        organization: expect.objectContaining({login: 'lovely-org'}),
        organization_url: expect.stringContaining('/orgs/lovely-org'),
        user: expect.objectContaining({login: 'dev'})
      })
    ]);
  });
});
