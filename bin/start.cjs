#!/usr/bin/env node
/** @file CommonJS CLI entry point for launching the built package. */
const githubAPIsimulator = require('../dist/index.cjs');

const app = githubAPIsimulator.simulation();
const port = Number(process.env.PORT) || 3300;

app.listen(port, () => console.log(`github-api simulation server started at http://localhost:${port}`));
