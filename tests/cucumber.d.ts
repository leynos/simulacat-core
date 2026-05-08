/**
 * @file Local typed shim for `tests/cucumber.js`.
 *
 * Supplies `loadFeatures`, `bunTestCucumber`, and `withState` declarations for
 * local test use while isolating the suite from third-party Bun/Cucumber
 * package types.
 */
type StepDefinition<State> = (state: State, args: string[], data?: unknown) => State | Promise<State>;
type HookDefinition<State> = (state: State) => State | Promise<State>;
type StepRegistrar<State> = (pattern: string | RegExp, fn: StepDefinition<State>) => void;
type HookRegistrar<State> = (fn: HookDefinition<State>) => void;

/**
 * Loads feature files that match a glob pattern from the optional working
 * directory.
 *
 * @param pattern Glob pattern for feature files to load.
 * @param cwd Optional working directory used to resolve the pattern.
 * @returns A promise that resolves after matching features are loaded.
 */
export function loadFeatures(pattern: string, cwd?: string): Promise<void>;

/**
 * Wires the Bun/Cucumber plugin into the Bun test runner.
 *
 * @param options Plugin options, including `stepDefinitionsPattern` for step
 * definition modules.
 * @returns The plugin registration value returned by the third-party package.
 */
export function bunTestCucumber(options: {stepDefinitionsPattern: string}): unknown;

/**
 * Creates typed hook and step registrar methods for a scenario state shape.
 *
 * @typeParam State Mutable scenario state passed through hooks and steps.
 * @returns Hook registrars (`Before`, `After`, and step-level variants) and
 * step registrars (`Given`, `When`, `Then`) bound to `State`.
 */
export function withState<State>(): {
  Before: HookRegistrar<State>;
  BeforeAll: HookRegistrar<State>;
  BeforeStep: HookRegistrar<State>;
  After: HookRegistrar<State>;
  AfterAll: HookRegistrar<State>;
  AfterStep: HookRegistrar<State>;
  Given: StepRegistrar<State>;
  When: StepRegistrar<State>;
  Then: StepRegistrar<State>;
};
