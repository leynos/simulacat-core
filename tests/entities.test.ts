/** @file Unit tests for fixture schemas and state-table conversion helpers. */
import {beforeEach, describe, expect, it} from 'bun:test';
import {
  githubAppInstallationSchema,
  githubBranchSchema,
  convertObjByKey,
  convertInitialStateToStoreState,
  githubBlobSchema,
  githubCommitSchema,
  githubInitialStoreSchema,
  githubIssueSchema,
  githubOrganizationSchema,
  githubPullRequestSchema,
  githubRefSchema,
  githubRepositorySchema,
  githubUserSchema
} from '../src/store/entities.ts';
import {resetNextRepositoryId} from '../src/store/entities/repository.ts';
import {
  branchUrlFields,
  commitUrlFields,
  issueUrlFields,
  organizationUrlFields,
  pullRequestUrlFields,
  refUrlFields,
  repositoryUrlFields
} from '../src/urls/index.ts';

type GitHubInitialStoreFixture = {
  users: Array<Record<string, unknown>>;
  installations?: Array<Record<string, unknown>>;
  organizations: Array<Record<string, unknown>>;
  repositories: Array<Record<string, unknown>>;
  branches: Array<Record<string, unknown>>;
  blobs: Array<Record<string, unknown>>;
  refs?: Array<Record<string, unknown>>;
  commits?: Array<Record<string, unknown>>;
  issues?: Array<Record<string, unknown>>;
  pullRequests?: Array<Record<string, unknown>>;
};

type BuildGithubInitialStoreOptions = {
  storeOverrides?: Partial<GitHubInitialStoreFixture>;
  userOverrides?: Record<string, unknown>;
};

const buildGithubInitialStore = (options: BuildGithubInitialStoreOptions = {}) => ({
  users: [{login: 'dev', organizations: [], ...(options.userOverrides ?? {})}],
  organizations: [{login: 'test-org'}],
  repositories: [{owner: 'test-org', name: 'test-repo'}],
  branches: [{owner: 'test-org', repo: 'test-repo', name: 'main'}],
  blobs: [],
  ...(options.storeOverrides ?? {})
});

const organizationLegacyUserUrlFields = [
  'followers_url',
  'following_url',
  'gists_url',
  'starred_url',
  'subscriptions_url',
  'organizations_url',
  'received_events_url'
] as const;

const parseGithubInitialStore = (options: BuildGithubInitialStoreOptions = {}) =>
  githubInitialStoreSchema.parse(buildGithubInitialStore(options));

type StoreState = ReturnType<typeof convertInitialStateToStoreState>;

/** Expects every named URL field to be absent from a sparse stored entity. */
const expectFieldsAbsent = (value: object, fields: readonly string[]) => {
  for (const field of fields) {
    expect(value).not.toHaveProperty(field);
  }
};

const requireStoreState = (store: StoreState) => {
  if (!store) {
    throw new Error('convertInitialStateToStoreState returned null for parsed input');
  }

  return store;
};

describe('initialState user fields', () => {
  it('preserves all provided fields through to store state', () => {
    const parsed = parseGithubInitialStore({
      userOverrides: {
        id: 99887766,
        name: 'dev User',
        email: 'dev@example.io'
      }
    });
    const store = requireStoreState(convertInitialStateToStoreState(parsed));
    const {dev: user} = store.users;

    expect(user).toBeDefined();
    if (!user) {
      throw new Error('expected seeded user to be present');
    }
    expect(user.id).toBe(99887766);
    expect(user.login).toBe('dev');
    expect(user.name).toBe('dev User');
    expect(user.email).toBe('dev@example.io');
  });

  it('generates defaults for omitted fields', () => {
    const parsed = parseGithubInitialStore();
    const store = requireStoreState(convertInitialStateToStoreState(parsed));
    const {dev: user} = store.users;

    if (!user) {
      throw new Error('expected seeded user to be present');
    }
    expect(user.id).toBeGreaterThanOrEqual(1000);
    expect(user.email).toContain('@');
  });

  it('rejects blank logins', () => {
    expect(() => githubUserSchema.parse({login: '   ', organizations: []})).toThrow();
  });
});

