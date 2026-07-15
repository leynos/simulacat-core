/** @file Unit tests for request-derived simulator base URLs. */
import {describe, expect, it} from 'bun:test';
import fc from 'fast-check';
import {buildBaseUrls, buildUrl, normalizeApiRoot} from '../src/http/request-url.ts';

const safeHost = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z](?:[A-Za-z0-9-]{0,11}[A-Za-z0-9])?$/),
    fc.stringMatching(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,11}[A-Za-z0-9])?$/),
    fc.option(fc.integer({min: 1, max: 65_535}), {nil: undefined})
  )
  .map(([first, second, port]) => {
    const host = `${first}.${second}.test`;
    return port === undefined ? host : `${host}:${port}`;
  });

const apiRoot = fc
  .array(fc.constantFrom('/', 'a', 'b', 'c', '1'), {minLength: 0, maxLength: 12})
  .map((parts) => parts.join(''));

/** Builds a minimal request-origin fixture for base-URL tests. */
const requestOrigin = (host: string, protocol = 'http') => ({protocol, host});

describe('normalizeApiRoot', () => {
  it.each([
    ['/', ''],
    ['', ''],
    ['/api/v3', '/api/v3'],
    ['api/v3', '/api/v3'],
    ['/api/v3/', '/api/v3'],
    ['//api//v3//', '/api/v3'],
    ['  /x  ', '/x']
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeApiRoot(input)).toBe(expected);
  });
});

describe('buildUrl', () => {
  it.each([
    ['http://localhost:3300', '/repos/acme/demo', 'http://localhost:3300/repos/acme/demo'],
    ['http://localhost:3300/', 'repos/acme/demo', 'http://localhost:3300/repos/acme/demo'],
    ['http://localhost:3300/api/v3/', '/repos/acme/demo', 'http://localhost:3300/api/v3/repos/acme/demo']
  ])('joins %p and %p', (base, path, expected) => {
    expect(buildUrl(base, path)).toBe(expected);
  });
});

describe('buildBaseUrls', () => {
  it.each([
    ['/', '127.0.0.1:54321', 'http://127.0.0.1:54321', 'http://127.0.0.1:54321'],
    ['/api/v3', '127.0.0.1:54321', 'http://127.0.0.1:54321/api/v3', 'http://127.0.0.1:54321'],
    ['/api/v3', '[::1]:3300', 'http://[::1]:3300/api/v3', 'http://[::1]:3300'],
    ['/', 'Example.COM', 'http://example.com', 'http://example.com'],
    ['/', 'localhost', 'http://localhost', 'http://localhost']
  ])('derives bases for apiRoot %p and host %p', (root, host, apiBaseUrl, webBaseUrl) => {
    expect(buildBaseUrls(requestOrigin(host), root)).toEqual({
      apiBaseUrl,
      webBaseUrl
    });
  });

  it('uses the fallback origin when the request host is missing', () => {
    expect(buildBaseUrls(requestOrigin('  '), '/api/v3', 'https://fallback.example.test/root')).toEqual({
      apiBaseUrl: 'https://fallback.example.test/api/v3',
      webBaseUrl: 'https://fallback.example.test'
    });
  });

  it('uses the fallback origin when the request host is malformed', () => {
    expect(buildBaseUrls(requestOrigin('not a host'), '/', 'https://fallback.example.test/root')).toEqual({
      apiBaseUrl: 'https://fallback.example.test',
      webBaseUrl: 'https://fallback.example.test'
    });
  });

  it('uses the fallback origin when raw request origin fields are not strings', () => {
    expect(
      buildBaseUrls(
        {protocol: 1, host: 'example.test'} as unknown as Parameters<typeof buildBaseUrls>[0],
        '/',
        'https://fallback.example.test/root'
      )
    ).toEqual({
      apiBaseUrl: 'https://fallback.example.test',
      webBaseUrl: 'https://fallback.example.test'
    });
  });

  it.each([
    ['http://', 'http://example.test'],
    ['https://', 'https://example.test']
  ])('normalizes request protocol delimiter %p', (protocol, webBaseUrl) => {
    expect(buildBaseUrls(requestOrigin('example.test', protocol), '/api/v3')).toEqual({
      apiBaseUrl: `${webBaseUrl}/api/v3`,
      webBaseUrl
    });
  });
});

describe('buildBaseUrls validation', () => {
  it('throws a greppable error when no host can be determined', () => {
    expect(() => buildBaseUrls(requestOrigin(''), '/')).toThrow('SIMULACAT: cannot derive base URL');
  });

  it('throws the greppable error when fallback URL is malformed', () => {
    expect(() => buildBaseUrls(requestOrigin(''), '/', 'not a url')).toThrow('SIMULACAT: cannot derive base URL');
  });

  it('throws the greppable error when request protocol is unsupported', () => {
    expect(() => buildBaseUrls(requestOrigin('example.test', 'ftp'), '/')).toThrow('SIMULACAT: cannot derive base URL');
  });

  it.each([
    [{protocol: 'http', host: 1}],
    [null]
  ])('throws the greppable error when raw request origin %p is invalid', (origin) => {
    expect(() => buildBaseUrls(origin as unknown as Parameters<typeof buildBaseUrls>[0], '/')).toThrow(
      'SIMULACAT: cannot derive base URL'
    );
  });

  it.each([
    'ftp://example.test/root',
    'mailto:octo@example.test',
    'file:///tmp/root'
  ])('throws the greppable error when fallback URL %p has no HTTP origin', (fallbackBaseUrl) => {
    expect(() => buildBaseUrls(requestOrigin(''), '/', fallbackBaseUrl)).toThrow('SIMULACAT: cannot derive base URL');
  });

  it('creates parseable API URLs without duplicate path separators for generated hosts and roots', () => {
    fc.assert(
      fc.property(safeHost, apiRoot, (host, root) => {
        const {apiBaseUrl} = buildBaseUrls(requestOrigin(host, 'https'), root);
        const parsed = new URL(apiBaseUrl);
        const canonicalHost = new URL(`https://${host}`).host;

        expect(parsed.host).toBe(canonicalHost);
        expect(parsed.pathname).not.toContain('//');
      }),
      {seed: 1_414_001}
    );
  });
});
