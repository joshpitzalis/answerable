import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { useActor } from "@xstate/react";

import { TableComponent } from "#/components/Table.tsx";

import { FailedChannelsBanner } from "./FailedChannelsBanner";
import type { createQuestionsMachine } from "./questionsMachine";
import { columns } from "./TableColumn";

const fieldDefs = [
  { key: "name", type: "string", label: "Name" },
  { key: "comments", type: "number", label: "Comment" },
  { key: "question", type: "string", label: "questionuestion" },
] as const;

export const QuestionsView = ({
  machine,
}: {
  machine: ReturnType<typeof createQuestionsMachine>;
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
        <TableComponent
          title="Effect Questions"
          data={snapshot.context.questions}
          columns={columns}
          fieldDefs={fieldDefs}
          idKey="id"
          searchPlaceholder="Search questions..."
        />
      </>
    );
  }

  return <Text type="body">Loading…</Text>;
};
