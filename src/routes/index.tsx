import { createFileRoute, redirect } from "@tanstack/react-router";

import { PROJECTS } from "#/features/question-finder/lib/projects.utils.ts";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({
      params: { project: PROJECTS[0].slug },
      replace: true,
      to: "/$project",
    });
  },
});
