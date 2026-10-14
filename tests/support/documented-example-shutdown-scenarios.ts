/** @file Generates bounded process schedules and signal outcomes for shutdown properties. */
import fc from 'fast-check';
import type {ShutdownLimits, SignalAttempt} from './documented-example-shutdown.ts';

interface ScenarioSettings {
  limits: ShutdownLimits;
  readonly signalResult: Extract<SignalAttempt, 'sent' | 'group-missing'>;
}

interface GracefulCloseScenario extends ScenarioSettings {
  kind: 'graceful-close';
  closeOffset: number;
}

interface ForcedCloseScenario extends ScenarioSettings {
  kind: 'forced-close';
}

interface ExitBeforeDeadlineScenario extends ScenarioSettings {
  kind: 'exit-before-deadline';
  exitOffset: number;
}

interface ForcedTimeoutScenario extends ScenarioSettings {
  kind: 'forced-timeout';
}

/** One bounded lifecycle schedule with a generated, supported signal result. */
export type ShutdownScenario =
  | GracefulCloseScenario
  | ForcedCloseScenario
  | ExitBeforeDeadlineScenario
  | ForcedTimeoutScenario;

const limitsArbitrary: fc.Arbitrary<ShutdownLimits> = fc.record({
  gracefulMs: fc.integer({min: 1, max: 20}),
  forcedMs: fc.integer({min: 1, max: 20}),
  postExitMs: fc.integer({min: 1, max: 20})
});

const signalResultArbitrary = fc.constantFrom<ScenarioSettings['signalResult']>('sent', 'group-missing');

/** Builds shared limits and generated signal-result data. */
const scenarioSettingsArbitrary = (generatedLimits: fc.Arbitrary<ShutdownLimits>): fc.Arbitrary<ScenarioSettings> => {
  return fc.record({limits: generatedLimits, signalResult: signalResultArbitrary});
};

const gracefulCloseScenarioArbitrary: fc.Arbitrary<GracefulCloseScenario> = fc
  .integer({min: 2, max: 20})
  .chain((postExitMs) => {
    const generatedLimits = fc.record({
      gracefulMs: fc.integer({min: 1, max: 20}),
      forcedMs: fc.integer({min: 1, max: 20}),
      postExitMs: fc.constant(postExitMs)
    });

    return scenarioSettingsArbitrary(generatedLimits).chain((settings) => {
      return fc.integer({min: 1, max: postExitMs - 1}).map(
        (closeOffset): GracefulCloseScenario => ({
          kind: 'graceful-close',
          ...settings,
          closeOffset
        })
      );
    });
  });

const forcedCloseScenarioArbitrary: fc.Arbitrary<ForcedCloseScenario> = scenarioSettingsArbitrary(limitsArbitrary).map(
  (settings): ForcedCloseScenario => ({kind: 'forced-close', ...settings})
);

const exitBeforeDeadlineScenarioArbitrary: fc.Arbitrary<ExitBeforeDeadlineScenario> = fc
  .integer({min: 2, max: 20})
  .chain((forcedMs) => {
    const generatedLimits = fc.record({
      gracefulMs: fc.integer({min: 1, max: 20}),
      forcedMs: fc.constant(forcedMs),
      postExitMs: fc.integer({min: 1, max: 20})
    });

    return scenarioSettingsArbitrary(generatedLimits).chain((settings) => {
      return fc.integer({min: 1, max: forcedMs - 1}).map(
        (exitOffset): ExitBeforeDeadlineScenario => ({
          kind: 'exit-before-deadline',
          ...settings,
          exitOffset
        })
      );
    });
  });

const forcedTimeoutScenarioArbitrary: fc.Arbitrary<ForcedTimeoutScenario> = scenarioSettingsArbitrary(
  limitsArbitrary
).map((settings): ForcedTimeoutScenario => ({kind: 'forced-timeout', ...settings}));

/** Samples all four bounded cases with generated signal outcomes and constructive offsets.
 *
 * @returns An arbitrary that never samples tied or out-of-budget offsets.
 */
export const shutdownScenarioArbitrary: fc.Arbitrary<ShutdownScenario> = fc.oneof(
  gracefulCloseScenarioArbitrary,
  forcedCloseScenarioArbitrary,
  exitBeforeDeadlineScenarioArbitrary,
  forcedTimeoutScenarioArbitrary
);
