/** @file Small REST payload builders shared by the OpenAPI handlers. */
import type {GitHubBlob} from '../store/entities.ts';

/**
 * Converts a stored blob into GitHub's base64 content response shape.
 *
 * @example
 * ```ts
 * const payload = blobAsBase64({blob, host, owner, repo, ref: 'README.md'});
 * ```
 */
export const blobAsBase64 = ({
  blob,
  host,
  owner,
  repo,
  ref,
  kind = 'contents'
}: {
  blob: GitHubBlob;
  host: string;
  owner: string;
  repo: string;
  ref: string;
  kind?: 'contents' | 'git-blob';
}) => ({
  content: blob.encoding === 'base64' ? blob.content : Buffer.from(blob.content).toString('base64'),
  encoding: 'base64',
  url:
    kind === 'git-blob'
      ? `${host}/repos/${owner}/${repo}/git/blobs/${blob.sha ?? ref}`
      : `${host}/repos/${owner}/${repo}/contents/${ref}`,
  sha: blob.sha,
  size: blob.encoding === 'base64' ? Buffer.from(blob.content, 'base64').byteLength : Buffer.byteLength(blob.content),
  node_id: 'node_id'
});

/**
 * Builds a Git tree response from all blobs in a repository fixture.
 *
 * @example
 * ```ts
 * const tree = gitTrees({blobs, host, owner, repo, ref: 'tree-sha'});
 * ```
 */
export const gitTrees = ({
  blobs,
  host,
  owner,
  repo,
  ref
}: {
  blobs: GitHubBlob[];
  host: string;
  owner: string;
  repo: string;
  ref: string;
}) => {
  const tree = blobs.map((blob) => ({
    path: blob.path,
    mode: '100644',
    type: 'blob',
    size: blob.encoding === 'base64' ? Buffer.from(blob.content, 'base64').byteLength : Buffer.byteLength(blob.content),
    sha: blob.sha,
    // should be like /git/blobs/44b4fc6d56897b048c772eb4087f854f46256132,
    //  but just need to return a file with content in base64
    url: `${host}/repos/${blob.owner}/${blob.repo}/git/blobs/${blob.sha}`
  }));

  return {
    sha: ref,
    url: `${host}/repos/${owner}/${repo}/git/trees/${ref}`,
    tree,
    truncated: false
  };
};

/**
 * Returns a fixed successful combined-status payload for a commit reference.
 *
 * @example
 * ```ts
 * const status = commitStatusResponse({host, owner, repo, ref: 'abc123'});
 * ```
 */
export const commitStatusResponse = ({
  host,
  owner,
  repo,
  ref
}: {
  host: string;
  owner: string;
  repo: string;
  ref: string;
}) => {
  const statuses: never[] = [];

  return {
    state: 'success',
    statuses,
    sha: ref,
    total_count: statuses.length,
    repository: {
      id: 1296269,
      node_id: 'MDEwOlJlcG9zaXRvcnkxMjk2MjY5',
      name: repo,
      full_name: `${owner}/${repo}`,
      owner: {
        login: owner,
        id: 1,
        type: 'User',
        site_admin: false
      },
      private: false,
      description: 'This your first repo!',
      fork: false,
      trees_url: `${host}/repos/${owner}/${repo}/git/trees{/sha}`,
      archive_url: `${host}/repos/${owner}/${repo}/{archive_format}{/ref}`
    }
  };
};
