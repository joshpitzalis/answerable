import { Text } from "@astryxdesign/core/Text";
import { useAtomSuspense } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { TableComponent } from "#/components/Table.tsx";
import { questionsAtom } from "#/features/question-finder/atom.ts";
import { columns } from "#/features/question-finder/components/TableColumn.tsx";

export const Route = createFileRoute("/")({
	component: QuestionPage,
	// useAtomSuspense throws Cause.squash(...) on failure; the router's own
	// CatchBoundary is the error boundary, so no hand-written class component.
	errorComponent: ({ error }) => <Text type="body">{error.message}</Text>,
});

const fieldDefs = [
	{ key: "name", type: "string", label: "Name" },
	{ key: "comments", type: "number", label: "Comment" },
	{ key: "question", type: "string", label: "questionuestion" },
] as const;

function QuestionPage() {
	return (
		<Suspense fallback={<Text type="body">Loading…</Text>}>
			<QuestionTable />
		</Suspense>
	);
}

// Separate component on purpose: the hook that suspends must sit *below* the
// boundary. Calling it in QuestionPage suspends QuestionPage itself, so its own
// fallback never renders and the router's boundary takes over instead.
function QuestionTable() {
	return (
		<TableComponent
			title="Effect Questions"
			data={useAtomSuspense(questionsAtom).value}
			columns={columns}
			fieldDefs={fieldDefs}
			idKey="id"
			searchPlaceholder="Search questions..."
		/>
	);
}
