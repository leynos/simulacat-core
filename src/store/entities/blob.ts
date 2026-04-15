/** @file Git blob fixture schema and canonical blob keys. */
import {faker} from '@faker-js/faker';
import {z} from 'zod';

export const githubBlobSchema = z
  .object({
    content: z.string().optional().default(faker.lorem.paragraphs),
    encoding: z.union([z.literal('string'), z.literal('base64')]).default('string'),
    owner: z.string(),
    repo: z.string(),
    path: z.string().optional(),
    sha: z.string().optional()
  })
  .transform((blob, ctx) => {
    if (!blob.path && !blob.sha) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Specify the path or sha of the blob'
      });
      return z.NEVER;
    }

    return blob;
  });

export type GitHubBlob = z.infer<typeof githubBlobSchema>;

export const blobStoreKey = (blob: GitHubBlob) => blob.sha ?? blob.path!;
