/**
 * @file GitHub organization fixture schema and defaults.
 *
 * This module normalizes organization fixtures, preserving caller identifiers
 * and filling in the GitHub-style profile URLs used throughout the simulator.
 */
import {faker} from '@faker-js/faker';
import {z} from 'zod';

export const githubOrganizationSchema = z
  .object({
    id: z.number().default(4000),
    login: z.string(),
    name: z.string().optional(),
    email: z.string().optional(),
    node_id: z.string().optional(),
    type: z.enum(['User', 'Organization']).default('Organization'),
    description: z.string().optional().default('Generic org description'),
    created_at: z
      .string()
      .default(() => faker.date.recent().toISOString())
      .optional(),
    teams: z.union([z.array(z.string()), z.undefined()]),
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
    org.id ??= faker.number.int({min: 4000});
    if (!org.name) {
      org.name = org.login;
    }
    if (!org.email) {
      org.email = faker.internet.email({
        firstName: 'org',
        lastName: org.login
      });
    }

    const host = 'localhost:3300';
    org.url = `http://${host}/orgs/${org.login}`;
    org.html_url = `http://github.com/${org.login}`;
    org.followers_url = `http://${host}/users/${org.login}/followers`;
    org.following_url = `http://${host}/users/${org.login}/following{/other_user}`;
    org.gists_url = `http://${host}/users/${org.login}/gists{/gist_id}`;
    org.starred_url = `http://${host}/users/${org.login}/starred{/owner}{/repo}`;
    org.subscriptions_url = `http://${host}/users/${org.login}/subscriptions`;
    org.organizations_url = `http://${host}/users/${org.login}/orgs`;
    org.repos_url = `${org.url}/repos`;
    org.events_url = `${org.url}/events`;
    org.received_events_url = `http://${host}/users/${org.login}/received_events`;
    org.hooks_url = `${org.url}/hooks`;
    org.issues_url = `${org.url}/issues`;
    org.members_url = `${org.url}/members{/member}`;
    org.public_members_url = `${org.url}/public_members{/member}`;
    org.node_id = 'MDQ6VXNlcjE=';

    return org;
  });

export type GitHubOrganization = z.infer<typeof githubOrganizationSchema>;
