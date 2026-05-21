/** @file Behavioural tests for the local df12 Oxlint plugin. */

import {describe, expect, it} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import {testInternals} from '../tools/oxlint-plugin-df12/index.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const PLUGIN_PATH = path.join(PROJECT_ROOT, 'tools/oxlint-plugin-df12/index.js');
const JSDOC_RULES = {
  'df12/require-module-jsdoc': 'error',
  'df12/require-private-jsdoc': 'error',
  'df12/require-public-jsdoc': 'error'
};

/** Creates a temporary plugin fixture workspace. */
function createFixtureWorkspace() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'simulacat-oxlint-plugin-'));
  return {
    cleanup() {
      rmSync(directory, {force: true, recursive: true});
    },
    directory
  };
}

/** Converts the plugin path to a config-local import specifier. */
function pluginSpecifier(directory) {
  const relativePath = path.relative(directory, PLUGIN_PATH).replaceAll(path.sep, '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

/** Writes an Oxlint config for a selected rule set. */
function writeConfig({directory, rules}) {
  const configPath = path.join(directory, '.oxlintrc.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        categories: {
          correctness: 'off',
          nursery: 'off',
          pedantic: 'off',
          perf: 'off',
          restriction: 'off',
          style: 'off',
          suspicious: 'off'
        },
        jsPlugins: [pluginSpecifier(directory)],
        rules
      },
      null,
      2
    ),
    'utf8'
  );
  return configPath;
}

/** Writes one TypeScript fixture file. */
function writeSource({directory, name, source}) {
  const filePath = path.join(directory, name);
  writeFileSync(filePath, source, 'utf8');
  return filePath;
}

/** Runs Oxlint against a fixture workspace. */
function runOxlint({configPath, cwd = PROJECT_ROOT, filePath}) {
  return spawnSync('bunx', ['oxlint', '-c', configPath, '--format', 'unix', filePath], {
    cwd,
    encoding: 'utf8'
  });
}

/** Counts diagnostics for one rule id. */
function countRuleFindings(output, ruleId) {
  return output.split('\n').filter((line) => line.includes(ruleId)).length;
}

/** Replaces fixture-local absolute paths with stable snapshot text. */
function normalizeDiagnostics(output, directory) {
  return output.replaceAll(directory, '<workspace>');
}

describe('df12/complex-conditional', () => {
  it('counts logical operators in branch predicates without counting nested callback predicates', () => {
    const workspace = createFixtureWorkspace();
    try {
      const configPath = writeConfig({
        directory: workspace.directory,
        rules: {
          'df12/complex-conditional': [
            'error',
            {
              includeNullishCoalescing: false,
              includeTernary: true,
              maxLogicalOperators: 1
            }
          ]
        }
      });
      const filePath = writeSource({
        directory: workspace.directory,
        name: 'complex-conditional.ts',
        source: `
          function checks(a, b, c, items, ready) {
            if (a) {}
            if (a && b) {}
            if (a && b && c) {}
            if ((a || b) && c) {}
            if (items.some((item) => item.ready && item.enabled) && ready) {}
          }
        `
      });

      const result = runOxlint({configPath, filePath});
      expect(result.status).toBe(1);
      expect(countRuleFindings(result.stdout, 'df12(complex-conditional)')).toBe(2);
    } finally {
      workspace.cleanup();
    }
  });

  it('counts ternary roots and nested logical operators when ternaries are included', () => {
    const workspace = createFixtureWorkspace();
    try {
      const configPath = writeConfig({
        directory: workspace.directory,
        rules: {
          'df12/complex-conditional': [
            'error',
            {
              includeTernary: true,
              maxLogicalOperators: 1
            }
          ]
        }
      });
      const filePath = writeSource({
        directory: workspace.directory,
        name: 'complex-ternary.ts',
        source: `
          const x = a ? (b && c) : d;
        `
      });

      const result = runOxlint({configPath, filePath});
      expect(result.status).toBe(1);
      expect(countRuleFindings(result.stdout, 'df12(complex-conditional)')).toBe(1);
    } finally {
      workspace.cleanup();
    }
  });
});

