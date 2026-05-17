/**
 * @file Request-scoped actor parsing and selection helpers.
 *
 * This module keeps simulator actor policy out of REST and GraphQL adapters.
 * Adapters provide headers; selectors provide fixture rows; this module owns
 * the shared interpretation.
 */
import type {GitHubAppInstallation, GitHubUser} from './entities.ts';

export const requestActorHeader = 'x-simulacat-actor';
export const legacySimulacatUserHeader = 'x-simulacat-user';
export const legacyGitHubUserHeader = 'x-github-user';

export type HeaderReader = {
  get(name: string): string | null | undefined;
};

export type AnonymousActor = {
  kind: 'anonymous';
};

export type UserActor = {
  kind: 'user';
  login: string;
};

export type AppActor = {
  kind: 'app';
  appId?: number;
  slug?: string;
};

export type InstallationActor = {
  kind: 'installation';
  installationId: number;
};

export type RequestActor = AnonymousActor | UserActor | AppActor | InstallationActor;

export type ResolvedRequestActor =
  | AnonymousActor
  | (UserActor & {user: GitHubUser})
  | (AppActor & {installation?: GitHubAppInstallation})
  | (InstallationActor & {installation?: GitHubAppInstallation});

const positiveIntegerPattern = /^[1-9]\d*$/;

const parsePositiveInteger = (input: string): number | undefined => {
  if (!positiveIntegerPattern.test(input)) return undefined;
  const value = Number(input);
  return Number.isSafeInteger(value) ? value : undefined;
};

export const parseActorHeaderValue = (headerValue: string): RequestActor | undefined => {
  const value = headerValue.trim();
  if (!value || value === 'anonymous') return {kind: 'anonymous'};

  const separatorIndex = value.indexOf(':');
  if (separatorIndex < 0) return undefined;

  const kind = value.slice(0, separatorIndex);
  const rawIdentifier = value.slice(separatorIndex + 1).trim();
  if (!rawIdentifier) return undefined;

  switch (kind) {
    case 'user':
      return {kind: 'user', login: rawIdentifier};
    case 'app': {
      const appId = parsePositiveInteger(rawIdentifier);
      return appId === undefined ? {kind: 'app', slug: rawIdentifier} : {kind: 'app', appId};
    }
    case 'installation': {
      const installationId = parsePositiveInteger(rawIdentifier);
      return installationId === undefined ? undefined : {kind: 'installation', installationId};
    }
    default:
      return undefined;
  }
};

export const parseRequestActor = (headers: HeaderReader): RequestActor => {
  const actorHeader = headers.get(requestActorHeader);
  if (actorHeader) {
    return parseActorHeaderValue(actorHeader) ?? {kind: 'anonymous'};
  }

  const legacyLogin = headers.get(legacySimulacatUserHeader) ?? headers.get(legacyGitHubUserHeader);
  if (legacyLogin?.trim()) {
    return {kind: 'user', login: legacyLogin.trim()};
  }

  return {kind: 'anonymous'};
};

export const resolveRequestActor = (
  actor: RequestActor,
  input: {
    users: readonly GitHubUser[];
    installations: readonly GitHubAppInstallation[];
  }
): ResolvedRequestActor => {
  switch (actor.kind) {
    case 'anonymous':
      return actor;
    case 'user': {
      const user = input.users.find((candidate) => candidate.login === actor.login);
      return user ? {...actor, user} : {kind: 'anonymous'};
    }
    case 'app': {
      const installation = input.installations.find((candidate) => {
        if (actor.appId !== undefined) return candidate.app_id === actor.appId;
        return candidate.app_slug === actor.slug;
      });
      return installation ? {...actor, installation} : actor;
    }
    case 'installation': {
      const installation = input.installations.find((candidate) => candidate.id === actor.installationId);
      return installation ? {...actor, installation} : actor;
    }
  }
};

export const selectAuthenticatedUser = (actor: ResolvedRequestActor): GitHubUser | undefined => {
  return actor.kind === 'user' ? actor.user : undefined;
};
