/** @file Shared numeric ID offsets for generated early entity fixtures. */

/**
 * Separates generated REST integer IDs by entity family when fixture authors
 * omit provider IDs. The current bands leave 10,000 generated IDs per family;
 * callers with larger fixture sets should provide explicit provider IDs or
 * widen these bands before seeding overlapping numeric ranges.
 */
export const ENTITY_ID_OFFSETS = {
  ISSUE: 10_000,
  PULL_REQUEST: 20_000
} as const;
