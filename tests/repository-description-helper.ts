/** @file Shared GraphQL helpers for repository description assertions. */
import {z} from 'zod';

const graphQLRepositoryDescriptionSchema = z.object({
  data: z
    .object({
      repository: z.object({description: z.string().nullable().optional()}).nullable().optional()
    })
    .optional(),
  errors: z.array(z.object({message: z.string()})).optional()
});

export type GraphQLRepositoryDescription = z.infer<typeof graphQLRepositoryDescriptionSchema>;

const gql = String.raw;

/**
 * Queries one repository description through GraphQL.
 *
 * @param baseUrl Simulator base URL.
 * @param owner Repository owner login.
 * @param name Repository name.
 * @returns The GraphQL response payload.
 * @throws {Error} When the GraphQL endpoint responds with a non-2xx HTTP status.
 */
export const fetchGraphQLDescription = async (
  baseUrl: string,
  owner: string,
  name: string
): Promise<GraphQLRepositoryDescription> => {
  const response = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      query: gql`
        query RepositoryDescription($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            description
          }
        }
      `,
      variables: {owner, name}
    })
  });

  if (!response.ok) {
    throw new Error(`GraphQL description query failed with HTTP ${response.status} ${response.statusText}`.trim());
  }

  return graphQLRepositoryDescriptionSchema.parse(await response.json());
};
