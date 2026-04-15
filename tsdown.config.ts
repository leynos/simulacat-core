/**
 * @file tsdown bundling configuration for package publishing.
 *
 * This module exports the default `defineConfig(...)` call used by the build.
 * Update it to change entry points, emitted formats, or packaging checks.
 */
import {defineConfig} from 'tsdown';

export default defineConfig({
  name: 'github-api',
  entry: './src/index.ts',
  exports: {devExports: 'development'},
  format: ['esm', 'cjs'], // Keep CJS while `bin/start.cjs` still requires `dist/index.cjs`.
  dts: {
    sourcemap: true
  },
  // handles dirname
  shims: true,
  minify: false,
  // runs with @arethetypeswrong/core which checks types
  attw: true,
  publint: true
});
