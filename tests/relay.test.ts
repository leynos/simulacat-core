/** @file Unit tests for Relay-style pagination helpers and invariants. */

import {describe, expect, it} from 'bun:test';
import fc from 'fast-check';
import {applyRelayPagination} from '../src/graphql/relay.ts';

describe('applyRelayPagination', () => {
  it('returns the first page with stable cursors', () => {
    const page = applyRelayPagination(['a', 'b', 'c', 'd'], {first: 2});

    expect(page.totalCount).toBe(4);
    expect(page.nodes).toEqual(['a', 'b']);
    expect(page.edges).toEqual([
      {node: 'a', cursor: '0'},
      {node: 'b', cursor: '1'}
    ]);
    expect(page.pageInfo.startCursor).toBe('0');
    expect(page.pageInfo.endCursor).toBe('1');
    expect(page.pageInfo.hasNextPage).toBe(true);
    expect(page.pageInfo.hasPreviousPage).toBe(false);
  });

  it('supports after and last pagination windows', () => {
    const page = applyRelayPagination(['a', 'b', 'c', 'd', 'e'], {after: '1', last: 2});

    expect(page.nodes).toEqual(['d', 'e']);
    expect(page.edges.map((edge) => edge.cursor)).toEqual(['3', '4']);
    expect(page.pageInfo.startCursor).toBe('3');
    expect(page.pageInfo.endCursor).toBe('4');
    expect(page.pageInfo.hasNextPage).toBe(false);
    expect(page.pageInfo.hasPreviousPage).toBe(true);
  });

  it('applies last to the already-trimmed first window', () => {
    const page = applyRelayPagination(['a', 'b', 'c', 'd'], {first: 3, last: 1});

    expect(page.nodes).toEqual(['c']);
    expect(page.edges).toEqual([{node: 'c', cursor: '2'}]);
  });

  it('reports hasNextPage against the untrimmed range when before is provided', () => {
    const page = applyRelayPagination(['a', 'b', 'c', 'd'], {before: '2'});

    expect(page.nodes).toEqual(['a', 'b']);
    expect(page.pageInfo.hasNextPage).toBe(true);
  });

  it('returns an empty page when last is zero', () => {
    const page = applyRelayPagination(['a', 'b', 'c'], {last: 0});

    expect(page.nodes).toEqual([]);
    expect(page.edges).toEqual([]);
    expect(page.pageInfo.startCursor).toBeUndefined();
    expect(page.pageInfo.endCursor).toBeUndefined();
  });

  it('maps nodes before returning them', () => {
    const page = applyRelayPagination([{name: 'a'}, {name: 'b'}], {first: 2}, (node) => node.name.toUpperCase());

    expect(page.nodes).toEqual(['A', 'B']);
    expect(page.edges).toEqual([
      {node: 'A', cursor: '0'},
      {node: 'B', cursor: '1'}
    ]);
  });

  it('preserves pagination invariants across generated windows', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string(), {maxLength: 12}),
        fc.record({
          first: fc.option(fc.integer({min: 0, max: 12}), {nil: undefined}),
          last: fc.option(fc.integer({min: 0, max: 12}), {nil: undefined}),
          after: fc.option(fc.integer({min: 0, max: 11}).map(String), {nil: undefined}),
          before: fc.option(fc.integer({min: 0, max: 12}).map(String), {nil: undefined})
        }),
        async (nodes, args) => {
          const pageArgs = {
            ...(args.first === undefined ? {} : {first: args.first}),
            ...(args.last === undefined ? {} : {last: args.last}),
            ...(args.after === undefined ? {} : {after: args.after}),
            ...(args.before === undefined ? {} : {before: args.before})
          };
          const page = applyRelayPagination(nodes, pageArgs);
          const cursors = page.edges.map((edge) => Number(edge.cursor));

          expect(page.totalCount).toBe(nodes.length);
          expect(page.edges.length).toBe(page.nodes.length);
          expect(page.edges.map((edge) => edge.node)).toEqual(page.nodes);
          expect(
            cursors.every((cursor, index) => {
              if (index === 0) {
                return true;
              }

              const previousCursor = cursors[index - 1];
              return previousCursor !== undefined && cursor === previousCursor + 1;
            })
          ).toBe(true);
          expect(page.pageInfo.startCursor).toBe(page.edges[0]?.cursor);
          expect(page.pageInfo.endCursor).toBe(page.edges.at(-1)?.cursor);
        }
      )
    );
  });

  it('rejects negative first values', () => {
    expect(() => applyRelayPagination(['a'], {first: -1})).toThrow("value of 'first' must be greater than 0");
  });

  it('rejects negative last values', () => {
    expect(() => applyRelayPagination(['a'], {last: -1})).toThrow("value of 'last' must be greater than 0");
  });
});
