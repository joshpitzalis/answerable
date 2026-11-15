import type { Project } from "../domain";

export const EFFECT_PROJECT: Project = {
  slug: "effect",
  label: "Effect",
  serverId: "795981131316985866",
  // Channel ids, not names: the id is what the Discord API takes.
  channels: [{ id: "1125094089281511474", name: "effect-help" }],
  ownerName: "josh",
};

/**
 * The server and `general` are real. The second Channel and the owner name are
 * still PLACEHOLDERS until the owner supplies them; with a token bound, the
 * placeholder Channel is reported as failed. The stub-mode fixture
 * (`services/_fixtures/messages.json`, `ANSWERED_THREADS`) keys off the same
 * ids and is only read with no Discord token bound.
 */
export const XSTATE_PROJECT: Project = {
  slug: "xstate",
  label: "XState",
  serverId: "795785288994652170",
  channels: [
    { id: "795785288994652174", name: "general" },
    { id: "xstate-placeholder-channel-guards", name: "xstate-guards" },
  ],
  ownerName: "xstate-placeholder-owner",
};

/** In display order: the first is where the root URL lands. */
export const PROJECTS: readonly [Project, ...Project[]] = [
  EFFECT_PROJECT,
  XSTATE_PROJECT,
];

// Plain value, not Option: the routes import this and no Effect code runs in the browser.
export const findProject = (slug: string): Project | undefined =>
  PROJECTS.find((project) => project.slug === slug);
