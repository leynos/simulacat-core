/**
 * @file Express router extension hooks for the simulation server.
 *
 * This module composes caller-provided router extensions with the built-in
 * routes supplied to `createFoundationSimulationServer`, wiring in GraphQL via
 * `createHandler` and exposing the shared `ExtendedSimulationStore`.
 */
import type {createFoundationSimulationServer} from '@simulacrum/foundation-simulator';
import {stringify} from 'querystring';
import {createHandler} from './graphql/handler.ts';
import {normalizeGitRefPath} from './rest/utils.ts';
import {getActorObservabilityMetrics} from './store/actors.ts';
import type {ExtendedSimulationStore} from './store/index.ts';

/**
 * The `extendRouter` callback shape expected by
 * `createFoundationSimulationServer`.
 *
 * Derived from the parameter types of the `extendRouter` option so callers
 * do not need to import it directly.
 */
type FoundationExtendRouter = NonNullable<Parameters<typeof createFoundationSimulationServer>[0]['extendRouter']>;

/** Shared 404 JSON payload returned by routes that cannot locate a resource. */
const notFound = {message: 'Not Found'};

/**
 * Wraps a caller-provided router extension with Simulacat Core's built-in
 * routes.
 *
 * @example
 * ```ts
 * const router = extendRouter((app) => {
 *   app.get('/hello', (_request, response) => response.json({ok: true}));
 * });
 * ```
 */
export const extendRouter =
  (
    extend:
      | ((router: Parameters<FoundationExtendRouter>[0], simulationStore: ExtendedSimulationStore) => void)
      | undefined
  ) =>
  (router: Parameters<FoundationExtendRouter>[0], simulationStore: ExtendedSimulationStore) => {
    if (extend) {
      extend(router, simulationStore);
    }

    router.get('/health', (_, response) => {
      response.send({status: 'ok'});
    });

    router.get('/metrics', (_, response) => {
      response.type('text/plain; version=0.0.4').send(getActorObservabilityMetrics());
    });

    router.use('/graphql', createHandler(simulationStore));

    router.get('/repos/:owner/:repo/git/ref/*ref', (request, response) => {
      const {owner, repo, ref} = request.params as {owner: string; repo: string; ref: string[]};
      const qualifiedName = normalizeGitRefPath(ref.join('/'));
      const state = simulationStore.store.getState();
      const repository = simulationStore.selectors.getRepository(state, owner, repo);
      const item = repository ? simulationStore.selectors.getRef(state, {owner, repo, qualifiedName}) : undefined;

      if (!item) return response.status(404).json(notFound);
      return response.status(200).json(item);
    });

    router.get(['/login/oauth/authorize'], (request, response) => {
      const {redirect_uri, state, env} = request.query as {
        [k: string]: string;
      };
      const code = 'dev_code';
      const qs = stringify({
        code,
        env,
        state
      });

      const routerUrl = `${redirect_uri}?${qs}`;
      response.status(302).redirect(routerUrl);
    });

    router.post(['/login/oauth/access_token', '/api/v3/app/installations/:id/access_tokens'], (_request, response) => {
      // for /login/oauth/access_token
      const access_token = 'dev_access_token';
      // for /app/installations/:id/access_tokens
      const token = 'dev_token';
      const refresh_token = 'dev_refresh_token';
      const repository_selection = 'all';
      response.status(200).json({
        access_token,
        refresh_token,
        token,
        repository_selection
      });
    });
  };
