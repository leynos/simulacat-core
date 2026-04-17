/**
 * @file GitHub repository fixture schema and canonical repository keys.
 *
 * This module applies GitHub-like URL defaults to seeded repositories and
 * exposes the canonical store key used to keep owner/name pairs unique.
 */
import {faker} from '@faker-js/faker';
import {z} from 'zod';
import {githubEntityPermissionSchema} from './shared.ts';

let nextGeneratedRepositoryId = 3000;

const nextRepositoryId = () => nextGeneratedRepositoryId++;

export const resetNextRepositoryId = (newValue = 3000) => {
  nextGeneratedRepositoryId = newValue;
};

export const githubRepositorySchema = z
  .object({
    id: z.number().optional(),
    node_id: z.string().optional(),
    name: z.string(),
    description: z.string().optional().default('Generic repository description'),
    owner: z.string(),
    full_name: z.string().optional().default(''),
    packages: z.array(z.string()).optional(),

    pushed_at: z
      .string()
      .optional()
      .default(() => faker.date.recent().toISOString()),
    updated_at: z
      .string()
      .optional()
      .default(() => faker.date.recent().toISOString()),
    created_at: z
      .string()
      .optional()
      .default(() => faker.date.recent().toISOString()),

    url: z.string().optional(),
    html_url: z.string().optional(),
    archive_url: z.string().optional(),
    assignees_url: z.string().optional(),
    blobs_url: z.string().optional(),
    branches_url: z.string().optional(),
    collaborators_url: z.string().optional(),
    comments_url: z.string().optional(),
    commits_url: z.string().optional(),
    compare_url: z.string().optional(),
    contents_url: z.string().optional(),
    contributors_url: z.string().optional(),
    deployments_url: z.string().optional(),
    downloads_url: z.string().optional(),
    events_url: z.string().optional(),
    forks_url: z.string().optional(),
    git_commits_url: z.string().optional(),
    git_refs_url: z.string().optional(),
    git_tags_url: z.string().optional(),
    git_url: z.string().optional(),
    issue_comment_url: z.string().optional(),
    issue_events_url: z.string().optional(),
    issues_url: z.string().optional(),
    keys_url: z.string().optional(),
    labels_url: z.string().optional(),
    languages_url: z.string().optional(),
    merges_url: z.string().optional(),
    milestones_url: z.string().optional(),
    notifications_url: z.string().optional(),
    pulls_url: z.string().optional(),
    releases_url: z.string().optional(),
    ssh_url: z.string().optional(),
    stargazers_url: z.string().optional(),
    statuses_url: z.string().optional(),
    subscribers_url: z.string().optional(),
    subscription_url: z.string().optional(),
    tags_url: z.string().optional(),
    teams_url: z.string().optional(),
    trees_url: z.string().optional(),
    clone_url: z.string().optional(),
    mirror_url: z.string().optional(),
    hooks_url: z.string().optional(),
    svn_url: z.string().optional(),

    homepage: z.string().optional(),
    language: z.nullable(z.string()).optional().default(null),
    default_branch: z.string().optional().default('main'),
    visibility: z.enum(['public', 'private']).default('public'),
    private: z.boolean().optional().default(false),
    license: z.nullable(z.record(z.string(), z.string())).default(null),
    fork: z.boolean().optional().default(false),
    topics: z.array(z.string()).optional().default([]),

    is_template: z.boolean().optional().default(false),
    has_issues: z.boolean().optional().default(true),
    has_projects: z.boolean().optional().default(true),
    has_wiki: z.boolean().optional().default(true),
    has_pages: z.boolean().optional().default(false),
    has_downloads: z.boolean().optional().default(true),
    has_discussions: z.boolean().optional().default(false),
    archived: z.boolean().optional().default(false),
    disabled: z.boolean().optional().default(false),

    forks_count: z.number().optional().default(9001),
    forks: z.number().optional().default(9001),
    stargazers_count: z.number().optional().default(9001),
    stargazers: z.number().optional().default(9001),
    watchers_count: z.number().optional().default(9001),
    watchers: z.number().optional().default(9001),
    size: z.number().optional().default(9001),
    open_issues_count: z.number().optional().default(9001),
    open_issues: z.number().optional().default(9001),

    permissions: githubEntityPermissionSchema,
    security_and_analysis: z
      .object({
        advanced_security: z.object({status: z.string()}).optional().default({status: 'enabled'}),
        secret_scanning: z.object({status: z.string()}).optional().default({status: 'enabled'}),
        secret_scanning_push_protection: z.object({status: z.string()}).optional().default({status: 'enabled'}),
        secret_scanning_non_provider_patterns: z.object({status: z.string()}).optional().default({status: 'enabled'})
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
    const host = 'localhost:3300';
    const id = repo.id ?? nextRepositoryId();
    const full_name = `${repo.owner}/${repo.name}`;

    return {
      ...repo,
      id,
      node_id: repo.name,
      full_name,
      url: `http://${host}/repos/${full_name}`,
      html_url: `http://${host}/repos/${full_name}`,
      archive_url: `http://${host}/repos/${full_name}/{archive_format}{/ref}`,
      assignees_url: `http://${host}/repos/${full_name}/assignees{/user}`,
      blobs_url: `http://${host}/repos/${full_name}/git/blobs{/sha}`,
      branches_url: `http://${host}/repos/${full_name}/branches{/branch}`,
      collaborators_url: `http://${host}/repos/${full_name}/collaborators{/collaborator}`,
      comments_url: `http://${host}/repos/${full_name}/comments{/number}`,
      commits_url: `http://${host}/repos/${full_name}/commits{/sha}`,
      compare_url: `http://${host}/repos/${full_name}/compare/{base}...{head}`,
      contents_url: `http://${host}/repos/${full_name}/contents/{+path}`,
      contributors_url: `http://${host}/repos/${full_name}/contributors`,
      deployments_url: `http://${host}/repos/${full_name}/deployments`,
      downloads_url: `http://${host}/repos/${full_name}/downloads`,
      events_url: `http://${host}/repos/${full_name}/events`,
      forks_url: `http://${host}/repos/${full_name}/forks`,
      git_commits_url: `http://${host}/repos/${full_name}/git/commits{/sha}`,
      git_refs_url: `http://${host}/repos/${full_name}/git/refs{/sha}`,
      git_tags_url: `http://${host}/repos/${full_name}/git/tags{/sha}`,
      git_url: `git:github.com/${full_name}.git`,
      issue_comment_url: `http://${host}/repos/${full_name}/issues/comments{/number}`,
      issue_events_url: `http://${host}/repos/${full_name}/issues/events{/number}`,
      issues_url: `http://${host}/repos/${full_name}/issues{/number}`,
      keys_url: `http://${host}/repos/${full_name}/keys{/key_id}`,
      labels_url: `http://${host}/repos/${full_name}/labels{/name}`,
      languages_url: `http://${host}/repos/${full_name}/languages`,
      merges_url: `http://${host}/repos/${full_name}/merges`,
      milestones_url: `http://${host}/repos/${full_name}/milestones{/number}`,
      notifications_url: `http://${host}/repos/${full_name}/notifications{?since,all,participating}`,
      pulls_url: `http://${host}/repos/${full_name}/pulls{/number}`,
      releases_url: `http://${host}/repos/${full_name}/releases{/id}`,
      ssh_url: `git@github.com:${full_name}.git`,
      stargazers_url: `http://${host}/repos/${full_name}/stargazers`,
      statuses_url: `http://${host}/repos/${full_name}/statuses/{sha}`,
      subscribers_url: `http://${host}/repos/${full_name}/subscribers`,
      subscription_url: `http://${host}/repos/${full_name}/subscription`,
      tags_url: `http://${host}/repos/${full_name}/tags`,
      teams_url: `http://${host}/repos/${full_name}/teams`,
      trees_url: `http://${host}/repos/${full_name}/git/trees{/sha}`,
      clone_url: `http://github.com/${full_name}.git`,
      mirror_url: `git:git.example.com/${full_name}`,
      hooks_url: `http://${host}/repos/${full_name}/hooks`,
      svn_url: `http://svn.github.com/${full_name}`,
      homepage: repo.homepage || `http://${host}`,
      topics: repo.topics.length === 0 ? ['octocat', 'boilerplate', 'tauri', 'api'] : repo.topics
    };
  });

export type GitHubRepository = z.infer<typeof githubRepositorySchema>;

export const repositoryStoreKey = (repository: GitHubRepository) => `${repository.owner}/${repository.name}`;
