/**
 * @file Local Oxlint rules for maintainability and documentation contracts.
 *
 * The plugin uses Oxlint's ESLint-compatible JavaScript plugin API so the
 * project can enforce local rules without a separate linting process.
 */
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

const MODULE_JSDOC_PATTERN =
  /^(?:#![^\n]*\n)?(?:\/\*![\s\S]*?\*\/\s*)?(?:(?:'use strict'|"use strict");\s*)?\s*\/\*\*[\s\S]*?@file[\s\S]*?\*\//;

const FUNCTION_NODE_TYPES = new Set(['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression']);
const baselineCache = new Map();

/** Loads baseline entries from the repository root. */
function loadBaseline() {
  const baselinePath = path.join(process.cwd(), '.jsdoc-baseline.json');
  if (baselineCache.has(baselinePath)) return baselineCache.get(baselinePath);
  if (!existsSync(baselinePath)) return cacheBaseline(baselinePath, new Set());

  try {
    const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'));
    return cacheBaseline(baselinePath, new Set(parsed.entries ?? []));
  } catch (error) {
    throw new Error(`Failed to parse JSDoc baseline at ${baselinePath}.`, {cause: error});
  }
}

/** Stores baseline entries for reuse across rule invocations. */
function cacheBaseline(baselinePath, entries) {
  baselineCache.set(baselinePath, entries);
  return entries;
}

/** Returns a repository-relative path for a linted file. */
function relativeFilename(context) {
  const filename = context.filename ?? context.getFilename?.() ?? '';
  return path.relative(process.cwd(), filename).replaceAll(path.sep, '/');
}

/** Builds the documentation baseline key for a function record. */
function baselineKey(context, record) {
  return `${relativeFilename(context)}#${record.name}`;
}

/** Reports whether an AST node is a function-like node. */
function isFunctionNode(node) {
  return Boolean(node && FUNCTION_NODE_TYPES.has(node.type));
}

/** Reports whether a statement is directly under the program. */
function isTopLevelStatement(node) {
  return node?.parent?.type === 'Program';
}

/** Reports whether a declaration is exported directly or by re-export. */
function isExported(node, exportedNames = new Set()) {
  const directlyExported =
    node?.parent?.type === 'ExportNamedDeclaration' || node?.parent?.type === 'ExportDefaultDeclaration';
  return directlyExported || exportedNames.has(functionName(node));
}

/** Collects local names exported through named and default export declarations. */
function collectExportedNames(program) {
  return new Set(program.body.flatMap((statement) => exportedNamesFromStatement(statement)));
}

/** Returns local names from one export statement. */
function exportedNamesFromStatement(statement) {
  if (statement.type === 'ExportDefaultDeclaration') return defaultExportedNames(statement);
  if (statement.type === 'ExportNamedDeclaration') {
    return (statement.specifiers ?? []).flatMap((specifier) => exportedSpecifierName(specifier));
  }
  return [];
}

/** Returns the local name exported by one export specifier. */
function exportedSpecifierName(specifier) {
  const local = specifier.local;
  return local?.type === 'Identifier' ? [local.name] : [];
}

/** Returns local names from `export default name` statements. */
function defaultExportedNames(statement) {
  const declaration = statement.declaration;
  if (declaration?.type === 'Identifier') return [declaration.name];
  return [];
}

/** Returns the top-level statement that owns declaration comments. */
function docsNodeForFunction(node) {
  return isExported(node) ? node.parent : node;
}

/** Returns the top-level statement that owns variable comments. */
function docsNodeForVariable(node) {
  const declaration = node.parent;
  return declaration?.parent?.type === 'ExportNamedDeclaration' ? declaration.parent : declaration;
}

/** Reports whether a variable declarator is a covered top-level function. */
function isTopLevelFunctionVariable(node) {
  const declaration = node.parent;
  return declaration?.parent?.type === 'Program' || declaration?.parent?.type === 'ExportNamedDeclaration';
}

/** Returns a stable name for a function declaration. */
function functionName(node) {
  return node.id?.name ?? 'default';
}

/** Returns a stable name for a variable declarator. */
function variableName(node) {
  return node.id?.type === 'Identifier' ? node.id.name : undefined;
}

/** Creates a function record for a top-level function declaration. */
function functionRecord(node, exportedNames = new Set()) {
  return {
    docsNode: docsNodeForFunction(node),
    functionNode: node,
    isPublic: isExported(node, exportedNames),
    name: functionName(node)
  };
}

/** Creates a function record for a top-level function variable. */
function variableFunctionRecord(node, exportedNames = new Set()) {
  const name = variableName(node);
  return {
    docsNode: docsNodeForVariable(node),
    functionNode: node.init,
    isPublic: node.parent?.parent?.type === 'ExportNamedDeclaration' || exportedNames.has(name),
    name
  };
}

/** Creates a function record for an inline default-exported function expression. */
function defaultFunctionExpressionRecord(node) {
  return {
    docsNode: node.parent,
    functionNode: node,
    isPublic: true,
    name: functionName(node)
  };
}

/** Parses the closest leading JSDoc block for a declaration. */
function parseLeadingJsDoc(context, node) {
  const comments = context.sourceCode.getCommentsBefore(node) ?? [];
  const jsdoc = comments.findLast((comment) => comment.type === 'Block' && comment.value.trimStart().startsWith('*'));
  if (!jsdoc) return undefined;
  return parseJsDocBlock(`/*${jsdoc.value}*/`);
}

/** Parses a raw JSDoc block into description lines and tags. */
function parseJsDocBlock(rawComment) {
  const descriptionLines = [];
  const tags = new Map();
  for (const line of jsDocLines(rawComment)) {
    recordJsDocLine(line, descriptionLines, tags);
  }

  return {descriptionLines, tags};
}

/** Normalizes a raw JSDoc block into trimmed content lines. */
function jsDocLines(rawComment) {
  return rawComment
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\* ?/, '').trim());
}

