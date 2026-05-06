/** @file Unit tests for canonical store key helpers. */
import {describe, expect, it} from 'bun:test';
import {blobStoreKey, branchStoreKey, repositoryStoreKey} from '../src/store/entities.ts';

describe('canonical store keys', () => {
  it('keys repositories by owner and name', () => {
    expect(repositoryStoreKey({owner: 'acme', name: 'awesome-repo'})).toBe('acme/awesome-repo');
    expect(repositoryStoreKey({owner: 'globex', name: 'awesome-repo'})).toBe('globex/awesome-repo');
  });

  it('keys branches by owner, repository, and branch name', () => {
    expect(branchStoreKey({owner: 'acme', repo: 'awesome-repo', name: 'main'})).toBe('acme/awesome-repo:main');
    expect(branchStoreKey({owner: 'globex', repo: 'awesome-repo', name: 'main'})).toBe('globex/awesome-repo:main');
  });

  it('keys blobs by owner, repository, and path or sha', () => {
    expect(
      blobStoreKey({owner: 'acme', repo: 'awesome-repo', path: 'README.md', content: '', encoding: 'string'})
    ).toBe('acme/awesome-repo:README.md');
    expect(blobStoreKey({owner: 'globex', repo: 'awesome-repo', sha: 'abc123', content: '', encoding: 'string'})).toBe(
      'globex/awesome-repo:abc123'
    );
  });
});
