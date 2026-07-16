/** @file GitHub pull request fixture schema and canonical pull request keys. */
import {z} from 'zod';
import {ENTITY_ID_OFFSETS} from '../entity-id-offsets.ts';
import {defaultTimestamp} from './defaults.ts';

const pullRequestStateSchema = z.enum(['open', 'closed', 'merged']);

type PullRequestStoreKeyInput = {
  owner: string;
  repo: string;
  number: number;
};

/**
 * Derives the canonical store key for a GitHub pull request.
 *
 * @param pullRequest Pull request coordinate parts containing owner, repo, and number.
 * @returns The canonical key in `owner/repo!number` format.
 */
export const pullRequestStoreKey = (pullRequest: PullRequestStoreKeyInput): string =>
  `${pullRequest.owner}/${pullRequest.repo}!${pullRequest.number}`;

const pullRequestRefSchema = z.object({
  owner: z.string().trim().min(1).optional(),
  repo: z.string().trim().min(1).optional(),
  ref: z.string().trim().min(1),
  sha: z.string().trim().min(1)
});

type PullRequestNumberInput = {
  issue_number?: number | undefined;
  number: number;
};

type PullRequestStateInput = {
  closed_at?: string | null | undefined;
  merged_at?: string | null | undefined;
  state: 'open' | 'closed' | 'merged';
  updated_at: string;
};

type PullRequestRefInput = {
  owner?: string | undefined;
  repo?: string | undefined;
  ref: string;
  sha: string;
};

type NormalizedPullRequestRef = {
  owner: string;
  repo: string;
  ref: string;
  sha: string;
};

/** Ensures the fixture does not describe one pull request as another issue. */
const assertMatchingIssueNumber = (pullRequest: PullRequestNumberInput): void => {
  if (pullRequest.issue_number !== undefined && pullRequest.issue_number !== pullRequest.number) {
    throw new Error(
      `Pull request issue_number ${pullRequest.issue_number} must match pull request number ${pullRequest.number}`
    );
  }
};

/** Returns the canonical closed timestamp stored for the pull request state. */
const deriveClosedAt = (pullRequest: PullRequestStateInput): string | null => {
  if (pullRequest.state !== 'closed' && pullRequest.state !== 'merged') {
    return null;
  }
  return pullRequest.closed_at ?? pullRequest.updated_at;
};

/** Returns the canonical merged timestamp stored for the pull request state. */
const deriveMergedAt = (pullRequest: PullRequestStateInput): string | null => {
  if (pullRequest.state !== 'merged') {
    return null;
  }
  return pullRequest.merged_at ?? pullRequest.updated_at;
};

/** Applies top-level repository coordinates to incomplete base/head refs. */
const normalizePullRequestRef = (ref: PullRequestRefInput, owner: string, repo: string): NormalizedPullRequestRef => ({
  owner: ref.owner ?? owner,
  repo: ref.repo ?? repo,
  ref: ref.ref,
  sha: ref.sha
});

/**
 * Validates and normalizes a minimal GitHub pull request fixture.
 *
 * `githubPullRequestSchema` requires `owner`, `repo`, `number`, `title`,
 * `base`, and `head`. Optional fields include provider IDs, issue linkage,
 * state, body, draft status, actor, timestamps, mergeability, and URLs.
 * Defaults are `state: 'open'`, `body: ''`, `draft: false`,
 * `user: {login: 'octocat'}`, and `created_at` / `updated_at` from shared
 * timestamp defaults. During transformation, missing IDs use
 * `ENTITY_ID_OFFSETS.PULL_REQUEST + number`, `node_id` is Base64 of
 * `PullRequest:${pullRequestStoreKey(...)}`, `issue_number` falls back to the
 * pull request number, `closed_at` and `merged_at` are computed from state with
 * `updated_at` fallback, base/head owner and repo fall back to the top-level
 * owner and repo.
 *
 * @returns The normalized `GitHubPullRequest` shape used by the store and
 * adapters.
 */
export const githubPullRequestSchema = z
  .object({
    owner: z.string().trim().min(1),
    repo: z.string().trim().min(1),
    id: z.number().optional(),
    node_id: z.string().optional(),
    number: z.number().int().positive(),
    issue_number: z.number().int().positive().optional(),
    state: pullRequestStateSchema.optional().default('open'),
    title: z.string().trim().min(1),
    body: z.string().optional().default(''),
    draft: z.boolean().optional().default(false),
    user: z
      .object({
        login: z.string().trim().min(1)
      })
      .optional(),
    base: pullRequestRefSchema,
    head: pullRequestRefSchema,
    created_at: z.string().optional().default(defaultTimestamp),
    updated_at: z.string().optional().default(defaultTimestamp),
    closed_at: z.string().nullable().optional(),
    merged_at: z.string().nullable().optional(),
    mergeable: z.boolean().nullable().optional().default(null),
    url: z.string().optional(),
    html_url: z.string().optional(),
    issue_url: z.string().optional()
  })
  .transform((pullRequest) => {
    const key = pullRequestStoreKey(pullRequest);
    assertMatchingIssueNumber(pullRequest);
    const issueNumber = pullRequest.number;

    return {
      ...pullRequest,
      id: pullRequest.id ?? ENTITY_ID_OFFSETS.PULL_REQUEST + pullRequest.number,
      node_id: pullRequest.node_id ?? Buffer.from(`PullRequest:${key}`).toString('base64'),
      issue_number: issueNumber,
      user: pullRequest.user ?? {login: 'octocat'},
      base: normalizePullRequestRef(pullRequest.base, pullRequest.owner, pullRequest.repo),
      head: normalizePullRequestRef(pullRequest.head, pullRequest.owner, pullRequest.repo),
      closed_at: deriveClosedAt(pullRequest),
      merged_at: deriveMergedAt(pullRequest)
    };
  });

export type GitHubPullRequest = z.infer<typeof githubPullRequestSchema>;
