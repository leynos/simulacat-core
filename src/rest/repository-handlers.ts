/** @file Focused REST handlers and response projection for one repository. */
import type {SimulationHandlers} from '@simulacrum/foundation-simulator';
import {buildUrl, type BaseUrls} from '../http/request-url.ts';
import {updateRepositoryUseCase} from '../store/actions/repository-use-case.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';
import {observeRepositoryWrite} from '../store/repository-observability.ts';
import {projectOrganizationUrls, projectRepositoryUrls} from '../urls/index.ts';
import {urlPathSegment} from '../urls/shared.ts';
import {buildUpdateRepositoryCommand} from './repository-patch.ts';

type SimulationHandler = SimulationHandlers[string];
type Ctx = Parameters<SimulationHandler>[0];
type Req = Parameters<SimulationHandler>[1];
type Res = Parameters<SimulationHandler>[2];

const notFound = {message: 'Not Found'};

/** Supplies the fallback only when the URL is undefined, retaining an explicit null. */
const withFallbackUrl = (value: string | null | undefined, fallback: string): string | null => {
  return value === undefined ? fallback : value;
};

/** Projects a user owner with the REST URL fields expected in repository payloads. */
const projectUserOwnerResponse = (owner: any, baseUrls: BaseUrls) => {
  const userPath = `/users/${urlPathSegment(owner.login)}`;
  return {
    ...owner,
    type: 'User',
    url: withFallbackUrl(owner.url, buildUrl(baseUrls.apiBaseUrl, userPath)),
    html_url: withFallbackUrl(owner.html_url, buildUrl(baseUrls.webBaseUrl, `/${urlPathSegment(owner.login)}`)),
    followers_url: withFallbackUrl(owner.followers_url, buildUrl(baseUrls.apiBaseUrl, `${userPath}/followers`)),
    following_url: withFallbackUrl(
      owner.following_url,
      buildUrl(baseUrls.apiBaseUrl, `${userPath}/following{/other_user}`)
    ),
    gists_url: withFallbackUrl(owner.gists_url, buildUrl(baseUrls.apiBaseUrl, `${userPath}/gists{/gist_id}`)),
    starred_url: withFallbackUrl(
      owner.starred_url,
      buildUrl(baseUrls.apiBaseUrl, `${userPath}/starred{/owner}{/repo}`)
    ),
    subscriptions_url: withFallbackUrl(
      owner.subscriptions_url,
      buildUrl(baseUrls.apiBaseUrl, `${userPath}/subscriptions`)
    ),
    organizations_url: withFallbackUrl(owner.organizations_url, buildUrl(baseUrls.apiBaseUrl, `${userPath}/orgs`)),
    received_events_url: withFallbackUrl(
      owner.received_events_url,
      buildUrl(baseUrls.apiBaseUrl, `${userPath}/received_events`)
    )
  };
};

/** Projects an organization owner with repository-owner URL fields. */
const projectOrganizationOwnerResponse = (owner: any, baseUrls: BaseUrls) => {
  const projected = projectOrganizationUrls(owner, baseUrls);
  const userPath = `/users/${urlPathSegment(projected.login)}`;
  return {
    ...projected,
    followers_url: withFallbackUrl(projected.followers_url, buildUrl(baseUrls.apiBaseUrl, `${userPath}/followers`)),
    following_url: withFallbackUrl(
      projected.following_url,
      buildUrl(baseUrls.apiBaseUrl, `${userPath}/following{/other_user}`)
    ),
    gists_url: withFallbackUrl(projected.gists_url, buildUrl(baseUrls.apiBaseUrl, `${userPath}/gists{/gist_id}`)),
    starred_url: withFallbackUrl(
      projected.starred_url,
      buildUrl(baseUrls.apiBaseUrl, `${userPath}/starred{/owner}{/repo}`)
    ),
    subscriptions_url: withFallbackUrl(
      projected.subscriptions_url,
      buildUrl(baseUrls.apiBaseUrl, `${userPath}/subscriptions`)
    ),
    organizations_url: withFallbackUrl(projected.organizations_url, buildUrl(baseUrls.apiBaseUrl, `${userPath}/orgs`)),
    received_events_url: withFallbackUrl(
      projected.received_events_url,
      buildUrl(baseUrls.apiBaseUrl, `${userPath}/received_events`)
    )
  };
};

/**
 * Projects a selected repository and its resolved user or organization owner.
 *
 * @param repository Selected repository with a resolved owner object.
 * @param baseUrls Request-scoped API and web URL bases.
 * @returns Repository REST response with owner URL fields populated.
 */
export const projectRepositoryResponse = (repository: any, baseUrls: BaseUrls) => {
  const projected = projectRepositoryUrls(repository, baseUrls);
  const owner = projected.owner as any;
  if (!owner || typeof owner !== 'object') return projected;
  return {
    ...projected,
    owner:
      owner.type === 'Organization'
        ? projectOrganizationOwnerResponse(owner, baseUrls)
        : projectUserOwnerResponse(owner, baseUrls)
  };
};

type RepositoryHandlerArgs = {
  simulationStore: ExtendedSimulationStore;
  getState: () => ReturnType<ExtendedSimulationStore['store']['getState']>;
  baseUrlsFor: (request: Req) => BaseUrls;
};

/**
 * Creates the GET and PATCH handlers for one selected repository.
 *
 * @param simulationStore Shared simulation store and selectors.
 * @param getState Reads the current store state.
 * @param baseUrlsFor Builds request-scoped URL bases.
 * @returns OpenAPI handlers for repository GET and PATCH operations.
 */
export const createRepositoryHandlers = ({
  simulationStore,
  getState,
  baseUrlsFor
}: RepositoryHandlerArgs): Pick<SimulationHandlers, 'repos/get' | 'repos/update'> => ({
  'repos/get': async (context: Ctx, request: Req, response: Res) => {
    const {owner, repo} = context.request.params as {owner: string; repo: string};
    const repository = simulationStore.selectors.getRepositoryWithOwner(getState(), owner, repo);
    if (!repository) return response.status(404).json(notFound);
    return response.status(200).json(projectRepositoryResponse(repository, baseUrlsFor(request)));
  },
  'repos/update': async (context: Ctx, request: Req, response: Res) => {
    const {owner, repo} = context.request.params as {owner: string; repo: string};
    const command = buildUpdateRepositoryCommand({owner, name: repo, body: request.body});
    const result = await updateRepositoryUseCase(simulationStore, command);
    if (!result.ok) {
      observeRepositoryWrite({operation: 'patch', outcome: 'not-found', reason: 'missing-repository'});
      return response.status(404).json(notFound);
    }
    const repository = simulationStore.selectors.getRepositoryWithOwner(getState(), owner, repo);
    if (!repository) {
      observeRepositoryWrite({operation: 'patch', outcome: 'not-found', reason: 'unshaped-repository'});
      return response.status(404).json(notFound);
    }
    observeRepositoryWrite({operation: 'patch', outcome: 'success'});
    return response.status(200).json(projectRepositoryResponse(repository, baseUrlsFor(request)));
  }
});
