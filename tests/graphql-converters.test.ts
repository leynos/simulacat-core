/** @file Unit tests for GraphQL repository conversion helpers. */
import {describe, expect, it} from 'bun:test';
import {convertRepositoryToGraphql} from '../src/graphql/converters/repository.ts';
import type {DataSchemas, ToGraphqlDispatcher} from '../src/graphql/to-graphql-shapes.ts';
import type {ExtendedSimulationStore} from '../src/store/index.ts';

describe('convertRepositoryToGraphql', () => {
  it('falls back to full_name when a repository id is unavailable', () => {
    const repository = {
      id: undefined,
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
    } as unknown as DataSchemas['Repository'];

    const graphqlRepository = convertRepositoryToGraphql({} as ExtendedSimulationStore, repository, (() => {
      throw new Error('owner resolution is not exercised in this test');
    }) as ToGraphqlDispatcher);

    expect(graphqlRepository.id).toBe('test-org/test-repo');
    expect(graphqlRepository.defaultBranchRef.id).toBe(
      Buffer.from('Branch:test-org/test-repo:main').toString('base64')
    );
  });
});
