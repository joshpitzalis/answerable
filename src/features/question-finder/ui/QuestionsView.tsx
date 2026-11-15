import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { useActor } from "@xstate/react";
import { useMemo } from "react";

import { TableComponent } from "#/components/Table.tsx";
import type {
  ContributorStats,
  QuestionsRow,
} from "#/features/question-finder/domain";

import { contributorStatsLabel } from "../lib/contributorStats.utils";
import { toFieldDefs, toTableRows } from "../lib/questionsTable.utils";
import { FailedChannelsBanner } from "./FailedChannelsBanner";
import type { createQuestionsMachine } from "./questionsMachine";
import { columns } from "./TableColumn";

const QuestionsTable = ({
  questions,
  title,
  stats,
}: {
  questions: QuestionsRow[];
  title: string;
  stats: ContributorStats | null;
}) => {
  const rows = useMemo(() => toTableRows(questions), [questions]);
  const fieldDefs = useMemo(() => toFieldDefs(rows), [rows]);

  return (
    <TableComponent
      title={title}
      subtitle={contributorStatsLabel(stats) ?? undefined}
      data={rows}
      columns={columns}
      fieldDefs={fieldDefs}
      idKey="id"
      searchPlaceholder="Search questions..."
    />
  );
};

export const QuestionsView = ({
  machine,
  title,
}: {
  machine: ReturnType<typeof createQuestionsMachine>;
  title: string;
}) => {
  const [snapshot, send] = useActor(machine);

  if (snapshot.matches("failed")) {
    return (
      <Banner
        status="error"
        title="Questions could not be loaded"
        description={snapshot.context.reason}
        endContent={
          <Button label="Retry" onClick={() => send({ type: "retry" })} />
        }
      />
    );
  }

  if (snapshot.matches("loaded")) {
    return (
      <>
        <FailedChannelsBanner
          failedChannels={snapshot.context.failedChannels}
        />
        <QuestionsTable
          questions={snapshot.context.questions}
          title={title}
          stats={snapshot.context.contributorStats}
        />
      </>
    );
  }

  return <Text type="body">Loading…</Text>;
};
