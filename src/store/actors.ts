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

const parseAppActor = (rawIdentifier: string): RequestActor => {
  const appId = parsePositiveInteger(rawIdentifier);
  return appId === undefined ? {kind: 'app', slug: rawIdentifier} : {kind: 'app', appId};
};

const parseInstallationActor = (rawIdentifier: string): RequestActor | undefined => {
  const installationId = parsePositiveInteger(rawIdentifier);
  return installationId === undefined ? undefined : {kind: 'installation', installationId};
};

const parseKindedActor = (kind: string, rawIdentifier: string): RequestActor | undefined => {
  switch (kind) {
    case 'user':
      return {kind: 'user', login: rawIdentifier};
    case 'app':
      return parseAppActor(rawIdentifier);
    case 'installation':
      return parseInstallationActor(rawIdentifier);
    default:
      return undefined;
  }
};

export const parseActorHeaderValue = (headerValue: string): RequestActor | undefined => {
  const value = headerValue.trim();
  if (!value || value === 'anonymous') return {kind: 'anonymous'};

  const separatorIndex = value.indexOf(':');
  if (separatorIndex < 0) return undefined;

  const kind = value.slice(0, separatorIndex);
  const rawIdentifier = value.slice(separatorIndex + 1).trim();
  if (!rawIdentifier) return undefined;

  return parseKindedActor(kind, rawIdentifier);
};

export const parseRequestActor = (headers: HeaderReader): RequestActor => {
  const actorHeader = headers.get(requestActorHeader);
  if (actorHeader !== null && actorHeader !== undefined) {
    return parseActorHeaderValue(actorHeader) ?? {kind: 'anonymous'};
  }

  const legacyLogin = headers.get(legacySimulacatUserHeader) ?? headers.get(legacyGitHubUserHeader);
  if (legacyLogin?.trim()) {
    return {kind: 'user', login: legacyLogin.trim()};
  }

  return {kind: 'anonymous'};
};

const resolveUserActor = (actor: UserActor, users: readonly GitHubUser[]): ResolvedRequestActor => {
  const user = users.find((candidate) => candidate.login === actor.login);
  return user ? {...actor, user} : {kind: 'anonymous'};
};

const findInstallationForApp = (
  actor: AppActor,
  installations: readonly GitHubAppInstallation[]
): GitHubAppInstallation | undefined => {
  if (actor.appId !== undefined) {
    return installations.find((candidate) => candidate.app_id === actor.appId);
  }

  return installations.find((candidate) => candidate.app_slug === actor.slug);
};

const resolveAppActor = (actor: AppActor, installations: readonly GitHubAppInstallation[]): ResolvedRequestActor => {
  const installation = findInstallationForApp(actor, installations);
  return installation ? {...actor, installation} : actor;
};

const resolveInstallationActor = (
  actor: InstallationActor,
  installations: readonly GitHubAppInstallation[]
): ResolvedRequestActor => {
  const installation = installations.find((candidate) => candidate.id === actor.installationId);
  return installation ? {...actor, installation} : actor;
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
    case 'user':
      return resolveUserActor(actor, input.users);
    case 'app':
      return resolveAppActor(actor, input.installations);
    case 'installation':
      return resolveInstallationActor(actor, input.installations);
  }
};

export const selectAuthenticatedUser = (actor: ResolvedRequestActor): GitHubUser | undefined => {
  return actor.kind === 'user' ? actor.user : undefined;
};
