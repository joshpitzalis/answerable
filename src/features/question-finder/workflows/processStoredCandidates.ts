import { Effect } from "effect";

import type { Project } from "../domain";
import { looksLikeAQuestion, toRow } from "../domain";
import type { ProcessingCandidate } from "../domain/harvest.values";
import { Corpus } from "../services/corpus";
import { Judge } from "../services/judge";
import { ProjectStorage } from "../services/projectStorage";

export const processCandidate = (
  project: Project,
  candidate: ProcessingCandidate
) =>
  Effect.gen(function* () {
    const store = yield* ProjectStorage;

    const channel = project.channels.find(
      (item) => item.id === candidate.message.parentChannelId
    );

    if (channel === undefined) {
      return;
    }

    const message = {
      ...candidate.message,
      createdAt: new Date(candidate.message.createdAt),
    };

    if (!looksLikeAQuestion(message)) {
      yield* store.complete(candidate, null);

      return;
    }

    const posts = yield* Corpus.use((corpus) => corpus.all(project.id));

    const verdict = yield* Judge.use((judge) =>
      judge.answerable(message.content, posts)
    );

    yield* store.complete(
      candidate,
      verdict.answerable ? toRow(message, project, channel) : null
    );
  }).pipe(
    Effect.catchTag("JudgeFailed", () =>
      ProjectStorage.use((store) =>
        store.fail(
          candidate.message.parentChannelId,
          "Saved messages could not be judged"
        )
      )
    )
  );
