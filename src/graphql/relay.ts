/**
 * @file Relay cursor pagination helpers for GraphQL connection resolvers.
 *
 * This module applies Relay-style before/after/first/last arguments to in-memory
 * fixture arrays and returns connection page metadata for resolver callers.
 */

export interface PageArgs {
  first?: number;
  before?: string;
  last?: number;
  after?: string;
}

/**
 * Relay connection page metadata indicating cursor boundaries and whether
 * adjacent pages exist.
 */
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

/**
 * A Relay-compatible paginated result carrying edges, nodes, and page-info for
 * a single page of `T`.
 */
export interface Page<T> {
  totalCount: number;
  edges: {
    node: T;
    cursor: string;
  }[];
  nodes: T[];
  pageInfo: PageInfo;
}

/** Cursor-based pagination arguments accepted by Relay connections. */
export interface RelayPagingOptions {
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}

/** Default mapper: returns the node unchanged when no mapper is supplied. */
const identity = <A>(a: A): A => a;

/** Parses a string cursor into a non-negative integer index. */
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
 * The three-argument form maps every node, while the two-argument form keeps
 * the node type unchanged.
 *
 * @example
 * ```ts
 * const page = applyRelayPagination(['a', 'b', 'c'], {first: 2});
 * // => nodes ['a', 'b'], startCursor '0', endCursor '1'
 * ```
 *
 * @param nodes Source nodes to paginate.
 * @param args Relay pagination arguments.
 * @param mapper Optional node mapper applied after slicing.
 * @returns Relay-compatible page containing edges, nodes, and page metadata.
 */
export function applyRelayPagination<T>(nodes: T[], args: PageArgs): Page<T>;
export function applyRelayPagination<T, R>(nodes: T[], args: PageArgs, mapper: (a: T) => R): Page<R>;
/**
 * Implementation signature for {@link applyRelayPagination}.
 *
 * @param nodes Source nodes to paginate.
 * @param args Relay pagination arguments.
 * @param mapper Optional node mapper applied after slicing.
 * @returns Relay-compatible page containing edges, nodes, and page metadata.
 */
export function applyRelayPagination<T, R>(nodes: T[], args: PageArgs, mapper?: (a: T) => R): Page<T | R> {
  const totalNodes = nodes.length;
  const range = applyCursorsToEdges(nodes, args.before, args.after);
  // The overloads describe the two shapes the implementation serves: with a
  // mapper every node becomes `R`, and without one it stays a `T`.
  const mapNode: (a: T) => T | R = mapper ?? identity;

  const edges = edgesToReturn(range, args.first, args.last).map((edge) => ({
    ...edge,
    node: mapNode(edge.node)
  }));

  const [first] = edges;
  const last = [...edges].pop();

  const pageInfo: PageInfo = {
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
    }
  };
  // Cursor properties are only set when an edge exists so consumers can
  // distinguish an empty page from an empty-string cursor.
  if (first) pageInfo.startCursor = first.cursor;
  if (last) pageInfo.endCursor = last.cursor;

  return {
    totalCount: nodes.length,
    edges,
    nodes: edges.map((e) => e.node),
    pageInfo
  };
}

/** Applies the `before` and `after` cursors before size-based pagination. */
function applyCursorsToEdges<T>(nodes: T[], before?: string, after?: string) {
  const afterIdx = parseCursor('after', after, -1);
  const beforeIdx = parseCursor('before', before, nodes.length);

  const edges = nodes.slice(afterIdx + 1, beforeIdx).map((node, i) => ({
    node,
    cursor: (afterIdx + 1 + i).toString()
  }));

  return edges;
}

/** Applies `first` or `last` limits to an edge collection. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: pagination edge semantics predate the new complexity gate.
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
    // A zero-sized tail is an empty page; `slice(-0)` would return every edge.
    newEdges = last === 0 ? [] : newEdges.slice(-last);
  }

  return newEdges;
}
