/**
 * @file OpenAPI-backed REST handlers for the simulated GitHub API.
 *
 * This module builds the default handler table used by the foundation
 * simulator's OpenAPI adapter, wires seeded store selectors into GitHub REST
 * routes, and merges caller-provided handler extensions.
 */
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Baseline route table predates the new complexity gate.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: Baseline route table predates the new length gate.
import type {Document, SimulationHandlers} from '@simulacrum/foundation-simulator';
import {buildBaseUrls, buildUrl, type BaseUrls} from '../http/request-url.ts';
import {makeUrlObservationContext} from '../http/url-observability.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';
import {
  projectBranchUrls,
  projectCommitUrls,
  projectIssueUrls,
  projectOrganizationUrls,
  projectPullRequestUrls,
  projectRefUrls,
  projectRepositoryUrls,
} from '../urls/index.ts';
import {urlPathSegment} from '../urls/shared.ts';
import {getSchema, type SchemaFile} from '../utils.ts';
import {requireRestUserActor} from './actor-context.ts';
import {blobAsBase64, commitStatusResponse, gitTrees, normalizeGitRefPath} from './utils.ts';

import {updateRepositoryUseCase} from '../store/actions/repository-use-case.ts';

import type {GitHubRepository} from '../store/entities.ts';
import {observeRepositoryWrite} from '../store/repository-observability.ts';

import {buildUpdateRepositoryCommand} from './repository-patch.ts';

/** REST handler callback shape supplied by the foundation simulator. */
type SimulationHandler = SimulationHandlers[string];

/** OpenAPI handler context parameter supplied to REST route callbacks. */
type Ctx = Parameters<SimulationHandler>[0];

/** Express-compatible request parameter supplied to REST route callbacks. */
type Req = Parameters<SimulationHandler>[1];

/** Express-compatible response parameter supplied to REST route callbacks. */
type Res = Parameters<SimulationHandler>[2];

/** Projects a selected store entity into its REST response payload. */
type RestProjector = (item: any, baseUrls: BaseUrls) => unknown;

/** Repository identity read from repository-scoped REST route params. */
type RepositoryRouteParams = {owner: string; repo: string};

/** Options for repository list handlers. */
type MakeListHandlerOptions = {project?: RestProjector};

/** Shared 404 JSON payload used by REST repository and item guards. */
const notFound = {message: 'Not Found'};

/**
 * Builds default REST handlers and merges caller-provided extensions.
 */
