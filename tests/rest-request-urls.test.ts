/** @file Integration tests for request-scoped REST response URLs. */
import {describe, expect, it} from 'bun:test';
import {z} from 'zod';
import {type InitialState, simulation} from '../src/index.ts';
import {requestActorHeader} from '../src/store/actors.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

interface RequestUrlCase {
  apiRoot: string;
  rootPath: string;
}

const repositoryPayloadSchema = z.object({
  url: z.string(),
  html_url: z.string(),
  commits_url: z.string(),
  contents_url: z.string(),
  git_commits_url: z.string(),
  clone_url: z.string(),
  owner: z.object({url: z.string(), html_url: z.string(), followers_url: z.string()})
});

const branchPayloadSchema = z.object({protection_url: z.string(), commit: z.object({url: z.string()})});
const refPayloadSchema = z.object({url: z.string(), object: z.object({url: z.string()})});
const issuePayloadSchema = z.object({url: z.string(), html_url: z.string(), repository_url: z.string()});
const pullRequestPayloadSchema = z.object({url: z.string(), html_url: z.string(), issue_url: z.string()});
const treePayloadSchema = z.object({url: z.string()});
const commitPayloadSchema = z.object({
  url: z.string(),
  html_url: z.string(),
  commit: z.object({tree: treePayloadSchema})
});
const membershipPayloadSchema = z.object({
  organization_url: z.string(),
  organization: z.object({url: z.string(), html_url: z.string(), repos_url: z.string()})
});
const contentPayloadSchema = z.object({url: z.string()});

const requestUrlCases: RequestUrlCase[] = [
  {apiRoot: '/', rootPath: ''},
  {apiRoot: '/api/v3', rootPath: '/api/v3'}
];

const fixture: InitialState = {
  users: [{login: 'dev', email: 'dev@example.test', organizations: ['lovely-org']}],
  organizations: [{login: 'lovely-org'}],
  repositories: [{owner: 'lovely-org', name: 'awesome-repo'}],
  branches: [{owner: 'lovely-org', repo: 'awesome-repo', name: 'main', commit: {sha: 'commit-a'}}],
  blobs: [
    {
      owner: 'lovely-org',
      repo: 'awesome-repo',
      path: 'README.md',
      sha: 'blob-a',
      content: 'hello request URLs',
      encoding: 'string'
    }
  ],
  refs: [
    {owner: 'lovely-org', repo: 'awesome-repo', qualifiedName: 'main', object: {sha: 'commit-a'}},
    {owner: 'lovely-org', repo: 'awesome-repo', qualifiedName: 'feature/request-urls', object: {sha: 'commit-a'}}
  ],
  commits: [{owner: 'lovely-org', repo: 'awesome-repo', sha: 'commit-a', commit: {message: 'Initial commit'}}],
  issues: [{owner: 'lovely-org', repo: 'awesome-repo', number: 1, title: 'Request URL issue'}],
  pullRequests: [
    {
      owner: 'lovely-org',
      repo: 'awesome-repo',
      number: 2,
      title: 'Request URL pull request',
      base: {ref: 'main', sha: 'commit-a'},
      head: {ref: 'feature/request-urls', sha: 'commit-b'}
    }
  ]
};

/** Fetches JSON from a REST URL and asserts a successful response. */
const fetchJson = async <Payload>(url: string, schema: z.ZodType<Payload>, init?: RequestInit): Promise<Payload> => {
  const response = await fetch(url, init);
  expect(response.status).toBe(200);
  return schema.parse(await response.json());
};

/** Fetches a REST list response that should contain exactly one item. */
const fetchListItem = async <Payload>(
  url: string,
  schema: z.ZodType<Payload>,
  init?: RequestInit
): Promise<Payload> => {
  const items = await fetchJson(url, z.array(schema), init);
  expect(items).toHaveLength(1);
  const [item] = items;
  if (item === undefined) {
    throw new Error(`Expected ${url} to return exactly one item`);
  }
  return item;
};

/** Runs a test callback against a random-port simulator and always closes it. */
const withServer = async (apiRoot: string, run: (origin: string) => Promise<void>): Promise<void> => {
  const app = simulation({initialState: fixture, apiUrl: apiRoot});
  const activeServer: SimulationServer = await app.listen(0);
  try {
    await run(`http://localhost:${activeServer.port}`);
  } finally {
    await activeServer.ensureClose();
  }
};