describe('githubBlobSchema', () => {
  it('accepts path-only blobs', () => {
    const blob = githubBlobSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      path: 'README.md'
    });

    expect(blob.path).toBe('README.md');
    expect(blob.sha).toBeUndefined();
  });

  it('accepts sha-only blobs', () => {
    const blob = githubBlobSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      sha: 'abc123'
    });

    expect(blob.sha).toBe('abc123');
    expect(blob.path).toBeUndefined();
  });

  it('rejects blobs missing both path and sha', () => {
    expect(() =>
      githubBlobSchema.parse({
        owner: 'test-org',
        repo: 'test-repo'
      })
    ).toThrow('Specify the path or sha of the blob');
  });
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: legacy early entity schema suite kept intact for coverage.
describe('early entity schemas', () => {
  it('normalizes commit parents precedence without synthesizing parent URLs', () => {
    const commit = githubCommitSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      sha: 'abcdef',
      parents: [{sha: 'parent-top-1'}, {sha: 'parent-top-2', url: 'https://example.test/parent-top-2'}],
      commit: {
        parents: [{sha: 'parent-nested-1'}]
      }
    });

    expect(commit.parents.map((parent) => parent.sha)).toEqual(['parent-top-1', 'parent-top-2']);
    expect(commit.parents[0]).not.toHaveProperty('url');
    expect(commit.parents[1]?.url).toBe('https://example.test/parent-top-2');
    expect(commit.commit.parents).toEqual(commit.parents);
  });

  it('normalizes ref prefixes and precedence without synthesizing object URLs', () => {
    const branchRef = githubRefSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      qualifiedName: 'main',
      object: {type: 'commit', sha: 'commit-sha'}
    });
    const tagRef = githubRefSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      qualifiedName: 'ignored',
      ref: 'v1.0.0',
      object: {type: 'tag', sha: 'tag-sha'}
    });

    expect(branchRef.qualifiedName).toBe('main');
    expect(branchRef.ref).toBe('refs/heads/main');
    expect(branchRef.object).not.toHaveProperty('url');
    expect(tagRef.qualifiedName).toBe('v1.0.0');
    expect(tagRef.ref).toBe('refs/tags/v1.0.0');
    expect(tagRef.object).not.toHaveProperty('url');
  });

  it('uses deterministic commit defaults', () => {
    const first = githubCommitSchema.parse({owner: 'test-org', repo: 'test-repo'});
    const second = githubCommitSchema.parse({owner: 'test-org', repo: 'test-repo'});

    expect(first.sha).toBe('0000000000000000000000000000000000000000');
    expect(second.sha).toBe(first.sha);
    expect(second.commit.author.date).toBe(first.commit.author.date);
    expect(second.commit.committer.date).toBe(first.commit.committer.date);
  });

  it('defaults initialState early entity collections to empty arrays', () => {
    const parsed = parseGithubInitialStore();

    expect(parsed.refs).toEqual([]);
    expect(parsed.commits).toEqual([]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.pullRequests).toEqual([]);
  });

  it('normalizes refs, commits, issues, and pull requests', () => {
    const commit = githubCommitSchema.parse({owner: 'test-org', repo: 'test-repo', sha: 'abc123'});
    const ref = githubRefSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      qualifiedName: 'main',
      object: {sha: 'abc123'}
    });
    const issue = githubIssueSchema.parse({owner: 'test-org', repo: 'test-repo', number: 2, title: 'Bug'});
    const pullRequest = githubPullRequestSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      number: 3,
      title: 'Patch',
      base: {ref: 'main', sha: 'abc123'},
      head: {ref: 'feature/ref-safe', sha: 'def456'}
    });

    expect(commit.commit.tree.sha).toBe('abc123');
    expect(ref.ref).toBe('refs/heads/main');
    expectFieldsAbsent(issue, issueUrlFields);
    expect(pullRequest.base.owner).toBe('test-org');
    expect(pullRequest.issue_number).toBe(3);
    expectFieldsAbsent(pullRequest, pullRequestUrlFields);
  });

  it('clears stale closure timestamps for open issues and pull requests', () => {
    const issue = githubIssueSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      number: 4,
      title: 'Open issue',
      closed_at: '2024-01-01T00:00:00Z'
    });
    const pullRequest = githubPullRequestSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      number: 5,
      title: 'Open pull request',
      closed_at: '2024-01-01T00:00:00Z',
      merged_at: '2024-01-02T00:00:00Z',
      base: {ref: 'main', sha: 'abc123'},
      head: {ref: 'feature/open', sha: 'def456'}
    });

    expect(issue.closed_at).toBeNull();
    expect(pullRequest.closed_at).toBeNull();
    expect(pullRequest.merged_at).toBeNull();
  });

  it('rejects pull requests with divergent issue numbers', () => {
    expect(() =>
      githubPullRequestSchema.parse({
        owner: 'test-org',
        repo: 'test-repo',
        number: 6,
        issue_number: 7,
        title: 'Mismatched pull request',
        base: {ref: 'main', sha: 'abc123'},
        head: {ref: 'feature/mismatch', sha: 'def456'}
      })
    ).toThrow('Pull request issue_number 7 must match pull request number 6');
  });
});

