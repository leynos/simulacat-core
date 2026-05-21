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
  diff_url: z.string().url().optional(),
  html_url: z.string().url().optional(),
  patch_url: z.string().url().optional(),
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
 * `Issue:${issueStoreKey(issue)}`, `closed_at` becomes the supplied value or
 * `updated_at` for closed issues and `null` otherwise, and `url`, `html_url`,
 * and `repository_url` are synthesized from owner, repo, and issue number.
 *
 * @returns The normalized `GitHubIssue` shape used by the store and adapters.
 */
export const githubIssueSchema = z
  .object({
    owner: z.string().trim().min(1),
    repo: z.string().trim().min(1),
    id: z.number().optional(),
    node_id: z.string().optional(),
    number: z.number().int().positive(),
    state: issueStateSchema.optional().default('open'),
    title: z.string().trim().min(1),
    body: z.string().optional().default(''),
    user: z
      .object({
        login: z.string().trim().min(1)
      })
      .optional(),
    pull_request: issuePullRequestLinkSchema.optional(),
    created_at: z.string().optional().default(defaultTimestamp),
    updated_at: z.string().optional().default(defaultTimestamp),
    closed_at: z.string().nullable().optional(),
    url: z.string().optional(),
    html_url: z.string().optional(),
    repository_url: z.string().optional()
  })
  // Legacy schema transform keeps GitHub URL defaults colocated with validation.
  // oxlint-disable-next-line complexity
  .transform((issue) => {
    const key = issueStoreKey(issue);

    return {
      ...issue,
      id: issue.id ?? ENTITY_ID_OFFSETS.ISSUE + issue.number,
      node_id: issue.node_id ?? Buffer.from(`Issue:${key}`).toString('base64'),
      user: issue.user ?? {login: 'octocat'},
      closed_at: issue.state === 'closed' ? (issue.closed_at ?? issue.updated_at) : null,
      url: issue.url ?? `https://api.github.com/repos/${issue.owner}/${issue.repo}/issues/${issue.number}`,
      html_url: issue.html_url ?? `https://github.com/${issue.owner}/${issue.repo}/issues/${issue.number}`,
      repository_url: issue.repository_url ?? `https://api.github.com/repos/${issue.owner}/${issue.repo}`
    };
  });

export type GitHubIssue = z.infer<typeof githubIssueSchema>;
