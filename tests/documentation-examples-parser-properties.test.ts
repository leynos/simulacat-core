/** @file Generates marked-fence parser inputs and checks source preservation. */
import {describe, expect, it} from 'bun:test';
import fc from 'fast-check';
import {propertyTestSeed} from './support/property-test-seed.ts';
import {parseDocumentedExamples, type DocumentedExample} from './support/documented-examples.ts';

const SOURCE_PATH = 'generated-users-guide.md';
type FenceCharacter = '`' | '~';
type Newline = '\n' | '\r\n';

interface FenceSpec {
  character: FenceCharacter;
  length: number;
  closerBonus: number;
  indent: number;
  newline: Newline;
  language: string;
  bodyLines: string[];
}

interface GeneratedFence {
  spec: FenceSpec;
  example: DocumentedExample;
  markerLine: number;
  openingLine: number;
  closingLine: number;
}

interface GeneratedDocument {
  markdown: string;
  fences: GeneratedFence[];
}

interface InvalidDocument {
  kind: string;
  markdown: string;
  message: string;
}

const bodyCharacter = fc.constantFrom('a', 'Z', '0', '_', '-', 'é', '雪', '🙂');
const bodyLineArbitrary = fc.array(bodyCharacter, {minLength: 0, maxLength: 12}).map((characters) => {
  return `body-${characters.join('')}`;
});

const fenceSpecArbitrary: fc.Arbitrary<FenceSpec> = fc.record({
  character: fc.constantFrom('`', '~'),
  length: fc.integer({min: 3, max: 8}),
  closerBonus: fc.integer({min: 0, max: 4}),
  indent: fc.integer({min: 0, max: 3}),
  newline: fc.constantFrom('\n', '\r\n'),
  language: fc.constantFrom('typescript', 'bash', 'ts', 'text', ''),
  bodyLines: fc.array(bodyLineArbitrary, {minLength: 0, maxLength: 5})
});

const generatedDocumentArbitrary: fc.Arbitrary<GeneratedDocument> = fc
  .array(fenceSpecArbitrary, {minLength: 1, maxLength: 5})
  .map((specs) => buildGeneratedDocument(specs));

describe('generated users-guide fence parser cases', () => {
  it('matches source-derived examples and rejects malformed fence mutations', () => {
    fc.assert(
      fc.property(generatedDocumentArbitrary, (generated) => {
        const parsed = parseDocumentedExamples({markdown: generated.markdown, sourcePath: SOURCE_PATH});
        assertParsedExamplesMatch(parsed, expectedExamples(generated));

        for (const invalid of invalidDocuments(generated)) {
          assertParserRejects(parseMarkdown(invalid.markdown), invalid.message);
        }
      }),
      {seed: propertyTestSeed, numRuns: 100}
    );
  });

  it('rejects body-dropping and invalid-source-accepting oracle controls', () => {
    const generated = buildGeneratedDocument([
      {
        character: '`',
        length: 3,
        closerBonus: 0,
        indent: 0,
        newline: '\n',
        language: 'typescript',
        bodyLines: ['body-雪']
      }
    ]);
    const expected = expectedExamples(generated);
    const droppedBodies = expected.map((example) => ({...example, body: ''}));
    expect(() => assertParsedExamplesMatch(droppedBodies, expected)).toThrow();

    const invalid = invalidDocuments(generated)[0];
    if (!invalid) {
      throw new Error('the generated parser control requires a malformed source');
    }

    const acceptingParser = (): DocumentedExample[] => expected;
    expect(() => assertParserRejects(acceptingParser, invalid.message)).toThrow();
  });
});

/** Builds source text and an independent expected document model. */
const buildGeneratedDocument = (specs: FenceSpec[]): GeneratedDocument => {
  const fences: GeneratedFence[] = [];
  const markdownParts: string[] = [];
  let nextMarkerLine = 1;

  for (const [index, spec] of specs.entries()) {
    const id = `sample-${index + 1}`;
    const markerLine = nextMarkerLine;
    const openingLine = markerLine + 1;
    const closingLine = openingLine + spec.bodyLines.length + 1;
    const example: DocumentedExample = {
      id,
      language: spec.language,
      body: expectedBody(spec),
      line: openingLine,
      sourcePath: SOURCE_PATH
    };
    const fence: GeneratedFence = {spec, example, markerLine, openingLine, closingLine};
    fences.push(fence);

    if (fences.length > 1) {
      markdownParts.push(specs[index - 1]?.newline ?? '\n');
    }

    markdownParts.push(formatFence(spec, id));
    nextMarkerLine = closingLine + 1;
  }

  return {markdown: markdownParts.join(''), fences};
};

