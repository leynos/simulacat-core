/** @file Integration tests for the simulated GraphQL API surface. */
import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {simulation} from '../src/index.ts';
import {graphql} from '@octokit/graphql';
import {requestActorHeader} from '../src/store/actors.ts';

type SimulationServer = Awaited<ReturnType<ReturnType<typeof simulation>['listen']>>;

const basePort = 3400;
const host = 'http://localhost';
const url = `${host}:${basePort}`;

// for syntax highlighting
const gql = String.raw;
const headers = {
  authorization: 'Bearer [REDACTED]',
  'Content-Type': 'application/json'
};
const client = graphql.defaults({
  baseUrl: url
});

type MembersWithRoleQuery = {
  organization: {
    membersWithRole: {
      nodes: unknown[];
      pageInfo: {
        hasNextPage: boolean;
      };
    };
  };
};

type TeamsQuery = {
  organization: {
    teams: {
      nodes: unknown[];
      pageInfo: {
        hasNextPage: boolean;
      };
    };
  };
};

type UserOrganizationsQuery = {
  user: {
    organizations: {
      nodes: Array<{
        login: string;
      }>;
    };
  };
};

describe('graphql queries', () => {
  let server: SimulationServer;
  beforeAll(async () => {
    const app = simulation({
      initialState: {
        users: [
          {login: 'frontsidejack', email: 'frontsidejack@example.test', organizations: ['lovely-org']},
          {login: 'reviewer', email: 'reviewer@example.test', organizations: ['Acme']}
        ],
        organizations: [{login: 'lovely-org'}, {login: 'Acme'}],
        repositories: [
          {owner: 'lovely-org', name: 'awesome-repo'},
          {owner: 'Acme', name: 'Awesome-Repo'}
        ],
        branches: [
          {owner: 'lovely-org', repo: 'awesome-repo', name: 'main'},
          {owner: 'Acme', repo: 'Awesome-Repo', name: 'main'}
        ],
        blobs: [],
        commits: [
          {owner: 'lovely-org', repo: 'awesome-repo', sha: 'commit-a', commit: {message: 'Initial commit'}},
          {owner: 'Acme', repo: 'Awesome-Repo', sha: 'commit-b', commit: {message: 'Acme commit'}}
        ],
        refs: [
          {owner: 'lovely-org', repo: 'awesome-repo', qualifiedName: 'main', object: {sha: 'commit-a'}},
          {owner: 'lovely-org', repo: 'awesome-repo', qualifiedName: 'feature/x', object: {sha: 'commit-a'}},
          {
            owner: 'lovely-org',
            repo: 'awesome-repo',
            qualifiedName: 'v1.0.0',
            object: {type: 'tag', sha: 'commit-a'}
          },
          {owner: 'Acme', repo: 'Awesome-Repo', qualifiedName: 'main', object: {sha: 'commit-b'}}
        ],
        issues: [
          {owner: 'lovely-org', repo: 'awesome-repo', number: 1, title: 'Lovely issue'},
          {owner: 'Acme', repo: 'Awesome-Repo', number: 1, title: 'Acme issue'}
        ],
        pullRequests: [
          {
            owner: 'lovely-org',
            repo: 'awesome-repo',
            number: 2,
            title: 'Lovely pull request',
            draft: true,
            base: {ref: 'main', sha: 'commit-a'},
            head: {ref: 'feature/entity-spine', sha: 'commit-c'}
          }
        ]
      }
    });
    server = await app.listen(basePort);
  });
  afterAll(async () => {
    await server.ensureClose();
  });

  it('validates with 200 response', async () => {
    const request = await fetch(`${url}/graphql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: gql`
          query repositories($org: String!) {
            repositoryOwner(login: $org) {
              login
              repositories(first: 50) {
                edges {
                  node {
                    name
                  }
                }
              }
            }
          }
        `,
        variables: {org: 'lovely-org'}
      })
    });
    const response = await request.json();
    expect(request.status).toEqual(200);
    expect(response.errors).toBe(undefined);
    expect(response.data.repositoryOwner.login).toBe('lovely-org');
    expect(response.data.repositoryOwner.repositories.edges).toEqual([
      expect.objectContaining({
        node: expect.objectContaining({name: 'awesome-repo'})
      })
    ]);
  });

  it('preserves case-insensitive repository lookup for mixed-case fixtures', async () => {
    const request = await fetch(`${url}/graphql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: gql`
          query repository($owner: String!, $name: String!) {
            repository(owner: $owner, name: $name) {
              name
              nameWithOwner
            }
          }
        `,
        variables: {owner: 'acme', name: 'awesome-repo'}
      })
    });
    const response = await request.json();

    expect(request.status).toEqual(200);
    expect(response.errors).toBe(undefined);
    expect(response.data.repository).toEqual({
      name: 'Awesome-Repo',
      nameWithOwner: 'Acme/Awesome-Repo'
    });
  });

  it('resolves viewer from the request actor', async () => {
    const request = await fetch(`${url}/graphql`, {
      method: 'POST',
      headers: {
        ...headers,
        [requestActorHeader]: 'user:reviewer'
      },
      body: JSON.stringify({
        query: gql`
          query viewer {
            viewer {
              login
              id
            }
          }
        `
      })
    });
    const response = await request.json();

    expect(request.status).toEqual(200);
    expect(response.errors).toBe(undefined);
    expect(response.data.viewer.login).toBe('reviewer');
  });

  it('fails viewer for anonymous, unknown, app, and installation actors', async () => {
    for (const actor of [undefined, 'user:missing', 'app:1', 'installation:1']) {
      const requestHeaders = actor ? {...headers, [requestActorHeader]: actor} : headers;
      const request = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          query: gql`
            query viewer {
              viewer {
                login
              }
            }
          `
        })
      });
      const response = await request.json();

      expect(request.status).toEqual(200);
      expect(response.errors?.[0]?.message).toBe('Authentication required');
      expect(response.data).toBeNull();
    }
  });

  it('agrees with REST /user for equivalent request actor input', async () => {
    const actorHeaders = {
      [requestActorHeader]: 'user:frontsidejack'
    };
    const restRequest = await fetch(`${url}/user`, {
      headers: actorHeaders
    });
    const restUser = await restRequest.json();
    const graphqlRequest = await fetch(`${url}/graphql`, {
      method: 'POST',
      headers: {
        ...headers,
        ...actorHeaders
      },
      body: JSON.stringify({
        query: gql`
          query viewer {
            viewer {
              login
              id
            }
          }
        `
      })
    });
    const graphqlResponse = await graphqlRequest.json();

    expect(restRequest.status).toEqual(200);
    expect(graphqlResponse.errors).toBe(undefined);
    expect(graphqlResponse.data.viewer.login).toBe(restUser.login);
    expect(graphqlResponse.data.viewer.id).toBe(restUser.id.toString());
  });

  describe('reads first-class refs, issues, and pull requests from repository state', () => {
    const repositoryEntitiesSingularQuery = gql`
      query repositoryEntitiesSingular($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          issue(number: 1) {
            id
            number
          }
          pullRequest(number: 2) {
            id
            number
          }
          refs(first: 10, refPrefix: "refs/heads/") {
            nodes {
              name
              prefix
            }
          }
        }
      }
    `;

    const repositoryEntitiesQuery = gql`
      query repositoryEntities($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          defaultBranchRef {
            name
            prefix
            target {
              ... on Commit {
                oid
                messageHeadline
              }
            }
          }
          ref(qualifiedName: "main") {
            name
            prefix
            target {
              ... on Commit {
                oid
              }
            }
          }
          tagRef: ref(qualifiedName: "refs/tags/v1.0.0") {
            name
            prefix
            target {
              ... on Commit {
                oid
              }
            }
          }
          issues(first: 10) {
            nodes {
              id
              number
              title
              state
            }
          }
          pullRequests(first: 10) {
            nodes {
              id
              number
              title
              isDraft
              baseRefName
              headRefName
            }
          }
        }
      }
    `;
    let response: any;
    let singularResponse: any;

    beforeAll(async () => {
      const request = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: repositoryEntitiesQuery,
          variables: {owner: 'lovely-org', name: 'awesome-repo'}
        })
      });
      response = await request.json();

      expect(request.status).toEqual(200);
      expect(response.errors).toBe(undefined);

      const singularRequest = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: repositoryEntitiesSingularQuery,
          variables: {owner: 'lovely-org', name: 'awesome-repo'}
        })
      });
      singularResponse = await singularRequest.json();

      expect(singularRequest.status).toEqual(200);
      expect(singularResponse.errors).toBe(undefined);
    });

    it('returns the defaultBranchRef with its commit target', () => {
      expect(response.data.repository.defaultBranchRef).toEqual(
        expect.objectContaining({
          name: 'main',
          prefix: 'refs/heads/',
          target: expect.objectContaining({oid: 'commit-a', messageHeadline: 'Initial commit'})
        })
      );
    });

    it('returns the named ref with its commit target', () => {
      expect(response.data.repository.ref).toEqual(expect.objectContaining({name: 'main', prefix: 'refs/heads/'}));
      expect(response.data.repository.ref.target.oid).toBe('commit-a');
    });

    it('returns the named tag ref with its commit target', () => {
      expect(response.data.repository.tagRef).toEqual(expect.objectContaining({name: 'v1.0.0', prefix: 'refs/tags/'}));
      expect(response.data.repository.tagRef.target.oid).toBe('commit-a');
    });

    it('returns issues with number, title, and state', () => {
      expect(response.data.repository.issues.nodes).toEqual([
        expect.objectContaining({number: 1, title: 'Lovely issue', state: 'OPEN'})
      ]);
    });

    it('returns pull requests with draft flag and ref names', () => {
      expect(response.data.repository.pullRequests.nodes).toEqual([
        expect.objectContaining({
          number: 2,
          title: 'Lovely pull request',
          isDraft: true,
          baseRefName: 'main',
          headRefName: 'feature/entity-spine'
        })
      ]);
    });

    it('resolves singular issue, pull request, and refs with refPrefix consistently', () => {
      const issueFromConnection = response.data.repository.issues.nodes.find(
        (node: {number: number}) => node.number === 1
      );
      const pullRequestFromConnection = response.data.repository.pullRequests.nodes.find(
        (node: {number: number}) => node.number === 2
      );
      const refs = singularResponse.data.repository.refs.nodes as Array<{name: string; prefix: string}>;

      expect(singularResponse.data.repository.issue).toEqual(
        expect.objectContaining({id: issueFromConnection.id, number: issueFromConnection.number})
      );
      expect(singularResponse.data.repository.pullRequest).toEqual(
        expect.objectContaining({
          id: pullRequestFromConnection.id,
          number: pullRequestFromConnection.number
        })
      );
      expect(refs.every((ref) => ref.prefix === 'refs/heads/')).toBe(true);
      expect(refs.some((ref) => ref.name === 'main')).toBe(true);
      expect(refs.some((ref) => ref.name === 'feature/x')).toBe(true);
    });
  });

  describe('getOrganizationUsers', () => {
    const query = gql`
      query users($org: String!, $email: Boolean!, $cursor: String) {
        organization(login: $org) {
          membersWithRole(first: 100, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              avatarUrl
              bio
              email @include(if: $email)
              login
              name
              organizationVerifiedDomainEmails(login: $org)
            }
          }
        }
      }
    `;
    const variables = {org: 'lovely-org', email: true};
    it('responds successfully to fetch', async () => {
      const request = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables
        })
      });
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response.errors).toBe(undefined);
    });
    it('responds successfully to graphql client', async () => {
      const request = await client<MembersWithRoleQuery>(query, variables);
      expect(request).toBeDefined();
      expect(request.organization.membersWithRole.nodes).toEqual([]);
      expect(request.organization.membersWithRole.pageInfo.hasNextPage).toBe(false);
    });
  });

  describe('getOrganizationTeams', () => {
    const query = gql`
      query teams($org: String!, $cursor: String) {
        organization(login: $org) {
          teams(first: 50, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              slug
              combinedSlug
              name
              description
              avatarUrl
              editTeamUrl
              parentTeam {
                slug
              }
              members(first: 100, membership: IMMEDIATE) {
                pageInfo {
                  hasNextPage
                }
                nodes {
                  avatarUrl
                  bio
                  email
                  login
                  name
                  organizationVerifiedDomainEmails(login: $org)
                }
              }
            }
          }
        }
      }
    `;
    const variables = {org: 'lovely-org'};
    it('responds successfully to fetch', async () => {
      const request = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables
        })
      });
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response.errors).toBe(undefined);
    });
    it('responds successfully to graphql client', async () => {
      const request = await client<TeamsQuery>(query, variables);
      expect(request).toBeDefined();
      expect(request.organization.teams.nodes).toEqual([]);
      expect(request.organization.teams.pageInfo.hasNextPage).toBe(false);
    });
  });

  describe('getOrganizationTeamsFromUsers', () => {
    const query = gql`
      query teams($org: String!, $cursor: String, $userLogins: [String!] = "") {
        organization(login: $org) {
          teams(first: 100, after: $cursor, userLogins: $userLogins) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              slug
              combinedSlug
              name
              description
              avatarUrl
              editTeamUrl
              parentTeam {
                slug
              }
              members(first: 100, membership: IMMEDIATE) {
                pageInfo {
                  hasNextPage
                }
                nodes {
                  avatarUrl
                  bio
                  email
                  login
                  name
                  organizationVerifiedDomainEmails(login: $org)
                }
              }
            }
          }
        }
      }
    `;
    const variables = {org: 'lovely-org', userLogins: ['frontsidejack']};
    it('responds successfully to fetch', async () => {
      const request = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables
        })
      });
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response.errors).toBe(undefined);
    });
    it('responds successfully to graphql client', async () => {
      const request = await client<TeamsQuery>(query, variables);
      expect(request).toBeDefined();
      expect(request.organization.teams.nodes).toEqual([]);
      expect(request.organization.teams.pageInfo.hasNextPage).toBe(false);
    });
  });

  describe('getOrganizationsFromUser', () => {
    const query = gql`
      query orgs($user: String!) {
        user(login: $user) {
          organizations(first: 100) {
            nodes {
              login
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `;
    const variables = {user: 'frontsidejack'};
    it('responds successfully to fetch', async () => {
      const request = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables
        })
      });
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response.errors).toBe(undefined);
    });
    it('responds successfully to graphql client', async () => {
      const request = await client<UserOrganizationsQuery>(query, variables);
      expect(request).toBeDefined();
      expect(request.user.organizations.nodes.length).toBeGreaterThan(0);
      expect(request.user.organizations.nodes).toEqual([expect.objectContaining({login: 'lovely-org'})]);
    });
  });

  describe('getOrganizationTeam', () => {
    const query = gql`
      query teams($org: String!, $teamSlug: String!) {
        organization(login: $org) {
          team(slug: $teamSlug) {
            slug
            combinedSlug
            name
            description
            avatarUrl
            editTeamUrl
            parentTeam {
              slug
            }
            members(first: 100, membership: IMMEDIATE) {
              pageInfo {
                hasNextPage
              }
              nodes {
                login
              }
            }
          }
        }
      }
    `;
    const variables = {org: 'lovely-org', teamSlug: 'boop'};
    it('responds successfully to fetch', async () => {
      const request = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables
        })
      });
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response.errors).toBe(undefined);
    });
    it('responds successfully to graphql client', async () => {
      const request = await client(query, variables);
      expect(request).toBeDefined();
    });
  });

  describe('getOrganizationRepositories', () => {
    const query = gql`
      query repositories($org: String!, $catalogPathRef: String!, $cursor: String) {
        repositoryOwner(login: $org) {
          login
          repositories(first: 50, after: $cursor) {
            nodes {
              name
              catalogInfoFile: object(expression: $catalogPathRef) {
                __typename
                ... on Blob {
                  id
                  text
                }
              }
              url
              isArchived
              isFork
              visibility
              repositoryTopics(first: 100) {
                nodes {
                  ... on RepositoryTopic {
                    topic {
                      name
                    }
                  }
                }
              }
              defaultBranchRef {
                name
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `;
    const variables = {
      org: 'lovely-org',
      catalogPathRef: 'HEAD:catalog-info.yaml',
      cursor: undefined
    };
    it('responds successfully to fetch', async () => {
      const request = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables
        })
      });
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response.errors).toBe(undefined);
      expect(response.data.repositoryOwner.login).toBe('lovely-org');
      expect(response.data.repositoryOwner.repositories.nodes.length).toBe(1);
      expect(response.data.repositoryOwner.repositories.pageInfo).toBeDefined();
      expect(response.data.repositoryOwner.repositories.pageInfo.hasNextPage).toBe(false);
    });
    it('responds successfully to graphql client', async () => {
      const request = await client(query, variables);
      expect(request).toBeDefined();
    });
  });

  describe('getOrganizationRepository', () => {
    const query = gql`
      query repository($org: String!, $repoName: String!, $catalogPathRef: String!) {
        repositoryOwner(login: $org) {
          repository(name: $repoName) {
            name
            catalogInfoFile: object(expression: $catalogPathRef) {
              __typename
              ... on Blob {
                id
                text
              }
            }
            url
            isArchived
            isFork
            visibility
            repositoryTopics(first: 100) {
              nodes {
                ... on RepositoryTopic {
                  topic {
                    name
                  }
                }
              }
            }
            defaultBranchRef {
              name
            }
          }
        }
      }
    `;
    const variables = {
      org: 'lovely-org',
      repoName: 'awesome-repo',
      catalogPathRef: './catalog-info.yaml'
    };
    it('responds successfully to fetch', async () => {
      const request = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables
        })
      });
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response.errors).toBe(undefined);
    });
    it('responds successfully to graphql client', async () => {
      const request = await client(query, variables);
      expect(request).toBeDefined();
    });
  });

  describe('getOrganizationRepository With Fragment', () => {
    const query = gql`
      fragment RepositoryNode on Repository {
        url
        defaultBranchRef {
          name
        }
        ... on Repository {
          __typename
          isArchived
          visibility
          name
          nameWithOwner
          url
          description
          languages(first: 10) {
            nodes {
              __typename
              name
            }
          }
          repositoryTopics(first: 10) {
            nodes {
              __typename
              topic {
                name
              }
            }
          }
          owner {
            ... on Organization {
              __typename
              login
            }
            ... on User {
              __typename
              login
            }
          }
        }
      }
      query repositories($cursor: String, $org: String!, $first: Int) {
        repositoryOwner(login: $org) {
          repositories(first: $first, after: $cursor, isFork: false) {
            totalCount
            nodes {
              ...RepositoryNode
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `;
    const variables = {
      org: 'lovely-org'
    };
    it('responds successfully to fetch', async () => {
      const request = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables
        })
      });
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response.errors).toBe(undefined);
    });
    it('responds successfully to graphql client', async () => {
      const request = await client(query, variables);
      expect(request).toBeDefined();
    });
  });

  describe('getTeamMembers', () => {
    const query = gql`
      query members($org: String!, $teamSlug: String!, $cursor: String) {
        organization(login: $org) {
          team(slug: $teamSlug) {
            members(first: 100, after: $cursor, membership: IMMEDIATE) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                login
              }
            }
          }
        }
      }
    `;
    const variables = {
      org: 'lovely-org',
      teamSlug: 'boop'
    };
    it('responds successfully to fetch', async () => {
      const request = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables
        })
      });
      const response = await request.json();
      expect(request.status).toEqual(200);
      expect(response.errors).toBe(undefined);
    });
    it('responds successfully to graphql client', async () => {
      const request = await client(query, variables);
      expect(request).toBeDefined();
    });
  });
});
