import { Clock, Effect } from "effect";

import type { Project } from "../domain";
import { compareSnowflakes } from "../domain/harvest.values";
import { advanceMessagePage } from "../domain/pagination.rules";
import { Discord, DiscordFailed } from "../services/discord";
import { ProjectStorage } from "../services/projectStorage";

// A verified message page is four access reads and one page read; one per batch stays within five requests.
export const acquireStoredPage = (project: Project, policyRevision: string) =>
  Effect.gen(function* () {
    const store = yield* ProjectStorage;
    const turn = yield* store.claimAcquisition(project);

    if (turn === null) {
      return;
    }

    const forum = yield* store.forumRequest(turn.channelId, turn.generation);

    const workId =
      forum !== undefined && "thread" in forum
        ? forum.thread.id
        : turn.channelId;

    const acquire = Effect.gen(function* () {
      const progress = yield* store.progress(turn.channelId);
      const at = yield* Clock.currentTimeMillis;

      const page = yield* Discord.use((discord) =>
        discord.sourcePage({
          channelId: turn.channelId,
          parentChannelId: turn.channelId,
          serverId: project.serverId,
          before: progress.before,
          limit: 50,
          forum,
        })
      );

      if ("messages" in page) {
        const advanced = yield* store.saveThreadMessages(
          page.thread,
          turn.generation,
          page.messages,
          policyRevision,
          at
        );

        if (!advanced) {
          return yield* Effect.fail(
            new DiscordFailed({
              reason: "Discord thread pagination did not advance",
            })
          );
        }

        return;
      }

      if ("threads" in page) {
        const advanced = yield* store.saveThreadPage(
          turn.channelId,
          turn.generation,
          page,
          at
        );

        if (!advanced) {
          return yield* Effect.fail(
            new DiscordFailed({
              reason: "Discord archive pagination did not advance",
            })
          );
        }

        return;
      }

      if ("starter" in page) {
        yield* store.saveForumStarter(
          turn.channelId,
          turn.generation,
          page.starter,
          policyRevision,
          at
        );

        return;
      }

      const messages = page;

      const selected =
        progress.upperBoundary === null
          ? messages
          : messages.filter(
              (message) =>
                compareSnowflakes(
                  message.id,
                  progress.upperBoundary ?? message.id
                ) <= 0
            );

      const next = advanceMessagePage(
        progress,
        messages,
        at,
        turn.generation,
        50
      );

      if (next === null) {
        yield* store.retry({
          kind: "acquisition",
          workId,
          channelId: turn.channelId,
          generation: turn.generation,
          reason: "Discord pagination did not advance",
        });

        return;
      }

      const counts = yield* store.ingestPage({
        expectedGeneration: turn.generation,
        messages: selected,
        progress: next,
        observedAt: at,
        policyRevision,
      });

      yield* Effect.logInfo(
        `harvest ingestion inserted=${counts.inserted} updated=${counts.updated} unchanged=${counts.unchanged}`
      );
    });

    yield* acquire.pipe(
      Effect.catchTag("DiscordFailed", () =>
        store.retry({
          kind: "acquisition",
          workId,
          channelId: turn.channelId,
          generation: turn.generation,
          reason: "Discord could not be read",
        })
      ),
      Effect.catchTag("DiscordRateLimited", (failure) =>
        store.retry({
          kind: "acquisition",
          workId,
          channelId: turn.channelId,
          generation: turn.generation,
          reason: "Discord is rate-limited",
          retryAfterMs: failure.retryAfterMs,
          global: failure.global,
        })
      )
    );
  });
