import { Effect } from "effect";

import { DiscordFailed } from "#/features/question-finder/services/discord/lib/errors";

import { decodeMessages } from "../schema";
import { discordGet } from "./discordGet";

export const listMessages = Effect.fn("Discord.listMessages")(function* (
  path: string,
  token: string,
  fetch: typeof globalThis.fetch
) {
  const body = yield* discordGet(path, token, fetch);

  return yield* decodeMessages(body).pipe(
    Effect.mapError((error) => new DiscordFailed({ reason: error.message }))
  );
});
