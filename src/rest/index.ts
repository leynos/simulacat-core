/** @file OpenAPI-backed REST handlers for the simulated GitHub API. */
import type {Document, SimulationHandlers} from '@simulacrum/foundation-simulator';
import type {ExtendedSimulationStore} from '../store/index.ts';
import {getSchema, type SchemaFile} from '../utils.ts';
import {blobAsBase64, commitStatusResponse, gitTrees} from './utils.ts';

/**
 * Creates the REST handler table consumed by the foundation simulator's
 * OpenAPI adapter.
 */
type SimulationHandler = SimulationHandlers[string];
type Ctx = Parameters<SimulationHandler>[0];
type Req = Parameters<SimulationHandler>[1];
type Res = Parameters<SimulationHandler>[2];

const notFound = {message: 'Not Found'};

const handlers =
  (
    initialState: Record<string, any> | undefined,
    extendedHandlers: ((simulationStore: ExtendedSimulationStore) => SimulationHandlers) | undefined
  ) =>
  (simulationStore: ExtendedSimulationStore): SimulationHandlers => {
    const getState = () => simulationStore.store.getState();
    const requireRepository = (owner: string, repo: string, response: Res) => {
      const repository = simulationStore.selectors.getRepository(getState(), owner, repo);
      if (!repository) response.status(404).json(notFound);
      return repository ?? null;
    };

    const makeListHandler =
      (selector: (state: ReturnType<typeof getState>, owner: string, repo: string) => unknown): SimulationHandler =>
      async (context: Ctx, _request: Req, response: Res) => {
        const {owner, repo} = context.request.params as {owner: string; repo: string};
        if (!requireRepository(owner, repo, response)) return;
        return response.status(200).json(selector(getState(), owner, repo));
      };

    const makeItemHandler =
      <TParam extends string>(
        paramName: TParam,
        selector: (state: ReturnType<typeof getState>, owner: string, repo: string, param: string | number) => unknown,
        coerce: (value: string) => string | number = (value) => value
      ): SimulationHandler =>
      async (context: Ctx, _request: Req, response: Res) => {
        const params = context.request.params as {owner: string; repo: string} & Record<string, string>;
        const {owner, repo} = params;
        if (!requireRepository(owner, repo, response)) return;
        const item = selector(getState(), owner, repo, coerce(params[paramName] ?? ''));
        if (!item) return response.status(404).json(notFound);
        return response.status(200).json(item);
      };

    const baseHandlers = !initialState
      ? {}
      : {
          // GET /user/installations
          'apps/list-installations': async (_context: Ctx, _request: Req, response: Res) => {
            const installations = simulationStore.schema.installations
              .selectTableAsList(getState())
              .map(
                (installation) =>
                  simulationStore.selectors.getAppInstallation(getState(), installation.account) ?? installation
              );
            response.status(200).json(installations);
          },
          // POST /app/installations/{installation_id}/access_tokens
          'apps/create-installation-access-token': async (context: Ctx, request: Req, _response: Res) => {
            const contextParams = context.request.params as {installation_id?: string | string[]};
            const requestParams = request.params as {installation_id?: string | string[]} | undefined;
            const installationIdParam =
              contextParams.installation_id ?? requestParams?.installation_id ?? request.body?.installation_id;
            const installationId = Number(
              Array.isArray(installationIdParam) ? installationIdParam[0] : installationIdParam
            );
            const installation = simulationStore.schema.installations
              .selectTableAsList(getState())
              .find((candidate) => candidate.id === installationId);
            if (!installation) {
              return {
                status: 404,
                json: {message: 'Not Found'}
              };
            }
            const repositories = simulationStore.selectors.allReposWithOrgs(getState(), installation.account) ?? [];
            const token = 'FAKE_GITHUB_TOKEN';
            return {
              status: 201,
              json: {
                token,
                expires_at: '2030-07-11T22:14:10Z',
                permissions: {
                  issues: 'write',
                  contents: 'read'
                },
                repository_selection: 'selected',
                repositories
              }
            };
          },
          // L#4134 /installation/repositories
          'apps/list-repos-accessible-to-installation': async (_context: Ctx, _request: Req, _response: Res) => {
            const repos = simulationStore.selectors.allReposWithOrgs(getState()) ?? [];
            return {
              status: 200,
              json: {
                total_count: repos.length,
                repositories: repos
              }
            };
          },
          // GET /orgs/{org}/installation - Get an organization installation for the authenticated app
          'apps/get-org-installation': async (context: Ctx, _request: Req, response: Res) => {
            const {org} = context.request.params;
            const install = simulationStore.selectors.getAppInstallation(simulationStore.store.getState(), org);
            if (!install) return response.status(404).send('Not Found');
            return response.status(200).json(install);
            // note that we can't use the return here because the schema has
            // a nullable field that openapi-backend chokes on
            // see https://github.com/typicode/openapi-backend/issues/747
            // return { status: 200, json: install };
          },
          // GET /repos/{owner}/{repo}/installation - Get a repository installation for the authenticated app
          'apps/get-repo-installation': async (context: Ctx, _request: Req, response: Res) => {
            const {owner, repo} = context.request.params;
            const install = simulationStore.selectors.getAppInstallation(simulationStore.store.getState(), owner, repo);
            if (!install) return response.status(404).send('Not Found');
            return response.status(200).json(install);
            // note that we can't use the return here because the schema has
            // a nullable field that openapi-backend chokes on
            // see https://github.com/typicode/openapi-backend/issues/747
            // return { status: 200, json: install };
          },

          // GET /orgs/{org}/repos
          'repos/list-for-org': async (context: Ctx, _request: Req, response: Res) => {
            const {org} = context.request.params;
            const repos = simulationStore.selectors.allReposWithOrgs(getState(), org);
            if (!repos) return response.status(404).send('Not Found');
            return {status: 200, json: repos};
          },
          // L#29067 /repos/{owner}/{repo}/branches
          'repos/list-branches': async (context: Ctx, _request: Req, response: Res) => {
            const {owner, repo} = context.request.params;
            if (!requireRepository(owner, repo, response)) return;
            const branches = simulationStore.selectors.listBranchesForRepository(getState(), owner, repo);
            return {status: 200, json: branches};
          },
          // GET /repos/{owner}/{repo}/commits/{ref}/status
          'repos/get-combined-status-for-ref': async (context: Ctx, request: Req, response: Res) => {
            const {owner, repo, ref} = context.request.params;
            const commitStatus = commitStatusResponse({
              host: `${request.protocol}://${request.headers.host}`,
              owner,
              repo,
              ref
            });
            response.status(200).json(commitStatus);
          },
          // GET /repos/{owner}/{repo}/contents/{path}
          'repos/get-content': async (context: Ctx, request: Req, response: Res) => {
            const {owner, repo, path} = context.request.params;
            const blob = simulationStore.selectors.getBlob(simulationStore.store.getState(), owner, repo, path);
            if (!blob) {
              response.status(404).send('fixture does not exist');
            } else {
              const data = blobAsBase64({
                blob,
                host: `${request.protocol}://${request.headers.host}`,
                owner,
                repo,
                ref: path
              });
              response.status(200).json(data);
            }
          },
          // GET /repos/{owner}/{repo}/git/blobs/{file_sha}
          'git/get-blob': async (context: Ctx, request: Req, response: Res) => {
            const {owner, repo, file_sha} = context.request.params;
            const blob = simulationStore.selectors.getBlob(simulationStore.store.getState(), owner, repo, file_sha);
            if (!blob) {
              response.status(404).send('fixture does not exist');
            } else {
              const data = blobAsBase64({
                blob,
                host: `${request.protocol}://${request.headers.host}`,
                owner,
                repo,
                ref: file_sha,
                kind: 'git-blob'
              });
              response.status(200).json(data);
            }
          },
          // GET /repos/{owner}/{repo}/git/trees/{tree_sha}
          'git/get-tree': async (context: Ctx, request: Req, response: Res) => {
            const ownerParam = context.request.params.owner;
            const repoParam = context.request.params.repo;
            const treeShaParam = context.request.params.tree_sha;
            const owner = Array.isArray(ownerParam) ? ownerParam[0] : ownerParam;
            const repo = Array.isArray(repoParam) ? repoParam[0] : repoParam;
            const treeSha = Array.isArray(treeShaParam) ? treeShaParam[0] : treeShaParam;
            const repository =
              owner && repo
                ? simulationStore.selectors.getRepository(simulationStore.store.getState(), owner, repo)
                : undefined;
            const blobs = simulationStore.selectors.getBlobAtOwnerRepo(simulationStore.store.getState(), owner, repo);
            if (!owner || !repo || !treeSha || !repository) {
              response.status(404).send('fixture does not exist');
            } else {
              const tree = gitTrees({
                blobs,
                host: `${request.protocol}://${request.headers.host}`,
                owner,
                repo,
                ref: treeSha
              });
              response.status(200).json(tree);
            }
          },
          // GET /repos/{owner}/{repo}/git/ref/{ref}
          'git/get-ref': makeItemHandler('ref', (state, owner, repo, ref) =>
            simulationStore.selectors.getRef(state, {owner, repo, qualifiedName: String(ref)})
          ),
          // GET /repos/{owner}/{repo}/git/commits/{commit_sha}
          'git/get-commit': makeItemHandler('commit_sha', (state, owner, repo, sha) =>
            simulationStore.selectors.getCommit(state, {owner, repo, sha: String(sha)})
          ),
          // GET /repos/{owner}/{repo}/issues
          'issues/list-for-repo': makeListHandler((state, owner, repo) =>
            simulationStore.selectors.listIssuesForRepository(state, {owner, repo})
          ),
          // GET /repos/{owner}/{repo}/issues/{issue_number}
          'issues/get': makeItemHandler(
            'issue_number',
            (state, owner, repo, number) =>
              simulationStore.selectors.getIssue(state, {owner, repo, number: Number(number)}),
            Number
          ),
          // GET /repos/{owner}/{repo}/pulls
          'pulls/list': makeListHandler((state, owner, repo) =>
            simulationStore.selectors.listPullRequestsForRepository(state, {owner, repo})
          ),
          // GET /repos/{owner}/{repo}/pulls/{pull_number}
          'pulls/get': makeItemHandler(
            'pull_number',
            (state, owner, repo, number) =>
              simulationStore.selectors.getPullRequest(state, {owner, repo, number: Number(number)}),
            Number
          ),

          // GET /user
          'users/get-authenticated': async (_context: Ctx, _request: Req, response: Res) => {
            const users = simulationStore.schema.users.selectTableAsList(simulationStore.store.getState());
            const user = users[0];
            if (!user) {
              return response.status(401).json({message: 'Authentication required'});
            }
            const data = {
              id: parseInt(user.id.toString(), 10) as number,
              login: user.login,
              email: user.email,
              name: user.name
            };
            response.status(200).json(data);
          },

          // GET /user/memberships/orgs
          'orgs/list-memberships-for-authenticated-user': async (_context: Ctx, request: Req, response: Res) => {
            const users = simulationStore.schema.users.selectTableAsList(getState());
            const requestedLogin = request.get('x-simulacat-user') ?? request.get('x-github-user');
            const user = requestedLogin ? users.find((candidate) => candidate.login === requestedLogin) : users[0];
            if (!user) {
              return response.status(401).json({message: 'Authentication required'});
            }
            const organizations = simulationStore.selectors.allGithubOrganizations(getState());
            const memberships = organizations
              .filter((organization) => user.organizations.includes(organization.login))
              .map((organization) => ({
                url: `${organization.url}/memberships/${user.login}`,
                state: 'active',
                organization,
                role: 'member',
                organization_url: organization.url,
                user
              }));
            return response.status(200).json(memberships);
          }
        };

    // note for any cases where it `return`s an object,
    //  that will validate the response per the schema
    return {
      ...baseHandlers,
      ...(extendedHandlers ? extendedHandlers(simulationStore) : {})
    };
  };

/**
 * Builds the OpenAPI configuration array for the simulated REST server.
 *
 * @example
 * ```ts
 * const config = openapi(initialState, '/', 'api.github.com.json', undefined);
 * ```
 */
export const openapi = (
  initialState: Record<string, any> | undefined,
  apiRoot: string,
  apiSchema: SchemaFile | string,
  openapiHandlers: ((simulationStore: ExtendedSimulationStore) => SimulationHandlers) | undefined
) => [
  {
    document: getSchema(apiSchema) as unknown as Document,
    handlers: handlers(initialState, openapiHandlers),
    apiRoot,
    additionalOptions: {
      // starts up quicker and avoids the precompile step which throws a ton of errors
      //  based on openapi-backend handling of GitHub schema
      quick: true
    }
  }
];
