/** @file Shared GraphQL helpers for repository description assertions. */

export type GraphQLRepositoryDescription = {
  data?: {
    repository?: {
      description?: string;
    };
  };
  errors?: Array<{message: string}>;
};

const gql = String.raw;

/**
 * Queries one repository description through GraphQL.
 *
 * @param baseUrl Simulator base URL.
 * @param owner Repository owner login.
 * @param name Repository name.
 * @returns The GraphQL response payload.
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

  return (await response.json()) as GraphQLRepositoryDescription;
};
