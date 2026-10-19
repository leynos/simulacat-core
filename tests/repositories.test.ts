/** @file Integration tests for repository-oriented REST endpoints. */
import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {z} from 'zod';
import {type InitialState, simulation} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const basePort = 3320;
const host = 'http://localhost';
const url = `${host}:${basePort}`;

/** A JSON scalar a REST response body can contain. */
type JsonScalar = string | number | boolean | null;

/** A decoded JSON object whose fields are validated before use. */
interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

/** Any value a JSON response body can contain. */
type JsonValue = JsonScalar | JsonObject | JsonValue[];

const jsonValueSchema: z.ZodType<JsonValue, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), jsonObjectSchema])
);

const jsonObjectSchema: z.ZodType<JsonObject, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.record(z.string(), jsonValueSchema)
);

interface ListAndGetConfig {
  listPath: string;
  getPath: string;
  listMatcher: ReturnType<typeof expect.objectContaining>;
  assertGetResponse: (response: JsonObject) => void;
}

/** A repository entity endpoint exercised through both its list and get routes. */
interface ListAndGetCase extends ListAndGetConfig {
  readonly kind: string;
}

/** Shared fixture state for repository-oriented REST endpoint tests. */
const REPOSITORY_TEST_FIXTURE: InitialState = {
  users: [],
  organizations: [{login: 'lovely-org'}, {login: 'empty-org'}, {login: 'branchless-org'}],
  repositories: [
    {owner: 'lovely-org', name: 'awesome-repo'},
    {owner: 'empty-org', name: 'other-repo'}
  ],
  branches: [
    {owner: 'lovely-org', repo: 'awesome-repo', name: 'main'},
    {owner: 'empty-org', repo: 'other-repo', name: 'release'}
  ],
  blobs: [
    {
      owner: 'lovely-org',
      repo: 'awesome-repo',
      path: 'README.md',
      sha: 'tree-sha-123',
      content: 'hello tree route'
    }
  ],
  commits: [
    {owner: 'lovely-org', repo: 'awesome-repo', sha: 'commit-a', commit: {message: 'Initial commit'}},
    {owner: 'empty-org', repo: 'other-repo', sha: 'commit-b', commit: {message: 'Other commit'}}
  ],
  refs: [
    {owner: 'lovely-org', repo: 'awesome-repo', qualifiedName: 'main', object: {sha: 'commit-a'}},
    {owner: 'empty-org', repo: 'other-repo', qualifiedName: 'main', object: {sha: 'commit-b'}}
  ],
  issues: [
    {owner: 'lovely-org', repo: 'awesome-repo', number: 1, title: 'Lovely issue'},
    {owner: 'empty-org', repo: 'other-repo', number: 1, title: 'Other issue'}
  ],
  pullRequests: [
    {
      owner: 'lovely-org',
      repo: 'awesome-repo',
      number: 2,
      title: 'Lovely pull request',
      base: {ref: 'main', sha: 'commit-a'},
      head: {ref: 'feature/entity-spine', sha: 'commit-c'}
    },
    {
      owner: 'empty-org',
      repo: 'other-repo',
      number: 2,
      title: 'Other pull request',
      base: {ref: 'main', sha: 'commit-b'},
      head: {ref: 'feature/entity-spine', sha: 'commit-d'}
    }
  ]
};

async function assertListAndGet(baseUrl: string, config: ListAndGetConfig): Promise<void> {
  const listRequest = await fetch(`${baseUrl}${config.listPath}`);
  const listResponse = z.array(z.unknown()).parse(await listRequest.json());
  const getRequest = await fetch(`${baseUrl}${config.getPath}`);
  const getResponse = jsonObjectSchema.parse(await getRequest.json());

  expect(listRequest.status).toEqual(200);
  expect(listResponse).toEqual([config.listMatcher]);
  expect(getRequest.status).toEqual(200);
  config.assertGetResponse(getResponse);
}

/**
 * Repository entity cases whose list and get routes share one fixture entity.
 *
 * Driving both entities from one table keeps the route-pair contract identical
 * for issues and pull requests, so a regression in either route cannot pass by
 * matching a duplicated test body.
 */
