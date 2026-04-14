import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {simulation} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const basePort = 3330;
const host = 'http://localhost';
const url = `${host}:${basePort}`;

describe('GET user endpoints', () => {
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

  describe('/user/memberships/orgs', () => {
    it('validates with 200 response', async () => {
      const request = await fetch(`${url}/user/memberships/orgs`);
      const response = await request.json();
      expect(response.err).toBe(undefined);
      expect(request.status).toEqual(200);
      expect(response).toEqual([
        expect.objectContaining({
          organization: expect.objectContaining({login: 'lovely-org'})
        })
      ]);
    });
  });
});
