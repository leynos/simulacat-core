/**
 * @file Compile-time assertions for the exported surface the documentation gate covers.
 *
 * The gate is satisfied by comments, so nothing in it would notice if the
 * type-level change that made those comments possible drifted. Converting the
 * `GitHub*` output aliases from `type … = z.infer<…>` to
 * `interface … extends z.infer<…> {}` is asserted here to be type-preserving,
 * and the builders' newly explicit return annotations are asserted to be those
 * same interfaces rather than a structurally expanded copy.
 */
import type {
  buildBranchFixture,
  buildCommitFixture,
  buildIssueFixture,
  buildPullRequestFixture,
  buildRefFixture,
  buildRepositoryFixture,
  BranchFixtureInput,
  CommitFixtureInput,
  githubBranchSchema,
  githubCommitSchema,
  githubIssueSchema,
  githubPullRequestSchema,
  githubRefSchema,
  githubRepositorySchema,
  GitHubCommit,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRef,
  GitHubSimulatorArgs,
  IssueFixtureInput,
  PullRequestFixtureInput,
  RefFixtureInput,
  RepositoryFixtureInput
} from '../src/index.ts';
// `GitHubBranch` and `GitHubRepository` are not re-exported from the package
// entry point, but `buildBranchFixture` and `buildRepositoryFixture` are, so
// their return types are part of the public surface and are asserted here.
import type {GitHubBranch} from '../src/store/entities/branch.ts';
import type {GitHubRepository} from '../src/store/entities/repository.ts';
import type {z} from 'zod';

type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

// The interface conversion must not change the type. `Equal` is nominal enough
// to catch a widened or narrowed member, which mutual assignability would not.
type BranchAliasParity = Expect<Equal<GitHubBranch, z.infer<typeof githubBranchSchema>>>;
type CommitAliasParity = Expect<Equal<GitHubCommit, z.infer<typeof githubCommitSchema>>>;
type IssueAliasParity = Expect<Equal<GitHubIssue, z.infer<typeof githubIssueSchema>>>;
type PullRequestAliasParity = Expect<Equal<GitHubPullRequest, z.infer<typeof githubPullRequestSchema>>>;
type RefAliasParity = Expect<Equal<GitHubRef, z.infer<typeof githubRefSchema>>>;
type RepositoryAliasParity = Expect<Equal<GitHubRepository, z.infer<typeof githubRepositorySchema>>>;

// The explicit return annotations must be the named interfaces themselves.
type BranchBuilderReturn = Expect<Equal<ReturnType<typeof buildBranchFixture>, GitHubBranch>>;
type CommitBuilderReturn = Expect<Equal<ReturnType<typeof buildCommitFixture>, GitHubCommit>>;
type IssueBuilderReturn = Expect<Equal<ReturnType<typeof buildIssueFixture>, GitHubIssue>>;
type PullRequestBuilderReturn = Expect<Equal<ReturnType<typeof buildPullRequestFixture>, GitHubPullRequest>>;
type RefBuilderReturn = Expect<Equal<ReturnType<typeof buildRefFixture>, GitHubRef>>;
type RepositoryBuilderReturn = Expect<Equal<ReturnType<typeof buildRepositoryFixture>, GitHubRepository>>;

// The builders still accept the schema input types, not the output types.
type BranchBuilderInput = Expect<Equal<Parameters<typeof buildBranchFixture>[0], BranchFixtureInput>>;
type CommitBuilderInput = Expect<Equal<Parameters<typeof buildCommitFixture>[0], CommitFixtureInput>>;
type IssueBuilderInput = Expect<Equal<Parameters<typeof buildIssueFixture>[0], IssueFixtureInput>>;
type PullRequestBuilderInput = Expect<Equal<Parameters<typeof buildPullRequestFixture>[0], PullRequestFixtureInput>>;
type RefBuilderInput = Expect<Equal<Parameters<typeof buildRefFixture>[0], RefFixtureInput>>;
type RepositoryBuilderInput = Expect<Equal<Parameters<typeof buildRepositoryFixture>[0], RepositoryFixtureInput>>;

declare const args: GitHubSimulatorArgs;

// The documented extension hooks must remain callable from the public type.
const extendRouter = args.extend?.extendRouter;
const openapiHandlers = args.extend?.openapiHandlers;
const extendStore = args.extend?.extendStore;

/** Asserts the router hook rejects a call missing the simulation store argument. */
// @ts-expect-error The router hook takes a router and the simulation store, not one argument.
const arityGuard = (): void => extendRouter?.({} as never);

void extendRouter;
void openapiHandlers;
void extendStore;
void arityGuard;
void (null as unknown as BranchAliasParity);
void (null as unknown as CommitAliasParity);
void (null as unknown as IssueAliasParity);
void (null as unknown as PullRequestAliasParity);
void (null as unknown as RefAliasParity);
void (null as unknown as RepositoryAliasParity);
void (null as unknown as BranchBuilderReturn);
void (null as unknown as CommitBuilderReturn);
void (null as unknown as IssueBuilderReturn);
void (null as unknown as PullRequestBuilderReturn);
void (null as unknown as RefBuilderReturn);
void (null as unknown as RepositoryBuilderReturn);
void (null as unknown as BranchBuilderInput);
void (null as unknown as CommitBuilderInput);
void (null as unknown as IssueBuilderInput);
void (null as unknown as PullRequestBuilderInput);
void (null as unknown as RefBuilderInput);
void (null as unknown as RepositoryBuilderInput);
