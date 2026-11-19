import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { useActor } from "@xstate/react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { TableComponent } from "#/components/Table.tsx";
import type {
  ContributorStats,
  QuestionsRow,
} from "#/features/question-finder/domain";

import { contributorStatsLabel } from "../lib/contributorStats.utils";
import { toFieldDefs, toTableRows } from "../lib/questionsTable.utils";
import { FailedChannelsBanner } from "./FailedChannelsBanner";
import { HarvestStatus } from "./HarvestStatus";
import type { createQuestionsMachine } from "./questionsMachine";
import { columns } from "./TableColumn";
import { TopContributors } from "./TopContributors";

const QuestionsTable = ({
  questions,
  title,
  stats,
  status,
}: {
  questions: QuestionsRow[];
  title: string;
  stats: ContributorStats | null;
  status: ReactNode;
}) => {
  const rows = useMemo(() => toTableRows(questions), [questions]);
  const fieldDefs = useMemo(() => toFieldDefs(rows), [rows]);

  return (
    <TableComponent
      title={title}
      subtitle={contributorStatsLabel(stats) ?? undefined}
      summary={
        <>
          {status}
          {stats === null ? null : (
            <TopContributors contributors={stats.topContributors} />
          )}
        </>
      }
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

  const { harvest, reason } = snapshot.context;
  const busy = !(snapshot.matches("loaded") || snapshot.matches("failed"));

  return (
    <>
      {snapshot.matches("failed") ? (
        <Banner
          status="error"
          title={
            harvest === null
              ? "Questions could not be loaded"
              : "Collection status could not be updated"
          }
          description={reason}
          endContent={
            <Button label="Retry" onClick={() => send({ type: "retry" })} />
          }
        />
      ) : null}
      {harvest === null && !snapshot.matches("failed") ? (
        <Text type="body">Loading saved questions…</Text>
      ) : null}
      {harvest === null ? null : (
        <>
          <FailedChannelsBanner
            failedChannels={snapshot.context.failedChannels}
          />
          <QuestionsTable
            questions={snapshot.context.questions}
            title={title}
            stats={snapshot.context.contributorStats}
            status={
              <HarvestStatus
                harvest={harvest}
                busy={busy}
                unavailable={reason !== null}
                refresh={() => send({ type: "refresh" })}
              />
            }
          />
        </>
      )}
    </>
  );
};
