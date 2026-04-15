/**
 * @file GitHub App installation fixture schema and defaults.
 *
 * This module normalizes seeded installation fixtures, preserving
 * caller-supplied identifiers and URLs whilst filling in GitHub-like defaults
 * when fields are omitted.
 */
import {faker} from '@faker-js/faker';
import {z} from 'zod';
import {githubEntityPermissionSchema} from './shared.ts';

export const githubAppInstallationSchema = z
  .object({
    id: z.number().optional(),
    account: z.string(),
    repository_selection: z.enum(['all', 'selected']).optional().default('all'),
    app_id: z.number().default(1),
    access_tokens_url: z.string().optional(),
    repositories_url: z.string().optional(),
    html_url: z.string().optional(),
    client_id: z.string().optional().default('Iv1.ab1112223334445c'),
    target_id: z.number().optional(),
    target_type: z.enum(['Organization', 'User']).optional(),
    permissions: githubEntityPermissionSchema,
    events: z.array(z.any()).optional().default([]),
    updated_at: z
      .string()
      .optional()
      .default(() => faker.date.recent().toISOString()),
    created_at: z
      .string()
      .optional()
      .default(() => faker.date.recent().toISOString()),
    single_file_name: z.string().optional().default('config.yml'),
    has_multiple_single_files: z.boolean().optional().default(true),
    single_file_paths: z.array(z.string()).optional().default([]),
    app_slug: z.string().optional().default('simulator-app'),
    suspended_at: z.nullable(z.string()).optional().default(null),
    suspended_by: z.nullable(z.string()).optional().default(null)
  })
  .transform((install) => {
    install.id ??= faker.number.int({min: 2000, max: 9_999_999});

    const host = 'localhost:3300';
    install.access_tokens_url ??= `https://${host}/app/installations/${install.id}/access_tokens`;
    install.repositories_url ??= `https://${host}/installation/repositories`;
    install.html_url ??= `https://${host}/organizations/${install.account}/settings/installations/${install.id}`;

    return install;
  });

export type GitHubAppInstallation = z.infer<typeof githubAppInstallationSchema>;
