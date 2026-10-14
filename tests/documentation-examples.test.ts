/** @file Enforces executable examples from the published users guide. */
import {describe, expect, it} from 'bun:test';
import {
  assertExampleCoverage,
  cleanupPreparedDocumentedExamples,
  DOCUMENTED_EXAMPLE_IDS,
  prepareDocumentedExamples,
  runPreparedDocumentedExamples
} from './support/documented-example-execution.ts';
import {typeCheckExamples, writeExampleProgram} from './support/documented-example-fixture.ts';
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
    const examples = parseDocumentedExamples(
      [
        '<!-- tested-example: backtick-sample -->',
        '```typescript',
        'const value = 1;',
        '```',
        '<!-- tested-example: tilde-sample -->',
        '~~~~bash',
        'printf example',
        '~~~~'
      ].join('\n'),
      'fixture.md'
    );

    expect(examples.map((example) => example.body)).toEqual(['const value = 1;\n', 'printf example\n']);
  });
});

describe('tested users-guide examples invalid markers', () => {
  it('rejects a fence without an adjacent marker', () => {
    expect(() => parseDocumentedExamples('```ts\nconst value = 1;\n```', 'fixture.md')).toThrow(
      'fixture.md:1: fenced example is missing a tested-example marker'
    );
  });

  it('rejects an empty marker identifier', () => {
    const source = '<!-- tested-example:  -->\n```ts\nconst value = 1;\n```';

    expect(() => parseDocumentedExamples(source, 'fixture.md')).toThrow(
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

    expect(() => parseDocumentedExamples(duplicate, 'fixture.md')).toThrow(
      'fixture.md:5: duplicate tested-example identifier "same"'
    );
    expect(() => parseDocumentedExamples(repeated, 'fixture.md')).toThrow(
      'fixture.md:1: tested-example marker must immediately precede a fence'
    );
  });

  it('rejects an unterminated fence and a marker separated from its fence', () => {
    const unterminated = '<!-- tested-example: open -->\n```ts\nconst value = 1;';
    const nonAdjacent = '<!-- tested-example: separated -->\n\n```ts\nvalue();\n```';

    expect(() => parseDocumentedExamples(unterminated, 'fixture.md')).toThrow(
      'fixture.md:2: unterminated tested-example fence'
    );
    expect(() => parseDocumentedExamples(nonAdjacent, 'fixture.md')).toThrow(
      'fixture.md:1: tested-example marker must immediately precede a fence'
    );
  });
});

describe('tested users-guide examples execution', () => {
  it('executes every published fence and checks public declaration errors', async () => {
    const prepared = await prepareDocumentedExamples(DOCUMENTED_EXAMPLE_IDS);

    try {
      const result = await runPreparedDocumentedExamples(prepared);
      expect(result.completedIds).toEqual([...DOCUMENTED_EXAMPLE_IDS]);

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
