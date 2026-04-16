/**
 * @file GitHub organization fixture schema and defaults.
 *
 * This module normalizes organization fixtures, preserving caller identifiers
 * and filling in the GitHub-style profile URLs used throughout the simulator.
 */
import {faker} from '@faker-js/faker';
import {z} from 'zod';

const {SIMULACAT_GITHUB_API_URL} = process.env;
const DEFAULT_GITHUB_API_BASE_URL = SIMULACAT_GITHUB_API_URL?.trim() || 'http://localhost:3300';

const deriveOrganizationBaseUrl = (url?: string) => {
  if (!url) {
    return DEFAULT_GITHUB_API_BASE_URL;
  }

  try {
    const parsedUrl = new URL(url);
    const orgPathMatch = parsedUrl.pathname.match(/^(.*)\/orgs\/[^/]+\/?$/);
    const basePath = orgPathMatch?.[1] ?? '';
    return `${parsedUrl.origin}${basePath}`;
  } catch {
    return DEFAULT_GITHUB_API_BASE_URL;
  }
};

export const githubOrganizationSchema = z
  .object({
    id: z.number().default(() => faker.number.int({min: 4000, max: 9_999_999})),
    login: z.string().trim().min(1, {message: 'login must be a non-empty string'}),
    name: z.string().optional(),
    email: z.string().optional(),
    node_id: z.string().optional(),
    type: z.enum(['User', 'Organization']).default('Organization'),
    description: z.string().optional().default('Generic org description'),
    created_at: z
      .string()
      .optional()
      .default(() => faker.date.recent().toISOString()),
    teams: z.array(z.string()).optional(),
    avatar_url: z.string().optional().default('https://github.com/images/error/octocat_happy.gif'),
    gravatar_id: z.string().optional().default(''),
    site_admin: z.boolean().optional().default(true),
    url: z.string().url().optional(),
    html_url: z.string().optional(),
    followers_url: z.string().optional(),
    following_url: z.string().optional(),
    gists_url: z.string().optional(),
    starred_url: z.string().optional(),
    subscriptions_url: z.string().optional(),
    organizations_url: z.string().optional(),
    repos_url: z.string().optional(),
    events_url: z.string().optional(),
    received_events_url: z.string().optional(),
    hooks_url: z.string().optional(),
    issues_url: z.string().optional(),
    members_url: z.string().optional(),
    public_members_url: z.string().optional()
  })
  .transform((org) => {
    const name = org.name ?? org.login;
    const email =
      org.email ??
      faker.internet.email({
        firstName: 'org',
        lastName: org.login
      });

    const baseUrl = deriveOrganizationBaseUrl(org.url);
    const url = org.url ?? `${baseUrl}/orgs/${org.login}`;

    return {
      ...org,
      name,
      email,
      url,
      html_url: org.html_url ?? url,
      followers_url: org.followers_url ?? `${baseUrl}/users/${org.login}/followers`,
      following_url: org.following_url ?? `${baseUrl}/users/${org.login}/following{/other_user}`,
      gists_url: org.gists_url ?? `${baseUrl}/users/${org.login}/gists{/gist_id}`,
      starred_url: org.starred_url ?? `${baseUrl}/users/${org.login}/starred{/owner}{/repo}`,
      subscriptions_url: org.subscriptions_url ?? `${baseUrl}/users/${org.login}/subscriptions`,
      organizations_url: org.organizations_url ?? `${baseUrl}/users/${org.login}/orgs`,
      repos_url: org.repos_url ?? `${url}/repos`,
      events_url: org.events_url ?? `${url}/events`,
      received_events_url: org.received_events_url ?? `${baseUrl}/users/${org.login}/received_events`,
      hooks_url: org.hooks_url ?? `${url}/hooks`,
      issues_url: org.issues_url ?? `${url}/issues`,
      members_url: org.members_url ?? `${url}/members{/member}`,
      public_members_url: org.public_members_url ?? `${url}/public_members{/member}`,
      node_id: org.node_id ?? Buffer.from(`Organization:${org.login}`).toString('base64')
    };
  });

export type GitHubOrganization = z.infer<typeof githubOrganizationSchema>;