describe('request-scoped REST URLs', () => {
  it.each(requestUrlCases)('derives repository URLs from apiRoot $apiRoot', async ({apiRoot, rootPath}) => {
    await withServer(apiRoot, async (origin) => {
      const apiBaseUrl = `${origin}${rootPath}`;
      const repository = await fetchJson(`${apiBaseUrl}/repos/lovely-org/awesome-repo`, repositoryPayloadSchema);

      expect(repository.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo`);
      expect(repository.html_url).toBe(`${origin}/lovely-org/awesome-repo`);
      expect(repository.commits_url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/commits{/sha}`);
      expect(repository.contents_url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/contents/{+path}`);
      expect(repository.git_commits_url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/git/commits{/sha}`);
      expect(repository.owner.url).toBe(`${apiBaseUrl}/orgs/lovely-org`);
      expect(repository.owner.html_url).toBe(`${origin}/lovely-org`);
      expect(repository.owner.followers_url).toBe(`${apiBaseUrl}/users/lovely-org/followers`);
      expect(repository.clone_url).toBe(`${origin}/lovely-org/awesome-repo.git`);
    });
  });

  it.each(requestUrlCases)('derives navigable entity URLs from apiRoot $apiRoot', async ({apiRoot, rootPath}) => {
    await withServer(apiRoot, async (origin) => {
      const apiBaseUrl = `${origin}${rootPath}`;
      const branch = await fetchListItem(`${apiBaseUrl}/repos/lovely-org/awesome-repo/branches`, branchPayloadSchema);
      const ref = await fetchJson(`${apiBaseUrl}/repos/lovely-org/awesome-repo/git/ref/main`, refPayloadSchema);
      const issue = await fetchJson(`${apiBaseUrl}/repos/lovely-org/awesome-repo/issues/1`, issuePayloadSchema);
      const pull = await fetchJson(`${apiBaseUrl}/repos/lovely-org/awesome-repo/pulls/2`, pullRequestPayloadSchema);
      const commit = await fetchJson(
        `${apiBaseUrl}/repos/lovely-org/awesome-repo/git/commits/commit-a`,
        commitPayloadSchema
      );
      const content = await fetchJson(
        `${apiBaseUrl}/repos/lovely-org/awesome-repo/contents/README.md`,
        contentPayloadSchema
      );

      expect(branch.protection_url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/branches/main/protection`);
      expect(branch.commit.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/commits/commit-a`);
      expect(ref.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/git/refs/heads/main`);
      expect(ref.object.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/git/commits/commit-a`);
      expect(issue.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/issues/1`);
      expect(issue.html_url).toBe(`${origin}/lovely-org/awesome-repo/issues/1`);
      expect(issue.repository_url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo`);
      expect(pull.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/pulls/2`);
      expect(pull.html_url).toBe(`${origin}/lovely-org/awesome-repo/pull/2`);
      expect(pull.issue_url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/issues/2`);
      expect(commit.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/commits/commit-a`);
      expect(commit.html_url).toBe(`${origin}/lovely-org/awesome-repo/commit/commit-a`);
      expect(commit.commit.tree.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/git/trees/commit-a`);
      expect(content.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/contents/README.md`);
    });
  });

  it('derives configured API-root URLs from the slash-ref shim', async () => {
    await withServer('/api/v3', async (origin) => {
      const apiBaseUrl = `${origin}/api/v3`;
      const ref = await fetchJson(
        `${origin}/repos/lovely-org/awesome-repo/git/ref/feature/request-urls`,
        refPayloadSchema
      );

      expect(ref.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/git/refs/heads/feature/request-urls`);
      expect(ref.object.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/git/commits/commit-a`);
    });
  });

  it.each(requestUrlCases)('derives organization membership URLs from apiRoot $apiRoot', async ({
    apiRoot,
    rootPath
  }) => {
    await withServer(apiRoot, async (origin) => {
      const apiBaseUrl = `${origin}${rootPath}`;
      const membership = await fetchListItem(`${apiBaseUrl}/user/memberships/orgs`, membershipPayloadSchema, {
        headers: {[requestActorHeader]: 'user:dev'}
      });

      expect(membership.organization_url).toBe(`${apiBaseUrl}/orgs/lovely-org`);
      expect(membership.organization.url).toBe(`${apiBaseUrl}/orgs/lovely-org`);
      expect(membership.organization.html_url).toBe(`${origin}/lovely-org`);
      expect(membership.organization.repos_url).toBe(`${apiBaseUrl}/orgs/lovely-org/repos`);
    });
  });
});
