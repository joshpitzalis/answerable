import { useMemo } from "react";

import type { Project } from "../domain";
import type { StoredQuestionsReply } from "../domain/harvest.values";
import { createQuestionsMachine } from "./questionsMachine";
import { QuestionsView } from "./QuestionsView";

/** `load` is the server call, passed in because `ui/` never imports `index.ts`. */
export const ProjectQuestions = ({
  project,
  load,
  activate,
  refresh,
}: {
  project: Project;
  load: (slug: string) => Promise<StoredQuestionsReply>;
  activate: (slug: string) => Promise<StoredQuestionsReply>;
  refresh: (slug: string) => Promise<StoredQuestionsReply>;
}) => {
  // The machine is a definition; the caller keys this component by slug, so each
  // visit to a Project mounts its own actor and loads again.
  const machine = useMemo(
    () =>
      createQuestionsMachine({
        load: () => load(project.slug),
        activate: () => activate(project.slug),
        refresh: () => refresh(project.slug),
      }),
    [project.slug, load, activate, refresh]
  );

  return (
    <QuestionsView machine={machine} title={`${project.label} Questions`} />
  );
};
