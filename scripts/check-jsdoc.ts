/**
 * @file AST-based documentation gate for JavaScript and TypeScript files.
 *
 * The checker enforces the project documentation contract without relying on
 * regular-expression declaration matching. It validates module-level `@file`
 * comments and top-level public/private function documentation.
 */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, '.jsdoc-baseline.json');
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.lody',
  'dist',
  'node_modules',
  'repository-mock-data',
  'schema',
  'src/__generated__'
]);
const MODULE_JSDOC_PATTERN =
  /^(?:#![^\n]*\n)?(?:\/\*![\s\S]*?\*\/\s*)?(?:(?:'use strict'|"use strict");\s*)?\s*\/\*\*[\s\S]*?@file[\s\S]*?\*\//;

type Finding = {
  readonly column: number;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

type JsDocBlock = {
  readonly descriptionLines: readonly string[];
  readonly tags: ReadonlyMap<string, readonly string[]>;
};

type FunctionRecord = {
  readonly docsNode: ts.Node;
  readonly functionNode: ts.FunctionLikeDeclaration;
  readonly isPublic: boolean;
  readonly name: string;
};

type BaselineFile = {
  readonly entries?: readonly string[];
};

type PublicCheckInput = {
  readonly docs: JsDocBlock;
  readonly record: FunctionRecord;
  readonly sourceFile: ts.SourceFile;
};

/** Reports whether a filesystem path points at a checked source file. */
function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath)) && !filePath.endsWith('.d.ts');
}

/** Reports whether a path contains an ignored directory segment. */
function isIgnoredPath(filePath: string): boolean {
  const relativePath = path.relative(ROOT, filePath);
  return relativePath.split(path.sep).some((segment, index, segments) => {
    const partialPath = segments.slice(0, index + 1).join('/');
    return IGNORED_DIRECTORIES.has(segment) || IGNORED_DIRECTORIES.has(partialPath);
  });
}

/** Recursively lists checked JavaScript and TypeScript files. */
function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    if (isIgnoredPath(entryPath)) continue;

    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
    } else if (stats.isFile() && isSourceFile(entryPath)) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

/** Converts an absolute file path to a stable repository-relative path. */
function relativeFilePath(filePath: string): string {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

/** Loads the exact per-symbol documentation baseline. */
function loadBaseline(): ReadonlySet<string> {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile;
    return new Set(parsed.entries ?? []);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
}

/** Builds a stable key for one function's documentation baseline entry. */
function baselineKey(sourceFile: ts.SourceFile, record: FunctionRecord): string {
  return `${relativeFilePath(sourceFile.fileName)}#${record.name}`;
}

/** Creates a finding at the start of a syntax node. */
function finding(sourceFile: ts.SourceFile, node: ts.Node, message: string): Finding {
  const {character, line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    column: character + 1,
    file: relativeFilePath(sourceFile.fileName),
    line: line + 1,
    message
  };
}

/** Checks whether a module begins with a module-level `@file` JSDoc block. */
function checkModuleJsDoc(sourceFile: ts.SourceFile): Finding[] {
  if (MODULE_JSDOC_PATTERN.test(sourceFile.text)) {
    return [];
  }

  return [
    {
      column: 1,
      file: relativeFilePath(sourceFile.fileName),
      line: 1,
      message: 'JS/TS files must start with a module-level JSDoc block containing @file.'
    }
  ];
}

/** Reports whether a node has an `export` modifier. */
function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** Reports whether a node has a `default` modifier. */
function hasDefaultModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword)
  );
}

/** Reports whether the variable declaration is exported from its module. */
function isExportedVariable(declaration: ts.VariableDeclaration): boolean {
  const statement = declaration.parent.parent;
  return ts.isVariableStatement(statement) && hasExportModifier(statement);
}

/** Finds the declaration node that owns leading comments for a function. */
function docsNodeForVariable(declaration: ts.VariableDeclaration): ts.Node {
  return declaration.parent.parent;
}

