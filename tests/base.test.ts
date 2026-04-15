/** @file Integration tests for top-level router extension hooks. */
import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {simulation} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const basePort = 2999;
const host = 'http://localhost';
const url = `${host}:${basePort}`;

describe('router extension tests', () => {
  let server: SimulationServer;
  beforeAll(async () => {
    const app = simulation({
      initialState: {
        users: [],
        organizations: [{login: 'lovely-org'}],
        repositories: [{owner: 'lovely-org', name: 'awesome-repo'}],
        branches: [{owner: 'lovely-org', repo: 'awesome-repo', name: 'main'}],
        blobs: []
      },
      extend: {
        extendRouter: (router, _simulationStore) => {
          router.get('/hello-world', (_req, res) => {
            res.status(200).json({message: 'Hello from GitHub API simulator!'});
          });
        }
      }
    });
    server = await app.listen(basePort);
  });
  afterAll(async () => {
    await server.ensureClose();
  });

  it('allows extending the router', async () => {
    const res: Response = await fetch(`${url}/hello-world`);
    const body = await res.json();
    expect(res.ok).toBe(true);
    expect(body).toEqual({message: 'Hello from GitHub API simulator!'});
  });
});