/** Formats one complete marked fence without using parser logic. */
const formatFence = (spec: FenceSpec, id: string, closer = closingFence(spec)): string => {
  const indentation = ' '.repeat(spec.indent);
  const opener = `${indentation}${spec.character.repeat(spec.length)}${spec.language}`;
  const lines = [`<!-- tested-example: ${id} -->`, opener, ...spec.bodyLines, `${indentation}${closer}`];
  return lines.join(spec.newline);
};

/** Creates the raw body bytes expected from a fence with the selected newline. */
const expectedBody = (spec: FenceSpec): string => {
  if (spec.bodyLines.length === 0) {
    return '';
  }

  const carriageReturn = spec.newline === '\r\n' ? '\r' : '';
  return `${spec.bodyLines.map((line) => `${line}${carriageReturn}`).join('\n')}\n`;
};

/** Returns the expected compatible closing delimiter. */
const closingFence = (spec: FenceSpec): string => spec.character.repeat(spec.length + spec.closerBonus);

/** Returns the independent model values in source order. */
const expectedExamples = (generated: GeneratedDocument): DocumentedExample[] => {
  return generated.fences.map(({example}) => example);
};

/** Compares parser observations with the source model, including raw bodies and coordinates. */
const assertParsedExamplesMatch = (
  actual: readonly DocumentedExample[],
  expected: readonly DocumentedExample[]
): void => {
  expect(actual).toEqual(expected);
};

/** Checks each generated malformed sibling against its exact diagnostic. */
const invalidDocuments = (generated: GeneratedDocument): InvalidDocument[] => {
  const first = generated.fences[0];
  const last = generated.fences.at(-1);

  if (!first || !last) {
    throw new Error('the document generator must produce at least one fence');
  }

  const duplicateMarkerLine = generated.markdown.split('\n').length + 1;
  const duplicateBlock = formatFence(first.spec, first.example.id);
  const wrongCharacter = last.spec.character === '`' ? '~' : '`';
  const wrongCloser = wrongCharacter.repeat(last.spec.length + last.spec.closerBonus);
  const shortCloser = last.spec.character.repeat(last.spec.length - 1);

  return [
    {
      kind: 'missing marker',
      markdown: removePhysicalLine(generated.markdown, first.markerLine),
      message: `${SOURCE_PATH}:${first.openingLine - 1}: fenced example is missing a tested-example marker`
    },
    {
      kind: 'duplicate identifier',
      markdown: `${generated.markdown}${first.spec.newline}${duplicateBlock}`,
      message: `${SOURCE_PATH}:${duplicateMarkerLine}: duplicate tested-example identifier "${first.example.id}"`
    },
    {
      kind: 'mismatched closer',
      markdown: replacePhysicalLine(generated.markdown, last.closingLine, wrongCloser),
      message: `${SOURCE_PATH}:${last.openingLine}: unterminated tested-example fence`
    },
    {
      kind: 'shortened closer',
      markdown: replacePhysicalLine(generated.markdown, last.closingLine, shortCloser),
      message: `${SOURCE_PATH}:${last.openingLine}: unterminated tested-example fence`
    },
    {
      kind: 'missing closer',
      markdown: removePhysicalLine(generated.markdown, last.closingLine),
      message: `${SOURCE_PATH}:${last.openingLine}: unterminated tested-example fence`
    }
  ];
};

/** A parser action that is expected to reject the generated Markdown. */
type ParserAction = () => void;

/** Requires parser rejection with the complete source and line diagnostic. */
const assertParserRejects = (parser: ParserAction, message: string): void => {
  expect(parser).toThrow(message);
};

/** Builds the parser action for one generated Markdown document. */
const parseMarkdown = (markdown: string): ParserAction => {
  return () => {
    parseDocumentedExamples({markdown, sourcePath: SOURCE_PATH});
  };
};

/** Replaces one one-based physical line while preserving its CRLF terminator. */
const replacePhysicalLine = (markdown: string, lineNumber: number, replacement: string): string => {
  const lines = markdown.split('\n');
  const currentLine = lines[lineNumber - 1] ?? '';
  const carriageReturn = currentLine.endsWith('\r') ? '\r' : '';
  lines[lineNumber - 1] = `${replacement}${carriageReturn}`;
  return lines.join('\n');
};

/** Removes one one-based physical line from generated Markdown. */
const removePhysicalLine = (markdown: string, lineNumber: number): string => {
  const lines = markdown.split('\n');
  lines.splice(lineNumber - 1, 1);
  return lines.join('\n');
};
