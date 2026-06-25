/** @file Shared helpers for request-scoped URL projection. */
import type {BaseUrls} from '../http/request-url.ts';
import {buildUrl} from '../http/request-url.ts';

/** Host category for a projected URL field. */
export type UrlHostClass = 'api' | 'web' | 'external';

/** A URL-bearing field and the base class used to derive it. */
export type UrlFieldClassification<Field extends string = string> = {
  field: Field;
  host: UrlHostClass;
};

/** Builder for a derived URL field. */
export type UrlBuilder<Entity extends object, Value> = (entity: Entity, baseUrls: BaseUrls) => Value;

/**
 * Describes a set of fields that share one host class.
 *
 * @param fields Field names in the set.
 * @param host Host class used to derive the field values.
 * @returns Field classification records.
 */
export const classifyUrlFields = <Field extends string>(
  fields: readonly Field[],
  host: UrlHostClass
): UrlFieldClassification<Field>[] => fields.map((field) => ({field, host}));

/**
 * Builds a URL from the request API base.
 *
 * @param baseUrls Request-derived base URLs.
 * @param path URL path or URI-template path.
 * @returns Absolute API URL.
 */
export const apiUrl = (baseUrls: BaseUrls, path: string): string => buildUrl(baseUrls.apiBaseUrl, path);

/**
 * Builds a URL from the request web base.
 *
 * @param baseUrls Request-derived base URLs.
 * @param path URL path or URI-template path.
 * @returns Absolute web URL.
 */
export const webUrl = (baseUrls: BaseUrls, path: string): string => buildUrl(baseUrls.webBaseUrl, path);

/**
 * Applies derived field values without overwriting explicit overrides.
 *
 * @param entity Entity to project.
 * @param baseUrls Request-derived base URLs.
 * @param fields URL fields to project.
 * @param builders Derived value builders for each field.
 * @returns A shallow copy with missing URL fields filled.
 */
export const projectDerivedFields = <Entity extends object, Field extends string, Value>(
  entity: Entity,
  baseUrls: BaseUrls,
  fields: readonly Field[],
  builders: Record<Field, UrlBuilder<Entity, Value>>
): Entity & Partial<Record<Field, Value>> => {
  const projected = {...entity} as Entity & Partial<Record<Field, Value>>;
  const projectedFields: Partial<Record<Field, Value>> = projected;

  for (const field of fields) {
    if (projectedFields[field] === undefined) {
      projectedFields[field] = builders[field](entity, baseUrls);
    }
  }

  return projected;
};
