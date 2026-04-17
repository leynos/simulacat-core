/** @file Shared Zod fragments for seeded GitHub entity schemas. */
import {z} from 'zod';

export const githubEntityPermissionSchema = z
  .object({
    admin: z.boolean().optional().default(false),
    push: z.boolean().optional().default(false),
    pull: z.boolean().optional().default(true)
  })
  .optional()
  .default({admin: false, push: false, pull: true});
