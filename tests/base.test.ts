/** @file Integration tests for top-level router extension hooks. */
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'bun:test';
import {simulation} from '../src/index.ts';
import {resetUrlObservabilityCounters} from '../src/http/url-observability.ts';
import {resetActorObservationCounters} from '../src/store/actors.ts';
import {resetRepositoryWriteObservabilityCounters} from '../src/store/repository-observability.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const basePort = 2999;
const host = 'http://localhost';
const url = `${host}:${basePort}`;

const buildActorObservabilityState = () => ({
  users: [{login: 'obs-user', email: 'obs@example.test', organizations: []}],
  organizations: [],
  repositories: [],
  branches: [],
  blobs: []
});

describe('OAuth authorize route query validation', () => {
  let server: SimulationServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await simulation({initialState: buildActorObservabilityState()}).listen(0);
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.ensureClose();
  });

  it('redirects with the development code when the query values are strings', async () => {
    const response = await fetch(
      `${baseUrl}/login/oauth/authorize?redirect_uri=${encodeURIComponent('http://localhost:3000/callback')}&state=xyz`,
      {redirect: 'manual'}
    );

    expect(response.status).toBe(302);
    // `env` stays in the query string even when absent, matching the helper's
    // fixed development payload.
    expect(response.headers.get('location')).toBe('http://localhost:3000/callback?code=dev_code&env=&state=xyz');
  });

  it('rejects a repeated redirect_uri instead of coercing it into the redirect', async () => {
    const response = await fetch(
      `${baseUrl}/login/oauth/authorize?redirect_uri=${encodeURIComponent('http://localhost:3000/a')}&redirect_uri=${encodeURIComponent('http://localhost:3000/b')}`,
      {redirect: 'manual'}
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({message: 'Bad Request'});
  });

  it('rejects a missing redirect_uri', async () => {
    const response = await fetch(`${baseUrl}/login/oauth/authorize`, {redirect: 'manual'});

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({message: 'Bad Request'});
  });
});

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
  beforeEach(() => {
    resetActorObservationCounters();
    resetUrlObservabilityCounters();
    resetRepositoryWriteObservabilityCounters();
  });

  it('allows extending the router', async () => {
    const res: Response = await fetch(`${url}/hello-world`);
    const body = await res.json();
    expect(res.ok).toBe(true);
    expect(body).toEqual({message: 'Hello from GitHub API simulator!'});
  });

  it('exposes actor observability metrics', async () => {
    const res: Response = await fetch(`${url}/metrics`);
    const body = await res.text();
    expect(res.ok).toBe(true);
    expect(body).toContain('# TYPE simulacat_actor_observations_total counter');
    expect(body).toContain('# TYPE simulacat_url_derivation_observations_total counter');
    expect(body).toContain('# TYPE simulacat_repository_write_observations_total counter');
  });

  it('matches the stable Prometheus metrics snapshot', async () => {
    await fetch(`${url}/user`);

    const res: Response = await fetch(`${url}/metrics`);
    const body = await res.text();
    expect(res.ok).toBe(true);
    expect(body).toMatchSnapshot();
  });
});

describe('actor observability end-to-end', () => {
  let server: SimulationServer;
  let baseUrl: string;

  beforeAll(async () => {
    const app = simulation({
      initialState: buildActorObservabilityState()
    });
    server = await app.listen(0);
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.ensureClose();
  });

  beforeEach(() => {
    resetActorObservationCounters();
    resetUrlObservabilityCounters();
    resetRepositoryWriteObservabilityCounters();
  });

  it('populates observability counters after an actor-authenticated request', async () => {
    const userRes = await fetch(`${baseUrl}/user`, {
      headers: {'x-simulacat-actor': 'user:obs-user'}
    });
    const userBody = await userRes.json();

    expect(userRes.ok).toBe(true);
    expect(userBody).toMatchObject({login: 'obs-user'});

    const metricsRes = await fetch(`${baseUrl}/metrics`);
    const body = await metricsRes.text();

    expect(metricsRes.ok).toBe(true);
    const nonZeroCounter = body
      .split('\n')
      .filter((line) => !line.startsWith('#') && line.includes('simulacat_actor_observations_total'))
      .some((line) => {
        const parts = line.split(' ');
        return parts.length >= 2 && Number(parts.at(-1)) > 0;
      });
    expect(nonZeroCounter).toBe(true);
  });
});
