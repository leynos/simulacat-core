/** @file Unit tests for canonical store key helpers. */
import {describe, expect, it} from 'bun:test';
import fc from 'fast-check';
import {
  buildBranchFixture,
  buildCommitFixture,
  buildIssueFixture,
  buildPullRequestFixture,
  buildRefFixture,
  buildRepositoryFixture,
  blobStoreKey,
  branchStoreKey,
  commitStoreKey,
  issueStoreKey,
  parseBlobStoreKey,
  parseBranchStoreKey,
  parseCommitStoreKey,
  parseIssueStoreKey,
  parsePullRequestStoreKey,
  parseRefStoreKey,
  pullRequestStoreKey,
  refStoreKey,
  parseRepositoryStoreKey,
  repositoryNodeId,
  repositoryStoreKey
} from '../src/index.ts';

// The canonical key grammar uses `/` and `:` as structural separators.
// Owner and repository segments must exclude both; terminal segments (branch
// name, blob reference) exclude only `:` and may contain `/`.
const keySegment = fc.string({minLength: 1}).filter((value) => !value.includes('/') && !value.includes(':'));
const numberedKeySegment = keySegment.filter((value) => !value.includes('#') && !value.includes('!'));

// Terminal segments (branch name, blob reference) may contain '/' but not ':'.
const refSegment = fc.string({minLength: 1}).filter((value) => !value.includes(':'));

const repositoryParts = fc.record({
  owner: keySegment,
  name: keySegment
});

const branchParts = fc.record({
  owner: keySegment,
  repo: keySegment,
  name: refSegment
});

const blobParts = fc.record({
  owner: keySegment,
  repo: keySegment,
  reference: refSegment
});

const numberedParts = fc.record({
  owner: numberedKeySegment,
  repo: numberedKeySegment,
  number: fc.integer({min: 1, max: 10_000})
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

  it('throws when blobStoreKey is given neither path nor sha', () => {
    expect(() => blobStoreKey({owner: 'acme', repo: 'awesome-repo'} as any)).toThrow();
  });

  it('throws when parseBranchStoreKey receives a key with no colon separator', () => {
    expect(() => parseBranchStoreKey('acme/awesome-repo')).toThrow(
      'Malformed branch store key "acme/awesome-repo"; expected "owner/repo:name"'
    );
  });

  it('throws when parseBranchStoreKey receives a key with an empty name segment', () => {
    expect(() => parseBranchStoreKey('acme/awesome-repo:')).toThrow(
      'Malformed branch store key "acme/awesome-repo:"; expected "owner/repo:name"'
    );
  });

  it('throws when parseBranchStoreKey receives a key with a malformed owner/repo prefix', () => {
    expect(() => parseBranchStoreKey('acme:main')).toThrow(
      'Malformed branch store key "acme:main"; expected "owner/repo:name"'
    );
  });

  it('throws when parseBlobStoreKey receives a key with no colon separator', () => {
    expect(() => parseBlobStoreKey('acme/awesome-repo')).toThrow(
      'Malformed blob store key "acme/awesome-repo"; expected "owner/repo:reference"'
    );
  });

  it('throws when parseBlobStoreKey receives a key with an empty reference segment', () => {
    expect(() => parseBlobStoreKey('acme/awesome-repo:')).toThrow(
      'Malformed blob store key "acme/awesome-repo:"; expected "owner/repo:reference"'
    );
  });

  it('throws when parseBlobStoreKey receives a key with a malformed owner/repo prefix', () => {
    expect(() => parseBlobStoreKey('acme:README.md')).toThrow(
      'Malformed blob store key "acme:README.md"; expected "owner/repo:reference"'
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

  it('round-trips ref and commit keys through their parsers', () => {
    fc.assert(
      fc.property(blobParts, (parts) => {
        expect(parseRefStoreKey(refStoreKey({...parts, qualifiedName: parts.reference}))).toEqual({
          owner: parts.owner,
          repo: parts.repo,
          qualifiedName: parts.reference
        });
        expect(parseCommitStoreKey(commitStoreKey({...parts, sha: parts.reference}))).toEqual({
          owner: parts.owner,
          repo: parts.repo,
          sha: parts.reference
        });
      })
    );
  });

  it('round-trips issue and pull request keys through their parsers', () => {
    fc.assert(
      fc.property(numberedParts, (parts) => {
        expect(parseIssueStoreKey(issueStoreKey(parts))).toEqual(parts);
        expect(parsePullRequestStoreKey(pullRequestStoreKey(parts))).toEqual(parts);
      })
    );
  });

  it('keeps new entity keys scoped to the owner and repository', () => {
    expect(refStoreKey({owner: 'acme', repo: 'same', qualifiedName: 'main'})).not.toBe(
      refStoreKey({owner: 'globex', repo: 'same', qualifiedName: 'main'})
    );
    expect(issueStoreKey({owner: 'acme', repo: 'same', number: 1})).not.toBe(
      issueStoreKey({owner: 'globex', repo: 'same', number: 1})
    );
    expect(pullRequestStoreKey({owner: 'acme', repo: 'same', number: 1})).not.toBe(
      pullRequestStoreKey({owner: 'globex', repo: 'same', number: 1})
    );
  });

  it('derives decodable repository node ids with the Repository prefix', () => {
    fc.assert(
      fc.property(repositoryParts, (parts) => {
        const nodeId = repositoryNodeId(parts);
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

  it('throws when buildRepositoryFixture receives invalid input', () => {
    expect(() => buildRepositoryFixture({} as any)).toThrow();
  });

  it('builds parsed branch fixtures through the public builder', () => {
    const branch = buildBranchFixture({owner: 'acme', repo: 'awesome-repo', name: 'main'});

    expect(branchStoreKey(branch)).toBe('acme/awesome-repo:main');
    expect(branch.commit.sha).toBeString();
  });

  it('throws when buildBranchFixture receives invalid input', () => {
    expect(() => buildBranchFixture({} as any)).toThrow();
  });

  it('builds parsed early entity fixtures through public builders', () => {
    const commit = buildCommitFixture({owner: 'acme', repo: 'awesome-repo', sha: 'abc123'});
    const ref = buildRefFixture({
      owner: 'acme',
      repo: 'awesome-repo',
      qualifiedName: 'main',
      object: {sha: 'abc123'}
    });
    const issue = buildIssueFixture({owner: 'acme', repo: 'awesome-repo', number: 7, title: 'Fix identity'});
    const pullRequest = buildPullRequestFixture({
      owner: 'acme',
      repo: 'awesome-repo',
      number: 8,
      title: 'Wire identities',
      base: {ref: 'main', sha: 'abc123'},
      head: {ref: 'feature', sha: 'def456'}
    });

    expect(commitStoreKey(commit)).toBe('acme/awesome-repo:abc123');
    expect(refStoreKey(ref)).toBe('acme/awesome-repo:main');
    expect(issueStoreKey(issue)).toBe('acme/awesome-repo#7');
    expect(pullRequestStoreKey(pullRequest)).toBe('acme/awesome-repo!8');
    expect(pullRequest.issue_number).toBe(8);
  });
});
