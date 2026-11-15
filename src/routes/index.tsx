import { createFileRoute } from "@tanstack/react-router";

import { listQuestions } from "#/features/question-finder/index.ts";
import { EFFECT_PROJECT } from "#/features/question-finder/lib/projects.config.ts";
import { createQuestionsMachine } from "#/features/question-finder/ui/questionsMachine.ts";
import { QuestionsView } from "#/features/question-finder/ui/QuestionsView.tsx";

// The machine is a definition; each mount of QuestionsView creates its own actor.
const questionsMachine = createQuestionsMachine(() =>
  listQuestions({ data: EFFECT_PROJECT.slug })
);

export const Route = createFileRoute("/")({
  component: () => <QuestionsView machine={questionsMachine} />,
});
