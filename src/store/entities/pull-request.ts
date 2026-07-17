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
 *
 * @internal
 */
export const githubPullRequestSchema = z
  .object({
    /** Login of the account that owns the repository the pull request belongs to. */
    owner: z.string().trim().min(1),
    /** Name of the repository the pull request belongs to. */
    repo: z.string().trim().min(1),
    /** Unique numeric identifier for the pull request across the whole simulated instance. */
    id: z.number().optional(),
    /** The GraphQL global node identifier for the pull request. */
    node_id: z.string().optional(),
    /** Pull request number, unique within the owning repository. */
    number: z.number().int().positive(),
    /** Issue number backing this pull request; must match `number` when provided. */
    issue_number: z.number().int().positive().optional(),
    /** Current lifecycle state of the pull request. */
    state: pullRequestStateSchema.optional().default('open'),
    /** Pull request title. */
    title: z.string().trim().min(1),
    /** Pull request body text, in Markdown. */
    body: z.string().optional().default(''),
    /** Whether the pull request is still a draft. */
    draft: z.boolean().optional().default(false),
    user: z
      .object({
        /** Username of the account that opened the pull request. */
        login: z.string().trim().min(1)
      })
      .optional(),
    /** Branch the pull request targets. */
    base: pullRequestRefSchema,
    /** Branch containing the proposed changes. */
    head: pullRequestRefSchema,
    /** ISO 8601 timestamp recording when the pull request was created. */
    created_at: z.string().optional().default(defaultTimestamp),
    /** ISO 8601 timestamp recording when the pull request was last updated. */
    updated_at: z.string().optional().default(defaultTimestamp),
    /** ISO 8601 timestamp recording when the pull request was closed, or `null` while open. */
    closed_at: z.string().nullable().optional(),
    /** ISO 8601 timestamp recording when the pull request was merged, or `null` if unmerged. */
    merged_at: z.string().nullable().optional(),
    /** Whether the pull request can be merged without conflicts, or `null` if unknown. */
    mergeable: z.boolean().nullable().optional().default(null),
    /** REST API URL for the pull request. */
    url: z.string().optional(),
    /** Web URL for viewing the pull request. */
    html_url: z.string().optional(),
    /** REST API URL for the pull request's associated issue. */
    issue_url: z.string().optional()
  })
  .transform((pullRequest) => {
    const key = pullRequestStoreKey(pullRequest);
    assertMatchingIssueNumber(pullRequest);
    const issueNumber = pullRequest.number;

    return {
      ...pullRequest,
      /** Unique numeric identifier, offset from the pull request number when omitted. */
      id: pullRequest.id ?? ENTITY_ID_OFFSETS.PULL_REQUEST + pullRequest.number,
      /** The GraphQL global node identifier, derived from the store key when omitted. */
      node_id: pullRequest.node_id ?? Buffer.from(`PullRequest:${key}`).toString('base64'),
      /** Number of the issue that mirrors this pull request; always equals `number`. */
      issue_number: issueNumber,
      /** Author of the pull request, defaulting to the `octocat` fixture account. */
      user: pullRequest.user ?? {login: 'octocat'},
      /** Base (target) branch reference, normalized to the owning repository. */
      base: normalizePullRequestRef(pullRequest.base, pullRequest.owner, pullRequest.repo),
      /** Head (source) branch reference, normalized to the owning repository. */
      head: normalizePullRequestRef(pullRequest.head, pullRequest.owner, pullRequest.repo),
      /** Close timestamp derived from the pull request state; null while open. */
      closed_at: deriveClosedAt(pullRequest),
      /** Merge timestamp derived from the pull request state; null unless merged. */
      merged_at: deriveMergedAt(pullRequest)
    };
  });

/** The normalized shape of a GitHub pull request fixture produced by `githubPullRequestSchema`. */
export interface GitHubPullRequest extends z.infer<typeof githubPullRequestSchema> {}