/** Records one JSDoc content line as description text or a tag. */
function recordJsDocLine(line, descriptionLines, tags) {
  if (!line) return;
  if (line.startsWith('@')) {
    recordJsDocTag(line, tags);
    return;
  }
  if (tags.size === 0) descriptionLines.push(line);
}

/** Records one normalized JSDoc tag line. */
function recordJsDocTag(line, tags) {
  const [, tagName, tagText = ''] = /^@(\S+)\s*(.*)$/.exec(line) ?? [];
  if (!tagName) return;
  tags.set(tagName, [...(tags.get(tagName) ?? []), tagText.trim()]);
}

/** Returns public parameter names that should have `@param` entries. */
function parameterNames(node) {
  return (node.params ?? []).flatMap((param) => boundNames(param));
}

/** Returns identifier names bound by a parameter pattern. */
function boundNames(node) {
  if (!node) return [];
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'AssignmentPattern') return boundNames(node.left);
  if (node.type === 'RestElement') return boundNames(node.argument);
  if (node.type === 'ObjectPattern') return node.properties.flatMap((property) => propertyNames(property));
  if (node.type === 'ArrayPattern') return node.elements.flatMap((element) => boundNames(element));
  return [];
}

/** Returns identifier names bound by an object pattern property. */
function propertyNames(node) {
  if (node.type === 'Property') return boundNames(node.value);
  if (node.type === 'RestElement') return boundNames(node.argument);
  return [];
}

/** Reports whether a node is a return statement with a value. */
function isValueReturn(node) {
  return node?.type === 'ReturnStatement' && Boolean(node.argument);
}

/** Reports whether an arrow function has an expression body. */
function hasExpressionBody(node) {
  return node.type === 'ArrowFunctionExpression' && node.body?.type !== 'BlockStatement';
}

/** Reports whether a function body returns a value. */
function returnsValue(node) {
  if (hasExpressionBody(node)) return true;
  return containsNode(node.body, node, isValueReturn);
}

/** Reports whether a node is a throw or promise rejection. */
function isThrowOrReject(node) {
  return node?.type === 'ThrowStatement' || isPromiseRejectCall(node);
}

/** Reports whether a function can throw or reject from its own body. */
function canThrow(node) {
  return containsNode(node.body, node, isThrowOrReject);
}

/** Reports whether a node calls `Promise.reject(...)`. */
function isPromiseRejectCall(node) {
  if (node?.type !== 'CallExpression') return false;
  return isPromiseRejectMember(node.callee);
}

/** Reports whether a member expression reads `Promise.reject`. */
function isPromiseRejectMember(node) {
  if (node?.type !== 'MemberExpression') return false;
  return isPromiseObject(node.object) && isRejectProperty(node.property);
}

/** Reports whether a member object is the global `Promise` identifier. */
function isPromiseObject(node) {
  return node?.type === 'Identifier' && node.name === 'Promise';
}

/** Reports whether a member property is the `reject` identifier. */
function isRejectProperty(node) {
  return node?.type === 'Identifier' && node.name === 'reject';
}

