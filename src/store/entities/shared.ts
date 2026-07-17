/** @file Shared Zod fragments for seeded GitHub entity schemas. */
import {z} from 'zod';

/**
 * Validates and normalizes the `admin`/`push`/`pull` permission triple
 * shared by repository and installation fixtures.
 *
 * @internal
 */
export const githubEntityPermissionSchema = z
  .object({
    /** Whether the collaborator has administrative access to the repository. */
    admin: z.boolean().optional().default(false),
    /** Whether the collaborator can push changes to the repository. */
    push: z.boolean().optional().default(false),
    /** Whether the collaborator can read (pull) from the repository. */
    pull: z.boolean().optional().default(true)
  })
  .optional()
  .default({admin: false, push: false, pull: true});
