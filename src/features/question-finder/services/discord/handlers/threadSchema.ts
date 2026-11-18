import { Schema } from "effect";

export const Thread = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/u)),
  parent_id: Schema.String,
  type: Schema.Number,
  name: Schema.String,
  thread_metadata: Schema.Struct({
    archived: Schema.Boolean,
    archive_timestamp: Schema.String.check(
      Schema.makeFilter((value) => Number.isFinite(Date.parse(value)))
    ),
  }),
});
