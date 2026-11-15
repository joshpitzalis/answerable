import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createActor, setup } from "xstate";

import { fromEffect } from "../fromEffect";

describe(fromEffect, () => {
  it("interrupts the running Effect when the actor is stopped", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    let started = false;
    let interrupted = false;

    const runForever = () =>
      Effect.sync(() => {
        started = true;
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          })
        )
      );

    const actor = createActor(
      setup({
        actors: { runForever: fromEffect(runtime, runForever) },
      }).createMachine({
        initial: "running",
        states: { running: { invoke: { src: "runForever" } } },
      })
    ).start();

    await vi.waitFor(() => expect(started).toBeTruthy());
    actor.stop();

    await vi.waitFor(() => expect(interrupted).toBeTruthy());
    await runtime.dispose();
  });
});
