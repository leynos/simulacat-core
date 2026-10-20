/** @file Store schema, selectors, and extension wiring for GitHub fixtures. */
import type {
  SimulationStore,
  ExtendSimulationSchema,
  ExtendSimulationSchemaInput,
  ExtendSimulationActions,
  ExtendSimulationActionsInput,
  ExtendSimulationSelectors,
  ExtendSimulationSelectorsInput,
  AnyState,
  ExtendSimulationActionsInputLoose,
  ExtendSimulationSelectorsInputLoose,
  ExtendStoreConfig
} from '@simulacrum/foundation-simulator';
import type {ActionWithPayload} from 'starfx';
import {
  convertInitialStateToStoreState,
  type GitHubStore,
  type GitHubBlob,
  type GitHubOrganization,
  type GitHubRepository,
  type GitHubUser,
  type GitHubBranch,
  type GitHubAppInstallation,
  type GitHubRef,
  type GitHubCommit,
  type GitHubIssue,
  type GitHubPullRequest
} from './entities.ts';
import {buildDomainActions} from './actions/index.ts';
import {buildEarlyEntitySelectors, type EarlyEntitySelectorArgs} from './early-entity-selectors.ts';
import {branchStoreKey, repositoryStoreKey} from './keys.ts';

/** Stateless parameter-extractor selectors, hoisted outside inputSelectors
 * to keep its cyclomatic complexity within acceptable bounds. */
const selectOwnerParam = (_state: AnyState, owner: string): string => owner;
const selectRepoParam = (_state: AnyState, _owner: string, repo: string): string => repo;
const selectShaOrPathParam = (_state: AnyState, _owner: string, _repo: string, shaOrPath: string): string => shaOrPath;

/** Returns `slice.table` options for one seeded store table. */
const tableOptions = <K extends keyof NonNullable<ReturnType<typeof convertInitialStateToStoreState>>>(
  storeInitialState: ReturnType<typeof convertInitialStateToStoreState>,
  key: K
) => {
  if (!storeInitialState) return {};
  return {initialState: storeInitialState[key]};
};

type ExtendedSchema = ReturnType<typeof inputSchema>;
type ExtendActions = typeof inputActions;
type ExtendSelectors = typeof inputSelectors;

// Concrete, exported types for downstream consumers to import and use
// when they need to reference the GitHub package's store generics.
export type GitHubSchema = ReturnType<ExtendedSchema>;
export type GitHubActions = ReturnType<ExtendActions>;
export type GitHubSelectors = ReturnType<ExtendSelectors>;

/**
 * Caller-supplied store action extensions.
 *
 * Every starfx thunk is a callable action creator, so the extension slot is
 * typed by the creator's owner contract rather than `Record<string, unknown>`.
 * The rest parameter stays `never[]` so creators with any payload shape (or
 * none) remain assignable without discarding their return contract.
 */
type ActionCreator = (...args: never[]) => ActionWithPayload<unknown>;

/** Caller-supplied store action extensions keyed by action name. */
export type GitHubActionExtensions = Record<string, ActionCreator>;

export type ExtendedSimulationStore = SimulationStore<GitHubSchema, GitHubActions, GitHubSelectors>;

/**
 * Public type for consumers of this package to declare the shape of an
 * `extendStore` argument. This wires the foundation `ExtendStoreConfig`
 * generics to the concrete GitHub schema/actions/selectors types so callers
 * get accurate typing when they provide schema/actions/selectors extensions.
 */
export type GitHubExtendStoreInput = Omit<
  ExtendStoreConfig<GitHubSchema, GitHubActions & GitHubActionExtensions, GitHubSelectors>,
  'schema'
> & {
  schema?: ExtendSimulationSchemaInput<GitHubSchema>;
};

export type GitHubOrganizationWithRepositories = GitHubOrganization & {
  repositories: GitHubRepository[];
};

export type GitHubAppInstallationWithAccount = Omit<GitHubAppInstallation, 'account'> & {
  account: GitHubOrganization;
  target_id?: GitHubOrganization['id'];
  target_type?: GitHubOrganization['type'];
};

export type GitHubRepoOwner = Omit<GitHubOrganization, 'name' | 'email'> & {
  id: number;
};

/**
 * Public projection of a user-owned repository owner.
 *
 * Deliberately omits internal-only user fields (notably `email`, `name`, `bio`,
 * and `organizations`) so REST and GraphQL responses never leak them through the
 * repository owner slot.
 */
