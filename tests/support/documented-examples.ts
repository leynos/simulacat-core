/** @file Reads tested examples from the shipped users guide. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

/** Stable source location for the consumer-facing users guide. */
export const USERS_GUIDE_PATH = resolve(import.meta.dir, '../../docs/users-guide.md');

/** A marked code fence together with its location in the source document. */
export interface DocumentedExample {
  id: string;
  language: string;
  body: string;
  line: number;
  sourcePath: string;
}

/** Markdown text and its diagnostic source path. */
export interface DocumentInput {
  markdown: string;
  sourcePath: string;
}

interface FenceOpening {
  character: '`' | '~';
  length: number;
  language: string;
}

interface FenceContext {
  marker: string;
  opening: FenceOpening;
  sourcePath: string;
  openingLine: number;
}

interface ExtractedFence {
  example: DocumentedExample;
  closingIndex: number;
}

/**
 * Loads every marked code fence from the checked-in users guide.
 *
 * @returns Fences extracted from the current document contents.
 * @throws Error when the document has an invalid tested-example marker.
 */
export const loadUsersGuideExamples = async (): Promise<DocumentedExample[]> => {
  const markdown = await readFile(USERS_GUIDE_PATH, 'utf8');
  return parseDocumentedExamples({markdown, sourcePath: USERS_GUIDE_PATH});
};

/**
 * Parses and validates tested-example markers and their fenced bodies.
 *
 * @param input Document text and path used in diagnostics.
 * @returns Marked examples in document order with their original bodies.
 * @throws Error when a fence or marker is missing, malformed, or duplicated.
 */
export const parseDocumentedExamples = (input: DocumentInput): DocumentedExample[] => {
  const lines = input.markdown.split('\n');
  const examples: DocumentedExample[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizedLine(lines[index] ?? '');

    if (line.trimStart().startsWith('<!-- tested-example')) {
      const context = validateMarkedFence(lines, index, input.sourcePath, seenIds);
      const extracted = extractMarkedFence(lines, context);
      examples.push(extracted.example);
      index = extracted.closingIndex;
      continue;
    }

    if (parseOpening(line)) {
      throw new Error(`${input.sourcePath}:${index + 1}: fenced example is missing a tested-example marker`);
    }
  }

  return examples;
};

/** Validates one marker, its adjacent opener, and source-order uniqueness. */
const validateMarkedFence = (
  lines: string[],
  markerIndex: number,
  sourcePath: string,
  seenIds: Set<string>
): FenceContext => {
  const markerLine = normalizedLine(lines[markerIndex] ?? '');
  const marker = parseMarker(markerLine, sourcePath, markerIndex + 1);
  const openingLine = lines[markerIndex + 1];
  const opening = openingLine === undefined ? undefined : parseOpening(openingLine);

  if (!opening) {
    throw new Error(`${sourcePath}:${markerIndex + 1}: tested-example marker must immediately precede a fence`);
  }

  if (seenIds.has(marker)) {
    throw new Error(`${sourcePath}:${markerIndex + 1}: duplicate tested-example identifier "${marker}"`);
  }

  seenIds.add(marker);
  return {marker, opening, sourcePath, openingLine: markerIndex + 2};
};

/** Extracts a validated marked fence while retaining its original body. */
const extractMarkedFence = (lines: string[], context: FenceContext): ExtractedFence => {
  const closingIndex = findClosingFence(lines, context);
  const bodyLines = lines.slice(context.openingLine, closingIndex);
  return {example: serializeMarkedFence(context, bodyLines), closingIndex};
};

/** Builds an example record with the source's original body line ending. */
const serializeMarkedFence = (context: FenceContext, bodyLines: string[]): DocumentedExample => {
  return {
    id: context.marker,
    language: context.opening.language,
    body: bodyLines.length === 0 ? '' : `${bodyLines.join('\n')}\n`,
    line: context.openingLine,
    sourcePath: context.sourcePath
  };
};

/** Validates one tested-example marker and returns its identifier. */
const parseMarker = (line: string, sourcePath: string, lineNumber: number): string => {
  const match = /^<!-- tested-example:\s*(.*?)\s*-->$/.exec(line.trim());
  const identifier = match?.[1]?.trim();

  if (!identifier) {
    throw new Error(`${sourcePath}:${lineNumber}: tested-example identifier is missing`);
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identifier)) {
    throw new Error(`${sourcePath}:${lineNumber}: invalid tested-example identifier "${identifier}"`);
  }

  return identifier;
};

/** Parses a fenced-code opening line and its optional language label. */
const parseOpening = (sourceLine: string): FenceOpening | undefined => {
  const line = normalizedLine(sourceLine);
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);

  if (!match) {
    return undefined;
  }

  const fence = match[2] ?? '';
  const information = match[3] ?? '';
  const character = fence[0];

  if (character !== '`' && character !== '~') {
    return undefined;
  }

  if (!allowsFenceInformation(character, information)) {
    return undefined;
  }

  return {
    character,
    length: fence.length,
    language: information.trim().split(/\s+/, 1)[0] ?? ''
  };
};

/** Allows information strings that obey the selected fence grammar. */
const allowsFenceInformation = (character: '`' | '~', information: string): boolean => {
  return character !== '`' || !information.includes('`');
};

/** Finds the closing fence for one validated opener. */
const findClosingFence = (lines: string[], context: FenceContext): number => {
  for (let index = context.openingLine; index < lines.length; index += 1) {
    const line = normalizedLine(lines[index] ?? '');
    const match = /^( {0,3})(`+|~+)[ \t]*$/.exec(line);
    const fence = match?.[2] ?? '';

    if (fence[0] === context.opening.character && fence.length >= context.opening.length) {
      return index;
    }
  }

  throw new Error(`${context.sourcePath}:${context.openingLine}: unterminated tested-example fence`);
};

/** Removes a carriage return for Markdown delimiter comparisons. */
const normalizedLine = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line);
