import { Clock, Effect } from "effect";

import type { Project } from "../domain";
import { compareSnowflakes } from "../domain/harvest.values";
import { advanceMessagePage } from "../domain/pagination.rules";
import { Discord } from "../services/discord";
import { ProjectStorage } from "../services/projectStorage";

// A verified message page is four access reads and one page read; one per batch stays within five requests.
export const acquireStoredPage = (project: Project, policyRevision: string) =>
  Effect.gen(function* () {
    const store = yield* ProjectStorage;
    const turn = yield* store.claimAcquisition(project);

    if (turn === null) {
      return;
    }

    const acquire = Effect.gen(function* () {
      const progress = yield* store.progress(turn.channelId);
      const at = yield* Clock.currentTimeMillis;

      const messages = yield* Discord.use((discord) =>
        discord.messagePage({
          channelId: turn.channelId,
          parentChannelId: turn.channelId,
          serverId: project.serverId,
          before: progress.before,
          limit: 50,
        })
      );

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
        yield* store.fail(turn.channelId, "Discord pagination did not advance");

        return;
      }

      const counts = yield* store.ingestPage({
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
        store.fail(turn.channelId, "Discord could not be read")
      ),
      Effect.catchTag("DiscordRateLimited", () =>
        store.fail(turn.channelId, "Discord is rate-limited")
      )
    );
  });
