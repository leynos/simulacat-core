/** @file Integration tests for GitHub App installation REST endpoints. */
import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {simulation} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const basePort = 3310;
const host = 'http://localhost';
const url = `${host}:${basePort}`;

describe('GET installation endpoints', () => {
  let server: SimulationServer;
  beforeAll(async () => {
    const app = simulation({
      initialState: {
        users: [],
        installations: [{id: 2000, account: 'lovely-org'}],
        organizations: [{login: 'lovely-org'}],
        repositories: [{owner: 'lovely-org', name: 'awesome-repo'}],
        branches: [{owner: 'lovely-org', repo: 'awesome-repo', name: 'main'}],
        blobs: []
      }
    });
    server = await app.listen(basePort);
  });
  afterAll(async () => {
    await server.ensureClose();
  });

  describe('/installation/repositories', () => {
    it('validates with 200 response', async () => {
      const request = await fetch(`${url}/installation/repositories`);
      const response = await request.json();
      expect(response.err).toBe(undefined);
      expect(request.status).toEqual(200);
      expect(response.repositories).toEqual([expect.objectContaining({name: 'awesome-repo'})]);
    });
  });

  describe('/app/installations/{installation_id}/access_tokens', () => {
    it('scopes repositories to the requested installation', async () => {
      const request = await fetch(`${url}/app/installations/2000/access_tokens`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: '{}'
      });
      const response = await request.json();

      expect(request.status).toEqual(201);
      expect(response.repositories).toEqual([expect.objectContaining({name: 'awesome-repo'})]);
      expect(response.token).toBe('FAKE_GITHUB_TOKEN');
    });

    it('returns 404 for an unknown installation', async () => {
      const request = await fetch(`${url}/app/installations/9999999/access_tokens`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: '{}'
      });

      expect(request.status).toEqual(404);
    });
  });

  describe('/orgs/{org}/installation', () => {
    it('validates with 200 response', async () => {
      const request = await fetch(`${url}/orgs/lovely-org/installation`);
      const response = await request.json();
      expect(response.err).toBe(undefined);
      expect(request.status).toEqual(200);
      expect(response).toEqual(
        expect.objectContaining({
          account: expect.objectContaining({login: 'lovely-org'})
        })
      );
    });

    it('handles non-existent org', async () => {
      const request = await fetch(`${url}/orgs/doesnt-exist/installation`);
      expect(request.status).toEqual(404);
    });
  });

  describe('/repos/{owner}/{repo}/installation', () => {
    it('validates with 200 response', async () => {
      const request = await fetch(`${url}/repos/lovely-org/awesome-repo/installation`);
      const response = await request.json();
      expect(response.err).toBe(undefined);
      expect(request.status).toEqual(200);
      expect(response).toEqual(
        expect.objectContaining({
          account: expect.objectContaining({login: 'lovely-org'})
        })
      );
    });

    for (const path of [
      '/repos/an-org/awesome-repo/installation',
      '/repos/lovely-org/not-awesome-repo/installation',
      '/repos/lovely-but-not/awesome/installation'
    ]) {
      it(`returns 404 for ${path}`, async () => {
        const request = await fetch(`${url}${path}`);
        expect(request.status).toEqual(404);
      });
    }
  });
});