export type GitHubPublicUserOwner = {
  id: GitHubUser['id'];
  login: GitHubUser['login'];
  type: 'User';
  avatar_url: GitHubUser['avatar_url'];
  url?: GitHubUser['url'];
};

export type GitHubRepositoryOwner = GitHubRepoOwner | GitHubPublicUserOwner;

export type GitHubRepositoryWithOrganizationOwner = Omit<GitHubRepository, 'id' | 'owner'> & {
  id: number;
  owner: GitHubRepositoryOwner | string;
};

/** Creates the base store schema and seeds it from parsed initial state. */
const inputSchema =
  <T>(initialState?: GitHubStore, extendedSchema?: ExtendSimulationSchemaInput<T>) =>
  ({slice}: ExtendSimulationSchema) => {
    const storeInitialState = convertInitialStateToStoreState(initialState);
    const extended = extendedSchema ? extendedSchema({slice}) : {};
    const slices = {
      users: slice.table<GitHubUser>(tableOptions(storeInitialState, 'users')),
      installations: slice.table<GitHubAppInstallation>(tableOptions(storeInitialState, 'installations')),
      repositories: slice.table<GitHubRepository>(tableOptions(storeInitialState, 'repositories')),
      branches: slice.table<GitHubBranch>(tableOptions(storeInitialState, 'branches')),
      organizations: slice.table<GitHubOrganization>(tableOptions(storeInitialState, 'organizations')),
      blobs: slice.table<GitHubBlob>(tableOptions(storeInitialState, 'blobs')),
      refs: slice.table<GitHubRef>(tableOptions(storeInitialState, 'refs')),
      commits: slice.table<GitHubCommit>(tableOptions(storeInitialState, 'commits')),
      issues: slice.table<GitHubIssue>(tableOptions(storeInitialState, 'issues')),
      pullRequests: slice.table<GitHubPullRequest>(tableOptions(storeInitialState, 'pullRequests')),
      ...extended
    };
    return slices;
  };

/** Returns the package's built-in action set before caller extensions. */
const inputActions = (args: ExtendSimulationActions<ExtendedSchema>) => {
  return buildDomainActions(args);
};

/** Merges built-in actions with caller-provided extensions. */
const extendActions =
  (extendedActions?: ExtendSimulationActionsInputLoose<GitHubActions & GitHubActionExtensions, GitHubSchema>) =>
  (args: ExtendSimulationActions<ExtendedSchema>) => {
    const base = inputActions(args);
    if (!extendedActions) return base;
    // Caller extensions are merged first so the built-in action set always
    // wins on a name collision; `Partial<Actions> | Actions` is the owner
    // contract supplied by the foundation simulator's loose input type.
    return Object.assign({}, extendedActions(args), base);
  };

/** Reshapes a GitHub organisation into the repository owner subset. */
const toRepoOwner = (org: GitHubOrganization): GitHubRepoOwner => ({
  id: Number(org.id),
  login: org.login,
  node_id: org.node_id,
  type: org.type,
  description: org.description,
  created_at: org.created_at,
  teams: org.teams,
  avatar_url: org.avatar_url,
  gravatar_id: org.gravatar_id,
  site_admin: org.site_admin,
  url: org.url,
  html_url: org.html_url,
  followers_url: org.followers_url,
  following_url: org.following_url,
  gists_url: org.gists_url,
  starred_url: org.starred_url,
  subscriptions_url: org.subscriptions_url,
  organizations_url: org.organizations_url,
  repos_url: org.repos_url,
  events_url: org.events_url,
  received_events_url: org.received_events_url,
  hooks_url: org.hooks_url,
  issues_url: org.issues_url,
  members_url: org.members_url,
  public_members_url: org.public_members_url
});

/** Projects a seeded user into the public repository-owner subset. */
const toPublicUserOwner = (user: GitHubUser): GitHubPublicUserOwner => ({
  id: user.id,
  login: user.login,
  type: 'User',
  avatar_url: user.avatar_url,
  url: user.url
});

/** Resolves the shaped owner object for a repository identity. */
const resolveRepositoryOwner = (
  organizations: Record<string, GitHubOrganization> | undefined,
  users: Record<string, GitHubUser> | undefined,
  owner: string
): GitHubRepositoryOwner | string => {
  const organization = organizations?.[owner];
  if (organization) return toRepoOwner(organization);
  const user = users?.[owner];
  return user ? toPublicUserOwner(user) : owner;
};

