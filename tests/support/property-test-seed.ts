/**
 * @file Shared deterministic seed for property-based tests.
 *
 * Fast-check uses random generation to explore invariants. Keeping one seed for
 * repository tests makes CI failures reproducible without coupling individual
 * suites to their own magic numbers.
 */

const propertyTestSeed = 13_101;

export {propertyTestSeed};
