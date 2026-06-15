/**
 * @file Express middleware for attaching request-scoped actor context.
 *
 * The middleware keeps HTTP header parsing at the adapter boundary and exposes
 * the same actor context to built-in handlers and caller-provided routes.
 */
import type {RequestHandler} from 'express';
import {buildActorContext, observeParsedRequestActor} from '../store/actors.ts';

/**
 * Builds middleware that attaches `req.simulacatActor` once per request.
 *
 * The returned Express `RequestHandler` mutates `request.simulacatActor` with
 * the context from `buildActorContext`, records one REST parse observation via
 * `observeParsedRequestActor`, and then calls `next()`.
 *
 * @example
 * ```ts
 * router.use(requestActorMiddleware());
 * ```
 *
 * @returns Express middleware that decorates `request.simulacatActor`,
 * observes the parse result, and calls `next()`.
 */
export const requestActorMiddleware = (): RequestHandler => {
  return (request, _response, next) => {
    const context = buildActorContext({get: (name) => request.get(name)});
    request.simulacatActor = context;
    observeParsedRequestActor('rest', context.parseResult, context.observationContext);
    next();
  };
};
