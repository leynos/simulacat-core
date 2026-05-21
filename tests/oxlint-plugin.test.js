/** @file Behavioural tests for the local df12 Oxlint plugin. */

import {describe, expect, it} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
function runOxlint({configPath, filePath}) {
  return spawnSync('bunx', ['oxlint', '-c', configPath, '--format', 'unix', filePath], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8'
  });
}

/** Counts diagnostics for one rule id. */
function countRuleFindings(output, ruleId) {
  return output.split('\n').filter((line) => line.includes(ruleId)).length;
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
