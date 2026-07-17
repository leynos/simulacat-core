/** @file Tests for REST repository PATCH request parsing. */
import {describe, expect, it} from 'bun:test';
import {buildUpdateRepositoryCommand} from '../src/rest/repository-patch.ts';
import type {UpdateRepositoryCommand} from '../src/store/actions/repository.ts';

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
      for (const value of [null, [], 42, false, {}]) {
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
    const cases: Array<{body: unknown; changes: UpdateRepositoryCommand['changes']}> = [
      {
        body: {description: null, homepage: 'https://docs.example.test'},
        changes: {homepage: 'https://docs.example.test'}
      },
      {body: {description: 'Updated description', homepage: []}, changes: {description: 'Updated description'}},
      {
        body: {description: false, homepage: 'https://docs.example.test'},
        changes: {homepage: 'https://docs.example.test'}
      },
      {
        body: {description: 'Updated description', homepage: {invalid: true}},
        changes: {description: 'Updated description'}
      }
    ];

    for (const {body, changes} of cases) {
      expect(buildUpdateRepositoryCommand({owner: 'acme', name: 'awesome-repo', body})).toEqual({
        owner: 'acme',
        name: 'awesome-repo',
        changes
      });
    }
  });

  it('rejects malformed PATCH body shapes without changing repository coordinates', () => {
    for (const body of [null, [], 'not-an-object', 42, false]) {
      expect(buildUpdateRepositoryCommand({owner: 'acme', name: 'awesome-repo', body})).toEqual({
        owner: 'acme',
        name: 'awesome-repo',
        changes: {}
      });
    }
  });
});
