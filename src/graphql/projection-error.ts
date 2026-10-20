/** @file Pure, bounded error contract for GraphQL entity URL projection. */

/** Entity kinds whose GraphQL URL projection can fail. */
export type ProjectionEntity = 'commit' | 'issue' | 'pull-request' | 'repository';

/** Projection failure carrying an entity kind without fixture identifiers. */
export class GraphqlProjectionError extends TypeError {
  /** Entity kind used by transport diagnostics. */
  readonly entity: ProjectionEntity;

  /** Constructs a projection error without retaining the rejected fixture. */
  constructor(entity: ProjectionEntity) {
    super(
      entity === 'repository'
        ? 'GraphQL repository URL could not be projected'
        : `GraphQL URL could not be projected for ${entity}`
    );
    this.entity = entity;
  }
}
