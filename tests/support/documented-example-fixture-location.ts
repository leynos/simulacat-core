/** @file Guards external cache locations for documented-example consumers. */
import {isAbsolute, relative, sep} from 'node:path';

/**
 * Rejects a fixture cache parent at or below the canonical checkout path.
 *
 * @param checkoutPath Canonical absolute path to the repository checkout.
 * @param cacheParent Canonical absolute path to the fixture cache parent.
 * @throws Error when the cache parent is equal to or inside the checkout.
 */
export const assertFixtureCacheOutsideCheckout = (checkoutPath: string, cacheParent: string): void => {
  const relativePath = relative(checkoutPath, cacheParent);

  if (relativePath === '' || !isParentTraversal(relativePath)) {
    throw new Error(`Documented-example cache must be outside the checkout: ${cacheParent}`);
  }
};

/** Identifies a relative path that escapes its parent directory. */
const isParentTraversal = (path: string): boolean => {
  if (path === '..') {
    return true;
  }

  if (path.startsWith(`..${sep}`)) {
    return true;
  }

  return isAbsolute(path);
};
