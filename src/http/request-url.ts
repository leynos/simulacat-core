/**
 * @file Request-scoped URL policy for simulator response payloads.
 *
 * This module stays framework-neutral: REST and GraphQL adapters extract a
 * plain origin record from their request types before calling these helpers.
 */

/** Transport origin values extracted from an inbound request. */
export type RequestOrigin = {protocol: string; host: string};

/** API and web URL bases used when projecting stored entities to wire payloads. */
export type BaseUrls = {apiBaseUrl: string; webBaseUrl: string};

const missingHostMessage = 'SIMULACAT: cannot derive base URL';
const httpProtocols = new Set(['http:', 'https:']);

/** Removes duplicate slashes from an API-root path. */
const collapseSlashes = (value: string): string => value.replace(/\/+/g, '/');

/** Removes trailing slashes while preserving the root slash. */
const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/g, '');

/**
 * Normalizes an API root to empty or `/segment` form.
 *
 * @example
 * ```ts
 * normalizeApiRoot('//api//v3//'); // '/api/v3'
 * ```
 *
 * @param apiRoot API root configured for REST routing.
 * @returns A normalized API root with no trailing slash, or empty string for root.
 */
export const normalizeApiRoot = (apiRoot: string): string => {
  const trimmed = apiRoot.trim();
  if (trimmed === '' || trimmed === '/') return '';

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = stripTrailingSlashes(collapseSlashes(withLeadingSlash));
  return normalized === '/' ? '' : normalized;
};

/**
 * Joins a base URL and resource path with one separating slash.
 *
 * @example
 * ```ts
 * buildUrl('http://localhost:3300/api/v3/', '/repos/acme/demo');
 * // 'http://localhost:3300/api/v3/repos/acme/demo'
 * ```
 *
 * @param base Absolute base URL.
 * @param path Resource path or URI-template path.
 * @returns Joined URL string.
 */
export const buildUrl = (base: string, path: string): string => {
  const normalizedBase = base.replace(/\/+$/g, '');
  const normalizedPath = path.replace(/^\/+/g, '');
  return normalizedPath === '' ? normalizedBase : `${normalizedBase}/${normalizedPath}`;
};

/** Normalizes a protocol value for URL construction. */
const normalizeProtocol = (protocol: string): string =>
  protocol
    .trim()
    .replace(/:\/{2}$/u, '')
    .replace(/:$/u, '');

/** Checks raw JavaScript input before string methods are called. */
const isString = (value: unknown): value is string => typeof value === 'string';

/** Checks raw JavaScript input before property access. */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Parses an absolute URL without leaking constructor-specific errors. */
const parseAbsoluteUrl = (value: string): URL | undefined => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

/** Keeps base derivation on schemes that have a network host and origin. */
const isHttpUrl = (url: URL): boolean => httpProtocols.has(url.protocol) && url.host !== '';

/** Rejects URL components that are not valid in an HTTP Host header. */
const containsUrlComponents = (host: string): boolean => /[@/?#\\]/u.test(host);

/** Builds an origin URL from request protocol and host. */
const originFromRequest = (origin: RequestOrigin): URL | undefined => {
  if (!isRecord(origin)) return undefined;
  const {protocol, host} = origin;
  if (!isString(protocol)) return undefined;
  if (!isString(host)) return undefined;
  const trimmedHost = host.trim();
  if (trimmedHost === '') return undefined;
  if (containsUrlComponents(trimmedHost)) return undefined;
  const parsedUrl = parseAbsoluteUrl(`${normalizeProtocol(protocol)}://${trimmedHost}`);
  if (!parsedUrl) return undefined;
  if (!isHttpUrl(parsedUrl)) return undefined;
  return parsedUrl;
};

/** Builds an origin URL from a configured fallback base URL. */
const originFromFallback = (fallbackBaseUrl: string | undefined): URL | undefined => {
  if (!isString(fallbackBaseUrl)) return undefined;
  const trimmedFallback = fallbackBaseUrl.trim();
  if (trimmedFallback === '') return undefined;
  const parsedUrl = parseAbsoluteUrl(trimmedFallback);
  if (!parsedUrl) return undefined;
  if (!isHttpUrl(parsedUrl)) return undefined;
  return parsedUrl;
};

/**
 * Derives API and web base URLs from a request origin and API root.
 *
 * @example
 * ```ts
 * buildBaseUrls({protocol: 'http', host: 'localhost:3300'}, '/api/v3');
 * // {apiBaseUrl: 'http://localhost:3300/api/v3', webBaseUrl: 'http://localhost:3300'}
 * ```
 *
 * @param origin Transport origin values extracted by an adapter.
 * @param apiRoot Configured API root, such as `/` or `/api/v3`.
 * @param fallbackBaseUrl Optional absolute fallback used when request host is absent.
 * @returns Request-scoped API and web base URLs.
 * @throws {Error} When neither request host nor fallback base URL provides a host.
 */
export const buildBaseUrls = (origin: RequestOrigin, apiRoot: string, fallbackBaseUrl?: string): BaseUrls => {
  const originUrl = originFromRequest(origin) ?? originFromFallback(fallbackBaseUrl);
  if (!originUrl) throw new Error(missingHostMessage);

  const webBaseUrl = originUrl.origin;
  const apiBaseUrl = `${webBaseUrl}${normalizeApiRoot(apiRoot)}`;

  return {
    apiBaseUrl,
    webBaseUrl
  };
};
