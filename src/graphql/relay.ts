/** @file Relay pagination helpers shared by GraphQL connections. */
export interface PageArgs {
  first?: number;
  before?: string;
  last?: number;
  after?: string;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

export interface Page<T> {
  totalCount: number;
  edges: {
    node: T;
    cursor: string;
  }[];
  nodes: T[];
  pageInfo: PageInfo;
}

export interface RelayPagingOptions {
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}

const identity = <A>(a: A): A => a;

const parseCursor = (name: 'before' | 'after', cursor: string | undefined, defaultValue: number) => {
  if (cursor == null) {
    return defaultValue;
  }

  const value = Number(cursor);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`value of '${name}' must be a non-negative integer, was ${cursor}`);
  }

  return value;
};

/**
 * Slices a node list into a Relay-compatible page response.
 *
 * @example
 * ```ts
 * const page = applyRelayPagination(['a', 'b', 'c'], {first: 2});
 * // => nodes ['a', 'b'], startCursor '0', endCursor '1'
 * ```
 */
export function applyRelayPagination<T, R>(
  nodes: T[],
  args: PageArgs,
  mapper: (a: T) => R = identity as (a: T) => R
): Page<R> {
  const totalNodes = nodes.length;
  const range = applyCursorsToEdges(nodes, args.before, args.after);

  const edges = edgesToReturn(range, args.first, args.last).map((edge) => ({
    ...edge,
    node: mapper(edge.node)
  }));

  const [first] = edges;
  const last = edges.slice().pop();

  return {
    totalCount: nodes.length,
    edges,
    nodes: edges.map((e) => e.node),
    pageInfo: {
      get hasNextPage() {
        const {first, before} = args;
        if (first != null) {
          return range.length > first;
        } else if (before != null) {
          return Number(before) < totalNodes - 1;
        }
        return false;
      },
      get hasPreviousPage() {
        const {last, after} = args;
        if (last != null) {
          return range.length > last;
        } else if (after != null) {
          return Number(after) > 0;
        }
        return false;
      },
      startCursor: first?.cursor,
      endCursor: last?.cursor
    } as PageInfo
  };
}

/**
 * Applies the `before` and `after` cursors before size-based pagination.
 *
 * @example
 * ```ts
 * const edges = applyCursorsToEdges(['a', 'b', 'c'], undefined, '0');
 * // => edges for ['b', 'c']
 * ```
 */
function applyCursorsToEdges<T>(nodes: T[], before?: string, after?: string) {
  const afterIdx = parseCursor('after', after, -1);
  const beforeIdx = parseCursor('before', before, nodes.length);

  const edges = nodes.slice(afterIdx + 1, beforeIdx).map((node, i) => ({
    node,
    cursor: (afterIdx + 1 + i).toString()
  }));

  return edges;
}

/**
 * Applies `first` or `last` limits to an edge collection.
 *
 * @example
 * ```ts
 * const edges = edgesToReturn([1, 2, 3], 2);
 * // => [1, 2]
 * ```
 */
function edgesToReturn<T>(edges: T[], first?: number, last?: number) {
  let newEdges = edges;
  if (first == null && last == null) {
    first = 100;
  }
  if (first != null) {
    if (first < 0) {
      throw new Error(`value of 'first' must be greater than 0, was ${first}`);
    }
    newEdges = newEdges.slice(0, first);
  }
  if (last != null) {
    if (last < 0) {
      throw new Error(`value of 'last' must be greater than 0, was ${last}`);
    }
    if (last === 0) {
      newEdges = [];
    } else {
      newEdges = newEdges.slice(-last);
    }
  }

  return newEdges;
}