describe('initialState blob fields', () => {
  it('stores path-only blobs using a repository-scoped fallback key', () => {
    const parsed = parseGithubInitialStore({
      storeOverrides: {
        blobs: [{owner: 'test-org', repo: 'test-repo', path: 'README.md'}]
      }
    });
    const store = requireStoreState(convertInitialStateToStoreState(parsed));

    expect(store.blobs['test-org/test-repo:README.md']).toEqual(
      expect.objectContaining({
        owner: 'test-org',
        repo: 'test-repo',
        path: 'README.md'
      })
    );
    expect(store.blobs['test-org/test-repo:README.md']?.sha).toBeUndefined();
  });

  it('keeps path-only blobs from different repositories distinct', () => {
    const parsed = parseGithubInitialStore({
      storeOverrides: {
        repositories: [
          {owner: 'test-org', name: 'test-repo'},
          {owner: 'test-org', name: 'docs-repo'}
        ],
        branches: [
          {owner: 'test-org', repo: 'test-repo', name: 'main'},
          {owner: 'test-org', repo: 'docs-repo', name: 'main'}
        ],
        blobs: [
          {owner: 'test-org', repo: 'test-repo', path: 'README.md'},
          {owner: 'test-org', repo: 'docs-repo', path: 'README.md'}
        ]
      }
    });
    const store = requireStoreState(convertInitialStateToStoreState(parsed));

    expect(store.blobs['test-org/test-repo:README.md']).toEqual(
      expect.objectContaining({repo: 'test-repo', path: 'README.md'})
    );
    expect(store.blobs['test-org/docs-repo:README.md']).toEqual(
      expect.objectContaining({repo: 'docs-repo', path: 'README.md'})
    );
  });
});

describe('githubOrganizationSchema', () => {
  it('rejects blank logins', () => {
    expect(() => githubOrganizationSchema.parse({login: '   '})).toThrow('login must be a non-empty string');
  });

  it('keeps the store host-agnostic when URL fields are omitted', () => {
    const organization = githubOrganizationSchema.parse({
      login: 'test-org'
    });

    expectFieldsAbsent(organization, [...organizationUrlFields, ...organizationLegacyUserUrlFields]);
  });

  it('preserves caller-supplied organization URL overrides', () => {
    const organization = githubOrganizationSchema.parse({
      login: 'test-org',
      url: 'https://api.example.test/api/v3/orgs/test-org',
      html_url: 'https://example.test/orgs/test-org',
      members_url: 'https://example.test/custom-members{/member}'
    });

    expect(organization.url).toBe('https://api.example.test/api/v3/orgs/test-org');
    expect(organization.html_url).toBe('https://example.test/orgs/test-org');
    expect(organization.members_url).toBe('https://example.test/custom-members{/member}');
  });
});

