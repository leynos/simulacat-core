#!/usr/bin/env node
/** @file CommonJS CLI entry point for launching the built package. */
// oxlint-disable-next-line typescript/no-require-imports -- CommonJS CLI entry point; this file must run under Node without transpilation.
const githubAPIsimulator = require('../dist/index.cjs');

const app = githubAPIsimulator.simulation();
const port = Number(process.env.PORT) || 3300;

void app.listen(port, () => console.log(`github-api simulation server started at http://localhost:${port}`));
