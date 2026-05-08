/** @file Unit tests for canonical store key helpers. */
import {describe, expect, it} from 'bun:test';
import fc from 'fast-check';
import {
  buildBranchFixture,
  buildRepositoryFixture,
  blobStoreKey,
  branchStoreKey,
  parseBlobStoreKey,
  parseBranchStoreKey,
  parseRepositoryStoreKey,
  repositoryNodeId,
  repositoryStoreKey
} from '../src/index.ts';

// The canonical key grammar uses `/` and `:` as separators, so property tests
// generate non-empty segments that exclude both delimiters.
const keySegment = fc.string({minLength: 1}).filter((value) => !value.includes('/') && !value.includes(':'));

const repositoryParts = fc.record({
  owner: keySegment,
  name: keySegment
});

const branchParts = fc.record({
  owner: keySegment,
  repo: keySegment,
  name: keySegment
});

const blobParts = fc.record({
  owner: keySegment,
  repo: keySegment,
  reference: keySegment
});

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
    expect(blobStoreKey({owner: 'acme', repo: 'awesome-repo', path: 'README.md'})).toBe('acme/awesome-repo:README.md');
    expect(blobStoreKey({owner: 'globex', repo: 'awesome-repo', sha: 'abc123'})).toBe('globex/awesome-repo:abc123');
  });

  it('round-trips repository keys through the parser', () => {
    fc.assert(
      fc.property(repositoryParts, (parts) => {
        expect(parseRepositoryStoreKey(repositoryStoreKey(parts))).toEqual(parts);
      })
    );
  });

  it('rejects repository keys with extra path separators', () => {
    expect(() => parseRepositoryStoreKey('acme/awesome/repo')).toThrow(
      'Malformed repository store key "acme/awesome/repo"; expected "owner/name"'
    );
  });

  it('keeps distinct repository coordinates distinct', () => {
    fc.assert(
      fc.property(repositoryParts, repositoryParts, (first, second) => {
        fc.pre(first.owner !== second.owner || first.name !== second.name);
        expect(repositoryStoreKey(first)).not.toBe(repositoryStoreKey(second));
      })
    );
  });

  it('round-trips branch keys through the parser', () => {
    fc.assert(
      fc.property(branchParts, (parts) => {
        expect(parseBranchStoreKey(branchStoreKey(parts))).toEqual(parts);
      })
    );
  });

  it('parses branch names that contain path separators', () => {
    expect(parseBranchStoreKey('acme/awesome-repo:feature/canonical-ids')).toEqual({
      owner: 'acme',
      repo: 'awesome-repo',
      name: 'feature/canonical-ids'
    });
  });

  it('keeps distinct branch coordinates distinct', () => {
    fc.assert(
      fc.property(branchParts, branchParts, (first, second) => {
        fc.pre(first.owner !== second.owner || first.repo !== second.repo || first.name !== second.name);
        expect(branchStoreKey(first)).not.toBe(branchStoreKey(second));
      })
    );
  });

  it('round-trips blob keys through the parser', () => {
    fc.assert(
      fc.property(blobParts, (parts) => {
        const key = blobStoreKey({...parts, path: parts.reference});
        expect(parseBlobStoreKey(key)).toEqual(parts);
      })
    );
  });

  it('parses blob references that contain path separators', () => {
    expect(parseBlobStoreKey('acme/awesome-repo:docs/reference/README.md')).toEqual({
      owner: 'acme',
      repo: 'awesome-repo',
      reference: 'docs/reference/README.md'
    });
  });

  it('keeps distinct blob coordinates distinct', () => {
    fc.assert(
      fc.property(blobParts, blobParts, (first, second) => {
        fc.pre(first.owner !== second.owner || first.repo !== second.repo || first.reference !== second.reference);
        expect(blobStoreKey({...first, path: first.reference})).not.toBe(
          blobStoreKey({...second, path: second.reference})
        );
      })
    );
  });

  it('derives decodable repository node ids with the Repository prefix', () => {
    fc.assert(
      fc.property(repositoryParts, (parts) => {
        const nodeId = repositoryNodeId(parts.owner, parts.name);
        expect(nodeId.length).toBeGreaterThan(0);
        expect(Buffer.from(nodeId, 'base64').toString('utf8')).toBe(`Repository:${repositoryStoreKey(parts)}`);
      })
    );
  });

  it('builds parsed repository fixtures through the public builder', () => {
    const repository = buildRepositoryFixture({owner: 'acme', name: 'awesome-repo'});

    expect(repository.full_name).toBe('acme/awesome-repo');
    expect(Buffer.from(repository.node_id, 'base64').toString('utf8')).toBe('Repository:acme/awesome-repo');
  });

  it('builds parsed branch fixtures through the public builder', () => {
    const branch = buildBranchFixture({owner: 'acme', repo: 'awesome-repo', name: 'main'});

    expect(branchStoreKey(branch)).toBe('acme/awesome-repo:main');
    expect(branch.commit.sha).toBeString();
  });
});
