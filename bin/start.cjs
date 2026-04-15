#!/usr/bin/env node
/** @file CommonJS CLI entry point for launching the built package. */
const githubAPIsimulator = require('../dist/index.cjs');

const app = githubAPIsimulator.simulation();
app.listen(3300, () => console.log(`github-api simulation server started at http://localhost:3300`));
