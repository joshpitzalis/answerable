/**
 * A fake Discord wire for `Discord.layer(token, fetch)`: the real client runs, only
 * the network is faked. Messages are written oldest first; the wire answers
 * newest first, as Discord does.
 */

export interface WireMessage {
  readonly threadId?: string;
  readonly id: string;
  readonly content: string;
  /** Display name of the author; "ada" when left out. */
  readonly author?: string;
  /** The author's user id; `user-{author}` when left out. */
  readonly authorId?: string;
  /** The author's avatar hash; `null` is the wire's "no custom avatar", left out sends no field. */
  readonly avatar?: string | null;
  /** The author is a bot or webhook: the wire sends `author.bot: true`. */
  readonly bot?: boolean;
}

/** A forum post as the wire serves it: a thread plus its first message. */
export interface WirePost {
  /** The post's id; it is also the id of its thread and of its first message. */
  readonly id: string;
  readonly title: string;
  readonly content: string;
  /** Display name of the first message's author; "ada" when left out. */
  readonly author?: string;
  /** The first message author's user id; `user-{author}` when left out. */
  readonly authorId?: string;
  /** The first message author's avatar hash, as on `WireMessage`. */
  readonly avatar?: string | null;
  /** The first message's author is a bot or webhook. */
  readonly bot?: boolean;
  /** The thread's `message_count`. */
  readonly replyCount?: number;
  /** The wire lists the post but returns no first message for it. */
  readonly withoutFirstMessage?: boolean;
}

interface WireConfig {
  /** Text channel id to the messages in it, oldest first. */
  readonly channels: Readonly<Record<string, readonly WireMessage[]>>;
  /** Forum channel id to its active posts, oldest first. */
  readonly forums?: Readonly<Record<string, readonly WirePost[]>>;
  /** Thread id to the display names of those who replied in it. */
  readonly replies?: Readonly<Record<string, readonly string[]>>;
  /**
   * Channel ids and thread ids the wire answers with a 500. `kind:<id>` breaks
   * the lookup of a channel's kind instead.
   */
  readonly broken?: readonly string[];
  /**
   * Channel ids and thread ids the wire answers with a 429 for their first
   * `times` requests, asking for `retryAfterSeconds` as Discord's body does.
   * `kind:<id>` limits the lookup of a channel's kind instead.
   */
  readonly limited?: Readonly<
    Record<
      string,
      { readonly times: number; readonly retryAfterSeconds: number }
    >
  >;
}

/** The guild every forum post claims, so a link can be told from the Project's server id. */
export const WIRE_GUILD = "wire-guild";

const TEXT_CHANNEL = 0;
const FORUM_CHANNEL = 15;

/** The most posts Discord serves per `threads/search` page. */
const MAX_POST_PAGE = 25;
const DEFAULT_PAGE = 25;

const raw = (
  channelId: string,
  id: string,
  content: string,
  who: Pick<WireMessage, "author" | "authorId" | "avatar" | "bot" | "threadId">
) => {
  const username = who.author ?? "ada";

  return {
    thread: who.threadId === undefined ? undefined : { id: who.threadId },
    author: {
      avatar: who.avatar,
      bot: who.bot === true ? true : undefined,
      id: who.authorId ?? `user-${username}`,
      username,
    },
    channel_id: channelId,
    content,
    id,
    timestamp: "2026-08-01T00:00:00.000+00:00",
  };
};

const rawPost = (forumId: string, post: WirePost) => ({
  guild_id: WIRE_GUILD,
  id: post.id,
  last_message_id: post.id,
  message_count: post.replyCount ?? 0,
  name: post.title,
  parent_id: forumId,
  thread_metadata: { archived: false },
  type: 11,
});

export const fakeDiscord = ({
  channels,
  forums = {},
  replies = {},
  broken = [],
  limited = {},
}: WireConfig) => {
  /** Channel ids whose messages were listed, in request order. */
  const channelsRead: string[] = [];
  /** Every message or post listing seen, by channel or thread id. */
  const requestsTo: Record<string, number> = {};
  /** Every request seen, as path and query, in order. */
  const requestLog: string[] = [];

  const fetch: typeof globalThis.fetch = (input) => {
    const url = new URL(String(input));
    // `/api/v9/channels/{id}[/messages | /threads/search]`
    const [, id = "", ...rest] = url.pathname.split("/").slice(3);
    const isKindLookup = rest.length === 0;
    const key = isKindLookup ? `kind:${id}` : id;
    const after = url.searchParams.get("after");

    requestLog.push(`${url.pathname}${url.search}`);
    requestsTo[key] = (requestsTo[key] ?? 0) + 1;

    const limit = limited[key];

    if (limit !== undefined && (requestsTo[key] ?? 0) <= limit.times) {
      return Promise.resolve(
        Response.json(
          {
            global: false,
            message: "rate limited",
            retry_after: limit.retryAfterSeconds,
          },
          { status: 429 }
        )
      );
    }

    if (broken.includes(key)) {
      return Promise.resolve(new Response("down", { status: 500 }));
    }

    if (isKindLookup) {
      return Promise.resolve(
        Response.json({
          id,
          type: forums[id] === undefined ? TEXT_CHANNEL : FORUM_CHANNEL,
        })
      );
    }

    const posts = forums[id];

    if (posts !== undefined) {
      channelsRead.push(id);

      const pageSize = Number(url.searchParams.get("limit") ?? DEFAULT_PAGE);
      const offset = Number(url.searchParams.get("offset") ?? 0);

      // Discord's own refusal of a page larger than it serves.
      if (pageSize > MAX_POST_PAGE) {
        return Promise.resolve(
          Response.json(
            {
              errors: {
                limit: {
                  _errors: [
                    {
                      code: "NUMBER_TYPE_MAX",
                      message: `int value should be less than or equal to ${MAX_POST_PAGE}.`,
                    },
                  ],
                },
              },
              message: "Invalid Form Body",
            },
            { status: 400 }
          )
        );
      }

      // Newest first, and no more than the page asked for.
      const newestFirst = posts.toReversed();
      const newest = newestFirst.slice(offset, offset + pageSize);

      return Promise.resolve(
        Response.json({
          first_messages: newest
            .filter((post) => post.withoutFirstMessage !== true)
            .map((post) => raw(post.id, post.id, post.content, post)),
          has_more: offset + pageSize < newestFirst.length,
          members: [],
          threads: newest.map((post) => rawPost(id, post)),
          total_results: posts.length,
        })
      );
    }

    const inChannel = channels[id];

    if (inChannel === undefined) {
      return Promise.resolve(
        Response.json(
          (replies[id] ?? []).map((author, index) =>
            raw(id, `${id}-reply-${index}`, "Covered in a post.", { author })
          )
        )
      );
    }

    channelsRead.push(id);

    const messageLimit = Number(url.searchParams.get("limit") ?? 50);

    // Discord returns the page of messages right after the cursor, or the
    // newest page when there is none; the page comes back newest first.
    const wanted = inChannel.filter(
      (message) => after === null || message.id > after
    );

    const page =
      after === null
        ? wanted.slice(-messageLimit)
        : wanted.slice(0, messageLimit);

    return Promise.resolve(
      Response.json(
        page
          .map((message) => raw(id, message.id, message.content, message))
          .toReversed()
      )
    );
  };

  return { channelsRead, fetch, requestLog, requestsTo };
};
