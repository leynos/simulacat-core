import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {simulation} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const basePort = 3320;
const host = 'http://localhost';
const url = `${host}:${basePort}`;

describe('GET repo endpoints', () => {
  let server: SimulationServer;
  beforeAll(async () => {
    const app = simulation({
      initialState: {
        users: [],
        organizations: [{login: 'lovely-org'}, {login: 'empty-org'}],
        repositories: [{owner: 'lovely-org', name: 'awesome-repo'}],
        branches: [{name: 'main'}],
        blobs: [
          {
            owner: 'lovely-org',
            repo: 'awesome-repo',
            path: 'README.md',
            sha: 'tree-sha-123',
            content: 'hello tree route'
          }
        ]
      }
    });
    server = await app.listen(basePort);
  });
  afterAll(async () => {
    await server.ensureClose();
  });

  describe('/orgs/{org}/repos', () => {
    it('validates with 200 response', async () => {
      const request = await fetch(`${url}/orgs/lovely-org/repos`);
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response).toEqual([expect.objectContaining({name: 'awesome-repo'})]);
    });

    it('handles org with no repos', async () => {
      const request = await fetch(`${url}/orgs/empty-org/repos`);
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response).toEqual([]);
    });

    it('handles non-existant org', async () => {
      const request = await fetch(`${url}/orgs/nope-org/repos`);
      expect(request.status).toEqual(404);
    });
  });

  describe('/repos/{org}/{repo}/branches', () => {
    it('validates with 200 response', async () => {
      const request = await fetch(`${url}/repos/lovely-org/awesome-repo/branches`);
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response).toEqual([expect.objectContaining({name: 'main'})]);
    });
  });

  describe('/repos/{owner}/{repo}/git/trees/{tree_sha}', () => {
    it('uses the tree_sha route param for successful lookups', async () => {
      const request = await fetch(`${url}/repos/lovely-org/awesome-repo/git/trees/tree-sha-123`);
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response).toEqual(
        expect.objectContaining({
          sha: 'tree-sha-123',
          tree: [
            expect.objectContaining({
              path: 'README.md',
              sha: 'tree-sha-123'
            })
          ],
          truncated: false
        })
      );
    });
  });
});
