import { Effect, Schema } from "effect";

import { DiscordFailed } from "../lib/errors";
import { discordGet } from "./discordGet";

const Bits = Schema.String.check(Schema.isPattern(/^[0-9]+$/u));

const Application = Schema.Struct({
  bot: Schema.Struct({ id: Schema.String }),
  flags: Schema.Number,
});

const Guild = Schema.Struct({
  owner_id: Schema.String,
  roles: Schema.Array(Schema.Struct({ id: Schema.String, permissions: Bits })),
});

const Member = Schema.Struct({ roles: Schema.Array(Schema.String) });

const ChannelAccess = Schema.Struct({
  id: Schema.String,
  guild_id: Schema.String,
  type: Schema.Number,
  permission_overwrites: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      type: Schema.Number,
      allow: Bits,
      deny: Bits,
    })
  ),
});

const HISTORY_AND_VIEW = 65_536n | 1024n;
const ADMINISTRATOR = 8n;
const MESSAGE_CONTENT_FLAGS = 262_144 | 524_288;

/** Four sequential metadata reads establish that a subsequent empty page is meaningful. */
export const requireMessageAccess = Effect.fn("Discord.requireMessageAccess")(
  function* (
    channelId: string,
    serverId: string,
    token: string,
    fetch: typeof globalThis.fetch
  ) {
    const application = yield* discordGet(
      "/applications/@me",
      token,
      fetch
    ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Application)));

    if ((application.flags & MESSAGE_CONTENT_FLAGS) === 0) {
      return yield* Effect.fail(
        new DiscordFailed({ reason: "Discord message content is unavailable" })
      );
    }

    const channel = yield* discordGet(
      `/channels/${channelId}`,
      token,
      fetch
    ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ChannelAccess)));

    if (
      channel.guild_id !== serverId ||
      channel.id !== channelId ||
      (channel.type !== 0 && channel.type !== 15 && channel.type !== 16)
    ) {
      return yield* Effect.fail(
        new DiscordFailed({
          reason: "Discord source is not a configured text or forum Channel",
        })
      );
    }

    const guild = yield* discordGet(`/guilds/${serverId}`, token, fetch).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Guild))
    );

    const member = yield* discordGet(
      `/guilds/${serverId}/members/${application.bot.id}`,
      token,
      fetch
    ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Member)));

    if (guild.owner_id === application.bot.id) {
      return channel.type;
    }

    let permissions = guild.roles
      .filter((role) => role.id === serverId || member.roles.includes(role.id))
      .reduce((bits, role) => bits | BigInt(role.permissions), 0n);

    if ((permissions & ADMINISTRATOR) !== 0n) {
      return channel.type;
    }

    const everyone = channel.permission_overwrites.find(
      (overwrite) => overwrite.type === 0 && overwrite.id === serverId
    );

    if (everyone !== undefined) {
      permissions =
        (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
    }

    const roles = channel.permission_overwrites.filter(
      (overwrite) => overwrite.type === 0 && member.roles.includes(overwrite.id)
    );

    const denied = roles.reduce((bits, role) => bits | BigInt(role.deny), 0n);
    const allowed = roles.reduce((bits, role) => bits | BigInt(role.allow), 0n);
    permissions = (permissions & ~denied) | allowed;

    const individual = channel.permission_overwrites.find(
      (overwrite) => overwrite.type === 1 && overwrite.id === application.bot.id
    );

    if (individual !== undefined) {
      permissions =
        (permissions & ~BigInt(individual.deny)) | BigInt(individual.allow);
    }

    if ((permissions & HISTORY_AND_VIEW) !== HISTORY_AND_VIEW) {
      return yield* Effect.fail(
        new DiscordFailed({ reason: "Discord message history is unavailable" })
      );
    }

    return channel.type;
  },
  Effect.catchTag("SchemaError", () =>
    Effect.fail(
      new DiscordFailed({ reason: "Discord access could not be established" })
    )
  )
);