const handlers =
  (
    initialState: Record<string, any> | undefined,
    apiRoot: string,
    extendedHandlers: ((simulationStore: ExtendedSimulationStore) => SimulationHandlers) | undefined
  ) =>
  (simulationStore: ExtendedSimulationStore): SimulationHandlers => {
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
            const baseUrls = baseUrlsFor(request);
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
                repositories: repositories.map((repository) => projectRepositoryResponse(repository, baseUrls))
              }
            };
          },
          // L#4134 /installation/repositories
          'apps/list-repos-accessible-to-installation': async (_context: Ctx, request: Req, _response: Res) => {
            const repos = simulationStore.selectors.allReposWithOrgs(getState()) ?? [];
            const baseUrls = baseUrlsFor(request);
            return {
              status: 200,
              json: {
                total_count: repos.length,
                repositories: repos.map((repository) => projectRepositoryResponse(repository, baseUrls))
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
          'repos/list-for-org': async (context: Ctx, request: Req, response: Res) => {
            const {org} = context.request.params;
            const repos = simulationStore.selectors.allReposWithOrgs(getState(), org);
            if (!repos) return response.status(404).send('Not Found');
            const baseUrls = baseUrlsFor(request);
            return {status: 200, json: repos.map((repository) => projectRepositoryResponse(repository, baseUrls))};
          },
          // GET /repos/{owner}/{repo}
          'repos/get': async (context: Ctx, request: Req, response: Res) => {
            const {owner, repo} = context.request.params as {owner: string; repo: string};
            const repository = simulationStore.selectors
              .allReposWithOrgs(getState(), owner)
              ?.find((candidate) => candidate.name === repo);
            if (!repository) response.status(404).json(notFound);
            if (!repository) return;
            return response.status(200).json(projectRepositoryResponse(repository, baseUrlsFor(request)));
          },
          // GET /repos/{owner}/{repo}
          'repos/get': async (context: Ctx, _request: Req, response: Res) => {
            const {owner, repo} = context.request.params;
            const repository = requireRepository(owner, repo, response);
            if (!repository) return;
            const shapedRepository = shapeRepository(repository);
            if (!shapedRepository) {
              return response.status(404).json(notFound);
            }
            return response.status(200).json(shapedRepository);
          },
          // PATCH /repos/{owner}/{repo}
          'repos/update': async (context: Ctx, request: Req, response: Res) => {
            const {owner, repo} = context.request.params;
            const command = buildUpdateRepositoryCommand({owner, name: repo, body: request.body});
            const result = await updateRepositoryUseCase(simulationStore, command);
            if (!result.ok) {
              observeRepositoryWrite({operation: 'patch', outcome: 'not-found', reason: 'missing-repository'});
              return response.status(404).json(notFound);
            }
            const shapedRepository = shapeRepository(result.repository);
            if (!shapedRepository) {
              observeRepositoryWrite({operation: 'patch', outcome: 'not-found', reason: 'unshaped-repository'});
              return response.status(404).json(notFound);
            }
            observeRepositoryWrite({operation: 'patch', outcome: 'success'});
            return response.status(200).json(shapedRepository);
          },
          // L#29067 /repos/{owner}/{repo}/branches
          'repos/list-branches': async (context: Ctx, request: Req, response: Res) => {
            const {owner, repo} = context.request.params;
            if (!requireRepository(owner, repo, response)) return;
            const branches = simulationStore.selectors.listBranchesForRepository(getState(), owner, repo);
            const baseUrls = baseUrlsFor(request);
            return {status: 200, json: branches.map((branch) => projectBranchUrls(branch, baseUrls))};
          },
          // GET /repos/{owner}/{repo}/commits/{ref}/status
          'repos/get-combined-status-for-ref': async (context: Ctx, request: Req, response: Res) => {
            const {owner, repo, ref} = context.request.params;
            const {apiBaseUrl} = baseUrlsFor(request);
            const commitStatus = commitStatusResponse({
              apiBaseUrl,
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
              const {apiBaseUrl} = baseUrlsFor(request);
              const data = blobAsBase64({
                blob,
                apiBaseUrl,
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
              const {apiBaseUrl} = baseUrlsFor(request);
              const data = blobAsBase64({
                blob,
                apiBaseUrl,
                owner,
                repo,
                ref: file_sha,
                kind: 'git-blob'
              });
              response.status(200).json(data);
            }
          },
          // GET /repos/{owner}/{repo}/git/trees/{tree_sha}
          // OpenAPI handler normalizes route params and response fallbacks inline.
          // oxlint-disable-next-line complexity
          'git/get-tree': async (context: Ctx, request: Req, response: Res) => {
            const ownerParam = context.request.params.owner;
            const repoParam = context.request.params.repo;
            const treeShaParam = context.request.params.tree_sha;
            const owner = Array.isArray(ownerParam) ? ownerParam[0] : ownerParam;
            const repo = Array.isArray(repoParam) ? repoParam[0] : repoParam;
            const treeSha = Array.isArray(treeShaParam) ? treeShaParam[0] : treeShaParam;
            let repository;
            if (owner && repo) {
              repository = simulationStore.selectors.getRepository(simulationStore.store.getState(), owner, repo);
            }
            const blobs = simulationStore.selectors.getBlobAtOwnerRepo(simulationStore.store.getState(), owner, repo);
            const missingTreeFixture = !owner || !repo || !treeSha || !repository;
            if (missingTreeFixture) {
              response.status(404).send('fixture does not exist');
            } else {
              const {apiBaseUrl} = baseUrlsFor(request);
              const tree = gitTrees({
                blobs,
                apiBaseUrl,
                owner,
                repo,
                ref: treeSha
              });
              response.status(200).json(tree);
            }
          },
          // GET /repos/{owner}/{repo}/git/ref/{ref}
          'git/get-ref': makeItemHandler(
            'ref',
            (state, owner, repo, ref) =>
              simulationStore.selectors.getRef(state, {owner, repo, qualifiedName: normalizeGitRefPath(String(ref))}),
            (value) => value,
            projectRefUrls
          ),
          // GET /repos/{owner}/{repo}/git/commits/{commit_sha}
          'git/get-commit': makeItemHandler(
            'commit_sha',
            (state, owner, repo, sha) => simulationStore.selectors.getCommit(state, {owner, repo, sha: String(sha)}),
            (value) => value,
            projectCommitUrls
          ),
          // GET /repos/{owner}/{repo}/issues
          'issues/list-for-repo': makeListHandler(
            (state, repository) => simulationStore.selectors.listIssuesForRepository(state, repository),
            {project: projectIssueUrls}
          ),
          // GET /repos/{owner}/{repo}/issues/{issue_number}
          'issues/get': makeItemHandler(
            'issue_number',
            (state, owner, repo, number) =>
              simulationStore.selectors.getIssue(state, {owner, repo, number: Number(number)}),
            Number,
            projectIssueUrls
          ),
          // GET /repos/{owner}/{repo}/pulls
          'pulls/list': makeListHandler(
            (state, repository) => simulationStore.selectors.listPullRequestsForRepository(state, repository),
            {project: projectPullRequestUrls}
          ),
          // GET /repos/{owner}/{repo}/pulls/{pull_number}
          'pulls/get': makeItemHandler(
            'pull_number',
            (state, owner, repo, number) =>
              simulationStore.selectors.getPullRequest(state, {owner, repo, number: Number(number)}),
            Number,
            projectPullRequestUrls
          ),

          // GET /user
          'users/get-authenticated': async (_context: Ctx, request: Req, response: Res) => {
            const result = requireRestUserActor(request, simulationStore, 'GET /user');
            if ('failure' in result) {
              return response.status(401).json({message: 'Authentication required'});
            }
            const data = {
              id: result.user.id,
              login: result.user.login,
              email: result.user.email,
              name: result.user.name
            };
            response.status(200).json(data);
          },

          // GET /user/memberships/orgs
          'orgs/list-memberships-for-authenticated-user': async (_context: Ctx, request: Req, response: Res) => {
            const result = requireRestUserActor(request, simulationStore, 'GET /user/memberships/orgs');
            if ('failure' in result) {
              return response.status(401).json({message: 'Authentication required'});
            }
            const baseUrls = baseUrlsFor(request);
            const organizations = simulationStore.selectors.allGithubOrganizations(getState());
            const memberships = organizations
              .filter((organization) => result.user.organizations.includes(organization.login))
              .map((organization) => projectOrganizationUrls(organization, baseUrls))
              .map((organization) => ({
                url: `${organization.url ?? ''}/memberships/${urlPathSegment(result.user.login)}`,
                state: 'active',
                organization,
                role: 'member',
                organization_url: organization.url,
                user: result.user
              }));
            return response.status(200).json(memberships);
          }
        };

    // note for any cases where it `return`s an object,
    //  that will validate the response per the schema

    type RepositoryListSelector = (state: StoreState, repository: RepositoryRouteParams) => unknown;

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
    handlers: handlers(initialState, apiRoot, openapiHandlers),
    apiRoot,
    additionalOptions: {
      // starts up quicker and avoids the precompile step which throws a ton of errors
      //  based on openapi-backend handling of GitHub schema
      quick: true
    }
  }
];
