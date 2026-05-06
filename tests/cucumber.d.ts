type StepDefinition<State> = (state: State, args: string[], data?: unknown) => State | Promise<State>;
type HookDefinition<State> = (state: State) => State | Promise<State>;
type StepRegistrar<State> = (pattern: string | RegExp, fn: StepDefinition<State>) => void;
type HookRegistrar<State> = (fn: HookDefinition<State>) => void;

export function loadFeatures(pattern: string, cwd?: string): Promise<void>;
export function bunTestCucumber(options: {stepDefinitionsPattern: string}): unknown;
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
