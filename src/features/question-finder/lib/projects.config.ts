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

const PROJECTS: readonly Project[] = [EFFECT_PROJECT];

export const findProject = (slug: string): Option.Option<Project> =>
  Option.fromNullishOr(PROJECTS.find((project) => project.slug === slug));
