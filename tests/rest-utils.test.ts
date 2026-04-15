/** @file Unit tests for REST helper payload builders used by OpenAPI handlers. */

import {describe, expect, it} from 'bun:test';
import {blobAsBase64, commitStatusResponse, gitTrees} from '../src/rest/utils.ts';

describe('blobAsBase64', () => {
  it('encodes string blobs as base64 content responses', () => {
    const payload = blobAsBase64({
      blob: {
        owner: 'lovely-org',
        repo: 'awesome-repo',
        path: 'README.md',
        sha: 'abc123',
        content: 'hello world',
        encoding: 'string'
      },
      host: 'http://localhost:3300',
      owner: 'lovely-org',
      repo: 'awesome-repo',
      ref: 'README.md'
    });

    expect(payload).toEqual(
      expect.objectContaining({
        content: Buffer.from('hello world').toString('base64'),
        encoding: 'base64',
        url: 'http://localhost:3300/repos/lovely-org/awesome-repo/contents/README.md'
      })
    );
  });

  it('preserves already-base64 content', () => {
    const payload = blobAsBase64({
      blob: {
        owner: 'lovely-org',
        repo: 'awesome-repo',
        path: 'README.md',
        sha: 'abc123',
        content: 'aGVsbG8=',
        encoding: 'base64'
      },
      host: 'http://localhost:3300',
      owner: 'lovely-org',
      repo: 'awesome-repo',
      ref: 'abc123'
    });

    expect(payload.content).toBe('aGVsbG8=');
    expect(payload.size).toBe(5);
  });

  it('uses git blob URLs when requested', () => {
    const payload = blobAsBase64({
      blob: {
        owner: 'lovely-org',
        repo: 'awesome-repo',
        path: 'README.md',
        sha: 'abc123',
        content: 'hello world',
        encoding: 'string'
      },
      host: 'http://localhost:3300',
      owner: 'lovely-org',
      repo: 'awesome-repo',
      ref: 'abc123',
      kind: 'git-blob'
    });

    expect(payload.url).toBe('http://localhost:3300/repos/lovely-org/awesome-repo/git/blobs/abc123');
    expect(payload.sha).toBe('abc123');
    expect(payload.size).toBe(11);
  });

  it('keeps sha undefined for content payloads without a stored blob sha', () => {
    const payload = blobAsBase64({
      blob: {
        owner: 'lovely-org',
        repo: 'awesome-repo',
        path: 'README.md',
        content: 'hello world',
        encoding: 'string'
      },
      host: 'http://localhost:3300',
      owner: 'lovely-org',
      repo: 'awesome-repo',
      ref: 'README.md'
    });

    expect(payload.sha).toBeUndefined();
    expect(payload.url).toBe('http://localhost:3300/repos/lovely-org/awesome-repo/contents/README.md');
  });
});

describe('gitTrees', () => {
  it('builds tree entries from repository blobs', () => {
    const payload = gitTrees({
      blobs: [
        {
          owner: 'lovely-org',
          repo: 'awesome-repo',
          path: 'README.md',
          sha: 'abc123',
          content: 'hello',
          encoding: 'string'
        }
      ],
      host: 'http://localhost:3300',
      owner: 'lovely-org',
      repo: 'awesome-repo',
      ref: 'tree-sha'
    });

    expect(payload).toEqual(
      expect.objectContaining({
        sha: 'tree-sha',
        url: 'http://localhost:3300/repos/lovely-org/awesome-repo/git/trees/tree-sha',
        truncated: false,
        tree: [
          expect.objectContaining({
            path: 'README.md',
            sha: 'README.md',
            url: 'http://localhost:3300/repos/lovely-org/awesome-repo/git/blobs/README.md'
          })
        ]
      })
    );
  });

  it('falls back to sha-only blobs when building git tree entries', () => {
    const payload = gitTrees({
      blobs: [
        {
          owner: 'lovely-org',
          repo: 'awesome-repo',
          sha: 'blob-sha',
          content: Buffer.from('tree content').toString('base64'),
          encoding: 'base64'
        }
      ],
      host: 'http://localhost:3300',
      owner: 'lovely-org',
      repo: 'awesome-repo',
      ref: 'tree-sha'
    });

    expect(payload.tree).toEqual([
      expect.objectContaining({
        path: 'blob-sha',
        sha: 'blob-sha',
        url: 'http://localhost:3300/repos/lovely-org/awesome-repo/git/blobs/blob-sha'
      })
    ]);
  });
});

describe('commitStatusResponse', () => {
  it('injects owner, repo, and ref into the combined status payload', () => {
    const payload = commitStatusResponse({
      host: 'http://localhost:3300',
      owner: 'lovely-org',
      repo: 'awesome-repo',
      ref: 'main'
    });

    expect(payload.sha).toBe('main');
    expect(payload.total_count).toBe(0);
    expect(payload.repository.full_name).toBe('lovely-org/awesome-repo');
    expect(payload.repository.trees_url).toContain('/repos/lovely-org/awesome-repo/git/trees');
  });
});
