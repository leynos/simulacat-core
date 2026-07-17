/** @file GitHub issue fixture schema and canonical issue keys. */
import {z} from 'zod';
import {ENTITY_ID_OFFSETS} from '../entity-id-offsets.ts';
import {defaultTimestamp} from './defaults.ts';

const issueStateSchema = z.enum(['open', 'closed']);

type IssueStoreKeyInput = {
  owner: string;
  repo: string;
  number: number;
};

/**
 * Derives the canonical store key for a GitHub issue.
 *
 * @param issue Issue coordinate parts containing owner, repo, and number.
 * @returns The canonical key in `owner/repo#number` format.
 */
export const issueStoreKey = (issue: IssueStoreKeyInput): string => `${issue.owner}/${issue.repo}#${issue.number}`;

const issuePullRequestLinkSchema = z.object({
  /** URL for retrieving the pull request's diff. */
  diff_url: z.string().url().optional(),
  /** Web URL for viewing the pull request. */
  html_url: z.string().url().optional(),
  /** URL for retrieving the pull request's patch file. */
  patch_url: z.string().url().optional(),
  /** REST API URL for the pull request. */
  url: z.string().url().optional()
});

/**
 * Validates and normalizes a minimal GitHub issue fixture.
 *
 * `githubIssueSchema` requires `owner`, `repo`, `number`, and `title`.
 * Optional fields include provider IDs, state, body, actor, timestamps, URLs,
 * and `pull_request`, whose `issuePullRequestLinkSchema` marks issues that are
 * linked to pull requests. Defaults are `state: 'open'`, `body: ''`,
 * `user: {login: 'octocat'}`, and `created_at` / `updated_at` from
 * `defaultTimestamp`. During transformation, missing IDs use
 * `ENTITY_ID_OFFSETS.ISSUE + number`, `node_id` is Base64 of
 * `Issue:${issueStoreKey(issue)}`, and `closed_at` becomes the supplied value
 * or `updated_at` for closed issues and `null` otherwise.
 *
 * @returns The normalized `GitHubIssue` shape used by the store and adapters.
 *
 * @internal
 */
export const githubIssueSchema = z
  .object({
    /** Login of the account that owns the repository the issue belongs to. */
    owner: z.string().trim().min(1),
    /** Name of the repository the issue belongs to. */
    repo: z.string().trim().min(1),
    /** Unique numeric identifier for the issue across the whole simulated instance. */
    id: z.number().optional(),
    /** The GraphQL global node identifier for the issue. */
    node_id: z.string().optional(),
    /** Issue number, unique within the owning repository. */
    number: z.number().int().positive(),
    /** Current lifecycle state of the issue. */
    state: issueStateSchema.optional().default('open'),
    /** Issue title. */
    title: z.string().trim().min(1),
    /** Issue body text, in Markdown. */
    body: z.string().optional().default(''),
    user: z
      .object({
        /** Username of the account that opened the issue. */
        login: z.string().trim().min(1)
      })
      .optional(),
    /** Pull request cross-reference, present only when the issue represents a pull request. */
    pull_request: issuePullRequestLinkSchema.optional(),
    /** ISO 8601 timestamp recording when the issue was created. */
    created_at: z.string().optional().default(defaultTimestamp),
    /** ISO 8601 timestamp recording when the issue was last updated. */
    updated_at: z.string().optional().default(defaultTimestamp),
    /** ISO 8601 timestamp recording when the issue was closed, or `null` while open. */
    closed_at: z.string().nullable().optional(),
    /** REST API URL for the issue. */
    url: z.string().optional(),
    /** Web URL for viewing the issue. */
    html_url: z.string().optional(),
    /** REST API URL for the repository the issue belongs to. */
    repository_url: z.string().optional()
  })
  .transform((issue) => {
    const key = issueStoreKey(issue);

    return {
      ...issue,
      /** Unique numeric identifier, offset from the issue number when omitted. */
      id: issue.id ?? ENTITY_ID_OFFSETS.ISSUE + issue.number,
      /** The GraphQL global node identifier, derived from the store key when omitted. */
      node_id: issue.node_id ?? Buffer.from(`Issue:${key}`).toString('base64'),
      /** Author of the issue, defaulting to the `octocat` fixture account. */
      user: issue.user ?? {login: 'octocat'},
      /** Close timestamp; populated only for closed issues, falling back to `updated_at`. */
      closed_at: issue.state === 'closed' ? (issue.closed_at ?? issue.updated_at) : null
    };
  });

/** The normalized shape of a GitHub issue fixture produced by `githubIssueSchema`. */
export interface GitHubIssue extends z.infer<typeof githubIssueSchema> {}
