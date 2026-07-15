/** @file Unit tests for request-scoped URL projectors. */
import {describe, expect, it} from 'bun:test';
import fc from 'fast-check';
import {buildBaseUrls} from '../src/http/request-url.ts';
import {
  branchUrlFields,
  commitUrlFields,
  issueUrlFields,
  organizationExternalUrlFields,
  organizationUrlFields,
  projectBranchUrls,
  projectCommitUrls,
  projectIssueUrls,
  projectOrganizationUrls,
  projectPullRequestUrls,
  projectRefUrls,
  projectRepositoryUrls,
  pullRequestUrlFields,
  refUrlFields,
  repositoryExternalUrlFields,
  repositoryUrlFields
} from '../src/urls/index.ts';
import {
  buildBranchFixture,
  buildCommitFixture,
  buildIssueFixture,
  buildPullRequestFixture,
  buildRefFixture,
  buildRepositoryFixture
} from '../src/store/builders.ts';
import {githubOrganizationSchema} from '../src/store/entities/organization.ts';

const owner = 'lovely-org';
const repo = 'awesome-repo';
const fullName = `${owner}/${repo}`;
const sha = 'abcdef1234567890';
const parentSha = '1234567890abcdef';
const treeSha = 'tree-sha';
const baseUrls = buildBaseUrls({protocol: 'https', host: 'sim.example.test:8443'}, '/api/v3');
const organizationLegacyUserUrlFields = [
  'followers_url',
  'following_url',
  'gists_url',
  'starred_url',
  'subscriptions_url',
  'organizations_url',
  'received_events_url'
] as const;

const safeHost = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z](?:[A-Za-z0-9-]{0,11}[A-Za-z0-9])?$/),
    fc.stringMatching(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,11}[A-Za-z0-9])?$/),
    fc.option(fc.integer({min: 1, max: 65_535}), {nil: undefined})
  )
  .map(([first, second, port]) => {
    const host = `${first}.${second}.test`;
    return port === undefined ? host : `${host}:${port}`;
  });

/** Returns a shallow copy with selected URL fields removed. */
const omitFields = <T extends object>(value: T, fields: readonly string[]): T => {
  const copy = {...value} as Record<string, unknown>;
  for (const field of fields) {
    delete copy[field];
  }
  return copy as T;
};

/** Builds a repository fixture with every URL-like field removed. */
const sparseRepository = () =>
  omitFields(buildRepositoryFixture({owner, name: repo}), [...repositoryUrlFields, 'homepage']);

/** Builds an issue fixture with every URL-like field removed. */
const sparseIssue = () =>
  omitFields(buildIssueFixture({owner, repo, number: 7, title: 'A seeded issue'}), issueUrlFields);

/** Builds a pull request fixture with every URL-like field removed. */
const sparsePullRequest = () =>
  omitFields(
    buildPullRequestFixture({
      owner,
      repo,
      number: 8,
      title: 'A seeded pull request',
      base: {ref: 'main', sha: parentSha},
      head: {ref: 'feature/rest-urls', sha}
    }),
    pullRequestUrlFields
  );

/** Builds an organization fixture with every URL-like field removed. */
const sparseOrganization = () =>
  omitFields(githubOrganizationSchema.parse({id: 4242, login: owner}), [
    ...organizationUrlFields,
    ...organizationLegacyUserUrlFields
  ]);

/** Builds a commit fixture with top-level and nested URL fields removed. */
const sparseCommit = () => {
  const commit = buildCommitFixture({
    owner,
    repo,
    sha,
    commit: {tree: {sha: treeSha}, parents: [{sha: parentSha}]}
  });

  return {
    ...omitFields(commit, commitUrlFields),
    commit: {
      ...commit.commit,
      tree: omitFields(commit.commit.tree, ['url']),
      parents: commit.commit.parents.map((parent) => omitFields(parent, ['url']))
    },
    parents: commit.parents.map((parent) => omitFields(parent, ['url']))
  };
};

/** Builds a Git ref fixture with top-level and nested URL fields removed. */
const sparseRef = () => {
  const ref = buildRefFixture({owner, repo, qualifiedName: 'main', object: {type: 'commit', sha}});
  return {
    ...omitFields(ref, refUrlFields),
    object: omitFields(ref.object, ['url'])
  };
};

/** Builds a branch fixture with top-level and nested URL fields removed. */
const sparseBranch = () => {
  const branch = buildBranchFixture({owner, repo, name: 'main', commit: {sha}});
  return {
    ...omitFields(branch, branchUrlFields),
    commit: omitFields(branch.commit, ['url'])
  };
};

/** Checks whether a string looks like one of the URL forms under test. */
const isUrlLikeString = (value: string): boolean => {
  if (value.includes('://')) return true;
  if (value.startsWith('git@')) return true;
  return value.startsWith('git:');
};

/** Recursively collects URL-like strings from a projected payload. */
const collectUrlStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return isUrlLikeString(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectUrlStrings);
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(collectUrlStrings);
};

