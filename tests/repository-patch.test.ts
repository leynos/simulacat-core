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
    for (const field of ['description', 'homepage'] as const) {
      for (const value of [null, 42, {}]) {
        expect(
          buildUpdateRepositoryCommand({
            owner: 'acme',
            name: 'awesome-repo',
            body: {[field]: value}
          })
        ).toEqual({owner: 'acme', name: 'awesome-repo', changes: {}});
      }
    }
  });

  it('retains valid writable siblings when another writable field is malformed', () => {
    expect(
      buildUpdateRepositoryCommand({
        owner: 'acme',
        name: 'awesome-repo',
        body: {description: null, homepage: 'https://docs.example.test'}
      })
    ).toEqual({
      owner: 'acme',
      name: 'awesome-repo',
      changes: {homepage: 'https://docs.example.test'}
    });
    expect(
      buildUpdateRepositoryCommand({
        owner: 'acme',
        name: 'awesome-repo',
        body: {description: 'Updated description', homepage: {invalid: true}}
      })
    ).toEqual({
      owner: 'acme',
      name: 'awesome-repo',
      changes: {description: 'Updated description'}
    });
  });
});
