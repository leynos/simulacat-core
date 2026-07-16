/**
 * @file Request-scoped URL policy for simulator response payloads.
 *
 * This module stays framework-neutral: REST and GraphQL adapters extract a
 * plain origin record from their request types before calling these helpers.
 */
import {
  observeBaseUrl,
  observeRejectedRequestOrigin,
  rememberBaseUrlObservationContext,
  type UrlObservationContext,
  type UrlObservationReason
} from './url-observability.ts';

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

type OriginAttempt = {url?: URL; reason: UrlObservationReason};

/** Builds an origin URL from request protocol and host. */
const originFromRequest = (origin: RequestOrigin): OriginAttempt => {
  if (!isRecord(origin)) return {reason: 'invalid-host'};
  const {protocol, host} = origin;
  if (!isString(protocol)) return {reason: 'invalid-protocol'};
  if (!isString(host)) return {reason: 'invalid-host'};
  const trimmedHost = host.trim();
  if (trimmedHost === '') return {reason: 'missing-host'};
  if (containsUrlComponents(trimmedHost)) return {reason: 'invalid-host'};
  const parsedUrl = parseAbsoluteUrl(`${normalizeProtocol(protocol)}://${trimmedHost}`);
  if (!parsedUrl) return {reason: 'invalid-host'};
  if (!isHttpUrl(parsedUrl)) return {reason: 'invalid-protocol'};
  return {url: parsedUrl, reason: 'none'};
};

/** Builds an origin URL from a configured fallback base URL. */
const originFromFallback = (fallbackBaseUrl: string | undefined): OriginAttempt => {
  if (!isString(fallbackBaseUrl)) return {reason: 'missing-fallback'};
  const trimmedFallback = fallbackBaseUrl.trim();
  if (trimmedFallback === '') return {reason: 'missing-fallback'};
  const parsedUrl = parseAbsoluteUrl(trimmedFallback);
  if (!parsedUrl) return {reason: 'invalid-fallback'};
  if (!isHttpUrl(parsedUrl)) return {reason: 'invalid-fallback'};
  return {url: parsedUrl, reason: 'none'};
};

/** Selects a request or fallback origin and records its bounded outcome. */
const resolveOrigin = (
  origin: RequestOrigin,
  fallbackBaseUrl: string | undefined,
  observationContext: UrlObservationContext
): URL | undefined => {
  const requestOrigin = originFromRequest(origin);
  if (requestOrigin.url) {
    observeBaseUrl(observationContext, 'request-origin', 'none');
    return requestOrigin.url;
  }

  observeRejectedRequestOrigin(observationContext, requestOrigin.reason);
  const fallbackOrigin = originFromFallback(fallbackBaseUrl);
  if (fallbackOrigin.url) {
    observeBaseUrl(observationContext, 'fallback', requestOrigin.reason);
    return fallbackOrigin.url;
  }

  observeBaseUrl(observationContext, 'failure', fallbackOrigin.reason);
  return undefined;
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
 * @param observationContext Optional plain transport and request-id context for
 * bounded observations. No framework request object is accepted here.
 * @returns Request-scoped API and web base URLs.
 * @throws {Error} When neither request host nor fallback base URL provides a host.
 */
export const buildBaseUrls = (
  origin: RequestOrigin,
  apiRoot: string,
  fallbackBaseUrl?: string,
  observationContext: UrlObservationContext = {transport: 'internal'}
): BaseUrls => {
  const originUrl = resolveOrigin(origin, fallbackBaseUrl, observationContext);
  if (!originUrl) throw new Error(missingHostMessage);

  const webBaseUrl = originUrl.origin;
  const apiBaseUrl = `${webBaseUrl}${normalizeApiRoot(apiRoot)}`;

  const baseUrls = {
    apiBaseUrl,
    webBaseUrl
  };
  rememberBaseUrlObservationContext(baseUrls, observationContext);
  return baseUrls;
};
