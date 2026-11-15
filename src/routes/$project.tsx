import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Option } from "effect";
import { useMemo } from "react";

import type { Project } from "#/features/question-finder/domain.ts";
import { listQuestions } from "#/features/question-finder/index.ts";
import {
  findProject,
  PROJECTS,
} from "#/features/question-finder/lib/projects.config.ts";
import { ProjectTabs } from "#/features/question-finder/ui/ProjectTabs.tsx";
import { createQuestionsMachine } from "#/features/question-finder/ui/questionsMachine.ts";
import { QuestionsView } from "#/features/question-finder/ui/QuestionsView.tsx";

const ProjectQuestions = ({ project }: { project: Project }) => {
  // The machine is a definition; this component is keyed by slug, so each visit
  // to a tab mounts its own actor and loads again.
  const machine = useMemo(
    () => createQuestionsMachine(() => listQuestions({ data: project.slug })),
    [project.slug]
  );

  return (
    <QuestionsView machine={machine} title={`${project.label} Questions`} />
  );
};

const ProjectPage = () => {
  const { project } = Route.useRouteContext();

  return (
    <VStack gap={4}>
      <ProjectTabs projects={PROJECTS} currentSlug={project.slug} />
      <ProjectQuestions key={project.slug} project={project} />
    </VStack>
  );
};

export const Route = createFileRoute("/$project")({
  beforeLoad: ({ params }) => {
    const project = findProject(params.project);

    if (Option.isNone(project)) {
      throw notFound();
    }

    return { project: project.value };
  },
  component: ProjectPage,
  notFoundComponent: () => (
    <EmptyState
      title="Project not found"
      description="There is no Project at this address. Pick one from the Home page."
    />
  ),
});