/** Extracts the function name from a variable or function declaration. */
function functionName(name: ts.BindingName | ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** Collects top-level named function declarations that the contract covers. */
function collectFunctions(sourceFile: ts.SourceFile): FunctionRecord[] {
  return sourceFile.statements.flatMap((statement) => {
    if (ts.isFunctionDeclaration(statement)) {
      return functionDeclarationRecord(statement);
    }
    if (ts.isVariableStatement(statement)) {
      return variableFunctionRecords(statement);
    }
    return [];
  });
}

/** Converts a function declaration into a function record when it has a body. */
function functionDeclarationRecord(statement: ts.FunctionDeclaration): FunctionRecord[] {
  if (!statement.body) return [];
  return [
    {
      docsNode: statement,
      functionNode: statement,
      isPublic: hasExportModifier(statement) || hasDefaultModifier(statement),
      name: functionName(statement.name) ?? 'default'
    }
  ];
}

/** Converts a variable statement's function initializers into function records. */
function variableFunctionRecords(statement: ts.VariableStatement): FunctionRecord[] {
  return statement.declarationList.declarations.flatMap((declaration) => {
    if (!declaration.initializer || !isFunctionInitializer(declaration.initializer)) return [];

    const name = functionName(declaration.name);
    if (!name) return [];
    return [
      {
        docsNode: docsNodeForVariable(declaration),
        functionNode: declaration.initializer,
        isPublic: isExportedVariable(declaration),
        name
      }
    ];
  });
}

/** Reports whether an expression is a function-valued variable initializer. */
function isFunctionInitializer(node: ts.Expression): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/** Parses the closest leading JSDoc block for a declaration node. */
function parseLeadingJsDoc(sourceFile: ts.SourceFile, node: ts.Node): JsDocBlock | undefined {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  const range = ranges.findLast((comment) => sourceFile.text.startsWith('/**', comment.pos));
  if (!range) return undefined;

  const descriptionLines: string[] = [];
  const tags = new Map<string, string[]>();
  for (const line of jsDocLines(sourceFile.text.slice(range.pos, range.end))) {
    recordJsDocLine(line, descriptionLines, tags);
  }

  return {descriptionLines, tags};
}

/** Normalizes a raw JSDoc block into trimmed content lines. */
function jsDocLines(rawComment: string): string[] {
  return rawComment
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\* ?/, '').trim());
}

/** Records one normalized JSDoc line as description text or a tag. */
function recordJsDocLine(line: string, descriptionLines: string[], tags: Map<string, string[]>): void {
  if (!line) return;
  if (!line.startsWith('@')) {
    if (tags.size === 0) descriptionLines.push(line);
    return;
  }

  const [, tagName, tagText = ''] = /^@(\S+)\s*(.*)$/.exec(line) ?? [];
  if (!tagName) return;
  tags.set(tagName, [...(tags.get(tagName) ?? []), tagText.trim()]);
}

/** Reports whether the previous line has `jsdoc-check-ignore-next-line` plus a non-empty reason. */
function hasSuppression(sourceFile: ts.SourceFile, node: ts.Node): boolean {
  const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const lines = sourceFile.text.split(/\r?\n/);
  const previousLine = lines[line - 1] ?? '';
  const marker = 'jsdoc-check-ignore-next-line';
  return (
    previousLine.includes(marker) && previousLine.slice(previousLine.indexOf(marker) + marker.length).trim().length > 0
  );
}

/** Returns public parameter names that should have `@param` entries. */
function parameterNames(node: ts.FunctionLikeDeclaration): string[] {
  return node.parameters.flatMap((param) => {
    if (ts.isIdentifier(param.name)) return param.name.text;
    return [];
  });
}

