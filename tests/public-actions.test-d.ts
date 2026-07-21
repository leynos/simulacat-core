/** @file Compile-time assertions for the public shared repository action surface. */
import {
  REPOSITORY_WRITABLE_FIELDS,
  type BuildUpdateRepositoryCommandInput,
  type DomainActionArgs,
  type RepositoryWritableField,
  type UpdateRepositoryCommand
} from '../src/index.ts';

type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type WritableFieldContract = Expect<Equal<RepositoryWritableField, 'description' | 'homepage'>>;
type WritableFieldTupleParity = Expect<Equal<(typeof REPOSITORY_WRITABLE_FIELDS)[number], RepositoryWritableField>>;
type CommandChangesContract = Expect<
  Equal<UpdateRepositoryCommand['changes'], Partial<Record<RepositoryWritableField, string | undefined>>>
>;

declare const input: BuildUpdateRepositoryCommandInput;
declare const args: DomainActionArgs;

const fields = REPOSITORY_WRITABLE_FIELDS satisfies readonly RepositoryWritableField[];
const owner = input.owner satisfies string;
const body = input.body satisfies unknown;
const addRepository = args.schema.repositories.add;

// @ts-expect-error Repository write commands cannot update unsupported fields.
const invalidCommand: UpdateRepositoryCommand = {owner: 'acme', name: 'repo', changes: {private: 'true'}};

void fields;
void owner;
void body;
void addRepository;
void invalidCommand;
void (null as unknown as WritableFieldContract);
void (null as unknown as WritableFieldTupleParity);
void (null as unknown as CommandChangesContract);
