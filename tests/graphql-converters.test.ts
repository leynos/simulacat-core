/** @file Unit tests for GraphQL repository conversion helpers. */
import {describe, expect, it} from 'bun:test';
import {
  convertCommitToGraphql,
  convertIssueToGraphql,
  convertPullRequestToGraphql
} from '../src/graphql/converters/early-entities.ts';
import {convertRepositoryToGraphql} from '../src/graphql/converters/repository.ts';
import {makeToGraphql} from '../src/graphql/to-graphql.ts';
import type {DataSchemas, ToGraphqlDispatcher} from '../src/graphql/to-graphql-shapes.ts';
import {buildBaseUrls, type BaseUrls} from '../src/http/request-url.ts';
import {getUrlObservabilityCounters, resetUrlObservabilityCounters} from '../src/http/url-observability.ts';
import type {ExtendedSimulationStore} from '../src/store/index.ts';
import {buildIssueFixture, buildPullRequestFixture} from '../src/store/builders.ts';
import {projectIssueUrls} from '../src/urls/issue.ts';
import {projectPullRequestUrls} from '../src/urls/pull-request.ts';

const baseUrls: BaseUrls = {
  apiBaseUrl: 'http://localhost:3300/api/v3',
  webBaseUrl: 'http://localhost:3300'
};

const makeRepositoryFixture = (): DataSchemas['Repository'] =>
  ({
    id: 123,
    node_id: Buffer.from('Repository:test-org/test-repo').toString('base64'),
    name: 'test-repo',
    full_name: 'test-org/test-repo',
    url: 'https://example.test/repos/test-org/test-repo',
    created_at: '2024-01-02T03:04:05.000Z',
    default_branch: 'main',
    description: 'Fixture repository',
    topics: [],
    visibility: 'public',
    archived: false,
    fork: false,
    owner: 'test-org'
  }) as unknown as DataSchemas['Repository'];

type RepositoryFixtureOverrides = Partial<Omit<DataSchemas['Repository'], 'node_id'>> & {node_id?: string | undefined};

/** Converts a repository fixture without exercising owner resolution. */
const convertRepositoryFixture = (overrides: RepositoryFixtureOverrides = {}) => {
  const repository = {...makeRepositoryFixture(), ...overrides} as DataSchemas['Repository'];
  const toGraphql = (() => {
    throw new Error('owner resolution is not exercised in this test');
  }) as ToGraphqlDispatcher;
  const graphqlRepository = convertRepositoryToGraphql({} as ExtendedSimulationStore, repository, toGraphql, baseUrls);

  return {graphqlRepository, repository};
};

describe('convertRepositoryToGraphql', () => {
  it('uses the repository node_id for the GraphQL id', () => {
    const {graphqlRepository, repository} = convertRepositoryFixture({
      node_id: Buffer.from('Repository:test-org/test-repo').toString('base64')
    });

    expect(graphqlRepository.id).toBe(repository.node_id);
    expect(graphqlRepository.defaultBranchRef.id).toBe(
      Buffer.from('Branch:test-org/test-repo:main').toString('base64')
    );
  });

  it('derives a canonical owner-qualified GraphQL id when node_id is unavailable', () => {
    const {graphqlRepository} = convertRepositoryFixture({
      node_id: undefined
    });

    expect(graphqlRepository.id).toBe(Buffer.from('Repository:test-org/test-repo').toString('base64'));
  });

  it('ignores malformed non-array repository topics', () => {
    const {graphqlRepository} = convertRepositoryFixture({
      topics: 'typescript'
    } as unknown as Partial<DataSchemas['Repository']>);

    expect(graphqlRepository.repositoryTopics({}).nodes).toEqual([]);
  });
});

describe('convertCommitToGraphql', () => {
  it('derives nested repository ids and normalizes CRLF message parts', () => {
    const commit = {
      owner: 'test-org',
      repo: 'test-repo',
      sha: 'abcdef1234567',
      node_id: 'commit-node',
      html_url: 'https://github.com/test-org/test-repo/commit/abcdef1234567',
      commit: {
        message: 'Headline\r\n\r\nBody',
        author: {name: 'Author', email: 'author@example.test', date: '2024-01-01T00:00:00.000Z'},
        committer: {name: 'Committer', email: 'committer@example.test', date: '2024-01-01T00:00:00.000Z'},
        tree: {sha: 'abcdef1234567'},
        parents: []
      },
      parents: []
    } as unknown as DataSchemas['Commit'];
    const store = {
      store: {getState: () => ({})},
      selectors: {
        getRepository: () => ({
          owner: 'test-org',
          name: 'test-repo'
        })
      }
    } as unknown as ExtendedSimulationStore;

    const graphqlCommit = convertCommitToGraphql(store, commit, baseUrls);
    const commitShape = graphqlCommit as unknown as {
      messageHeadline: string;
      messageBody: string;
      repository: {id: string};
    };

    expect(commitShape.messageHeadline).toBe('Headline');
    expect(commitShape.messageBody).toBe('\nBody');
    expect(commitShape.repository.id).toBe(Buffer.from('Repository:test-org/test-repo').toString('base64'));
  });
});

describe('issue and pull request GraphQL URL conversion', () => {
  const repositoryStore = {
    store: {getState: () => ({})},
    selectors: {
      getRepository: () => ({owner: 'test-org', name: 'test-repo'}),
      resolvePullRequestRelations: () => ({})
    }
  } as unknown as ExtendedSimulationStore;

  it('projects issue URLs from the web base despite an explicit REST URL', () => {
    const issue = buildIssueFixture({
      owner: 'test-org',
      repo: 'test-repo',
      number: 42,
      title: 'URL projection',
      url: 'https://override.example.test/api/v3/repos/test-org/test-repo/issues/42'
    });

    expect(projectIssueUrls(issue, baseUrls).html_url).toBe('http://localhost:3300/test-org/test-repo/issues/42');
    const graphqlIssue = convertIssueToGraphql(repositoryStore, issue, baseUrls) as unknown as {url: string};
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
    const toGraphql = (() => {
      throw new Error('ref conversion is not exercised in this test');
    }) as ToGraphqlDispatcher;
    const graphqlPullRequest = convertPullRequestToGraphql(repositoryStore, pullRequest, toGraphql, baseUrls);

    expect(projectPullRequestUrls(pullRequest, baseUrls).html_url).toBe(
      'http://localhost:3300/test-org/test-repo/pull/42'
    );
    const graphqlPullRequestUrls = graphqlPullRequest as unknown as {permalink: string; url: string};
    expect(graphqlPullRequestUrls.url).toBe('http://localhost:3300/test-org/test-repo/pull/42');
    expect(graphqlPullRequestUrls.permalink).toBe('http://localhost:3300/test-org/test-repo/pull/42');
  });
});

describe('GraphQL dispatch observability', () => {
  it('observes unknown typenames and preserves the error contract', () => {
    resetUrlObservabilityCounters();
    const observedBaseUrls = buildBaseUrls({protocol: 'https', host: 'graphql.example.test'}, '/', undefined, {
      transport: 'graphql',
      requestId: 'graphql-request-1'
    });
    const dispatcher = makeToGraphql({} as ExtendedSimulationStore, observedBaseUrls);

    expect(() => dispatcher({} as ExtendedSimulationStore, 'Unknown' as never, {} as never)).toThrow(
      'toGraphql: unhandled __typename Unknown'
    );
    expect(getUrlObservabilityCounters()).toEqual({
      'base-url.graphql.request-origin.none': 1,
      'graphql-dispatch.graphql.unhandled-typename.unknown-typename': 1
    });
  });
});
