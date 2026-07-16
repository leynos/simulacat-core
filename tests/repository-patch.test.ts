/** @file Tests for REST repository PATCH request parsing. */
import {describe, expect, it} from 'bun:test';
import {buildUpdateRepositoryCommand} from '../src/rest/repository-patch.ts';

describe('repository PATCH parsing', () => {
  it('keeps every supported writable string field and ignores unrelated fields', () => {
    expect(
      buildUpdateRepositoryCommand({
        owner: 'acme',
        name: 'awesome-repo',
        body: {
          description: 'Updated description',
          homepage: 'https://docs.example.test',
          private: true
        }
      })
    ).toEqual({
      owner: 'acme',
      name: 'awesome-repo',
      changes: {
        description: 'Updated description',
        homepage: 'https://docs.example.test'
      }
    });
  });

  it('rejects patch bodies with non-string writable fields', () => {
    expect(
      buildUpdateRepositoryCommand({
        owner: 'acme',
        name: 'awesome-repo',
        body: {description: 42}
      })
    ).toEqual({owner: 'acme', name: 'awesome-repo', changes: {}});
  });
});
