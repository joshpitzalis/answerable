import { Effect, Schema } from "effect";

import type { DiscordThread } from "../../../domain/values/thread.values";
import { DiscordFailed } from "../lib/errors";
import { discordGet } from "./discordGet";
import { RawContent, toSourceMessage } from "./messagePage";
import type { MessagePageRequest } from "./messagePage";

export const readStarter = Effect.fn("Discord.readStarter")(function* (
  request: MessagePageRequest,
  thread: DiscordThread,
  token: string,
  fetch: typeof globalThis.fetch
) {
  const channelId =
    thread.isPost === false ? thread.parentChannelId : thread.id;

  const body = yield* discordGet(
    `/channels/${channelId}/messages/${thread.starterId}`,
    token,
    fetch
  );

  const raw = yield* Schema.decodeUnknownEffect(RawContent)(body).pipe(
    Effect.mapError(
      () => new DiscordFailed({ reason: "Malformed Discord forum starter" })
    )
  );

  if (
    raw.id !== thread.starterId ||
    raw.channel_id !== channelId ||
    thread.parentChannelId !== request.parentChannelId
  ) {
    return yield* Effect.fail(
      new DiscordFailed({ reason: "Discord returned another thread's starter" })
    );
  }

  return {
    starter: {
      ...toSourceMessage(raw, { ...request, channelId }),
      threadId: thread.id,
      isPost: thread.isPost !== false,
    },
  };
});