describe('githubAppInstallationSchema', () => {
  it('rejects blank accounts', () => {
    expect(() => githubAppInstallationSchema.parse({account: '   '})).toThrow();
  });

  it('rejects invalid ISO datetimes', () => {
    expect(() => githubAppInstallationSchema.parse({account: 'test-org', created_at: 'not-a-date'})).toThrow();
    expect(() => githubAppInstallationSchema.parse({account: 'test-org', updated_at: 'not-a-date'})).toThrow();
  });

  it('defaults updated_at no earlier than created_at', () => {
    const installation = githubAppInstallationSchema.parse({account: 'test-org'});

    if (!installation.updated_at) {
      throw new Error('expected updated_at to be defaulted');
    }

    expect(new Date(installation.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(installation.created_at).getTime()
    );
  });

  it('handles future-dated created_at without throwing', () => {
    const futureCreatedAt = new Date(Date.now() + 60_000).toISOString();

    const installation = githubAppInstallationSchema.parse({
      account: 'test-org',
      created_at: futureCreatedAt
    });

    expect(installation.created_at).toBe(futureCreatedAt);
    expect(installation.updated_at).toBeDefined();
  });
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: legacy schema transform suite kept intact for coverage.
describe('initialState schema transforms', () => {
  beforeEach(() => {
    resetNextRepositoryId();
  });

  it('creates installation fixtures for each seeded organization', () => {
    const parsed = parseGithubInitialStore();

    expect(parsed.installations).toHaveLength(1);
    expect(parsed.installations[0]).toEqual(
      expect.objectContaining({
        account: 'test-org',
        target_type: 'Organization'
      })
    );
  });

  it('assigns deterministic unique ids to synthesized installations', () => {
    const parsed = parseGithubInitialStore({
      storeOverrides: {
        organizations: [
          {id: 4401, login: 'test-org'},
          {id: 4402, login: 'other-org'}
        ],
        installations: [
          {
            id: 2000,
            account: 'existing-account',
            target_id: 9999,
            target_type: 'Organization'
          }
        ]
      }
    });

    expect(parsed.installations.map((installation) => installation.id)).toEqual([2000, 2001, 2002]);
    expect(new Set(parsed.installations.map((installation) => installation.id)).size).toBe(parsed.installations.length);
  });

  it('assigns deterministic ids to caller-provided installations missing ids', () => {
    const parsed = parseGithubInitialStore({
      storeOverrides: {
        organizations: [
          {id: 4401, login: 'test-org'},
          {id: 4402, login: 'other-org'}
        ],
        installations: [
          {
            account: 'existing-account',
            target_id: 9999,
            target_type: 'Organization'
          }
        ]
      }
    });
    const store = requireStoreState(convertInitialStateToStoreState(parsed));

    expect(parsed.installations.map((installation) => installation.id)).toEqual([2000, 2001, 2002]);
    expect(Object.keys(store.installations)).toEqual(['2000', '2001', '2002']);
    expect(store.installations['2000']).toEqual(
      expect.objectContaining({
        id: 2000,
        account: 'existing-account'
      })
    );
  });

  it('preserves caller-supplied installation fields', () => {
    const parsed = parseGithubInitialStore({
      storeOverrides: {
        installations: [
          {
            id: 4242,
            account: 'test-org',
            access_tokens_url: 'https://example.test/custom/access_tokens',
            repositories_url: 'https://example.test/custom/repositories',
            html_url: 'https://example.test/custom/html'
          }
        ]
      }
    });

    expect(parsed.installations).toEqual([
      expect.objectContaining({
        id: 4242,
        access_tokens_url: 'https://example.test/custom/access_tokens',
        repositories_url: 'https://example.test/custom/repositories',
        html_url: 'https://example.test/custom/html'
      })
    ]);
  });

  it('does not mutate the caller-provided installations array', () => {
    const installations = [
      {
        id: 4242,
        account: 'test-org',
        access_tokens_url: 'https://example.test/custom/access_tokens',
        repositories_url: 'https://example.test/custom/repositories',
        html_url: 'https://example.test/custom/html'
      }
    ];
    const input = buildGithubInitialStore({storeOverrides: {installations}});

    githubInitialStoreSchema.parse(input);

    expect(installations).toEqual([
      expect.objectContaining({
        id: 4242,
        account: 'test-org',
        access_tokens_url: 'https://example.test/custom/access_tokens',
        repositories_url: 'https://example.test/custom/repositories',
        html_url: 'https://example.test/custom/html'
      })
    ]);
  });

  it('normalizes repository fields needed by REST and GraphQL responses', () => {
    const parsed = parseGithubInitialStore();
    const repository = parsed.repositories[0];

    if (!repository) {
      throw new Error('expected seeded repository to be present');
    }
    expect(repository.full_name).toBe('test-org/test-repo');
    expectFieldsAbsent(repository, repositoryUrlFields);
    expect(repository.visibility).toBe('public');
  });

  it('preserves caller-supplied repository URL overrides', () => {
    const repository = githubRepositorySchema.parse({
      owner: 'test-org',
      name: 'test-repo',
      permissions: {},
      html_url: 'https://example.test/custom/repo',
      mirror_url: null,
      homepage: null
    });

    expect(repository.html_url).toBe('https://example.test/custom/repo');
    expect(repository.mirror_url).toBeNull();
    expect(repository.homepage).toBeNull();
  });

  it('keeps parsed early entities host-agnostic when URL fields are omitted', () => {
    const commit = githubCommitSchema.parse({owner: 'test-org', repo: 'test-repo', sha: 'abc123'});
    const ref = githubRefSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      qualifiedName: 'main',
      object: {sha: 'abc123'}
    });
    const branch = githubBranchSchema.parse({owner: 'test-org', repo: 'test-repo', name: 'main'});
    const issue = githubIssueSchema.parse({owner: 'test-org', repo: 'test-repo', number: 2, title: 'Bug'});
    const pullRequest = githubPullRequestSchema.parse({
      owner: 'test-org',
      repo: 'test-repo',
      number: 3,
      title: 'Patch',
      base: {ref: 'main', sha: 'abc123'},
      head: {ref: 'feature/ref-safe', sha: 'def456'}
    });

    expectFieldsAbsent(commit, commitUrlFields);
    expect(commit.commit.tree).not.toHaveProperty('url');
    expect(commit.commit.parents).toEqual([]);
    expect(commit.parents).toEqual([]);
    expectFieldsAbsent(ref, refUrlFields);
    expect(ref.object).not.toHaveProperty('url');
    expectFieldsAbsent(branch, branchUrlFields);
    expect(branch.commit).not.toHaveProperty('url');
    expectFieldsAbsent(issue, issueUrlFields);
    expectFieldsAbsent(pullRequest, pullRequestUrlFields);
  });

  it('preserves caller-supplied repository and organization ids', () => {
    const parsed = parseGithubInitialStore({
      storeOverrides: {
        organizations: [{id: 4401, login: 'test-org'}],
        repositories: [{id: 3301, owner: 'test-org', name: 'test-repo'}]
      }
    });

    expect(parsed.organizations[0]?.id).toBe(4401);
    expect(parsed.repositories[0]?.id).toBe(3301);
  });

  it('assigns distinct generated ids to multiple seeded repositories', () => {
    const parsed = parseGithubInitialStore({
      storeOverrides: {
        repositories: [
          {owner: 'test-org', name: 'test-repo'},
          {owner: 'test-org', name: 'second-repo'}
        ],
        branches: [
          {owner: 'test-org', repo: 'test-repo', name: 'main'},
          {owner: 'test-org', repo: 'second-repo', name: 'main'}
        ]
      }
    });

    const firstRepository = parsed.repositories[0];
    const secondRepository = parsed.repositories[1];

    if (!firstRepository || !secondRepository) {
      throw new Error('expected seeded repositories to be present');
    }

    expect(firstRepository.id).not.toBe(secondRepository.id);
    expect(firstRepository.full_name).toBe('test-org/test-repo');
    expect(secondRepository.full_name).toBe('test-org/second-repo');
    expectFieldsAbsent(firstRepository, repositoryUrlFields);
    expectFieldsAbsent(secondRepository, repositoryUrlFields);
  });

  it('rejects duplicate keyed entities instead of overwriting them', () => {
    const parsed = parseGithubInitialStore({
      storeOverrides: {
        repositories: [
          {owner: 'test-org', name: 'test-repo'},
          {owner: 'test-org', name: 'test-repo'}
        ],
        branches: [
          {owner: 'test-org', repo: 'test-repo', name: 'main'},
          {owner: 'test-org', repo: 'test-repo', name: 'release'}
        ]
      }
    });

    expect(() => convertInitialStateToStoreState(parsed)).toThrow('Duplicate key "test-org/test-repo"');
  });

  it('converts early entity arrays into owner-scoped keyed tables', () => {
    const parsed = parseGithubInitialStore({
      storeOverrides: {
        organizations: [{login: 'test-org'}, {login: 'other-org'}],
        repositories: [
          {owner: 'test-org', name: 'same-repo'},
          {owner: 'other-org', name: 'same-repo'}
        ],
        branches: [
          {owner: 'test-org', repo: 'same-repo', name: 'main'},
          {owner: 'other-org', repo: 'same-repo', name: 'main'}
        ],
        commits: [
          {owner: 'test-org', repo: 'same-repo', sha: 'abc123'},
          {owner: 'other-org', repo: 'same-repo', sha: 'abc123'}
        ],
        refs: [
          {owner: 'test-org', repo: 'same-repo', qualifiedName: 'main', object: {sha: 'abc123'}},
          {owner: 'other-org', repo: 'same-repo', qualifiedName: 'main', object: {sha: 'abc123'}}
        ],
        issues: [
          {owner: 'test-org', repo: 'same-repo', number: 1, title: 'Test issue'},
          {owner: 'other-org', repo: 'same-repo', number: 1, title: 'Other issue'}
        ],
        pullRequests: [
          {
            owner: 'test-org',
            repo: 'same-repo',
            number: 2,
            title: 'Test pull request',
            base: {ref: 'main', sha: 'abc123'},
            head: {ref: 'feature', sha: 'def456'}
          },
          {
            owner: 'other-org',
            repo: 'same-repo',
            number: 2,
            title: 'Other pull request',
            base: {ref: 'main', sha: 'abc123'},
            head: {ref: 'feature', sha: 'def456'}
          }
        ]
      }
    });
    const store = requireStoreState(convertInitialStateToStoreState(parsed));

    expect(store.refs['test-org/same-repo:main']?.owner).toBe('test-org');
    expect(store.refs['other-org/same-repo:main']?.owner).toBe('other-org');
    expect(store.commits['test-org/same-repo:abc123']?.owner).toBe('test-org');
    expect(store.issues['test-org/same-repo#1']?.title).toBe('Test issue');
    expect(store.pullRequests['other-org/same-repo!2']?.title).toBe('Other pull request');
  });

  it('rejects duplicate early entity keys', () => {
    const parsed = parseGithubInitialStore({
      storeOverrides: {
        refs: [
          {owner: 'test-org', repo: 'test-repo', qualifiedName: 'main', object: {sha: 'abc123'}},
          {owner: 'test-org', repo: 'test-repo', qualifiedName: 'main', object: {sha: 'def456'}}
        ]
      }
    });

    expect(() => convertInitialStateToStoreState(parsed)).toThrow('Duplicate key "test-org/test-repo:main"');
  });
});

describe('convertObjByKey', () => {
  it('uses a null-prototype object for keyed results', () => {
    const keyedObjects = convertObjByKey([{name: 'prototype-guard'}], () => '__proto__');

    expect(Object.getPrototypeOf(keyedObjects)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(keyedObjects, '__proto__')?.value).toEqual({name: 'prototype-guard'});
  });
});
