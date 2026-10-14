/** @file Enforces executable examples from the published users guide. */
import {describe, expect, it} from 'bun:test';
import {join} from 'node:path';
import {
  assertExampleCoverage,
  cleanupPreparedDocumentedExamples,
  DOCUMENTED_EXAMPLE_IDS,
  prepareDocumentedExamples,
  runPreparedDocumentedExamples
} from './support/documented-example-execution.ts';
import {typeCheckExamples, writeExampleProgram, type ExampleFixture} from './support/documented-example-fixture.ts';
import {runDocumentedCommand} from './support/documented-examples-process.ts';
import {
  assertDocumentedExampleObservations,
  createDocumentedExampleObservationCollector
} from './support/documented-example-observations.ts';
import {
  loadUsersGuideExamples,
  parseDocumentedExamples,
  type DocumentedExample
} from './support/documented-examples.ts';

describe('tested users-guide examples loading', () => {
  it('loads each example from the current guide and matches the handler inventory', async () => {
    const examples = await loadUsersGuideExamples();

    assertExampleCoverage(examples);
    expect(examples.map((example) => example.id)).toEqual([...DOCUMENTED_EXAMPLE_IDS]);
  });
});

describe('tested users-guide examples marker validation', () => {
  it('accepts matching backtick and tilde fences and preserves their bodies', () => {
    const examples = parseDocumentedExamples({
      markdown: [
        '<!-- tested-example: backtick-sample -->',
        '```typescript',
        'const value = 1;',
        '```',
        '<!-- tested-example: tilde-sample -->',
        '~~~~bash',
        'printf example',
        '~~~~'
      ].join('\n'),
      sourcePath: 'fixture.md'
    });

    expect(examples.map((example) => example.body)).toEqual(['const value = 1;\n', 'printf example\n']);
  });

  it('preserves CRLF body bytes and the opener source coordinate', () => {
    const markdown = ['<!-- tested-example: crlf-sample -->', '```typescript', 'const value = 1;', '```'].join('\r\n');
    const [example] = parseDocumentedExamples({markdown, sourcePath: 'crlf-fixture.md'});

    expect(example?.body).toBe('const value = 1;\r\n');
    expect(example?.line).toBe(2);
    expect(example?.sourcePath).toBe('crlf-fixture.md');
  });
});

describe('tested users-guide examples invalid markers', () => {
  it('rejects a fence without an adjacent marker', () => {
    expect(() => parseDocumentedExamples({markdown: '```ts\nconst value = 1;\n```', sourcePath: 'fixture.md'})).toThrow(
      'fixture.md:1: fenced example is missing a tested-example marker'
    );
  });

  it('rejects an empty marker identifier', () => {
    const source = '<!-- tested-example:  -->\n```ts\nconst value = 1;\n```';

    expect(() => parseDocumentedExamples({markdown: source, sourcePath: 'fixture.md'})).toThrow(
      'fixture.md:1: tested-example identifier is missing'
    );
  });

  it('rejects duplicate identifiers and repeated or non-adjacent markers', () => {
    const duplicate = [
      '<!-- tested-example: same -->',
      '```ts',
      'first();',
      '```',
      '<!-- tested-example: same -->',
      '~~~ts',
      'second();',
      '~~~'
    ].join('\n');
    const repeated = [
      '<!-- tested-example: first -->',
      '<!-- tested-example: second -->',
      '```ts',
      'example();',
      '```'
    ].join('\n');

    expect(() => parseDocumentedExamples({markdown: duplicate, sourcePath: 'fixture.md'})).toThrow(
      'fixture.md:5: duplicate tested-example identifier "same"'
    );
    expect(() => parseDocumentedExamples({markdown: repeated, sourcePath: 'fixture.md'})).toThrow(
      'fixture.md:1: tested-example marker must immediately precede a fence'
    );
  });

  it('reports a duplicate identifier before scanning its unterminated fence', () => {
    const duplicateThenUnterminated = [
      '<!-- tested-example: same -->',
      '```ts',
      'first();',
      '```',
      '<!-- tested-example: same -->',
      '```ts',
      'second();'
    ].join('\n');

    expect(() => parseDocumentedExamples({markdown: duplicateThenUnterminated, sourcePath: 'fixture.md'})).toThrow(
      'fixture.md:5: duplicate tested-example identifier "same"'
    );
  });

  it('rejects an unterminated fence and a marker separated from its fence', () => {
    const unterminated = '<!-- tested-example: open -->\n```ts\nconst value = 1;';
    const nonAdjacent = '<!-- tested-example: separated -->\n\n```ts\nvalue();\n```';

    expect(() => parseDocumentedExamples({markdown: unterminated, sourcePath: 'fixture.md'})).toThrow(
      'fixture.md:2: unterminated tested-example fence'
    );
    expect(() => parseDocumentedExamples({markdown: nonAdjacent, sourcePath: 'fixture.md'})).toThrow(
      'fixture.md:1: tested-example marker must immediately precede a fence'
    );
  });
});

describe('tested users-guide examples execution', () => {
  it('executes every published fence and checks public declaration errors', async () => {
    const collector = createDocumentedExampleObservationCollector();
    const prepared = await prepareDocumentedExamples(DOCUMENTED_EXAMPLE_IDS, collector);

    try {
      await assertPackedArchiveContents(prepared.fixture);
      const result = await runPreparedDocumentedExamples(prepared);
      expect(result.completedIds).toEqual([...DOCUMENTED_EXAMPLE_IDS]);
      await assertDocumentedExampleObservations({
        sourceExamples: await loadUsersGuideExamples(),
        selectedIds: DOCUMENTED_EXAMPLE_IDS,
        prepared,
        collector
      });

      const invalidCall: DocumentedExample = {
        id: 'invalid-public-call-negative-control',
        language: 'typescript',
        body: ["import {repositoryNodeId} from 'simulacat-core';", "repositoryNodeId('acme', 'awesome-repo');"].join(
          '\n'
        ),
        line: 1,
        sourcePath: 'synthetic negative control'
      };
      const invalidProgram = await writeExampleProgram(prepared.fixture, invalidCall, 'invalid-public-call.ts');

      await expect(typeCheckExamples(prepared.fixture, [invalidProgram])).rejects.toThrow('TS2554');
    } finally {
      await cleanupPreparedDocumentedExamples(prepared);
    }
  }, 240_000);
});

/** Checks the installed source archive contains only the package payload. */
const assertPackedArchiveContents = async (fixture: ExampleFixture): Promise<void> => {
  const archivePath = join(fixture.consumerPath, 'simulacat-core.tgz');
  const {stdout} = await runDocumentedCommand({
    command: 'tar',
    args: ['-tzf', archivePath],
    cwd: fixture.consumerPath,
    env: fixture.environment,
    label: 'packed package archive listing',
    timeoutMs: 15_000
  });
  const entries = stdout.split(/\r?\n/).filter(Boolean);

  for (const expectedPath of [
    'package/package.json',
    'package/dist/index.mjs',
    'package/dist/index.cjs',
    'package/dist/index.d.cts',
    'package/bin/start.cjs',
    'package/schema/api.github.com.json'
  ]) {
    expect(entries).toContain(expectedPath);
  }

  expect(entries.some((entry) => entry.startsWith('package/node_modules/'))).toBe(false);
  expect(entries.some((entry) => entry.includes('.parcel-cache'))).toBe(false);
  expect(entries.some((entry) => entry.includes('documented-examples-'))).toBe(false);
};