describe('df12/complex-conditional diagnostics', () => {
  it('checks diagnostic output for a complex conditional', () => {
    const workspace = createFixtureWorkspace();
    try {
      const configPath = writeConfig({
        directory: workspace.directory,
        rules: {
          'df12/complex-conditional': [
            'error',
            {
              includeTernary: true,
              maxLogicalOperators: 1
            }
          ]
        }
      });
      const filePath = writeSource({
        directory: workspace.directory,
        name: 'diagnostic.ts',
        source: `
          if (a && b && c) {}
        `
      });

      const result = runOxlint({configPath, filePath});
      expect(normalizeDiagnostics(result.stdout, workspace.directory)).toMatchSnapshot();
    } finally {
      workspace.cleanup();
    }
  });
});

describe('df12/complex-conditional properties', () => {
  it('counts generated predicate operators consistently', () => {
    const countedLogicalOperator = fc.constantFrom('&&', '||');
    const valueExpression = fc.record({
      type: fc.constant('Identifier'),
      name: fc.string({minLength: 1, maxLength: 8})
    });
    const logicalExpression = fc.record({
      type: fc.constant('LogicalExpression'),
      operator: countedLogicalOperator,
      left: valueExpression,
      right: valueExpression
    });
    const conditionalExpression = fc.record({
      type: fc.constant('ConditionalExpression'),
      test: valueExpression,
      consequent: logicalExpression,
      alternate: valueExpression
    });

    fc.assert(
      fc.property(fc.array(logicalExpression, {minLength: 0, maxLength: 20}), (expressions) => {
        const body = {
          type: 'SequenceExpression',
          expressions
        };
        expect(testInternals.countPredicateOperators(body, {includeTernary: false})).toBe(expressions.length);
      })
    );

    fc.assert(
      fc.property(conditionalExpression, (expression) => {
        expect(testInternals.countPredicateOperators(expression, {includeTernary: true})).toBe(2);
        expect(testInternals.countPredicateOperators(expression, {includeTernary: false})).toBe(1);
      })
    );
  });
});

describe('df12 JSDoc rules', () => {
  it('reports module, public function, and private function documentation contract violations', () => {
    const workspace = createFixtureWorkspace();
    try {
      const configPath = writeConfig({
        directory: workspace.directory,
        rules: JSDOC_RULES
      });
      const filePath = writeSource({
        directory: workspace.directory,
        name: 'missing-jsdoc.ts',
        source: `
          export function publicApi(value) {
            if (!value) {
              throw new Error('missing');
            }
            return value;
          }

          const privateHelper = () => 'value';

          function reExported(value) {
            return value;
          }

          export { reExported };
        `
      });

      const result = runOxlint({configPath, filePath});
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('df12(require-module-jsdoc)');
      expect(result.stdout).toContain('df12(require-public-jsdoc)');
      expect(result.stdout).toContain('df12(require-private-jsdoc)');
    } finally {
      workspace.cleanup();
    }
  });

  it('accepts supported documented function declaration shapes', () => {
    const workspace = createFixtureWorkspace();
    try {
      const configPath = writeConfig({
        directory: workspace.directory,
        rules: JSDOC_RULES
      });
      const filePath = writeSource({
        directory: workspace.directory,
        name: 'documented.ts',
        source: `
          /** @file Documented fixture. */

          /**
           * Reads one public value.
           *
           * @param value Value to read.
           * @returns The original value.
           */
          export function publicApi(value) {
            return value;
          }

          /**
           * Reads one default value.
           *
           * @param value Value to read.
           * @returns The original value.
           */
          export default function defaultApi(value) {
            return value;
          }

          /**
           * Reads one arrow value.
           *
           * @param value Value to read.
           * @returns The original value.
           */
          export const arrowApi = (value) => value;

          /**
           * Raises a documented fixture failure.
           *
           * @throws Always raises a fixture failure.
           */
          export function throwsApi() {
            throw new Error('failure');
          }

          /**
           * Reads a trailing re-exported value.
           *
           * @param value Value to read.
           * @returns The original value.
           */
          function reExported(value) {
            return value;
          }

          /** Builds a private value. */
          function privateHelper() {
            return 'value';
          }

          /** Builds a private arrow value. */
          const privateArrow = () => 'value';

          export { reExported };
        `
      });

      const result = runOxlint({configPath, filePath});
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
    } finally {
      workspace.cleanup();
    }
  });
});

