import { Effect } from "effect";

import type { Project } from "../domain";
import { looksLikeAQuestion, toRow } from "../domain";
import { processingPolicy } from "../domain/harvest.values";
import type { ProcessingCandidate } from "../domain/harvest.values";
import { Corpus } from "../services/corpus";
import type { Post } from "../services/corpus";
import { Judge } from "../services/judge";
import { ProjectStorage } from "../services/projectStorage";

export const prepareProcessing = (project: Project, mode: "live" | "fixture") =>
  Effect.gen(function* () {
    const { posts, revision } = yield* Corpus.snapshot(project.id);
    const policyRevision = processingPolicy(mode, revision, project.ownerName);
    yield* ProjectStorage.use((store) =>
      store.reprocess(
        project.channels.map((channel) => channel.id),
        policyRevision
      )
    );

    return { posts, policyRevision };
  });

export const processCandidate = (
  project: Project,
  candidate: ProcessingCandidate,
  posts: readonly Post[],
  mode: "live" | "fixture"
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
      replyCount: candidate.replyCount ?? candidate.message.replyCount,
      content:
        candidate.threadTitle === null || candidate.threadTitle === undefined
          ? candidate.message.content
          : `${candidate.threadTitle}\n\n${candidate.message.content}`,
      createdAt: new Date(candidate.message.createdAt),
    };

    if (
      !looksLikeAQuestion(message) ||
      (mode === "fixture" &&
        candidate.replyAuthors?.includes(project.ownerName))
    ) {
      yield* store.complete(candidate, null);

      return;
    }

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
        store.retry({
          kind: "processing",
          workId: candidate.message.id,
          channelId: candidate.message.parentChannelId,
          generation: candidate.generation,
          reason: "Saved messages could not be judged",
        })
      )
    )
  );
