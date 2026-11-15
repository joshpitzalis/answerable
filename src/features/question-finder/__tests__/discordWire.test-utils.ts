/**
 * A fake Discord wire for `Discord.layer(token, fetch)`: the real client runs, only
 * the network is faked. Messages are written oldest first; the wire answers
 * newest first, as Discord does.
 */

export interface WireMessage {
  readonly id: string;
  readonly content: string;
}

interface WireConfig {
  /** Channel id to the messages in it, oldest first. */
  readonly channels: Readonly<Record<string, readonly WireMessage[]>>;
  /** Thread id to the display names of those who replied in it. */
  readonly replies?: Readonly<Record<string, readonly string[]>>;
  /** Channel ids and thread ids the wire answers with a 500. */
  readonly broken?: readonly string[];
}

const raw = (
  channelId: string,
  id: string,
  content: string,
  author: string
) => ({
  author: { username: author },
  channel_id: channelId,
  content,
  id,
  timestamp: "2026-08-01T00:00:00.000+00:00",
});

export const fakeDiscord = ({
  channels,
  replies = {},
  broken = [],
}: WireConfig) => {
  /** Channel ids whose messages were listed, in request order. */
  const channelsRead: string[] = [];

  const fetch: typeof globalThis.fetch = (input) => {
    const url = new URL(String(input));
    const id = url.pathname.split("/").at(-2) ?? "";
    const after = url.searchParams.get("after");

    if (broken.includes(id)) {
      return Promise.resolve(new Response("down", { status: 500 }));
    }

    const inChannel = channels[id];

    if (inChannel === undefined) {
      return Promise.resolve(
        Response.json(
          (replies[id] ?? []).map((author, index) =>
            raw(id, `${id}-reply-${index}`, "Covered in a post.", author)
          )
        )
      );
    }

    channelsRead.push(id);

    return Promise.resolve(
      Response.json(
        inChannel
          .filter((message) => after === null || message.id > after)
          .map((message) => raw(id, message.id, message.content, "ada"))
          .toReversed()
      )
    );
  };

  return { channelsRead, fetch };
};
