/** @file Unit tests for GraphQL repository conversion helpers. */
import {describe, expect, it} from 'bun:test';
import {
  convertCommitToGraphql,
  convertIssueToGraphql,
  convertPullRequestToGraphql
} from '../src/graphql/converters/early-entities.ts';
import {convertRepositoryToGraphql} from '../src/graphql/converters/repository.ts';
import {makeToGraphql} from '../src/graphql/to-graphql.ts';
import type {DataSchemas, ToGraphqlDispatcher} from '../src/graphql/to-graphql-types.ts';
import {buildBaseUrls, type BaseUrls} from '../src/http/request-url.ts';
import {getUrlObservabilityCounters, resetUrlObservabilityCounters} from '../src/http/url-observability.ts';
import type {ExtendedSimulationStore} from '../src/store/index.ts';
import {
  buildCommitFixture,
  buildIssueFixture,
  buildPullRequestFixture,
  buildRepositoryFixture,
  type RepositoryFixtureInput
} from '../src/store/builders.ts';
import {projectIssueUrls} from '../src/urls/issue.ts';
import {projectPullRequestUrls} from '../src/urls/pull-request.ts';

const baseUrls: BaseUrls = {
  apiBaseUrl: 'http://localhost:3300/api/v3',
  webBaseUrl: 'http://localhost:3300'
};

const repositoryNodeId = Buffer.from('Repository:test-org/test-repo').toString('base64');

/** Node id seeded explicitly to prove stored identities are not recomputed. */
const seededNodeId = Buffer.from('Repository:legacy-test-repo').toString('base64');

const makeRepositoryFixture = (): DataSchemas['Repository'] =>
  buildRepositoryFixture({
    id: 123,
    node_id: repositoryNodeId,
    name: 'test-repo',
    url: 'https://example.test/repos/test-org/test-repo',
    created_at: '2024-01-02T03:04:05.000Z',
    default_branch: 'main',
    description: 'Fixture repository',
    owner: 'test-org'
  });

type RepositoryFixtureOverrides = Partial<RepositoryFixtureInput> & {node_id?: string | undefined};

/** Fails when a conversion reaches owner resolution, which these tests avoid. */
const toGraphql: ToGraphqlDispatcher = () => {
  throw new Error('owner resolution is not exercised in this test');
};

// The store schema accepts only arrays, so the malformed value is written
// onto the parsed fixture to model data that bypassed the validation boundary.
/** Builds a repository whose `topics` is a malformed non-array string. */
const malformedRepositoryTopics = (): DataSchemas['Repository'] => {
  const repository = makeRepositoryFixture();
  Object.defineProperty(repository, 'topics', {value: 'typescript'});
  return repository;
};

/** Repository owner/name pair returned by the stubbed lookup. */
type RepositoryLookup = {owner: string; name: string};

/** Selector stubs a conversion under test may rely on. */
type ConverterSelectorStubs = {
  getRepository?: () => RepositoryLookup | undefined;
  resolvePullRequestRelations?: () => Record<string, never>;
};

/** Members a converter test is allowed to stub. */
type TestStoreSurface = {
  store: {getState: () => Record<string, never>};
  selectors: {
    getRef: () => undefined;
    getRepository: () => RepositoryLookup | undefined;
    resolvePullRequestRelations: () => Record<string, never>;
  };
};

/** Narrows a deliberately partial test double to the full store contract. */
const asTestStore = (store: TestStoreSurface): ExtendedSimulationStore => {
  // SAFETY: callers construct only the members the converter under test
  // reaches, and the remaining contract is never exercised by these fixtures.
  const base = {} as ExtendedSimulationStore;
  return Object.assign(base, store);
};

// Each test supplies only the stubs its conversion reaches; every other
// selector and schema slice stays unreachable because the fixtures carry no
// linked owner, default branch, or pull request relations.
/** Builds a minimal store surface with per-test selector stubs. */
const makeRepositoryConverterStore = (stubs?: ConverterSelectorStubs): ExtendedSimulationStore =>
  asTestStore({
    store: {getState: () => ({})},
    selectors: {
      getRef: () => {},
      getRepository: stubs?.getRepository ?? (() => {}),
      resolvePullRequestRelations: stubs?.resolvePullRequestRelations ?? (() => ({}))
    }
  });

/** Converts a repository fixture without exercising owner resolution. */
const convertRepositoryFixture = (overrides?: RepositoryFixtureOverrides) => {
  // `node_id: undefined` is meaningful here: it exercises the fallback that
  // derives the id from the owner-qualified store key.
  const repository = buildRepositoryFixture({...makeRepositoryFixture(), ...overrides});
  const graphqlRepository = convertRepositoryToGraphql(makeRepositoryConverterStore(), repository, toGraphql, baseUrls);

  return {graphqlRepository, repository};
};

