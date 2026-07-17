/**
 * @file GitHub repository fixture schema and canonical repository keys.
 *
 * This module normalizes seeded repositories and exposes the canonical store
 * key used to keep owner/name pairs unique.
 */
import {faker} from '@faker-js/faker';
import {z} from 'zod';
import {githubEntityPermissionSchema} from './shared.ts';

let nextGeneratedRepositoryId = 3000;

const nextRepositoryId = () => nextGeneratedRepositoryId++;

type RepositoryKeyInput = {
  owner: string;
  name: string;
};

/**
 * Derives the canonical store key for a GitHub repository.
 *
 * @param repository Repository coordinate parts containing owner and name.
 * @returns The canonical key in `owner/name` format.
 */
export const repositoryStoreKey = (repository: RepositoryKeyInput) => `${repository.owner}/${repository.name}`;

export const resetNextRepositoryId = (newValue = 3000) => {
  nextGeneratedRepositoryId = newValue;
};

/**
 * Validates and normalizes a minimal GitHub repository fixture, filling in
 * the wide set of GitHub REST URLs, counters, and security settings that
 * callers omit. During transformation, `id` and `node_id` are generated when
 * absent, and `full_name` is derived from `owner`/`name`.
 *
 * @internal
 */
export const githubRepositorySchema = z
  .object({
    /** Unique numeric identifier for the repository across the whole simulated instance. */
    id: z.number().optional(),
    /** The GraphQL global node identifier for the repository. */
    node_id: z.string().optional(),
    /** Repository name, without the owner prefix. */
    name: z.string(),
    /** Short description of the repository shown in listings. */
    description: z.string().optional().default('Generic repository description'),
    /** Login of the account that owns the repository. */
    owner: z.string(),
    /** Fully qualified `owner/name` identifier, derived automatically if omitted. */
    full_name: z.string().optional().default(''),
    /** Names of packages published from the repository. */
    packages: z.array(z.string()).optional(),

    /** ISO 8601 timestamp recording when the repository was last pushed to. */
    pushed_at: z
      .string()
      .optional()
      .default(() => faker.date.recent().toISOString()),
    /** ISO 8601 timestamp recording when the repository was last updated. */
    updated_at: z
      .string()
      .optional()
      .default(() => faker.date.recent().toISOString()),
    /** ISO 8601 timestamp recording when the repository was created. */
    created_at: z
      .string()
      .optional()
      .default(() => faker.date.recent().toISOString()),

    /** REST API URL for the repository. */
    url: z.string().optional(),
    /** Web URL for viewing the repository. */
    html_url: z.string().optional(),
    /** Templated URL for retrieving repository archives in a given format. */
    archive_url: z.string().optional(),
    /** Templated URL for listing users that can be assigned issues in the repository. */
    assignees_url: z.string().optional(),
    /** Templated URL for retrieving Git blob objects by SHA. */
    blobs_url: z.string().optional(),
    /** Templated URL for retrieving repository branches. */
    branches_url: z.string().optional(),
    /** Templated URL for listing repository collaborators. */
    collaborators_url: z.string().optional(),
    /** Templated URL for retrieving issue and pull request comments. */
    comments_url: z.string().optional(),
    /** Templated URL for retrieving commits by SHA. */
    commits_url: z.string().optional(),
    /** Templated URL for comparing two commit ranges. */
    compare_url: z.string().optional(),
    /** Templated URL for retrieving repository file contents. */
    contents_url: z.string().optional(),
    /** URL for listing repository contributors. */
    contributors_url: z.string().optional(),
    /** URL for listing repository deployments. */
    deployments_url: z.string().optional(),
    /** URL for listing repository downloads. */
    downloads_url: z.string().optional(),
    /** URL for retrieving repository events. */
    events_url: z.string().optional(),
    /** URL for listing repository forks. */
    forks_url: z.string().optional(),
    /** Templated URL for retrieving Git commit objects by SHA. */
    git_commits_url: z.string().optional(),
    /** Templated URL for retrieving Git ref objects. */
    git_refs_url: z.string().optional(),
    /** Templated URL for retrieving Git tag objects by SHA. */
    git_tags_url: z.string().optional(),
    /** Git protocol URL for cloning the repository. */
    git_url: z.string().optional(),
    /** Templated URL for retrieving a single issue comment. */
    issue_comment_url: z.string().optional(),
    /** Templated URL for retrieving issue events. */
    issue_events_url: z.string().optional(),
    /** Templated URL for retrieving repository issues. */
    issues_url: z.string().optional(),
    /** Templated URL for retrieving deploy keys. */
    keys_url: z.string().optional(),
    /** Templated URL for retrieving repository labels. */
    labels_url: z.string().optional(),
    /** URL for retrieving the repository's language breakdown. */
    languages_url: z.string().optional(),
    /** Templated URL for merging branches. */
    merges_url: z.string().optional(),
    /** Templated URL for retrieving repository milestones. */
    milestones_url: z.string().optional(),
    /** Templated URL for retrieving repository notifications. */
    notifications_url: z.string().optional(),
    /** Templated URL for retrieving repository pull requests. */
    pulls_url: z.string().optional(),
    /** Templated URL for retrieving repository releases. */
    releases_url: z.string().optional(),
    /** SSH URL for cloning the repository. */
    ssh_url: z.string().optional(),
    /** URL for listing repository stargazers. */
    stargazers_url: z.string().optional(),
    /** Templated URL for retrieving commit statuses. */
    statuses_url: z.string().optional(),
    /** URL for listing repository subscribers. */
    subscribers_url: z.string().optional(),
    /** URL for the current user's subscription to the repository. */
    subscription_url: z.string().optional(),
    /** URL for listing repository tags. */
    tags_url: z.string().optional(),
    /** URL for listing teams with access to the repository. */
    teams_url: z.string().optional(),
    /** Templated URL for retrieving Git tree objects by SHA. */
    trees_url: z.string().optional(),
    /** HTTPS URL for cloning the repository. */
    clone_url: z.string().optional(),
    /** URL of the upstream repository this repository mirrors, or `null` if it is not a mirror. */
    mirror_url: z.string().nullable().optional(),
    /** URL for managing repository webhooks. */
    hooks_url: z.string().optional(),
    /** Legacy Subversion checkout URL, preserved for API parity. */
    svn_url: z.string().optional(),

    /** Repository homepage URL, or `null` if none is set. */
    homepage: z.string().nullable().optional(),
    /** Primary programming language detected in the repository, or `null` if unknown. */
    language: z.nullable(z.string()).optional().default(null),
    /** Name of the repository's default branch. */
    default_branch: z.string().optional().default('main'),
    /** Repository visibility, either `public` or `private`. */
    visibility: z.enum(['public', 'private']).default('public'),
    /** Whether the repository is private. */
    private: z.boolean().optional().default(false),
    /** SPDX licence details for the repository, or `null` if unlicensed. */
    license: z.nullable(z.record(z.string(), z.string())).default(null),
    /** Whether the repository is a fork of another repository. */
    fork: z.boolean().optional().default(false),
    /** Topic tags associated with the repository. */
    topics: z.array(z.string()).optional().default([]),

    /** Whether the repository is used as a template for creating new repositories. */
    is_template: z.boolean().optional().default(false),
    /** Whether the issues feature is enabled for the repository. */
    has_issues: z.boolean().optional().default(true),
    /** Whether the projects feature is enabled for the repository. */
    has_projects: z.boolean().optional().default(true),
    /** Whether the wiki feature is enabled for the repository. */
    has_wiki: z.boolean().optional().default(true),
    /** Whether GitHub Pages is enabled for the repository. */
    has_pages: z.boolean().optional().default(false),
    /** Whether the downloads feature is enabled for the repository. */
    has_downloads: z.boolean().optional().default(true),
    /** Whether the discussions feature is enabled for the repository. */
    has_discussions: z.boolean().optional().default(false),
    /** Whether the repository has been archived (read-only). */
    archived: z.boolean().optional().default(false),
    /** Whether the repository has been disabled. */
    disabled: z.boolean().optional().default(false),

    /** Number of forks of the repository. */
    forks_count: z.number().optional().default(9001),
    /** Number of forks of the repository, mirroring `forks_count` for API parity. */
    forks: z.number().optional().default(9001),
    /** Number of stargazers for the repository. */
    stargazers_count: z.number().optional().default(9001),
    /** Number of stargazers for the repository, mirroring `stargazers_count` for API parity. */
    stargazers: z.number().optional().default(9001),
    /** Number of watchers for the repository. */
    watchers_count: z.number().optional().default(9001),
    /** Number of watchers for the repository, mirroring `watchers_count` for API parity. */
    watchers: z.number().optional().default(9001),
    /** Size of the repository, in kilobytes. */
    size: z.number().optional().default(9001),
    /** Number of open issues and pull requests in the repository. */
    open_issues_count: z.number().optional().default(9001),
    /** Number of open issues and pull requests, mirroring `open_issues_count` for API parity. */
    open_issues: z.number().optional().default(9001),

    /** Collaborator access levels for the authenticated actor on the repository. */
    permissions: githubEntityPermissionSchema,
    /** Status of GitHub Advanced Security features for the repository. */
    security_and_analysis: z
      .object({
        /** Advanced Security enablement state for the repository. */
        advanced_security: z
          .object({
            /** Whether Advanced Security is `enabled` or `disabled`. */
            status: z.string()
          })
          .optional()
          .default({status: 'enabled'}),
        /** Secret scanning enablement state for the repository. */
        secret_scanning: z
          .object({
            /** Whether secret scanning is `enabled` or `disabled`. */
            status: z.string()
          })
          .optional()
          .default({status: 'enabled'}),
        /** Secret scanning push protection enablement state for the repository. */
        secret_scanning_push_protection: z
          .object({
            /** Whether secret scanning push protection is `enabled` or `disabled`. */
            status: z.string()
          })
          .optional()
          .default({status: 'enabled'}),
        /** Secret scanning non-provider pattern detection enablement state for the repository. */
        secret_scanning_non_provider_patterns: z
          .object({
            /** Whether non-provider pattern secret scanning is `enabled` or `disabled`. */
            status: z.string()
          })
          .optional()
          .default({status: 'enabled'})
      })
      .optional()
      .default({
        advanced_security: {
          status: 'enabled'
        },
        secret_scanning: {
          status: 'enabled'
        },
        secret_scanning_push_protection: {
          status: 'disabled'
        },
        secret_scanning_non_provider_patterns: {
          status: 'disabled'
        }
      })
  })
  .transform((repo) => {
    const id = repo.id ?? nextRepositoryId();
    const full_name = `${repo.owner}/${repo.name}`;

    return {
      ...repo,
      id,
      node_id:
        repo.node_id ??
        Buffer.from(`Repository:${repositoryStoreKey({owner: repo.owner, name: repo.name})}`).toString('base64'),
      full_name,
      topics: repo.topics.length === 0 ? ['octocat', 'boilerplate', 'tauri', 'api'] : repo.topics
    };
  });

export interface GitHubRepository extends z.infer<typeof githubRepositorySchema> {}
