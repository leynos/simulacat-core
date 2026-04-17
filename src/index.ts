/** @file Public entry point for building and seeding a Simulacat Core server. */
import {
  createFoundationSimulationServer,
  type SimulationHandlers,
  type FoundationSimulator,
  type SimulationStore as FoundationSimulationStore
} from '@simulacrum/foundation-simulator';

import {
  type ExtendedSimulationStore,
  extendStore as mergeStoreConfig,
  type GitHubExtendStoreInput
} from './store/index.ts';
import {extendRouter} from './extend-api.ts';
import {openapi} from './rest/index.ts';
import {type GitHubInitialStore, githubInitialStoreSchema} from './store/entities.ts';
import type {SchemaFile} from './utils.ts';

export type InitialState = GitHubInitialStore;

type FoundationRouter = Parameters<
  NonNullable<Parameters<typeof createFoundationSimulationServer>[0]['extendRouter']>
>[0];

export type GitHubSimulatorArgs = {
  initialState?: GitHubInitialStore;
  apiUrl?: string;
  apiSchema?: SchemaFile | string;
  extend?: {
    extendStore?: GitHubExtendStoreInput;
    openapiHandlers?: (simulationStore: ExtendedSimulationStore) => SimulationHandlers;
    extendRouter?: (router: FoundationRouter, simulationStore: ExtendedSimulationStore) => void;
  };
};

// derive the concrete generic parameters from the exported ExtendedSimulationStore
type _GitHubSchema =
  ExtendedSimulationStore extends FoundationSimulationStore<infer S, infer _A, infer _Sel> ? S : never;
type _GitHubActions =
  ExtendedSimulationStore extends FoundationSimulationStore<infer _S, infer A, infer _Sel> ? A : never;
type _GitHubSelectors =
  ExtendedSimulationStore extends FoundationSimulationStore<infer _S, infer _A, infer Sel> ? Sel : never;

/**
 * Builds a GitHub API simulation server from seeded state and optional
 * extensions.
 *
 * @example
 * ```ts
 * const app = simulation({
 *   initialState: {
 *     users: [{login: 'octocat', organizations: []}],
 *     organizations: [{login: 'frontside'}],
 *     repositories: [{owner: 'frontside', name: 'simulacat'}],
 *     branches: [{owner: 'frontside', repo: 'simulacat', name: 'main'}],
 *     blobs: []
 *   }
 * });
 * ```
 */
export const simulation = (args: GitHubSimulatorArgs = {}): FoundationSimulator<ExtendedSimulationStore> => {
  const parsedInitialState = !args?.initialState ? undefined : githubInitialStoreSchema.parse(args?.initialState);
  const extendStoreConfig = mergeStoreConfig(parsedInitialState, args?.extend?.extendStore);

  return createFoundationSimulationServer<_GitHubSchema, _GitHubActions, _GitHubSelectors>({
    port: 3300, // default port
    simulationContextPage: '/simulation',
    extendStore: extendStoreConfig,
    extendRouter: extendRouter(args?.extend?.extendRouter),
    openapi: openapi(
      parsedInitialState,
      args?.apiUrl ?? '/',
      args?.apiSchema ?? 'api.github.com.json',
      args?.extend?.openapiHandlers
    )
  })();
};

export {
  githubUserSchema,
  githubOrganizationSchema,
  githubRepositorySchema,
  githubBranchSchema,
  githubBlobSchema
} from './store/entities.ts';