describe('convertRepositoryToGraphql', () => {
  it('uses the repository node_id for the GraphQL id', () => {
    const {graphqlRepository} = convertRepositoryFixture();

    expect(graphqlRepository.id).toBe(repositoryNodeId);
    expect(graphqlRepository.defaultBranchRef.id).toBe(
      Buffer.from('Branch:test-org/test-repo:main').toString('base64')
    );
  });

  it('preserves an explicitly seeded noncanonical node_id', () => {
    // `docs/api-reference.md` promises the stored value survives; deriving a
    // canonical id here would make GraphQL disagree with REST and the store.
    const {graphqlRepository} = convertRepositoryFixture({node_id: seededNodeId});

    expect(graphqlRepository.id).toBe(seededNodeId);
  });

  it('derives a canonical owner-qualified GraphQL id when node_id is unavailable', () => {
    const {graphqlRepository} = convertRepositoryFixture({
      node_id: undefined
    });

    expect(graphqlRepository.id).toBe(Buffer.from('Repository:test-org/test-repo').toString('base64'));
  });

  it('ignores malformed non-array repository topics', () => {
    // `topics` reaches the store through fixture input, which accepts any
    // value; the converter must treat a non-array as "no topics".
    const graphqlRepository = convertRepositoryToGraphql(
      makeRepositoryConverterStore(),
      malformedRepositoryTopics(),
      toGraphql,
      baseUrls
    );

    expect(graphqlRepository.repositoryTopics({}).nodes).toEqual([]);
  });
});

describe('convertCommitToGraphql', () => {
  it('derives nested repository ids and normalizes CRLF message parts', () => {
    const commit = buildCommitFixture({
      owner: 'test-org',
      repo: 'test-repo',
      sha: 'abcdef1234567',
      node_id: 'commit-node',
      html_url: 'https://github.com/test-org/test-repo/commit/abcdef1234567',
      commit: {
        message: 'Headline\r\n\r\nBody',
        author: {name: 'Author', email: 'author@example.test', date: '2024-01-01T00:00:00.000Z'},
        committer: {name: 'Committer', email: 'committer@example.test', date: '2024-01-01T00:00:00.000Z'}
      }
    });
    const store = makeRepositoryConverterStore({
      getRepository: () => ({owner: 'test-org', name: 'test-repo'})
    });

    const graphqlCommit = convertCommitToGraphql(store, commit, baseUrls);

    expect(graphqlCommit.messageHeadline).toBe('Headline');
    expect(graphqlCommit.messageBody).toBe('\nBody');
    expect(graphqlCommit.repository?.id).toBe(Buffer.from('Repository:test-org/test-repo').toString('base64'));
  });
});

describe('issue and pull request GraphQL URL conversion', () => {
  const repositoryStore = makeRepositoryConverterStore({
    getRepository: () => ({owner: 'test-org', name: 'test-repo'})
  });

  it('projects issue URLs from the web base despite an explicit REST URL', () => {
    const issue = buildIssueFixture({
      owner: 'test-org',
      repo: 'test-repo',
      number: 42,
      title: 'URL projection',
      url: 'https://override.example.test/api/v3/repos/test-org/test-repo/issues/42'
    });

    expect(projectIssueUrls(issue, baseUrls).html_url).toBe('http://localhost:3300/test-org/test-repo/issues/42');
    const graphqlIssue = convertIssueToGraphql(repositoryStore, issue, baseUrls);
    expect(graphqlIssue.url).toBe('http://localhost:3300/test-org/test-repo/issues/42');
  });

  it('projects pull request URLs and permalinks from the web base despite an explicit REST URL', () => {
    const pullRequest = buildPullRequestFixture({
      owner: 'test-org',
      repo: 'test-repo',
      number: 42,
      title: 'URL projection',
      base: {ref: 'main', sha: 'base-sha'},
      head: {ref: 'feature/url-projection', sha: 'head-sha'},
      url: 'https://override.example.test/api/v3/repos/test-org/test-repo/pulls/42'
    });
    const graphqlPullRequest = convertPullRequestToGraphql(repositoryStore, pullRequest, toGraphql, baseUrls);

    expect(projectPullRequestUrls(pullRequest, baseUrls).html_url).toBe(
      'http://localhost:3300/test-org/test-repo/pull/42'
    );
    expect(graphqlPullRequest.url).toBe('http://localhost:3300/test-org/test-repo/pull/42');
    expect(graphqlPullRequest.permalink).toBe('http://localhost:3300/test-org/test-repo/pull/42');
  });
});

describe('GraphQL dispatch observability', () => {
  it('observes unknown typenames and preserves the error contract', () => {
    resetUrlObservabilityCounters();
    const observedBaseUrls = buildBaseUrls({protocol: 'https', host: 'graphql.example.test'}, '/', undefined, {
      transport: 'graphql',
      requestId: 'graphql-request-1'
    });
    const unusedStore = makeRepositoryConverterStore();
    const dispatcher = makeToGraphql(unusedStore, observedBaseUrls);
    // SAFETY: the dispatcher keys its converter map by this exact key and
    // rejects it before reading any entity field, which is the contract under
    // test; the value is never dereferenced.
    const unknownTypename = 'Unknown' as keyof DataSchemas;
    // SAFETY: the dispatch above rejects the unknown key before touching the
    // entity, so no member of this placeholder is ever read.
    const emptyEntity = {} as DataSchemas['User'];

    expect(() => dispatcher(unusedStore, unknownTypename, emptyEntity)).toThrow(
      'toGraphql: unhandled __typename Unknown'
    );
    expect(getUrlObservabilityCounters()).toEqual({
      'base-url.graphql.request-origin.none': 1,
      'graphql-dispatch.graphql.unhandled-typename.unknown-typename': 1
    });
  });
});
