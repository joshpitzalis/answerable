import { Effect, Option, Schema } from "effect";

import {
  DiscordFailed,
  DiscordRateLimited,
} from "@/features/question-finder/services/discord/lib/errors";

import { API } from "../lib/constants";
import { decodeMessages } from "../schema";

const RATE_LIMITED = 429;

const RateLimitBody = Schema.Struct({ retry_after: Schema.Number });

/**
 * Discord's delay on a 429, in milliseconds: the JSON body's `retry_after`
 * (seconds, fractional), else the `Retry-After` header (seconds).
 */
const retryAfterMs = (response: Response) =>
  Effect.tryPromise(() => response.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(RateLimitBody)),
    Effect.map((body) => body.retry_after),
    Effect.orElseSucceed(() => Number(response.headers.get("Retry-After"))),
    Effect.map((seconds) =>
      Number.isFinite(seconds) && seconds > 0
        ? Option.some(seconds * 1000)
        : Option.none()
    )
  );

export const listMessages = Effect.fn("Discord.listMessages")(function* (
  path: string,
  token: string,
  fetch: typeof globalThis.fetch
) {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(`${API}${path}`, {
        headers: { Authorization: token },
      }),
    catch: (error) => new DiscordFailed({ reason: String(error) }),
  });

  if (!response.ok) {
    const delay =
      response.status === RATE_LIMITED
        ? yield* retryAfterMs(response)
        : Option.none();

    return yield* Option.match(delay, {
      onNone: () =>
        Effect.fail(
          new DiscordFailed({
            reason: `GET ${path} returned ${response.status}`,
          })
        ),
      onSome: (ms) => Effect.fail(new DiscordRateLimited({ retryAfterMs: ms })),
    });
  }

  const body = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (error) => new DiscordFailed({ reason: String(error) }),
  });

  return yield* decodeMessages(body).pipe(
    Effect.mapError((error) => new DiscordFailed({ reason: error.message }))
  );
});