/** Searches a subtree while skipping nested function bodies. */
function containsNode(node, root, predicate) {
  if (!node) return false;
  if (node !== root && isFunctionNode(node)) return false;
  if (predicate(node)) return true;
  return childNodes(node).some((child) => containsNode(child, root, predicate));
}

/** Returns child AST nodes for a generic ESTree node. */
function childNodes(node) {
  return Object.entries(node).flatMap(([key, value]) => (key === 'parent' ? [] : nodeValues(value)));
}

/** Converts a node property value into child AST nodes. */
function nodeValues(value) {
  if (Array.isArray(value)) return value.filter(isAstNode);
  return isAstNode(value) ? [value] : [];
}

/** Reports whether a value looks like an ESTree AST node. */
function isAstNode(value) {
  return Boolean(value && typeof value.type === 'string');
}

/** Reports whether a function record is skipped by the baseline. */
function isBaselined(context, record) {
  return loadBaseline().has(baselineKey(context, record));
}

/** Reports a missing JSDoc block for a covered function. */
function reportMissingJsDoc(context, record) {
  const visibility = record.isPublic ? 'Exported' : 'Private';
  context.report({node: record.docsNode, message: `${visibility} function "${record.name}" needs JSDoc.`});
}

/** Validates public JSDoc description text. */
function checkPublicDescription(context, record, docs) {
  if (docs.descriptionLines.length > 0) return;
  context.report({
    node: record.docsNode,
    message: `Exported function "${record.name}" needs a usage-oriented description.`
  });
}

/** Validates public JSDoc parameter tags. */
function checkPublicParams(context, record, docs) {
  const paramTags = docs.tags.get('param') ?? [];
  for (const name of parameterNames(record.functionNode)) {
    if (hasParamTag(paramTags, name)) continue;
    context.report({
      node: record.docsNode,
      message: `Exported function "${record.name}" must document parameter "${name}".`
    });
  }
}

/** Reports whether a parameter has a matching tag. */
function hasParamTag(paramTags, name) {
  return paramTags.some((tag) => tag === name || tag.startsWith(`${name} `));
}

/** Reports whether return documentation is absent. */
function lacksReturnDocumentation(docs) {
  return !docs.tags.has('returns') && !docs.tags.has('return');
}

/** Reports whether error documentation is absent. */
function lacksErrorDocumentation(docs) {
  return !docs.tags.has('throws') && !docs.tags.has('rejects');
}

/** Validates public JSDoc return tags. */
function checkPublicReturn(context, record, docs) {
  if (!returnsValue(record.functionNode)) return;
  if (!lacksReturnDocumentation(docs)) return;
  context.report({
    node: record.docsNode,
    message: `Exported function "${record.name}" must document its return value.`
  });
}

/** Validates public JSDoc error tags. */
function checkPublicThrows(context, record, docs) {
  if (!canThrow(record.functionNode)) return;
  if (!lacksErrorDocumentation(docs)) return;
  context.report({
    node: record.docsNode,
    message: `Exported function "${record.name}" must document thrown or rejected errors.`
  });
}

/** Validates the complete public JSDoc contract. */
function checkPublicFunction(context, record, docs) {
  checkPublicDescription(context, record, docs);
  checkPublicParams(context, record, docs);
  checkPublicReturn(context, record, docs);
  checkPublicThrows(context, record, docs);
}

/** Reports whether private JSDoc is a one-line summary. */
function hasConcisePrivateSummary(docs) {
  const nonInternalTags = [...docs.tags.keys()].filter((tag) => tag !== 'internal');
  return docs.descriptionLines.length === 1 && nonInternalTags.length === 0;
}

/** Validates the private JSDoc contract. */
function checkPrivateFunction(context, record, docs) {
  if (hasConcisePrivateSummary(docs)) return;
  context.report({
    node: record.docsNode,
    message: `Private function "${record.name}" needs a concise one-line JSDoc summary.`
  });
}

/** Checks a single covered function record. */
function checkFunctionRecord(context, record) {
  if (!record.name || isBaselined(context, record)) return;
  const docs = parseLeadingJsDoc(context, record.docsNode);
  if (!docs) {
    reportMissingJsDoc(context, record);
    return;
  }
  if (record.isPublic) checkPublicFunction(context, record, docs);
  else checkPrivateFunction(context, record, docs);
}

