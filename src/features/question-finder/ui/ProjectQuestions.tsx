import { useMemo } from "react";

import type { Project, QuestionsReply } from "../domain";
import { createQuestionsMachine } from "./questionsMachine";
import { QuestionsView } from "./QuestionsView";

/** `load` is the server call, passed in because `ui/` never imports `index.ts`. */
export const ProjectQuestions = ({
  project,
  load,
}: {
  project: Project;
  load: (slug: string) => Promise<QuestionsReply>;
}) => {
  // The machine is a definition; the caller keys this component by slug, so each
  // visit to a Project mounts its own actor and loads again.
  const machine = useMemo(
    () => createQuestionsMachine(() => load(project.slug)),
    [project.slug, load]
  );

  return (
    <QuestionsView machine={machine} title={`${project.label} Questions`} />
  );
};
