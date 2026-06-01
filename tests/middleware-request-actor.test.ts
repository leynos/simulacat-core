/** @file Unit tests for request actor middleware decoration. */
import {beforeEach, describe, expect, it} from 'bun:test';
import type {NextFunction, Request, Response} from 'express';
import {requestActorMiddleware} from '../src/middleware/request-actor.ts';
import {
  correlationIdHeader,
  getActorObservabilityCounters,
  legacyGitHubUserHeader,
  legacySimulacatUserHeader,
  requestActorHeader,
  resetActorObservationCounters
} from '../src/store/actors.ts';

/** Builds the small request surface the middleware reads in these tests. */
const requestWithHeaders = (headers: Record<string, string | undefined>): Request => {
  const request = {
    get(name: string) {
      return headers[name];
    }
  };
  return request as unknown as Request;
};

/** Invokes the request actor middleware and asserts it passes control onward. */
const runMiddleware = (request: Request): void => {
  const middleware = requestActorMiddleware();
  let didCallNext = false;
  const next: NextFunction = () => {
    didCallNext = true;
  };
  middleware(request, {} as Response, next);
  expect(didCallNext).toBe(true);
};

describe('requestActorMiddleware', () => {
  beforeEach(() => {
    resetActorObservationCounters();
  });

  it('attaches an anonymous actor when no actor headers are present', () => {
    const request = requestWithHeaders({});

    runMiddleware(request);

    expect(request.simulacatActor?.actor).toEqual({kind: 'anonymous'});
    expect(getActorObservabilityCounters()).toMatchObject({
      'rest-parse.anonymous.default.default': 1
    });
  });

  it('attaches a user actor from the preferred actor header', () => {
    const request = requestWithHeaders({[requestActorHeader]: 'user:dev'});

    runMiddleware(request);

    expect(request.simulacatActor?.actor).toEqual({kind: 'user', login: 'dev'});
    expect(getActorObservabilityCounters()).toMatchObject({
      'rest-parse.user.parsed.preferred': 1
    });
  });

  it('attaches user actors from legacy compatibility headers', () => {
    const simulacatRequest = requestWithHeaders({[legacySimulacatUserHeader]: 'dev'});
    const githubRequest = requestWithHeaders({[legacyGitHubUserHeader]: 'reviewer'});

    runMiddleware(simulacatRequest);
    runMiddleware(githubRequest);

    expect(simulacatRequest.simulacatActor?.actor).toEqual({kind: 'user', login: 'dev'});
    expect(githubRequest.simulacatActor?.actor).toEqual({kind: 'user', login: 'reviewer'});
    expect(getActorObservabilityCounters()).toMatchObject({
      'rest-parse.user.parsed.legacy-simulacat-user': 1,
      'rest-parse.user.parsed.legacy-github-user': 1
    });
  });

  it('falls back to anonymous for malformed preferred actor headers', () => {
    const request = requestWithHeaders({[requestActorHeader]: 'definitely invalid'});

    runMiddleware(request);

    expect(request.simulacatActor).toMatchObject({
      actor: {kind: 'anonymous'},
      parseResult: {
        outcome: 'fallback',
        reason: 'invalid-preferred-header',
        source: 'preferred'
      }
    });
    expect(getActorObservabilityCounters()).toMatchObject({
      'rest-parse.anonymous.fallback.preferred.invalid-preferred-header': 1
    });
  });

  it('does not leak state between sequential requests', () => {
    const first = requestWithHeaders({[requestActorHeader]: 'user:dev'});
    const second = requestWithHeaders({});

    runMiddleware(first);
    runMiddleware(second);

    expect(first.simulacatActor?.actor).toEqual({kind: 'user', login: 'dev'});
    expect(second.simulacatActor?.actor).toEqual({kind: 'anonymous'});
    expect(getActorObservabilityCounters()).toMatchObject({
      'rest-parse.user.parsed.preferred': 1,
      'rest-parse.anonymous.default.default': 1
    });
  });

  it('preserves request id observation context', () => {
    const request = requestWithHeaders({
      [correlationIdHeader]: 'request-123',
      [requestActorHeader]: 'user:dev'
    });

    runMiddleware(request);

    expect(request.simulacatActor?.observationContext).toEqual({requestId: 'request-123'});
  });
});