type RepositoryWithOwnerSchema = Pick<
  ExtendSimulationSelectors<ExtendedSchema>['schema'],
  'organizations' | 'repositories' | 'users'
>;

/** Builds a keyed repository selector that projects its user or organization owner. */
const buildRepositoryWithOwnerSelector = (schema: RepositoryWithOwnerSchema) => {
  return (state: AnyState, owner: string, name: string): GitHubRepositoryWithOrganizationOwner | undefined => {
    const repository = schema.repositories.selectTable(state)[repositoryStoreKey({owner, name})];
    if (!repository) return undefined;
    const organizations = schema.organizations.selectTable(state);
    const users = schema.users.selectTable(state);
    return {
      ...repository,
      id: Number(repository.id),
      owner: resolveRepositoryOwner(organizations, users, repository.owner)
    };
  };
};

/** Builds selectors that join organizations and repositories. */
const buildOrganisationSelectors = ({createSelector, schema}: ExtendSimulationSelectors<ExtendedSchema>) => {
  const allGithubOrganizations: (state: AnyState) => GitHubOrganizationWithRepositories[] = createSelector(
    schema.organizations.selectTableAsList,
    schema.repositories.selectTableAsList,
    (ghOrgs, repos) => {
      return ghOrgs.map((ghOrg) => {
        const repositories = repos.filter((r) => r.owner === ghOrg.login);
        return {...ghOrg, repositories};
      });
    }
  );

  const allReposWithOrgs: (state: AnyState, org?: string) => GitHubRepositoryWithOrganizationOwner[] | undefined =
    createSelector(
      schema.repositories.selectTableAsList,
      schema.organizations.selectTable,
      schema.users.selectTable,
      (_: AnyState, org?: string) => org,
      (allRepos, orgMap, userMap, org) => {
        if (org && !orgMap[org]) return;
        const repos = org ? allRepos.filter((r) => r.owner === org) : allRepos;
        return repos.map((repo) => {
          return {
            ...repo,
            id: Number(repo.id),
            owner: resolveRepositoryOwner(orgMap, userMap, repo.owner)
          };
        });
      }
    );

  const getRepositoryWithOwner = buildRepositoryWithOwnerSelector(schema);

  return {allGithubOrganizations, allReposWithOrgs, getRepositoryWithOwner};
};

/** Resolves the GitHub organisation account for an app installation. */
const resolveInstallationAccount = (
  orgs: GitHubOrganization[],
  repos: GitHubRepository[],
  appInstall: GitHubAppInstallation,
  repo?: string
): GitHubOrganization | undefined => {
  if (repo) {
    const repoData = repos.find((r) => r.owner === appInstall.account && r.name === repo);
    return repoData ? orgs.find((o) => o.login === repoData.owner) : undefined;
  }
  return orgs.find((o) => o.login === appInstall.account);
};

/** Builds selectors that resolve GitHub App installations. */
const buildInstallationSelectors = ({createSelector, schema}: ExtendSimulationSelectors<ExtendedSchema>) => {
  const getAppInstallation: (
    state: AnyState,
    org: string,
    repo?: string
  ) => GitHubAppInstallationWithAccount | undefined = createSelector(
    schema.installations.selectTableAsList,
    schema.organizations.selectTableAsList,
    schema.repositories.selectTableAsList,
    (_state: AnyState, org: string, _repo?: string) => org,
    (_state: AnyState, _org: string, repo?: string) => repo,
    // biome-ignore lint/complexity/useMaxParams: selector API passes derived inputs positionally.
    (installations, orgs, repos, org, repo) => {
      const appInstall = installations.find((install) => install.account === org);
      if (!appInstall) return;
      const account = resolveInstallationAccount(orgs, repos, appInstall, repo);
      if (!account) return;
      return {
        ...appInstall,
        account: {...account},
        target_id: account.id,
        target_type: account.type
      };
    }
  );

  return {getAppInstallation};
};

