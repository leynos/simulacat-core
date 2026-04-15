/** @file Integration tests for GitHub App installation REST endpoints. */
import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {simulation} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const basePort = 3310;
const host = 'http://localhost';
const url = `${host}:${basePort}`;

describe('GET repo endpoints', () => {
  let server: SimulationServer;
  beforeAll(async () => {
    const app = simulation({
      initialState: {
        users: [],
        organizations: [{login: 'lovely-org'}],
        repositories: [{owner: 'lovely-org', name: 'awesome-repo'}],
        branches: [{name: 'main'}],
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

    it('handles non-existant org', async () => {
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

    it('handles non-existant org', async () => {
      const request = await fetch(`${url}/repos/an-org/awesome-repo/installation`);
      expect(request.status).toEqual(404);
    });

    it('handles non-existant repo', async () => {
      const request = await fetch(`${url}/repos/lovely-org/not-awesome-repo/installation`);
      expect(request.status).toEqual(404);
    });

    it('handles non-existant org and repo', async () => {
      const request = await fetch(`${url}/repos/lovely-but-not/awesome/installation`);
      expect(request.status).toEqual(404);
    });
  });
});
