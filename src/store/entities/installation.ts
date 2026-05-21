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

const fallbackInstallationTimestamp = () => faker.date.recent().toISOString();

export const githubAppInstallationSchema = z
  .object({
    id: z.number().optional(),
    account: z.string().trim().min(1),
    repository_selection: z.enum(['all', 'selected']).optional().default('all'),
    app_id: z.number().default(1),
    access_tokens_url: z.string().optional(),
    repositories_url: z.string().optional(),
    html_url: z.string().optional(),
    client_id: z.string().optional().default('Iv1.ab1112223334445c'),
    target_id: z.number().optional(),
    target_type: z.enum(['Organization', 'User']).optional(),
    permissions: githubEntityPermissionSchema,
    events: z.array(z.string()).optional().default([]),
    updated_at: z.string().datetime().optional(),
    created_at: z.string().datetime().optional().default(fallbackInstallationTimestamp),
    single_file_name: z.string().optional().default('config.yml'),
    has_multiple_single_files: z.boolean().optional().default(true),
    single_file_paths: z.array(z.string()).optional().default([]),
    app_slug: z.string().optional().default('simulator-app'),
    suspended_at: z.nullable(z.string()).optional().default(null),
    suspended_by: z.nullable(z.string()).optional().default(null)
  })
  .transform((install) => {
    if (install.updated_at) {
      return install;
    }

    const createdAtDate = new Date(install.created_at);
    const now = new Date();

    if (Number.isNaN(createdAtDate.getTime()) || Number.isNaN(now.getTime())) {
      return {
        ...install,
        updated_at: fallbackInstallationTimestamp()
      };
    }

    const minDate = createdAtDate.getTime() <= now.getTime() ? createdAtDate : now;
    const maxDate = createdAtDate.getTime() <= now.getTime() ? now : createdAtDate;

    if (minDate.getTime() >= maxDate.getTime()) {
      return {
        ...install,
        updated_at: fallbackInstallationTimestamp()
      };
    }

    return {
      ...install,
      updated_at: faker.date
        .between({
          from: minDate,
          to: maxDate
        })
        .toISOString()
    };
  });

export type GitHubAppInstallation = z.infer<typeof githubAppInstallationSchema>;