/** Reports whether a function explicitly or implicitly returns a value. */
function returnsValue(node: ts.FunctionLikeDeclaration): boolean {
  if (node.type && node.type.kind !== ts.SyntaxKind.VoidKeyword && node.type.kind !== ts.SyntaxKind.UndefinedKeyword) {
    return true;
  }
  if (ts.isArrowFunction(node) && node.body && !ts.isBlock(node.body)) {
    return true;
  }

  let foundReturn = false;
  const visit = (child: ts.Node): void => {
    if (foundReturn || (ts.isFunctionLike(child) && child !== node)) return;
    if (ts.isReturnStatement(child) && child.expression) {
      foundReturn = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return foundReturn;
}

/** Reports whether a function can throw or reject from its own body. */
function canThrow(node: ts.FunctionLikeDeclaration): boolean {
  let foundThrow = false;
  const visit = (child: ts.Node): void => {
    if (foundThrow || (ts.isFunctionLike(child) && child !== node)) return;
    if (ts.isThrowStatement(child) || isPromiseRejectCall(child)) {
      foundThrow = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return foundThrow;
}

/** Reports whether a node calls `Promise.reject(...)`. */
function isPromiseRejectCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }

  return node.expression.expression.getText() === 'Promise' && node.expression.name.text === 'reject';
}

/** Validates the complete public JSDoc contract for one function. */
function checkPublicFunction(sourceFile: ts.SourceFile, record: FunctionRecord, docs: JsDocBlock): Finding[] {
  const input = {docs, record, sourceFile};
  return [
    ...checkPublicDescription(input),
    ...checkPublicParams(input),
    ...checkPublicReturn(input),
    ...checkPublicThrows(input)
  ];
}

/** Validates that public JSDoc explains usage. */
function checkPublicDescription({docs, record, sourceFile}: PublicCheckInput): Finding[] {
  const findings: Finding[] = [];
  if (docs.descriptionLines.length === 0) {
    findings.push(
      finding(sourceFile, record.docsNode, `Exported function "${record.name}" needs a usage-oriented description.`)
    );
  }

  return findings;
}

/** Validates public `@param` coverage. */
function checkPublicParams({docs, record, sourceFile}: PublicCheckInput): Finding[] {
  const findings: Finding[] = [];
  const paramTags = docs.tags.get('param') ?? [];
  for (const name of parameterNames(record.functionNode)) {
    if (!paramTags.some((tag) => tag === name || tag.startsWith(`${name} `))) {
      findings.push(
        finding(sourceFile, record.docsNode, `Exported function "${record.name}" must document parameter "${name}".`)
      );
    }
  }

  return findings;
}

/** Validates public `@returns` coverage when the function returns a value. */
function checkPublicReturn({docs, record, sourceFile}: PublicCheckInput): Finding[] {
  if (returnsValue(record.functionNode) && !docs.tags.has('returns') && !docs.tags.has('return')) {
    return [finding(sourceFile, record.docsNode, `Exported function "${record.name}" must document its return value.`)];
  }

  return [];
}

/** Validates public `@throws` or `@rejects` coverage when errors can escape. */
function checkPublicThrows({docs, record, sourceFile}: PublicCheckInput): Finding[] {
  if (canThrow(record.functionNode) && !docs.tags.has('throws') && !docs.tags.has('rejects')) {
    return [
      finding(
        sourceFile,
        record.docsNode,
        `Exported function "${record.name}" must document thrown or rejected errors.`
      )
    ];
  }

  return [];
}

/** Validates the concise private JSDoc summary contract for one function. */
function checkPrivateFunction(sourceFile: ts.SourceFile, record: FunctionRecord, docs: JsDocBlock): Finding[] {
  if (docs.descriptionLines.length === 1 && ![...docs.tags.keys()].some((tag) => tag !== 'internal')) {
    return [];
  }

  return [
    finding(sourceFile, record.docsNode, `Private function "${record.name}" needs a concise one-line JSDoc summary.`)
  ];
}

/** Checks every covered function in a source file. */
function checkFunctions(sourceFile: ts.SourceFile, baseline: ReadonlySet<string>): Finding[] {
  return collectFunctions(sourceFile).flatMap((record) => checkFunctionRecord(sourceFile, baseline, record));
}

/** Checks one covered function record. */
function checkFunctionRecord(
  sourceFile: ts.SourceFile,
  baseline: ReadonlySet<string>,
  record: FunctionRecord
): Finding[] {
  if (baseline.has(baselineKey(sourceFile, record)) || hasSuppression(sourceFile, record.docsNode)) {
    return [];
  }

  const docs = parseLeadingJsDoc(sourceFile, record.docsNode);
  if (!docs) {
    const visibility = record.isPublic ? 'Exported' : 'Private';
    return [finding(sourceFile, record.docsNode, `${visibility} function "${record.name}" needs JSDoc.`)];
  }

  return record.isPublic
    ? checkPublicFunction(sourceFile, record, docs)
    : checkPrivateFunction(sourceFile, record, docs);
}

/** Parses and checks a single source file. */
function checkFile(filePath: string, baseline: ReadonlySet<string>): Finding[] {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  return [...checkModuleJsDoc(sourceFile), ...checkFunctions(sourceFile, baseline)];
}

/** Prints all findings and exits with the appropriate status. */
function main(): void {
  const baseline = loadBaseline();
  const findings = listSourceFiles(ROOT).flatMap((filePath) => checkFile(filePath, baseline));
  for (const item of findings) {
    console.error(`${item.file}:${item.line}:${item.column} ${item.message}`);
  }

  if (findings.length > 0) {
    console.error(`JSDoc check failed with ${findings.length} finding(s).`);
    process.exitCode = 1;
  }
}

main();
