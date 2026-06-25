/** @file Integration tests for request-scoped REST response URLs. */
import {describe, expect, it} from 'bun:test';
import {type InitialState, simulation} from '../src/index.ts';
import {requestActorHeader} from '../src/store/actors.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

interface RepositoryPayload {
  url: string;
  html_url: string;
  commits_url: string;
  contents_url: string;
  git_commits_url: string;
  clone_url: string;
  owner: {
    url: string;
    html_url: string;
    followers_url: string;
  };
}

interface BranchPayload {
  protection_url: string;
  commit: {url: string};
}

interface RefPayload {
  url: string;
  object: {url: string};
}

interface IssuePayload {
  url: string;
  html_url: string;
  repository_url: string;
}

interface PullRequestPayload {
  url: string;
  html_url: string;
  issue_url: string;
}

interface CommitPayload {
  url: string;
  html_url: string;
  commit: {tree: {url: string}};
}

interface MembershipPayload {
  organization_url: string;
  organization: {url: string; html_url: string; repos_url: string};
}

interface ContentPayload {
  url: string;
}

interface RequestUrlCase {
  apiRoot: string;
  rootPath: string;
}

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
  refs: [{owner: 'lovely-org', repo: 'awesome-repo', qualifiedName: 'main', object: {sha: 'commit-a'}}],
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
const fetchJson = async <Payload>(url: string, init?: RequestInit): Promise<Payload> => {
  const response = await fetch(url, init);
  expect(response.status).toBe(200);
  return (await response.json()) as Payload;
};

/** Fetches a REST list response that should contain exactly one item. */
const fetchListItem = async <Payload>(url: string, init?: RequestInit): Promise<Payload> => {
  const items = await fetchJson<Payload[]>(url, init);
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
      const repository = await fetchJson<RepositoryPayload>(`${apiBaseUrl}/repos/lovely-org/awesome-repo`);

      expect(repository.url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo`);
      expect(repository.html_url).toBe(`${origin}/lovely-org/awesome-repo`);
      expect(repository.commits_url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/commits{/sha}`);
      expect(repository.contents_url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/contents/{+path}`);
      expect(repository.git_commits_url).toBe(`${apiBaseUrl}/repos/lovely-org/awesome-repo/git/commits{/sha}`);
      expect(repository.owner.url).toBe(`${apiBaseUrl}/orgs/lovely-org`);
      expect(repository.owner.html_url).toBe(`${origin}/orgs/lovely-org`);
      expect(repository.owner.followers_url).toBe(`${apiBaseUrl}/users/lovely-org/followers`);
      expect(repository.clone_url).toBe('https://github.com/lovely-org/awesome-repo.git');
    });
  });

  it.each(requestUrlCases)('derives navigable entity URLs from apiRoot $apiRoot', async ({apiRoot, rootPath}) => {
    await withServer(apiRoot, async (origin) => {
      const apiBaseUrl = `${origin}${rootPath}`;
      const branch = await fetchListItem<BranchPayload>(`${apiBaseUrl}/repos/lovely-org/awesome-repo/branches`);
      const ref = await fetchJson<RefPayload>(`${apiBaseUrl}/repos/lovely-org/awesome-repo/git/ref/main`);
      const issue = await fetchJson<IssuePayload>(`${apiBaseUrl}/repos/lovely-org/awesome-repo/issues/1`);
      const pull = await fetchJson<PullRequestPayload>(`${apiBaseUrl}/repos/lovely-org/awesome-repo/pulls/2`);
      const commit = await fetchJson<CommitPayload>(`${apiBaseUrl}/repos/lovely-org/awesome-repo/git/commits/commit-a`);
      const content = await fetchJson<ContentPayload>(`${apiBaseUrl}/repos/lovely-org/awesome-repo/contents/README.md`);

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

  it.each(requestUrlCases)('derives organization membership URLs from apiRoot $apiRoot', async ({
    apiRoot,
    rootPath
  }) => {
    await withServer(apiRoot, async (origin) => {
      const apiBaseUrl = `${origin}${rootPath}`;
      const membership = await fetchListItem<MembershipPayload>(`${apiBaseUrl}/user/memberships/orgs`, {
        headers: {[requestActorHeader]: 'user:dev'}
      });

      expect(membership.organization_url).toBe(`${apiBaseUrl}/orgs/lovely-org`);
      expect(membership.organization.url).toBe(`${apiBaseUrl}/orgs/lovely-org`);
      expect(membership.organization.html_url).toBe(`${origin}/orgs/lovely-org`);
      expect(membership.organization.repos_url).toBe(`${apiBaseUrl}/orgs/lovely-org/repos`);
    });
  });
});
