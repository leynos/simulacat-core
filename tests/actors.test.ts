/** @file Unit tests for request-scoped actor parsing and resolution. */
import {describe, expect, it} from 'bun:test';
import fc from 'fast-check';
import {
  legacyGitHubUserHeader,
  legacySimulacatUserHeader,
  parseActorHeaderValue,
  parseRequestActor,
  requestActorHeader,
  resolveRequestActor,
  selectAuthenticatedUser
} from '../src/store/actors.ts';
import type {GitHubAppInstallation, GitHubUser} from '../src/store/entities.ts';

const user = (login: string): GitHubUser => ({
  id: login === 'reviewer' ? 2 : 1,
  login,
  name: login,
  bio: '',
  email: `${login}@example.test`,
  avatar_url: `https://example.test/${login}.png`,
  organizations: [],
  created_at: '2026-01-01T00:00:00.000Z'
});

const installation = (id: number, app_id: number, app_slug: string): GitHubAppInstallation => ({
  id,
  account: 'lovely-org',
  repository_selection: 'all',
  app_id,
  access_tokens_url: `https://api.example.test/app/installations/${id}/access_tokens`,
  repositories_url: `https://api.example.test/installation/repositories`,
  html_url: `https://github.example.test/apps/${app_slug}`,
  client_id: 'Iv1.example',
  target_id: 1,
  target_type: 'Organization',
  permissions: {admin: false, push: false, pull: true},
  events: [],
  updated_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  single_file_name: 'config.yml',
  has_multiple_single_files: true,
  single_file_paths: [],
  app_slug,
  suspended_at: null,
  suspended_by: null
});

const headers = (values: Record<string, string | undefined>) => ({
  get(name: string) {
    return values[name];
  }
});

describe('request actor parsing', () => {
  it('defaults to an anonymous actor when no request actor is present', () => {
    expect(parseRequestActor(headers({}))).toEqual({kind: 'anonymous'});
  });

  it('parses the preferred actor header for supported actor kinds', () => {
    expect(parseRequestActor(headers({[requestActorHeader]: 'user:dev'}))).toEqual({kind: 'user', login: 'dev'});
    expect(parseRequestActor(headers({[requestActorHeader]: 'app:42'}))).toEqual({kind: 'app', appId: 42});
    expect(parseRequestActor(headers({[requestActorHeader]: 'app:simulator-app'}))).toEqual({
      kind: 'app',
      slug: 'simulator-app'
    });
    expect(parseRequestActor(headers({[requestActorHeader]: 'installation:99'}))).toEqual({
      kind: 'installation',
      installationId: 99
    });
    expect(parseRequestActor(headers({[requestActorHeader]: 'anonymous'}))).toEqual({kind: 'anonymous'});
  });

  it('preserves compatibility user aliases', () => {
    expect(parseRequestActor(headers({[legacySimulacatUserHeader]: 'dev'}))).toEqual({kind: 'user', login: 'dev'});
    expect(parseRequestActor(headers({[legacyGitHubUserHeader]: 'reviewer'}))).toEqual({
      kind: 'user',
      login: 'reviewer'
    });
  });

  it('lets the preferred actor header override compatibility aliases', () => {
    expect(
      parseRequestActor(headers({[requestActorHeader]: 'user:reviewer', [legacySimulacatUserHeader]: 'dev'}))
    ).toEqual({kind: 'user', login: 'reviewer'});
  });

  it('treats an empty preferred actor header as authoritative anonymous input', () => {
    expect(parseRequestActor(headers({[requestActorHeader]: '', [legacySimulacatUserHeader]: 'dev'}))).toEqual({
      kind: 'anonymous'
    });
  });

  it('rejects malformed actor header values', () => {
    expect(parseActorHeaderValue('user:')).toBeUndefined();
    expect(parseActorHeaderValue('installation:0')).toBeUndefined();
    expect(parseActorHeaderValue('installation:not-a-number')).toBeUndefined();
    expect(parseActorHeaderValue('team:devs')).toBeUndefined();
  });

  it('round-trips user actor values across a range of fixture logins', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/), (login) => {
        expect(parseActorHeaderValue(`user:${login}`)).toEqual({kind: 'user', login});
      })
    );
  });

  it('round-trips app actor values across a range of positive numeric app IDs', () => {
    fc.assert(
      fc.property(fc.integer({min: 1, max: Number.MAX_SAFE_INTEGER}), (appId) => {
        expect(parseActorHeaderValue(`app:${appId}`)).toEqual({kind: 'app', appId});
      })
    );
  });

  it('round-trips installation actor values across a range of positive installation IDs', () => {
    fc.assert(
      fc.property(fc.integer({min: 1, max: Number.MAX_SAFE_INTEGER}), (installationId) => {
        expect(parseActorHeaderValue(`installation:${installationId}`)).toEqual({
          kind: 'installation',
          installationId
        });
      })
    );
  });

  it('rejects zero and negative integers in app and installation positions', () => {
    fc.assert(
      fc.property(fc.integer({max: 0}), (n) => {
        expect(parseActorHeaderValue(`installation:${n}`)).toBeUndefined();
      })
    );
  });
});

describe('request actor resolution', () => {
  const users = [user('dev'), user('reviewer')];
  const installations = [installation(99, 42, 'simulator-app')];

  it('selects the requested user actor instead of the first seeded user', () => {
    const actor = resolveRequestActor({kind: 'user', login: 'reviewer'}, {users, installations});

    expect(selectAuthenticatedUser(actor)).toEqual(expect.objectContaining({login: 'reviewer'}));
  });

  it('does not fall back to the first seeded user for unknown user actors', () => {
    const actor = resolveRequestActor({kind: 'user', login: 'missing'}, {users, installations});

    expect(selectAuthenticatedUser(actor)).toBeUndefined();
  });

  it('resolves app and installation actors for later policy use', () => {
    expect(resolveRequestActor({kind: 'app', appId: 42}, {users, installations})).toEqual(
      expect.objectContaining({kind: 'app', installation: expect.objectContaining({id: 99})})
    );
    expect(resolveRequestActor({kind: 'app', slug: 'simulator-app'}, {users, installations})).toEqual(
      expect.objectContaining({kind: 'app', installation: expect.objectContaining({id: 99})})
    );
    expect(resolveRequestActor({kind: 'installation', installationId: 99}, {users, installations})).toEqual(
      expect.objectContaining({kind: 'installation', installation: expect.objectContaining({app_id: 42})})
    );
  });

  it('returns the anonymous actor unchanged', () => {
    const actor = resolveRequestActor({kind: 'anonymous'}, {users, installations});
    expect(actor).toEqual({kind: 'anonymous'});
  });

  it('returns an app actor unchanged when no installation matches', () => {
    const actor = resolveRequestActor({kind: 'app', appId: 999}, {users, installations});
    expect(actor).toEqual({kind: 'app', appId: 999});
    expect(actor).not.toHaveProperty('installation');
  });

  it('returns an app actor unchanged when no installation matches by slug', () => {
    const actor = resolveRequestActor({kind: 'app', slug: 'unknown-app'}, {users, installations});
    expect(actor).toEqual({kind: 'app', slug: 'unknown-app'});
    expect(actor).not.toHaveProperty('installation');
  });

  it('returns an installation actor unchanged when no installation matches', () => {
    const actor = resolveRequestActor({kind: 'installation', installationId: 999}, {users, installations});
    expect(actor).toEqual({kind: 'installation', installationId: 999});
    expect(actor).not.toHaveProperty('installation');
  });
});
