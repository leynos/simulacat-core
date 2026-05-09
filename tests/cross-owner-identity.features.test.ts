/** @file Loads Gherkin feature scenarios into Bun's test runner. */
import {loadFeatures} from './cucumber.js';

await loadFeatures('features/**/*.feature');
