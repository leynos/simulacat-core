/** @file Loads Gherkin feature scenarios into Bun's test runner. */
import {loadFeatures} from '@aboviq/bun-test-cucumber';

await loadFeatures('features/**/*.feature');
