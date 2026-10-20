/**
 * @file Request-scoped URL policy for simulator response payloads.
 *
 * This module stays framework-neutral: REST and GraphQL adapters extract a
 * plain origin record from their request types before calling these helpers.
 */
import {z} from 'zod';
import {
  observeBaseUrl,
  observeRejectedRequestOrigin,
  rememberBaseUrlObservationContext,
  type UrlObservationContext,
  type UrlObservationReason
} from './url-observability.ts';

/**
 * Transport origin values extracted from an inbound request.
 *
 * Adapters build this from framework request fields, so the two members are
 * intentionally plain strings; {@link decodeRequestOrigin} decides whether the
 * runtime values actually satisfy that contract.
 */
export type RequestOrigin = {protocol: string; host: string};

/**
 * The untrusted runtime shape an adapter may hand over before decoding.
 *
 * Express exposes `protocol` as a string and `host` as `string | undefined`,
 * while tests and third-party adapters can supply anything at all.
 */
export type UnvalidatedRequestOrigin = {protocol?: unknown; host?: unknown};

const requestOriginSchema = z.object({protocol: z.string(), host: z.string()});

/** Decodes untrusted request origin fields into a validated {@link RequestOrigin}. */
const decodeRequestOrigin = (
  value: UnvalidatedRequestOrigin
): {ok: true; value: RequestOrigin} | {ok: false; reason: UrlObservationReason} => {
  const parsed = requestOriginSchema.safeParse(value);
  if (parsed.success) return {ok: true, value: parsed.data};
  return {ok: false, reason: parsed.error.issues[0]?.path[0] === 'protocol' ? 'invalid-protocol' : 'invalid-host'};
};

/** API and web URL bases used when projecting stored entities to wire payloads. */
export type BaseUrls = {apiBaseUrl: string; webBaseUrl: string};

const missingHostMessage = 'SIMULACAT: cannot derive base URL';
const httpProtocols = new Set(['http:', 'https:']);

/** Removes duplicate slashes from an API-root path. */
const collapseSlashes = (value: string): string => value.replaceAll(/\/+/g, '/');

/** Removes trailing slashes while preserving the root slash. */
const stripTrailingSlashes = (value: string): string => value.replaceAll(/\/+$/g, '');

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
  const normalizedBase = base.replaceAll(/\/+$/g, '');
  const normalizedPath = path.replaceAll(/^\/+/g, '');
  return normalizedPath === '' ? normalizedBase : `${normalizedBase}/${normalizedPath}`;
};

/** Normalizes a protocol value for URL construction. */
const normalizeProtocol = (protocol: string): string =>
  protocol
    .trim()
    .replace(/:\/{2}$/u, '')
    .replace(/:$/u, '');

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

/** Builds an origin URL from decoded request protocol and host. */
const originFromRequest = (origin: RequestOrigin): OriginAttempt => {
  const trimmedHost = origin.host.trim();
  if (trimmedHost === '') return {reason: 'missing-host'};
  if (containsUrlComponents(trimmedHost)) return {reason: 'invalid-host'};
  const parsedUrl = parseAbsoluteUrl(`${normalizeProtocol(origin.protocol)}://${trimmedHost}`);
  if (!parsedUrl) return {reason: 'invalid-host'};
  if (!isHttpUrl(parsedUrl)) return {reason: 'invalid-protocol'};
  return {url: parsedUrl, reason: 'none'};
};

/** Builds an origin URL from a configured fallback base URL. */
const originFromFallback = (fallbackBaseUrl: string | undefined): OriginAttempt => {
  if (fallbackBaseUrl === undefined) return {reason: 'missing-fallback'};
  const trimmedFallback = fallbackBaseUrl.trim();
  if (trimmedFallback === '') return {reason: 'missing-fallback'};
  const parsedUrl = parseAbsoluteUrl(trimmedFallback);
  if (!parsedUrl) return {reason: 'invalid-fallback'};
  if (!isHttpUrl(parsedUrl)) return {reason: 'invalid-fallback'};
  return {url: parsedUrl, reason: 'none'};
};

/** Selects a request or fallback origin and records its bounded outcome. */
const resolveOrigin = (
  origin: UnvalidatedRequestOrigin,
  fallbackBaseUrl: string | undefined,
  observationContext: UrlObservationContext
): URL | undefined => {
  const decodedOrigin = decodeRequestOrigin(origin);
  const requestOrigin: OriginAttempt = decodedOrigin.ok
    ? originFromRequest(decodedOrigin.value)
    : {reason: decodedOrigin.reason};
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
  origin: UnvalidatedRequestOrigin,
  apiRoot: string,
  fallbackBaseUrl?: string,
  observationContext?: UrlObservationContext
): BaseUrls => {
  const context = observationContext ?? {transport: 'internal'};
  const originUrl = resolveOrigin(origin, fallbackBaseUrl, context);
  if (!originUrl) throw new Error(missingHostMessage);

  const webBaseUrl = originUrl.origin;
  const apiBaseUrl = `${webBaseUrl}${normalizeApiRoot(apiRoot)}`;

  const baseUrls = {
    apiBaseUrl,
    webBaseUrl
  };
  rememberBaseUrlObservationContext(baseUrls, context);
  return baseUrls;
};