/** Expands the small URI-template subset emitted by current fixture URLs. */
const expandTemplate = (url: string): string =>
  url
    .replace('{archive_format}', 'zipball')
    .replace('{base}', 'main')
    .replace('{head}', 'feature')
    .replace('{+path}', 'README.md')
    .replace('{?since,all,participating}', '?since=2024-01-01T00%3A00%3A00Z&all=true')
    .replace(
      /\{\/(?:branch|collaborator|gist_id|id|key_id|member|name|number|other_user|ref|repo|sha|user)\}/gu,
      '/value'
    );

describe('projectRepositoryUrls', () => {
  it('derives repository API, web, and external URL fields from base URLs', () => {
    expect(projectRepositoryUrls(sparseRepository(), baseUrls)).toMatchObject({
      url: `${baseUrls.apiBaseUrl}/repos/${fullName}`,
      html_url: `${baseUrls.webBaseUrl}/${fullName}`,
      archive_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/{archive_format}{/ref}`,
      assignees_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/assignees{/user}`,
      blobs_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/git/blobs{/sha}`,
      branches_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/branches{/branch}`,
      collaborators_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/collaborators{/collaborator}`,
      comments_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/comments{/number}`,
      commits_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/commits{/sha}`,
      compare_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/compare/{base}...{head}`,
      contents_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/contents/{+path}`,
      contributors_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/contributors`,
      deployments_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/deployments`,
      downloads_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/downloads`,
      events_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/events`,
      forks_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/forks`,
      git_commits_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/git/commits{/sha}`,
      git_refs_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/git/refs{/sha}`,
      git_tags_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/git/tags{/sha}`,
      hooks_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/hooks`,
      issue_comment_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/issues/comments{/number}`,
      issue_events_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/issues/events{/number}`,
      issues_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/issues{/number}`,
      keys_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/keys{/key_id}`,
      labels_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/labels{/name}`,
      languages_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/languages`,
      merges_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/merges`,
      milestones_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/milestones{/number}`,
      notifications_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/notifications{?since,all,participating}`,
      pulls_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/pulls{/number}`,
      releases_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/releases{/id}`,
      stargazers_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/stargazers`,
      statuses_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/statuses/{sha}`,
      subscribers_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/subscribers`,
      subscription_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/subscription`,
      tags_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/tags`,
      teams_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/teams`,
      trees_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/git/trees{/sha}`,
      git_url: `git://github.com/${fullName}.git`,
      ssh_url: `git@github.com:${fullName}.git`,
      clone_url: `${baseUrls.webBaseUrl}/${fullName}.git`,
      mirror_url: `${baseUrls.webBaseUrl}/${fullName}`,
      svn_url: `${baseUrls.webBaseUrl}/${fullName}`
    });
  });

  it('preserves explicit URL overrides while deriving missing sibling fields', () => {
    const repository = {
      ...sparseRepository(),
      html_url: 'https://override.example.test/repository',
      mirror_url: null
    };

    const projected = projectRepositoryUrls(repository, baseUrls);

    expect(projected.html_url).toBe('https://override.example.test/repository');
    expect(projected.mirror_url).toBeNull();
    expect(projected.url).toBe(`${baseUrls.apiBaseUrl}/repos/${fullName}`);
  });

  it('emits null for missing repository homepage metadata', () => {
    const repository = omitFields(buildRepositoryFixture({owner, name: repo}), [...repositoryUrlFields, 'homepage']);

    expect(projectRepositoryUrls(repository, baseUrls).homepage).toBeNull();
  });
});

