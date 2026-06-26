/** @file Integration tests for repository writes through shared actions. */
import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {simulation, type InitialState} from '../src/index.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

type RepositoryResponse = {
  description?: string;
  full_name?: string;
  homepage?: string;
  private?: boolean;
};

type GraphQLRepositoryDescription = {
  data?: {
    repository?: {
      description?: string;
    };
  };
  errors?: Array<{message: string}>;
};

const fixtureState: InitialState = {
  users: [],
  organizations: [{login: 'acme'}],
  repositories: [{owner: 'acme', name: 'awesome-repo', description: 'Original description'}],
  branches: [],
  blobs: []
};

const gql = String.raw;

/** Fetches JSON and preserves the HTTP status for assertions. */
const fetchJson = async <T>(url: string, init?: RequestInit): Promise<{status: number; body: T}> => {
  const response = await fetch(url, init);
  return {status: response.status, body: (await response.json()) as T};
};

/** Queries GraphQL for the repository description demonstrator field. */
const fetchGraphQLDescription = async (baseUrl: string): Promise<GraphQLRepositoryDescription> => {
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
      variables: {owner: 'acme', name: 'awesome-repo'}
    })
  });

  return (await response.json()) as GraphQLRepositoryDescription;
};

describe('repository writes through shared actions', () => {
  let server: SimulationServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await simulation({initialState: fixtureState}).listen(0);
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.ensureClose();
  });

  it('makes one repository description write visible through REST and GraphQL reads', async () => {
    const patch = await fetchJson<RepositoryResponse>(`${baseUrl}/repos/acme/awesome-repo`, {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer local-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        description: 'Patched via shared action',
        homepage: 'https://docs.example.test',
        private: true
      })
    });
    const get = await fetchJson<RepositoryResponse>(`${baseUrl}/repos/acme/awesome-repo`);
    const list = await fetchJson<RepositoryResponse[]>(`${baseUrl}/orgs/acme/repos`);
    const graphql = await fetchGraphQLDescription(baseUrl);

    expect(patch.status).toBe(200);
    expect(patch.body).toEqual(
      expect.objectContaining({
        full_name: 'acme/awesome-repo',
        description: 'Patched via shared action',
        homepage: 'https://docs.example.test',
        private: false
      })
    );
    expect(get.status).toBe(200);
    expect(get.body.description).toBe('Patched via shared action');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([expect.objectContaining({description: 'Patched via shared action'})]);
    expect(graphql.errors).toBeUndefined();
    expect(graphql.data?.repository?.description).toBe('Patched via shared action');
  });
});
