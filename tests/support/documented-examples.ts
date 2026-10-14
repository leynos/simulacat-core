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

interface SourceDocument {
  readonly lines: readonly string[];
  readonly sourcePath: string;
}

interface SourceMarker {
  document: SourceDocument;
  markerIndex: number;
}

interface FenceOpening {
  character: '`' | '~';
  length: number;
  language: string;
}

interface FenceContext {
  marker: string;
  document: SourceDocument;
  opening: FenceOpening;
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
  const document: SourceDocument = {lines: input.markdown.split('\n'), sourcePath: input.sourcePath};
  const examples: DocumentedExample[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < document.lines.length; index += 1) {
    const line = normalizedLine(document.lines[index] ?? '');

    if (line.trimStart().startsWith('<!-- tested-example')) {
      const context = validateMarkedFence({document, markerIndex: index}, seenIds);
      const extracted = extractMarkedFence(context);
      examples.push(extracted.example);
      index = extracted.closingIndex;
      continue;
    }

    if (parseOpening(line)) {
      throw new Error(`${document.sourcePath}:${index + 1}: fenced example is missing a tested-example marker`);
    }
  }

  return examples;
};

/** Validates one marker, its adjacent opener, and source-order uniqueness. */
const validateMarkedFence = (sourceMarker: SourceMarker, seenIds: Set<string>): FenceContext => {
  const {document, markerIndex} = sourceMarker;
  const marker = parseMarker(sourceMarker);
  const openingLine = document.lines[markerIndex + 1];
  const opening = openingLine === undefined ? undefined : parseOpening(openingLine);

  if (!opening) {
    throw new Error(
      `${document.sourcePath}:${markerIndex + 1}: tested-example marker must immediately precede a fence`
    );
  }

  if (seenIds.has(marker)) {
    throw new Error(`${document.sourcePath}:${markerIndex + 1}: duplicate tested-example identifier "${marker}"`);
  }

  seenIds.add(marker);
  return {marker, document, opening, openingLine: markerIndex + 2};
};

/** Extracts a validated marked fence while retaining its original body. */
const extractMarkedFence = (context: FenceContext): ExtractedFence => {
  const closingIndex = findClosingFence(context);
  return {example: serializeMarkedFence(context, closingIndex), closingIndex};
};

/** Builds the public example from the validated source range. */
const serializeMarkedFence = (context: FenceContext, closingIndex: number): DocumentedExample => {
  const bodyLines = context.document.lines.slice(context.openingLine, closingIndex);
  return {
    id: context.marker,
    language: context.opening.language,
    body: bodyLines.length === 0 ? '' : `${bodyLines.join('\n')}\n`,
    line: context.openingLine,
    sourcePath: context.document.sourcePath
  };
};

/** Validates one tested-example marker and returns its identifier. */
const parseMarker = (sourceMarker: SourceMarker): string => {
  const {document, markerIndex} = sourceMarker;
  const line = normalizedLine(document.lines[markerIndex] ?? '');
  const lineNumber = markerIndex + 1;
  const {sourcePath} = document;
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
  const character = fence.startsWith('`') ? '`' : '~';

  if (character === '`' && information.includes('`')) {
    return undefined;
  }

  return {
    character,
    length: fence.length,
    language: information.trim().split(/\s+/, 1)[0] ?? ''
  };
};

/** Finds the closing fence for one validated opener. */
const findClosingFence = (context: FenceContext): number => {
  const {lines, sourcePath} = context.document;

  for (let index = context.openingLine; index < lines.length; index += 1) {
    const line = normalizedLine(lines[index] ?? '');
    const match = /^( {0,3})(`+|~+)[ \t]*$/.exec(line);
    const fence = match?.[2] ?? '';

    if (fence[0] === context.opening.character && fence.length >= context.opening.length) {
      return index;
    }
  }

  throw new Error(`${sourcePath}:${context.openingLine}: unterminated tested-example fence`);
};

/** Removes a carriage return for Markdown delimiter comparisons. */
const normalizedLine = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line);
