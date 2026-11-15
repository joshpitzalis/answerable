import { Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { EFFECT_PROJECT, XSTATE_PROJECT } from "../lib/projects.config.example";
import { Contributions } from "../services/contributions";
import { Corpus } from "../services/corpus";
import { Cursors } from "../services/cursors";
import { Discord } from "../services/discord";
import { Judge } from "../services/judge";
import { QuestionStore } from "../services/question-store";
import { listQuestions } from "../workflows/listQuestions";

// The no-token app: every stub, the real Discord client over the fixture wire.
const stubRuntime = () =>
  ManagedRuntime.make(
    Layer.mergeAll(
      Discord.stub,
      Cursors.stub,
      Contributions.stub,
      Corpus.stub,
      Judge.stub,
      QuestionStore.stub
    )
  );

describe("listQuestions in stub mode", () => {
  it("lists XState questions from more than one Channel, judged against XState Posts only", async () => {
    const reply = await listQuestions(stubRuntime(), XSTATE_PROJECT);

    expect(reply.failedChannels).toStrictEqual([]);
    // The thread about delayed transitions is answerable too, but its owner replied.
    expect(
      reply.questions.map((row) => [row.channel.name, row.id]).toSorted()
    ).toStrictEqual([
      ["xstate-guards", "1540000000000000004"],
      ["xstate-help", "1540000000000000001"],
    ]);
  });

  it("counts the fixture's messages per Project: ten Effect authors once each, four XState authors", async () => {
    const effect = await listQuestions(stubRuntime(), EFFECT_PROJECT);
    const xstate = await listQuestions(stubRuntime(), XSTATE_PROJECT);

    // Ten authors with one message: median 1; mean 1, SD 0, so 1. Ties by name, so the first five.
    expect(effect.contributorStats).toStrictEqual({
      medianResponses: 1,
      plusOneSd: 1,
      topContributors: [
        { avatarUrl: null, name: "Fish Fan 01", responses: 1 },
        { avatarUrl: null, name: "Fish Fan 02", responses: 1 },
        { avatarUrl: null, name: "Fish Fan 03", responses: 1 },
        { avatarUrl: null, name: "Fish Fan 04", responses: 1 },
        { avatarUrl: null, name: "Fish Fan 05", responses: 1 },
      ],
    });
    // Otter Fan 02 wrote two of five messages, the other three one each: counts 2, 1, 1, 1.
    // Median (1 + 1) / 2 = 1; mean 1.25, SD 0.433, so 2.
    expect(xstate.contributorStats).toStrictEqual({
      medianResponses: 1,
      plusOneSd: 2,
      topContributors: [
        { avatarUrl: null, name: "Otter Fan 02", responses: 2 },
        { avatarUrl: null, name: "Otter Fan 01", responses: 1 },
        { avatarUrl: null, name: "Otter Fan 03", responses: 1 },
        { avatarUrl: null, name: "Otter Fan 04", responses: 1 },
      ],
    });
  });

  it("lists Effect questions without any XState question", async () => {
    const reply = await listQuestions(stubRuntime(), EFFECT_PROJECT);

    expect(reply.questions.length).toBeGreaterThan(0);
    expect(
      reply.questions.map((row) => row.channel.name).toSorted()
    ).toStrictEqual(reply.questions.map(() => "effect-help"));
  });

  it("does not list the Effect owner's answered thread, nor the XState owner's", async () => {
    const effect = await listQuestions(stubRuntime(), EFFECT_PROJECT);
    const xstate = await listQuestions(stubRuntime(), XSTATE_PROJECT);

    expect(effect.questions.map((row) => row.id)).not.toContain(
      "1525693287409913856"
    );
    expect(xstate.questions.map((row) => row.id)).not.toContain(
      "1540000000000000002"
    );
  });
});
