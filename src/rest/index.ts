/** @file OpenAPI-backed REST handlers for the simulated GitHub API. */
import type {SimulationHandlers} from '@simulacrum/foundation-simulator';
import type {ExtendedSimulationStore} from '../store/index.ts';
import {getSchema, type SchemaFile} from '../utils.ts';
import {blobAsBase64, commitStatusResponse, gitTrees} from './utils.ts';

/**
 * Creates the REST handler table consumed by the foundation simulator's
 * OpenAPI adapter.
 */
type SimulationHandler = SimulationHandlers[string];

const handlers =
  (
    initialState: Record<string, any> | undefined,
    extendedHandlers: ((simulationStore: ExtendedSimulationStore) => SimulationHandlers) | undefined
  ) =>
  (simulationStore: ExtendedSimulationStore): SimulationHandlers => {
    const getState = () => simulationStore.store.getState();
    const baseHandlers = !initialState
      ? {}
      : {
          // GET /user/installations
          'apps/list-installations': async (
            _context: Parameters<SimulationHandler>[0],
            _request: Parameters<SimulationHandler>[1],
            response: Parameters<SimulationHandler>[2]
          ) => {
            const installations = simulationStore.schema.installations
              .selectTableAsList(getState())
              .map(
                (installation) =>
                  simulationStore.selectors.getAppInstallation(getState(), installation.account) ?? installation
              );
            response.status(200).json(installations);
          },
          // POST /app/installations/{installation_id}/access_tokens
          'apps/create-installation-access-token': async (
            _context: Parameters<SimulationHandler>[0],
            _request: Parameters<SimulationHandler>[1],
            _response: Parameters<SimulationHandler>[2]
          ) => {
            const repositories = simulationStore.selectors.allReposWithOrgs(getState()) ?? [];
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
          'apps/list-repos-accessible-to-installation': async (
            _context: Parameters<SimulationHandler>[0],
            _request: Parameters<SimulationHandler>[1],
            _response: Parameters<SimulationHandler>[2]
          ) => {
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
          'apps/get-org-installation': async (
            context: Parameters<SimulationHandler>[0],
            _request: Parameters<SimulationHandler>[1],
            response: Parameters<SimulationHandler>[2]
          ) => {
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
          'apps/get-repo-installation': async (
            context: Parameters<SimulationHandler>[0],
            _request: Parameters<SimulationHandler>[1],
            response: Parameters<SimulationHandler>[2]
          ) => {
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
          'repos/list-for-org': async (
            context: Parameters<SimulationHandler>[0],
            _request: Parameters<SimulationHandler>[1],
            response: Parameters<SimulationHandler>[2]
          ) => {
            const {org} = context.request.params;
            const repos = simulationStore.selectors.allReposWithOrgs(getState(), org);
            if (!repos) return response.status(404).send('Not Found');
            return {status: 200, json: repos};
          },
          // L#29067 /repos/{owner}/{repo}/branches
          'repos/list-branches': async (
            context: Parameters<SimulationHandler>[0],
            _request: Parameters<SimulationHandler>[1],
            _response: Parameters<SimulationHandler>[2]
          ) => {
            const {owner, repo} = context.request.params;
            const branches = simulationStore.schema.branches
              .selectTableAsList(getState())
              .filter((branch) => branch.owner === owner && branch.repo === repo);
            return {status: 200, json: branches};
          },
          // GET /repos/{owner}/{repo}/commits/{ref}/status
          'repos/get-combined-status-for-ref': async (
            context: Parameters<SimulationHandler>[0],
            request: Parameters<SimulationHandler>[1],
            response: Parameters<SimulationHandler>[2]
          ) => {
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
          'repos/get-content': async (
            context: Parameters<SimulationHandler>[0],
            request: Parameters<SimulationHandler>[1],
            response: Parameters<SimulationHandler>[2]
          ) => {
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
          'git/get-blob': async (
            context: Parameters<SimulationHandler>[0],
            request: Parameters<SimulationHandler>[1],
            response: Parameters<SimulationHandler>[2]
          ) => {
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
          'git/get-tree': async (
            context: Parameters<SimulationHandler>[0],
            request: Parameters<SimulationHandler>[1],
            response: Parameters<SimulationHandler>[2]
          ) => {
            const ownerParam = context.request.params.owner;
            const repoParam = context.request.params.repo;
            const treeShaParam = context.request.params.tree_sha;
            const owner = Array.isArray(ownerParam) ? ownerParam[0] : ownerParam;
            const repo = Array.isArray(repoParam) ? repoParam[0] : repoParam;
            const treeSha = Array.isArray(treeShaParam) ? treeShaParam[0] : treeShaParam;
            const blobs = simulationStore.selectors.getBlobAtOwnerRepo(simulationStore.store.getState(), owner, repo);
            if (!blobs || !owner || !repo || !treeSha) {
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

          // GET /user
          'users/get-authenticated': async (
            _context: Parameters<SimulationHandler>[0],
            _request: Parameters<SimulationHandler>[1],
            response: Parameters<SimulationHandler>[2]
          ) => {
            const users = simulationStore.schema.users.selectTableAsList(simulationStore.store.getState());
            const user = users[0];
            const data = {
              id: parseInt(user?.id?.toString() ?? '1', 10) as number,
              login: user?.login,
              email: user?.email,
              name: user?.name
            };
            response.status(200).json(data);
          },

          // GET /user/memberships/orgs
          'orgs/list-memberships-for-authenticated-user': async (
            _context: Parameters<SimulationHandler>[0],
            _request: Parameters<SimulationHandler>[1],
            _response: Parameters<SimulationHandler>[2]
          ) => {
            const users = simulationStore.schema.users.selectTableAsList(getState());
            const user = users[0];
            const organizations = simulationStore.selectors.allGithubOrganizations(getState());
            return {
              status: 200,
              json: organizations.map((organization) => ({
                url: `${organization.url}/memberships`,
                state: 'active',
                organization,
                role: 'admin',
                organization_url: organization.url,
                user: !user ? null : user
              }))
            };
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
    document: getSchema(apiSchema),
    handlers: handlers(initialState, openapiHandlers),
    apiRoot,
    additionalOptions: {
      // starts up quicker and avoids the precompile step which throws a ton of errors
      //  based on openapi-backend handling of GitHub schema
      quick: true
    }
  }
];
