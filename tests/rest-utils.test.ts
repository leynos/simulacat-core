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
        url: 'http://localhost:3300/repos/lovely-org/awesome-repo/trees/tree-sha',
        truncated: false,
        tree: [
          expect.objectContaining({
            path: 'README.md',
            sha: 'abc123',
            url: 'http://localhost:3300/repos/lovely-org/awesome-repo/git/blobs/abc123'
          })
        ]
      })
    );
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
    expect(payload.repository.full_name).toBe('lovely-org/awesome-repo');
    expect(payload.repository.trees_url).toContain('/repos/lovely-org/awesome-repo/git/trees');
  });
});