/** Returns configured complex conditional rule options. */
function complexConditionalOptions(context) {
  const options = context.options?.[0] ?? {};
  return {
    includeNullishCoalescing: options.includeNullishCoalescing ?? false,
    includeTernary: options.includeTernary ?? true,
    maxLogicalOperators: options.maxLogicalOperators ?? 1
  };
}

/** Reports whether a logical operator should count as predicate complexity. */
function shouldCountLogicalOperator(operator, options) {
  if (operator === '&&' || operator === '||') return true;
  return operator === '??' && options.includeNullishCoalescing;
}

/** Counts logical operators inside one predicate expression. */
function countPredicateOperators(node, options) {
  if (!node || isFunctionNode(node)) return 0;
  const ownCount = predicateNodeCount(node, options);
  return ownCount + childNodes(node).reduce((sum, child) => sum + countPredicateOperators(child, options), 0);
}

/** Counts the current predicate node when it is an operator of interest. */
function predicateNodeCount(node, options) {
  if (node.type === 'LogicalExpression' && shouldCountLogicalOperator(node.operator, options)) return 1;
  if (node.type === 'ConditionalExpression' && options.includeTernary) return 1;
  return 0;
}

/** Reports a predicate when it exceeds the configured operator threshold. */
function checkPredicate(context, node) {
  if (!node) return;
  const options = complexConditionalOptions(context);
  const count = countPredicateOperators(node, options);
  if (count <= options.maxLogicalOperators) return;
  context.report({
    node,
    message: `Conditional has ${count} logical operators; extract a named predicate or split into guard clauses.`
  });
}

const complexConditionalRule = {
  meta: {
    type: 'suggestion',
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          includeNullishCoalescing: {type: 'boolean'},
          includeTernary: {type: 'boolean'},
          maxLogicalOperators: {type: 'number'}
        }
      }
    ]
  },
  create(context) {
    return {
      ConditionalExpression(node) {
        const options = complexConditionalOptions(context);
        checkPredicate(context, options.includeTernary ? node : node.test);
      },
      DoWhileStatement(node) {
        checkPredicate(context, node.test);
      },
      ForStatement(node) {
        checkPredicate(context, node.test);
      },
      IfStatement(node) {
        checkPredicate(context, node.test);
      },
      WhileStatement(node) {
        checkPredicate(context, node.test);
      }
    };
  }
};

const requireModuleJsDocRule = {
  meta: {type: 'suggestion', schema: []},
  create(context) {
    return {
      Program(node) {
        if (MODULE_JSDOC_PATTERN.test(context.sourceCode.text)) return;
        context.report({node, message: 'JS/TS files must start with a module-level JSDoc block containing @file.'});
      }
    };
  }
};

const requirePublicJsDocRule = {
  meta: {type: 'suggestion', schema: []},
  create(context) {
    let exportedNames = new Set();
    return {
      Program(node) {
        exportedNames = collectExportedNames(node);
      },
      FunctionDeclaration(node) {
        const record = functionRecord(node, exportedNames);
        if (!record.isPublic) return;
        checkFunctionRecord(context, record);
      },
      ExportDefaultDeclaration(node) {
        if (!isFunctionNode(node.declaration) || node.declaration.type === 'FunctionDeclaration') return;
        checkFunctionRecord(context, defaultFunctionExpressionRecord(node.declaration));
      },
      VariableDeclarator(node) {
        if (!isFunctionNode(node.init)) return;
        const record = variableFunctionRecord(node, exportedNames);
        if (record.isPublic) checkFunctionRecord(context, record);
      }
    };
  }
};

const requirePrivateJsDocRule = {
  meta: {type: 'suggestion', schema: []},
  create(context) {
    let exportedNames = new Set();
    return {
      Program(node) {
        exportedNames = collectExportedNames(node);
      },
      FunctionDeclaration(node) {
        if (!isTopLevelStatement(node)) return;
        const record = functionRecord(node, exportedNames);
        if (record.isPublic) return;
        checkFunctionRecord(context, record);
      },
      VariableDeclarator(node) {
        if (!isFunctionNode(node.init) || !isTopLevelFunctionVariable(node)) return;
        const record = variableFunctionRecord(node, exportedNames);
        if (!record.isPublic) checkFunctionRecord(context, record);
      }
    };
  }
};

export default {
  meta: {
    name: 'df12'
  },
  rules: {
    'complex-conditional': complexConditionalRule,
    'require-module-jsdoc': requireModuleJsDocRule,
    'require-private-jsdoc': requirePrivateJsDocRule,
    'require-public-jsdoc': requirePublicJsDocRule
  }
};
