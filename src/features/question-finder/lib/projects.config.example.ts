import type { Project } from "../domain";

/**
 * The committed template for `projects.config.ts`, which is gitignored and
 * holds the owner's real servers, Channels and display names. Copy this file
 * there and edit it; without a copy, these Projects are used.
 *
 * These are also the Projects served with no Discord token bound: the stub
 * fixture (`services/_fixtures/messages.json`, `ANSWERED_THREADS`) keys off
 * these ids, so the XState ones are invented on purpose.
 */
export const EFFECT_PROJECT: Project = {
  id: "effect",
  slug: "effect",
  label: "Effect",
  serverId: "795981131316985866",
  // Channel ids, not names: the id is what the Discord API takes.
  channels: [{ id: "1125094089281511474", name: "effect-help" }],
  ownerName: "josh",
};

export const XSTATE_PROJECT: Project = {
  id: "xstate",
  slug: "xstate",
  label: "XState",
  serverId: "xstate-placeholder-server",
  channels: [
    { id: "xstate-placeholder-channel-help", name: "xstate-help" },
    { id: "xstate-placeholder-channel-guards", name: "xstate-guards" },
  ],
  ownerName: "xstate-placeholder-owner",
};

/** In display order: the first is where the root URL lands. */
export const PROJECTS: readonly [Project, ...Project[]] = [
  EFFECT_PROJECT,
  XSTATE_PROJECT,
];