describe('df12 JSDoc default exports', () => {
  it('reports missing JSDoc for default-exported expressions and aliases', () => {
    const workspace = createFixtureWorkspace();
    try {
      const configPath = writeConfig({
        directory: workspace.directory,
        rules: JSDOC_RULES
      });
      const expressionPath = writeSource({
        directory: workspace.directory,
        name: 'default-expression.ts',
        source: `
          /** @file Default expression fixture. */

          export default (value) => value;
        `
      });
      const aliasPath = writeSource({
        directory: workspace.directory,
        name: 'default-alias.ts',
        source: `
          /** @file Default alias fixture. */

          const defaultAlias = (value) => value;

          export default defaultAlias;
        `
      });

      const expressionResult = runOxlint({configPath, filePath: expressionPath});
      const aliasResult = runOxlint({configPath, filePath: aliasPath});
      expect(countRuleFindings(expressionResult.stdout, 'df12(require-public-jsdoc)')).toBeGreaterThan(0);
      expect(countRuleFindings(aliasResult.stdout, 'df12(require-public-jsdoc)')).toBeGreaterThan(0);
      expect(aliasResult.stdout).not.toContain('df12(require-private-jsdoc)');
    } finally {
      workspace.cleanup();
    }
  });
});

describe('df12 JSDoc negative cases', () => {
  it('reports targeted public JSDoc tag omissions', () => {
    const workspace = createFixtureWorkspace();
    try {
      const configPath = writeConfig({
        directory: workspace.directory,
        rules: JSDOC_RULES
      });
      const filePath = writeSource({
        directory: workspace.directory,
        name: 'missing-tags.ts',
        source: `
          /** @file Missing tag fixture. */

          /**
           * Reads a value.
           *
           * @returns The original value.
           */
          export function missingParam(value) {
            return value;
          }

          /**
           * Reads a value.
           *
           * @param value Value to read.
           */
          export function missingReturn(value) {
            return value;
          }
        `
      });

      const result = runOxlint({configPath, filePath});
      expect(result.stdout).toContain('Exported function "missingParam" must document parameter "value".');
      expect(result.stdout).toContain('Exported function "missingReturn" must document its return value.');
    } finally {
      workspace.cleanup();
    }
  });

  it('accepts a documented default-exported alias as public JSDoc', () => {
    const workspace = createFixtureWorkspace();
    try {
      const configPath = writeConfig({
        directory: workspace.directory,
        rules: JSDOC_RULES
      });
      const filePath = writeSource({
        directory: workspace.directory,
        name: 'documented-default-alias.ts',
        source: `
          /** @file Documented default alias fixture. */

          /**
           * Reads one default aliased value.
           *
           * @param value Value to read.
           * @returns The original value.
           */
          const defaultAlias = (value) => value;

          export default defaultAlias;
        `
      });

      const result = runOxlint({configPath, filePath});
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
    } finally {
      workspace.cleanup();
    }
  });
});

describe('df12 JSDoc baseline', () => {
  it('uses the current baseline file for each lint process', () => {
    const workspace = createFixtureWorkspace();
    try {
      const configPath = writeConfig({
        directory: workspace.directory,
        rules: JSDOC_RULES
      });
      const filePath = writeSource({
        directory: workspace.directory,
        name: 'baseline.ts',
        source: `
          /** @file Baseline fixture. */

          export function skipped(value) {
            return value;
          }
        `
      });
      const baselinePath = path.join(workspace.directory, '.jsdoc-baseline.json');
      writeFileSync(baselinePath, JSON.stringify({entries: ['baseline.ts#skipped']}), 'utf8');

      const skippedResult = runOxlint({configPath, cwd: workspace.directory, filePath});
      writeFileSync(baselinePath, JSON.stringify({entries: []}), 'utf8');
      const reportedResult = runOxlint({configPath, cwd: workspace.directory, filePath});

      expect(skippedResult.stdout).not.toContain('df12(require-public-jsdoc)');
      expect(reportedResult.stdout).toContain('df12(require-public-jsdoc)');
    } finally {
      workspace.cleanup();
    }
  });
});
