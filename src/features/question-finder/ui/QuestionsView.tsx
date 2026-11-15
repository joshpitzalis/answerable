import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { useActor } from "@xstate/react";
import { useMemo } from "react";

import { TableComponent } from "#/components/Table.tsx";
import type { QuestionsRow } from "#/features/question-finder/domain";

import { FailedChannelsBanner } from "./FailedChannelsBanner";
import type { createQuestionsMachine } from "./questionsMachine";
import type { QuestionsTableRow } from "./TableColumn";
import { columns } from "./TableColumn";

const toTableRows = (questions: QuestionsRow[]): QuestionsTableRow[] =>
  questions.map((question) => ({
    ...question,
    channel: question.channel.name,
  }));

const toFieldDefs = (rows: QuestionsTableRow[]) =>
  [
    { key: "name", type: "string", label: "Name" },
    { key: "comments", type: "number", label: "Comment" },
    { key: "question", type: "string", label: "Question" },
    {
      key: "channel",
      type: "enum",
      label: "Channel",
      enumValues: [...new Set(rows.map((row) => row.channel))].map(
        (channel) => ({ value: channel, label: channel })
      ),
    },
  ] as const;

const QuestionsTable = ({
  questions,
  title,
}: {
  questions: QuestionsRow[];
  title: string;
}) => {
  const rows = useMemo(() => toTableRows(questions), [questions]);
  const fieldDefs = useMemo(() => toFieldDefs(rows), [rows]);

  return (
    <TableComponent
      title={title}
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
        <QuestionsTable questions={snapshot.context.questions} title={title} />
      </>
    );
  }

  return <Text type="body">Loading…</Text>;
};
