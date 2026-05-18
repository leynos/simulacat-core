/** @file GitHub pull request fixture schema and canonical pull request keys. */
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Baseline schema transform predates the new complexity gate.
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
 * owner and repo, and `url`, `html_url`, and `issue_url` are synthesized from
 * owner, repo, and number when omitted.
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
    // nosemgrep: simulacat.ts.cyclomatic-complexity - Baseline schema transform predates the heuristic rule.
    const key = pullRequestStoreKey(pullRequest);
    if (pullRequest.issue_number !== undefined && pullRequest.issue_number !== pullRequest.number) {
      throw new Error(
        `Pull request issue_number ${pullRequest.issue_number} must match pull request number ${pullRequest.number}`
      );
    }
    const issueNumber = pullRequest.number;
    const closedAt =
      pullRequest.state === 'closed' || pullRequest.state === 'merged'
        ? (pullRequest.closed_at ?? pullRequest.updated_at)
        : null;
    const mergedAt = pullRequest.state === 'merged' ? (pullRequest.merged_at ?? pullRequest.updated_at) : null;

    return {
      ...pullRequest,
      id: pullRequest.id ?? ENTITY_ID_OFFSETS.PULL_REQUEST + pullRequest.number,
      node_id: pullRequest.node_id ?? Buffer.from(`PullRequest:${key}`).toString('base64'),
      issue_number: issueNumber,
      user: pullRequest.user ?? {login: 'octocat'},
      base: {
        owner: pullRequest.base.owner ?? pullRequest.owner,
        repo: pullRequest.base.repo ?? pullRequest.repo,
        ref: pullRequest.base.ref,
        sha: pullRequest.base.sha
      },
      head: {
        owner: pullRequest.head.owner ?? pullRequest.owner,
        repo: pullRequest.head.repo ?? pullRequest.repo,
        ref: pullRequest.head.ref,
        sha: pullRequest.head.sha
      },
      closed_at: closedAt,
      merged_at: mergedAt,
      url:
        pullRequest.url ??
        `https://api.github.com/repos/${pullRequest.owner}/${pullRequest.repo}/pulls/${pullRequest.number}`,
      html_url:
        pullRequest.html_url ??
        `https://github.com/${pullRequest.owner}/${pullRequest.repo}/pull/${pullRequest.number}`,
      issue_url:
        pullRequest.issue_url ??
        `https://api.github.com/repos/${pullRequest.owner}/${pullRequest.repo}/issues/${issueNumber}`
    };
  });

export type GitHubPullRequest = z.infer<typeof githubPullRequestSchema>;
