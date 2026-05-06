/** @file Bun test plugin registration for Gherkin feature scenarios. */
import {plugin} from 'bun';
import {bunTestCucumber} from '@aboviq/bun-test-cucumber';

await plugin(
  bunTestCucumber({
    stepDefinitionsPattern: 'tests/**/*.steps.ts'
  })
);
