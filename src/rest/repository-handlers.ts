/** @file Focused REST handlers and response projection for one repository. */
import type {SimulationHandlers} from '@simulacrum/foundation-simulator';
import {z} from 'zod';
import {buildUrl, type BaseUrls} from '../http/request-url.ts';
import {updateRepositoryUseCase} from '../store/actions/repository-use-case.ts';
import type {GitHubRepositoryWithOrganizationOwner} from '../store/index.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';
import {observeRepositoryWrite} from '../store/repository-observability.ts';
import {projectOrganizationUrls, projectRepositoryUrls, type RepositoryUrlPayload} from '../urls/index.ts';
import {urlPathSegment} from '../urls/shared.ts';
import {buildUpdateRepositoryCommand} from './repository-patch.ts';

type SimulationHandler = SimulationHandlers[string];
type Ctx = Parameters<SimulationHandler>[0];
type Req = Parameters<SimulationHandler>[1];
type Res = Parameters<SimulationHandler>[2];

/** Owner URL fields that repository owner payloads may omit. */
type RepositoryOwnerUrl =
  | 'html_url'
  | 'followers_url'
  | 'following_url'
  | 'gists_url'
  | 'starred_url'
  | 'subscriptions_url'
  | 'organizations_url'
  | 'received_events_url';

/**
 * Owner fields used by the repository response projection.
 *
 * The selector resolves either a full user/organization record or the raw
 * login string, and the record form always carries an `id` and `login`.
 */
type RepositoryOwnerAccount = {
  id: number;
  login: string;
  type?: 'User' | 'Organization';
  url?: string;
} & Partial<Record<RepositoryOwnerUrl, string | undefined>>;

const notFound = {message: 'Not Found'};

/** Supplies the fallback only when the URL is undefined, retaining an explicit null. */
const withFallbackUrl = (value: string | null | undefined, fallback: string): string | null => {
  return value === undefined ? fallback : value;
};

/** Projects the user-account URLs shared by user and organization owners. */
const projectOwnerAccountUrls = (
  owner: Pick<RepositoryOwnerAccount, 'login'> & Partial<Record<RepositoryOwnerUrl, string | undefined>>,
  baseUrls: BaseUrls
) => {
  // GitHub's REST contract addresses these fields under `/users/{login}` even
  // when the owner is an organization, so they derive from the login rather
  // than from the organization API base. Explicit values, including `null`,
  // win over the derived URL.
  const userPath = `/users/${urlPathSegment(owner.login)}`;
  const userUrl = (suffix: string): string => buildUrl(baseUrls.apiBaseUrl, `${userPath}${suffix}`);
  return {
    followers_url: withFallbackUrl(owner.followers_url, userUrl('/followers')),
    following_url: withFallbackUrl(owner.following_url, userUrl('/following{/other_user}')),
    gists_url: withFallbackUrl(owner.gists_url, userUrl('/gists{/gist_id}')),
    starred_url: withFallbackUrl(owner.starred_url, userUrl('/starred{/owner}{/repo}')),
    subscriptions_url: withFallbackUrl(owner.subscriptions_url, userUrl('/subscriptions')),
    organizations_url: withFallbackUrl(owner.organizations_url, userUrl('/orgs')),
    received_events_url: withFallbackUrl(owner.received_events_url, userUrl('/received_events'))
  };
};

/** Projects a user owner with the REST URL fields expected in repository payloads. */
const projectUserOwnerResponse = (owner: RepositoryOwnerAccount, baseUrls: BaseUrls) => {
  const userPath = `/users/${urlPathSegment(owner.login)}`;
  return {
    ...owner,
    type: 'User',
    url: withFallbackUrl(owner.url, buildUrl(baseUrls.apiBaseUrl, userPath)),
    html_url: withFallbackUrl(owner.html_url, buildUrl(baseUrls.webBaseUrl, `/${urlPathSegment(owner.login)}`)),
    ...projectOwnerAccountUrls(owner, baseUrls)
  };
};

/** Projects an organization owner with repository-owner URL fields. */
const projectOrganizationOwnerResponse = (owner: RepositoryOwnerAccount, baseUrls: BaseUrls) => {
  const projected = projectOrganizationUrls(owner, baseUrls);
  return {...projected, ...projectOwnerAccountUrls(projected, baseUrls)};
};

/**
 * Repository owner fields read by the REST response projection.
 *
 * `login` is absent only when the selector could not resolve an owner record
 * and fell back to the raw login string.
 */
const repositoryOwnerSchema = z.object({login: z.string()}).passthrough();

/**
 * Projects a selected repository and its resolved user or organization owner.
 *
 * @param repository Selected repository with a resolved owner object.
 * @param baseUrls Request-scoped API and web URL bases.
 * @returns Repository REST response with owner URL fields populated.
 */
export const projectRepositoryResponse = (
  repository: GitHubRepositoryWithOrganizationOwner | RepositoryUrlPayload,
  baseUrls: BaseUrls
) => {
  const projected = projectRepositoryUrls(repository, baseUrls);
  const owner = repositoryOwnerSchema.safeParse(projected.owner);
  if (!owner.success) return projected;
  // SAFETY: `projected.owner` is a resolved `GitHubRepositoryOwner`, and the
  // schema above has confirmed the `login` field this projection reads; the
  // selector only returns owner records that also carry `id`.
  const ownerAccount = owner.data as RepositoryOwnerAccount;
  return {
    ...projected,
    owner:
      ownerAccount.type === 'Organization'
        ? projectOrganizationOwnerResponse(ownerAccount, baseUrls)
        : projectUserOwnerResponse(ownerAccount, baseUrls)
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
    // SAFETY: the OpenAPI route template declares `owner` and `repo` segments,
    // and openapi-backend fills them from the matched path.
    const {owner, repo} = context.request.params as {owner: string; repo: string};
    const repository = simulationStore.selectors.getRepositoryWithOwner(getState(), owner, repo);
    if (!repository) return response.status(404).json(notFound);
    return response.status(200).json(projectRepositoryResponse(repository, baseUrlsFor(request)));
  },
  'repos/update': async (context: Ctx, request: Req, response: Res) => {
    // SAFETY: the OpenAPI route template declares `owner` and `repo` segments,
    // and openapi-backend fills them from the matched path.
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
