import { Option } from "effect";

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
 * PLACEHOLDER ids: invented until the owner supplies the real XState server,
 * Channels and display name. Replacing them is an edit to this entry alone; the
 * stub-mode fixture (`services/_fixtures/messages.json`, `ANSWERED_THREADS`)
 * keys off the same placeholders and is only read with no Discord token bound.
 */
export const XSTATE_PROJECT: Project = {
  slug: "xstate",
  label: "XState",
  serverId: "xstate-placeholder-server",
  channels: [
    { id: "xstate-placeholder-channel-help", name: "xstate-help" },
    { id: "xstate-placeholder-channel-guards", name: "xstate-guards" },
  ],
  ownerName: "xstate-placeholder-owner",
};

/** In tab order: the first is where the root URL lands. */
export const PROJECTS: readonly [Project, ...Project[]] = [
  EFFECT_PROJECT,
  XSTATE_PROJECT,
];

export const findProject = (slug: string): Option.Option<Project> =>
  Option.fromNullishOr(PROJECTS.find((project) => project.slug === slug));
