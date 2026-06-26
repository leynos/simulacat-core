/** @file Shared store action adapters for domain write behaviour. */
import {select, type AnyState, type Operation, type StoreUpdater, type TableOutput, type createThunks} from 'starfx';
import type {GitHubRepository} from '../entities.ts';
import {repositoryStoreKey} from '../keys.ts';
import {applyRepositoryUpdate, type UpdateRepositoryCommand} from './repository.ts';

type StoreThunks = ReturnType<typeof createThunks>;
type SchemaUpdate<State extends AnyState> = (
  updater: StoreUpdater<State> | StoreUpdater<State>[]
) => Operation<unknown>;

type EntityTable<Entity extends AnyState, State extends AnyState> = Pick<
  TableOutput<Entity, State>,
  'add' | 'selectById'
>;

type EntityUpdateThunkArgs<Command, Entity extends AnyState, State extends AnyState> = {
  name: string;
  thunks: StoreThunks;
  update: SchemaUpdate<State>;
  table: EntityTable<Entity, State>;
  keyOf: (command: Command) => string;
  reduce: (current: Entity, command: Command) => Entity;
};

/** Store action inputs required by the built-in domain action set. */
export type DomainActionArgs<State extends AnyState = AnyState> = {
  thunks: StoreThunks;
  schema: {
    update: SchemaUpdate<State>;
    repositories: EntityTable<GitHubRepository, State>;
  };
};

/**
 * Creates a thunk that reads one entity, applies a pure reducer, and writes it.
 *
 * @example
 * ```ts
 * const updateRepository = createEntityUpdateThunk({
 *   name: 'updateRepository',
 *   thunks,
 *   update: schema.update,
 *   table: schema.repositories,
 *   keyOf: repositoryStoreKey,
 *   reduce: applyRepositoryUpdate
 * });
 * ```
 *
 * @param args Store primitives and pure domain functions.
 * @returns A starfx action creator for entity update commands.
 */
export const createEntityUpdateThunk = <Command, Entity extends AnyState, State extends AnyState>(
  args: EntityUpdateThunkArgs<Command, Entity, State>
) => {
  const {name, thunks, update, table, keyOf, reduce} = args;

  return thunks.create<Command>(name, function* updateEntity(ctx, next) {
    const id = keyOf(ctx.payload);
    const current = yield* select(table.selectById, {id});

    if (current) {
      yield* update(table.add({[id]: reduce(current, ctx.payload)}));
    }

    yield* next();
  });
};

/**
 * Builds the package's built-in shared domain write actions.
 *
 * @example
 * ```ts
 * const actions = buildDomainActions({thunks, schema});
 * actions.updateRepository({owner: 'acme', name: 'widgets', changes: {}});
 * ```
 *
 * @param args Store action construction context.
 * @returns Built-in domain action creators.
 */
export const buildDomainActions = <State extends AnyState>(args: DomainActionArgs<State>) => {
  return {
    updateRepository: createEntityUpdateThunk<UpdateRepositoryCommand, GitHubRepository, State>({
      name: 'updateRepository',
      thunks: args.thunks,
      update: args.schema.update,
      table: args.schema.repositories,
      keyOf: repositoryStoreKey,
      reduce: applyRepositoryUpdate
    })
  };
};