describe('non-repository URL projectors', () => {
  it('derives issue, pull request, organization, commit, ref, and branch URLs', () => {
    expect(projectIssueUrls(sparseIssue(), baseUrls)).toMatchObject({
      url: `${baseUrls.apiBaseUrl}/repos/${fullName}/issues/7`,
      html_url: `${baseUrls.webBaseUrl}/${fullName}/issues/7`,
      repository_url: `${baseUrls.apiBaseUrl}/repos/${fullName}`
    });
    expect(projectPullRequestUrls(sparsePullRequest(), baseUrls)).toMatchObject({
      url: `${baseUrls.apiBaseUrl}/repos/${fullName}/pulls/8`,
      html_url: `${baseUrls.webBaseUrl}/${fullName}/pull/8`,
      issue_url: `${baseUrls.apiBaseUrl}/repos/${fullName}/issues/8`
    });
    expect(projectOrganizationUrls(sparseOrganization(), baseUrls)).toMatchObject({
      url: `${baseUrls.apiBaseUrl}/orgs/${owner}`,
      html_url: `${baseUrls.webBaseUrl}/${owner}`,
      members_url: `${baseUrls.apiBaseUrl}/orgs/${owner}/members{/member}`,
      avatar_url: 'https://avatars.githubusercontent.com/u/4242?v=4'
    });
    expect(projectOrganizationUrls(sparseOrganization(), baseUrls).followers_url).toBeUndefined();

    const commit = projectCommitUrls(sparseCommit(), baseUrls);
    expect(commit.url).toBe(`${baseUrls.apiBaseUrl}/repos/${fullName}/commits/${sha}`);
    expect(commit.html_url).toBe(`${baseUrls.webBaseUrl}/${fullName}/commit/${sha}`);
    expect(commit.commit.tree.url).toBe(`${baseUrls.apiBaseUrl}/repos/${fullName}/git/trees/${treeSha}`);
    expect(commit.parents[0]?.url).toBe(`${baseUrls.apiBaseUrl}/repos/${fullName}/commits/${parentSha}`);
    expect(commit.commit.parents[0]?.url).toBe(`${baseUrls.apiBaseUrl}/repos/${fullName}/git/commits/${parentSha}`);

    const ref = projectRefUrls(sparseRef(), baseUrls);
    expect(ref.url).toBe(`${baseUrls.apiBaseUrl}/repos/${fullName}/git/refs/heads/main`);
    expect(ref.object.url).toBe(`${baseUrls.apiBaseUrl}/repos/${fullName}/git/commits/${sha}`);

    const branch = projectBranchUrls(sparseBranch(), baseUrls);
    expect(branch.commit.url).toBe(`${baseUrls.apiBaseUrl}/repos/${fullName}/commits/${sha}`);
    expect(branch.protection_url).toBe(`${baseUrls.apiBaseUrl}/repos/${fullName}/branches/main/protection`);

    const branchWithReservedName = projectBranchUrls(
      {
        ...sparseBranch(),
        name: 'feature/rest urls'
      },
      baseUrls
    );
    expect(branchWithReservedName.protection_url).toBe(
      `${baseUrls.apiBaseUrl}/repos/${fullName}/branches/feature%2Frest%20urls/protection`
    );
  });

  it('derives distinct fallback avatar URLs for organizations missing avatars', () => {
    const firstOrganization = projectOrganizationUrls(
      omitFields(githubOrganizationSchema.parse({id: 1111, login: 'alpha'}), organizationUrlFields),
      baseUrls
    );
    const secondOrganization = projectOrganizationUrls(
      omitFields(githubOrganizationSchema.parse({id: 2222, login: 'beta'}), organizationUrlFields),
      baseUrls
    );

    expect(firstOrganization.avatar_url).toBe('https://avatars.githubusercontent.com/u/1111?v=4');
    expect(secondOrganization.avatar_url).toBe('https://avatars.githubusercontent.com/u/2222?v=4');
    expect(firstOrganization.avatar_url).not.toBe(secondOrganization.avatar_url);
  });

  it('does not rewrite explicit URL overrides when projecting parsed fixtures', () => {
    const repository = buildRepositoryFixture({
      owner,
      name: repo,
      url: 'https://legacy.example.test/repos/lovely-org/awesome-repo'
    });
    const issue = buildIssueFixture({
      owner,
      repo,
      number: 7,
      title: 'A seeded issue',
      url: 'https://legacy.example.test/repos/lovely-org/awesome-repo/issues/7'
    });

    expect(projectRepositoryUrls(repository, baseUrls).url).toBe(repository.url);
    expect(projectIssueUrls(issue, baseUrls).url).toBe(issue.url);
  });
});

describe('URL projector properties', () => {
  it('expands derived repository URI templates to valid request-host URLs', () => {
    const projected = projectRepositoryUrls(sparseRepository(), baseUrls);
    const templateFields = repositoryUrlFields.filter((field) => projected[field]?.includes('{'));

    for (const field of templateFields) {
      const expandedUrl = new URL(expandTemplate(projected[field] ?? ''));
      expect(expandedUrl.host).toBe('sim.example.test:8443');
    }
  });

  it('does not leak legacy hosts into derived API or web fields', () => {
    fc.assert(
      fc.property(safeHost, (host) => {
        const generatedBaseUrls = buildBaseUrls({protocol: 'https', host}, '/api/v3');
        const expectedHost = new URL(generatedBaseUrls.apiBaseUrl).host;
        const repository = projectRepositoryUrls(sparseRepository(), generatedBaseUrls);
        const organization = projectOrganizationUrls(sparseOrganization(), generatedBaseUrls);
        const externalValues = new Set([
          ...repositoryExternalUrlFields.map((field) => repository[field]),
          ...organizationExternalUrlFields.map((field) => organization[field])
        ]);
        const derivedValues = [
          ...collectUrlStrings(repository),
          ...collectUrlStrings(projectIssueUrls(sparseIssue(), generatedBaseUrls)),
          ...collectUrlStrings(projectPullRequestUrls(sparsePullRequest(), generatedBaseUrls)),
          ...collectUrlStrings(organization),
          ...collectUrlStrings(projectCommitUrls(sparseCommit(), generatedBaseUrls)),
          ...collectUrlStrings(projectRefUrls(sparseRef(), generatedBaseUrls)),
          ...collectUrlStrings(projectBranchUrls(sparseBranch(), generatedBaseUrls))
        ];

        for (const value of derivedValues) {
          if (externalValues.has(value)) {
            continue;
          }
          expect(new URL(expandTemplate(value)).host).toBe(expectedHost);
          expect(value).not.toContain('localhost:3300');
          expect(value).not.toContain('api.github.com');
          expect(value).not.toContain('github.com');
        }
      }),
      {seed: 1_414_102}
    );
  });
});
