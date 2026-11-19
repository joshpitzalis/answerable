import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { createFileRoute, notFound } from "@tanstack/react-router";

import {
  activateHarvest,
  listQuestions,
  refreshHarvest,
} from "#/features/question-finder/index.ts";
import {
  findProject,
  PROJECTS,
} from "#/features/question-finder/lib/projects.utils.ts";
import { ProjectQuestions } from "#/features/question-finder/ui/ProjectQuestions.tsx";
import { ProjectTabs } from "#/features/question-finder/ui/ProjectTabs.tsx";

const load = (slug: string) => listQuestions({ data: slug });
const activate = (slug: string) => activateHarvest({ data: slug });
const refresh = (slug: string) => refreshHarvest({ data: slug });

const ProjectPage = () => {
  const { project } = Route.useRouteContext();

  return (
    <VStack gap={4}>
      <ProjectTabs projects={PROJECTS} currentSlug={project.slug} />
      <ProjectQuestions
        key={project.slug}
        project={project}
        load={load}
        activate={activate}
        refresh={refresh}
      />
    </VStack>
  );
};

export const Route = createFileRoute("/$project")({
  beforeLoad: ({ params }) => {
    const project = findProject(params.project);

    if (project === undefined) {
      throw notFound();
    }

    return { project };
  },
  component: ProjectPage,
  notFoundComponent: () => (
    <EmptyState
      title="Project not found"
      description="There is no Project at this address. Pick one from the Home page."
    />
  ),
});
