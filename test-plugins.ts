/** @file Bun test plugin registration for Gherkin feature scenarios. */
import {plugin} from 'bun';
import {bunTestCucumber} from './tests/cucumber.js';

await plugin(
  bunTestCucumber({
    stepDefinitionsPattern: 'tests/**/*.steps.ts'
  })
);
