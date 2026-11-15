import type { Effect, ManagedRuntime } from "effect";
import { createAsyncLogic } from "xstate";

/**
 * The one way a machine runs an Effect (ADR 0001). The actor's abort signal goes
 * to the runtime, so leaving a state or stopping the actor interrupts the Effect.
 * A failure rejects with the Effect's own error value.
 */
export const fromEffect = <Output, Input, Services>(
  runtime: ManagedRuntime.ManagedRuntime<Services, never>,
  step: (input: Input) => Effect.Effect<Output, unknown, Services>
) =>
  createAsyncLogic<Output, Input>({
    run: ({ input, signal }) => runtime.runPromise(step(input), { signal }),
  });
