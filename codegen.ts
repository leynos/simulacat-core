/**
 * @file GraphQL Codegen configuration for resolver type generation.
 *
 * This module defines the `CodegenConfig` consumed by `graphql-codegen` during
 * type generation. Update this file to change the loaded schema, generated
 * outputs, or plugin set used by the build.
 */
import type {CodegenConfig} from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: './schema/schema.docs.graphql',
  generates: {
    './src/__generated__/resolvers-types.ts': {
      config: {
        useTypeImports: true
      },
      plugins: ['typescript', 'typescript-resolvers']
    }
  }
};
export default config;
