/**
 * @file GitHub organization fixture schema and defaults.
 *
 * This module normalizes organization fixtures while preserving caller-provided
 * URL overrides for request-time projection.
 */
import {faker} from '@faker-js/faker';
import {z} from 'zod';

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
    avatar_url: z.string().optional(),
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

    return {
      ...org,
      name,
      email,
      node_id: org.node_id ?? Buffer.from(`Organization:${org.login}`).toString('base64')
    };
  });

export type GitHubOrganization = z.infer<typeof githubOrganizationSchema>;