const LIST_AND_GET_CASES: ListAndGetCase[] = [
  {
    kind: 'issues',
    listPath: '/repos/lovely-org/awesome-repo/issues',
    getPath: '/repos/lovely-org/awesome-repo/issues/1',
    listMatcher: expect.objectContaining({title: 'Lovely issue'}),
    assertGetResponse: (response) => expect(response).toEqual(expect.objectContaining({title: 'Lovely issue'}))
  },
  {
    kind: 'pull requests',
    listPath: '/repos/lovely-org/awesome-repo/pulls',
    getPath: '/repos/lovely-org/awesome-repo/pulls/2',
    listMatcher: expect.objectContaining({title: 'Lovely pull request'}),
    assertGetResponse: (response) =>
      expect(response).toEqual(expect.objectContaining({head: expect.objectContaining({ref: 'feature/entity-spine'})}))
  }
];

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: legacy repository integration suite remains over the line gate.
describe('GET repo endpoints', () => {
  let server: SimulationServer;
  beforeAll(async () => {
    const app = simulation({initialState: REPOSITORY_TEST_FIXTURE});
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
      const request = await fetch(`${url}/orgs/branchless-org/repos`);
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response).toEqual([]);
    });

    it('handles non-existent org', async () => {
      const request = await fetch(`${url}/orgs/nope-org/repos`);
      expect(request.status).toEqual(404);
    });
  });

  describe('/repos/{org}/{repo}/branches', () => {
    it('returns only branches for the requested repository', async () => {
      const request = await fetch(`${url}/repos/lovely-org/awesome-repo/branches`);
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response).toEqual([
        {
          owner: 'lovely-org',
          repo: 'awesome-repo',
          name: 'main',
          commit: expect.any(Object),
          protected: true,
          protection_url: expect.any(String)
        }
      ]);
      expect(response).not.toEqual(expect.arrayContaining([expect.objectContaining({name: 'release'})]));
    });

    it('returns 404 for unknown repositories', async () => {
      const request = await fetch(`${url}/repos/lovely-org/missing-repo/branches`);

      expect(request.status).toEqual(404);
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
      expect(response.url).toContain('/repos/lovely-org/awesome-repo/git/trees/tree-sha-123');
    });

    it('returns an empty tree when the repository has no blobs', async () => {
      const request = await fetch(`${url}/repos/empty-org/other-repo/git/trees/tree-sha-123`);
      const response = await request.json();

      expect(request.status).toEqual(200);
      expect(response).toEqual(
        expect.objectContaining({
          sha: 'tree-sha-123',
          tree: [],
          truncated: false
        })
      );
    });

    it('returns 404 when the repository does not exist', async () => {
      const request = await fetch(`${url}/repos/lovely-org/missing-repo/git/trees/tree-sha-123`);

      expect(request.status).toEqual(404);
    });
  });

  describe('early entity REST endpoints', () => {
    it('returns repository-scoped refs and commits', async () => {
      const refRequest = await fetch(`${url}/repos/lovely-org/awesome-repo/git/ref/main`);
      const refResponse = await refRequest.json();
      const qualifiedRefRequest = await fetch(`${url}/repos/lovely-org/awesome-repo/git/ref/heads/main`);
      const qualifiedRefResponse = await qualifiedRefRequest.json();
      const commitRequest = await fetch(`${url}/repos/lovely-org/awesome-repo/git/commits/commit-a`);
      const commitResponse = await commitRequest.json();

      expect(refRequest.status).toEqual(200);
      expect(refResponse.object.sha).toBe('commit-a');
      expect(qualifiedRefRequest.status).toEqual(200);
      expect(qualifiedRefResponse.object.sha).toBe('commit-a');
      expect(commitRequest.status).toEqual(200);
      expect(commitResponse.commit.message).toBe('Initial commit');
    });

    it.each(LIST_AND_GET_CASES)('lists and gets $kind within the requested repository', async (testCase) => {
      await assertListAndGet(url, testCase);
    });

    it('does not fall through to same-name entities under another owner', async () => {
      const refRequest = await fetch(`${url}/repos/lovely-org/awesome-repo/git/ref/release`);
      const issueRequest = await fetch(`${url}/repos/lovely-org/awesome-repo/issues/99`);
      const pullRequest = await fetch(`${url}/repos/lovely-org/awesome-repo/pulls/99`);

      expect(refRequest.status).toEqual(404);
      expect(issueRequest.status).toEqual(404);
      expect(pullRequest.status).toEqual(404);
    });
  });
});
