/** @file Tests safe fixture locations and preparation failure cleanup. */
import {describe, expect, it} from 'bun:test';
import {mkdtemp, mkdir, realpath, rm, symlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {rethrowAfterCleanup} from './support/documented-example-failures.ts';
import {assertFixtureCacheOutsideCheckout} from './support/documented-example-fixture-location.ts';

describe('documented-example fixture cache location', () => {
  it('rejects equal and nested paths but accepts external paths with shared prefixes', () => {
    const checkoutPath = resolve('/home/build/workspace with spaces/simulacat-core');
    const nestedCache = join(checkoutPath, 'nested', 'fixture-cache');
    const siblingCache = `${checkoutPath}-cache`;
    const homeCache = resolve('/home/build/.cache/simulacat-core-documentation-examples');

    expect(() => assertFixtureCacheOutsideCheckout(checkoutPath, checkoutPath)).toThrow('outside the checkout');
    expect(() => assertFixtureCacheOutsideCheckout(checkoutPath, nestedCache)).toThrow('outside the checkout');
    expect(() => assertFixtureCacheOutsideCheckout(checkoutPath, siblingCache)).not.toThrow();
    expect(() => assertFixtureCacheOutsideCheckout(checkoutPath, homeCache)).not.toThrow();
  });

  it('rejects a symlink alias after both paths are canonicalized', async () => {
    const homePath = await realpath(homedir());
    const temporaryRoot = await mkdtemp(join(homePath, 'simulacat-fixture-location-'));
    const checkoutPath = join(temporaryRoot, 'workspace with spaces');
    const cacheAlias = join(temporaryRoot, 'cache-alias');

    try {
      await mkdir(checkoutPath);
      await symlink(checkoutPath, cacheAlias, 'dir');
      const canonicalCheckout = await realpath(checkoutPath);
      const canonicalCacheAlias = await realpath(cacheAlias);

      expect(() => assertFixtureCacheOutsideCheckout(canonicalCheckout, canonicalCacheAlias)).toThrow(
        'outside the checkout'
      );
    } finally {
      await rm(temporaryRoot, {recursive: true, force: true});
    }
  });
});

describe('documented-example preparation failure cleanup', () => {
  it('awaits successful cleanup before rethrowing the original error', async () => {
    const operationError = new Error('archive installation failed');
    let cleanupCompleted = false;
    const preparation = rethrowAfterCleanup(operationError, async () => {
      await Promise.resolve();
      cleanupCompleted = true;
    });

    await expect(preparation).rejects.toBe(operationError);
    expect(cleanupCompleted).toBe(true);
  });

  it('retains both errors when cleanup also fails', async () => {
    const operationError = new Error('archive installation failed');
    const cleanupError = new Error('fixture removal failed');
    const failure = await rethrowAfterCleanup(operationError, async () => {
      throw cleanupError;
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);

    if (!(failure instanceof AggregateError)) {
      throw new Error('Expected an aggregate of preparation and cleanup failures');
    }

    expect(failure.errors).toEqual([operationError, cleanupError]);
    expect(failure.cause).toBe(operationError);
  });
});
