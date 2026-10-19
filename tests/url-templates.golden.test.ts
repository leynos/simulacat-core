/** @file Store-level assertions for host-agnostic parsed fixtures. */
import {describe, expect, it} from 'bun:test';
import {z} from 'zod';
import {
  buildBranchFixture,
  buildCommitFixture,
  buildIssueFixture,
  buildPullRequestFixture,
  buildRefFixture,
  buildRepositoryFixture
} from '../src/store/builders.ts';
import {githubOrganizationSchema} from '../src/store/entities/organization.ts';

const owner = 'lovely-org';
const repo = 'awesome-repo';
const commitSha = 'abcdef1234567890';
const parentSha = '1234567890abcdef';
const treeSha = 'tree-sha';

/** Any value a parsed fixture snapshot can contain. */
type UrlSnapshotValue = string | number | boolean | null | UrlSnapshot | UrlSnapshotValue[];

/** A parsed fixture object whose URL-shaped fields are collected. */
interface UrlSnapshot {
  readonly [key: string]: UrlSnapshotValue | undefined;
}

const urlSnapshotValueSchema: z.ZodType<UrlSnapshotValue, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(urlSnapshotValueSchema), urlSnapshotSchema])
);

const urlSnapshotSchema: z.ZodType<UrlSnapshot, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.record(z.string(), urlSnapshotValueSchema.optional())
);

/** Checks whether a value is a plain object that can contain URL fields. */
const isRecord = <T>(value: T): value is T & UrlSnapshot => urlSnapshotSchema.safeParse(value).success;

/** Checks whether a collected subtree should be kept in the snapshot. */
const hasSnapshotFields = (value: UrlSnapshotValue | undefined): value is UrlSnapshotValue => {
  if (z.array(z.unknown()).safeParse(value).success) return true;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return value !== undefined;
};

/** Checks whether a fixture key is a URL-bearing field. */
const isUrlField = (key: string): boolean => {
  return key === 'url' || key.endsWith('_url');
};

/** Recursively extracts URL-shaped fields from parsed fixtures. */
const collectUrlFields = <T>(value: T): UrlSnapshot | UrlSnapshotValue[] | undefined => {
  const arrayValue = z.array(z.unknown()).safeParse(value);

  if (arrayValue.success) {
    const collected = arrayValue.data.map((item) => collectUrlFields(item)).filter((item) => hasSnapshotFields(item));
    return collected.length > 0 ? collected : undefined;
  }

  if (!isRecord(value)) return undefined;

  const entries = Object.entries(value).flatMap(([key, item]) => {
    if (isUrlField(key)) return [[key, item] as const];

    const nested = collectUrlFields(item);
    return hasSnapshotFields(nested) ? [[key, nested] as const] : [];
  });

  return Object.fromEntries(entries);
};

describe('host-agnostic fixture URL fields', () => {
  it('does not synthesize URL fields while parsing fixtures', () => {
    const fixtures = {
      repository: buildRepositoryFixture({owner, name: repo}),
      issue: buildIssueFixture({owner, repo, number: 7, title: 'A seeded issue'}),
      pullRequest: buildPullRequestFixture({
        owner,
        repo,
        number: 8,
        title: 'A seeded pull request',
        base: {ref: 'main', sha: parentSha},
        head: {ref: 'feature/rest-urls', sha: commitSha}
      }),
      organization: githubOrganizationSchema.parse({login: owner}),
      commit: buildCommitFixture({
        owner,
        repo,
        sha: commitSha,
        commit: {
          tree: {sha: treeSha},
          parents: [{sha: parentSha}]
        }
      }),
      ref: buildRefFixture({
        owner,
        repo,
        qualifiedName: 'main',
        object: {type: 'commit', sha: commitSha}
      }),
      branch: buildBranchFixture({
        owner,
        repo,
        name: 'main',
        commit: {sha: commitSha}
      })
    };

    expect(collectUrlFields(fixtures)).toEqual({});
  });
});