/** Builds selectors that resolve repositories and branches. */
const buildRepositorySelectors = ({createSelector, schema}: ExtendSimulationSelectors<ExtendedSchema>) => {
  const getRepository = (state: AnyState, owner: string, name: string): GitHubRepository | undefined => {
    const key = repositoryStoreKey({owner, name});
    return schema.repositories.selectTable(state)[key];
  };

  const getBranch = (state: AnyState, owner: string, repo: string, name: string): GitHubBranch | undefined => {
    const key = branchStoreKey({owner, repo, name});
    return schema.branches.selectTable(state)[key];
  };

  const listBranchesForRepository: (state: AnyState, owner: string, repo: string) => GitHubBranch[] = createSelector(
    schema.branches.selectTableAsList,
    selectOwnerParam,
    selectRepoParam,
    (branches, owner, repo) => branches.filter((branch) => branchStoreKey(branch).startsWith(`${owner}/${repo}:`))
  );

  return {getRepository, getBranch, listBranchesForRepository};
};

/** Builds selectors that resolve repository blobs. */
const buildBlobSelectors = ({createSelector, schema}: ExtendSimulationSelectors<ExtendedSchema>) => {
  const getBlob: (state: AnyState, owner: string, repo: string, sha_or_path: string) => GitHubBlob | undefined =
    createSelector(
      schema.blobs.selectTableAsList,
      selectOwnerParam,
      selectRepoParam,
      selectShaOrPathParam,
      (blobs, owner, repo, sha_or_path) => {
        const blob = blobs.find(
          (blob) =>
            blob.owner === owner && blob.repo === repo && (blob.path === sha_or_path || blob.sha === sha_or_path)
        );
        return blob;
      }
    );

  const getBlobAtOwnerRepo: (state: AnyState, owner: string, repo: string) => GitHubBlob[] = createSelector(
    schema.blobs.selectTableAsList,
    selectOwnerParam,
    selectRepoParam,
    (blobs, owner, repo) => {
      const blob = blobs.filter((blob) => blob.owner === owner && blob.repo === repo);
      return blob;
    }
  );

  return {getBlob, getBlobAtOwnerRepo};
};

/** Selects the early-entity table seams from the generated store schema. */
const earlyEntitySelectorArgs = (args: ExtendSimulationSelectors<ExtendedSchema>): EarlyEntitySelectorArgs => ({
  createSelector: args.createSelector,
  schema: {
    refs: args.schema.refs,
    commits: args.schema.commits,
    issues: args.schema.issues,
    pullRequests: args.schema.pullRequests
  }
});

/** Creates the built-in selector suite used by REST and GraphQL handlers. */
const inputSelectors = (args: ExtendSimulationSelectors<ExtendedSchema>) => {
  return {
    ...buildOrganisationSelectors(args),
    ...buildInstallationSelectors(args),
    ...buildRepositorySelectors(args),
    ...buildBlobSelectors(args),
    ...buildEarlyEntitySelectors(earlyEntitySelectorArgs(args))
  };
};

/** Merges built-in selectors with caller-provided selector extensions. */
const extendSelectors =
  (extendedSelectors?: ExtendSimulationSelectorsInputLoose<GitHubSelectors, GitHubSchema>) =>
  (args: ExtendSimulationSelectors<ExtendedSchema>) => {
    const base = inputSelectors(args);
    if (!extendedSelectors) return base;
    // Caller selectors are merged last so an extension can override a built-in
    // selector by name; this mirrors the `openapiHandlers` seam, where callers
    // may replace built-in operations.
    return Object.assign({}, base, extendedSelectors(args));
  };

/** Store extension configuration consumed by the foundation simulator. */
export interface ExtendedStoreConfig {
  schema: ExtendSimulationSchemaInput<GitHubSchema>;
  actions?: ExtendSimulationActionsInput<GitHubActions, GitHubSchema>;
  selectors?: ExtendSimulationSelectorsInput<GitHubSelectors, GitHubSchema>;
  logs?: boolean;
}

/**
 * Builds the store extension configuration consumed by the foundation
 * simulator.
 *
 * @example
 * ```ts
 * const storeConfig = extendStore(parsedInitialState);
 * ```
 */
export const extendStore = (
  initialState: GitHubStore | undefined,
  extended?: GitHubExtendStoreInput
): ExtendedStoreConfig => {
  const config: ExtendedStoreConfig = {
    actions: extendActions(extended?.actions),
    selectors: extendSelectors(extended?.selectors),
    schema: inputSchema(initialState, extended?.schema)
  };
  if (extended?.logs !== undefined) return {...config, logs: extended.logs};
  return config;
};
