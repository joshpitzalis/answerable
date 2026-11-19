import { Effect, Option, Schema } from "effect";

import {
  DiscordFailed,
  DiscordRateLimited,
} from "#/features/question-finder/services/discord/lib/errors";

import { API } from "../lib/constants";

const RATE_LIMITED = 429;

const RateLimitBody = Schema.Struct({
  retry_after: Schema.Number,
  global: Schema.optional(Schema.Boolean),
});

/**
 * Discord's delay on a 429, in milliseconds: the JSON body's `retry_after`
 * (seconds, fractional), else the `Retry-After` header (seconds).
 */
const retryAfterMs = (response: Response) =>
  Effect.tryPromise(() => response.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(RateLimitBody)),
    Effect.orElseSucceed(() => ({
      retry_after: Number(response.headers.get("Retry-After")),
      global: false,
    })),
    Effect.map((body) =>
      Number.isFinite(body.retry_after) && body.retry_after > 0
        ? Option.some({
            retryAfterMs: body.retry_after * 1000,
            global:
              body.global === true ||
              response.headers.get("X-RateLimit-Global") === "true" ||
              response.headers.get("X-RateLimit-Scope") === "global",
          })
        : Option.none()
    )
  );

/**
 * One authorised GET against the Discord API, returning the JSON body undecoded.
 * Every request shares this failure and rate-limit handling.
 */
export const discordGet = Effect.fn("Discord.get")(function* (
  path: string,
  token: string,
  fetch: typeof globalThis.fetch
) {
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(`${API}${path}`, {
              signal: controller.signal,
              headers: { Authorization: token },
            }),
          catch: (error) => new DiscordFailed({ reason: String(error) }),
        });

        if (!response.ok) {
          const errorBody =
            response.status === 404
              ? yield* Effect.tryPromise(() => response.json()).pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      Schema.Struct({ code: Schema.Number })
                    )
                  ),
                  Effect.option
                )
              : Option.none();

          const delay =
            response.status === RATE_LIMITED
              ? yield* retryAfterMs(response)
              : Option.none();

          return yield* Option.match(delay, {
            onNone: () =>
              Effect.fail(
                new DiscordFailed({
                  reason: `GET ${path} returned ${response.status}`,
                  status: response.status,
                  ...Option.getOrUndefined(errorBody),
                })
              ),
            onSome: (limit) => Effect.fail(new DiscordRateLimited(limit)),
          });
        }

        return yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (error) => new DiscordFailed({ reason: String(error) }),
        });
      }),
    (controller) => Effect.sync(() => controller.abort())
  );
});
