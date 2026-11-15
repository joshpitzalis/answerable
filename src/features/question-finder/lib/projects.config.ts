import type { Project } from "../domain";

export const EFFECT_PROJECT: Project = {
  slug: "effect",
  label: "Effect",
  serverId: "795981131316985866",
  // Channel ids, not names: the id is what the Discord API takes.
  channels: [{ id: "1125094089281511474", name: "effect-help" }],
  ownerName: "joshpitzalis",
};

export const XSTATE_PROJECT: Project = {
  slug: "xstate",
  label: "XState",
  serverId: "795785288994652170",
  channels: [
    { id: "795785288994652174", name: "general" },
    { id: "1021738689434501181", name: "help" },
  ],
  ownerName: "joshpitzalis",
};

/** In display order: the first is where the root URL lands. */
export const PROJECTS: readonly [Project, ...Project[]] = [
  EFFECT_PROJECT,
  XSTATE_PROJECT,
];

// Plain value, not Option: the routes import this and no Effect code runs in the browser.
export const findProject = (slug: string): Project | undefined =>
  PROJECTS.find((project) => project.slug === slug);
