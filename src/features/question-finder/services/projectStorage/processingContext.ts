export const invalidateProcessingContext = (
  sql: SqlStorage,
  messageId: string,
  revision: string
): boolean =>
  sql
    .exec(
      `UPDATE processing SET context_revision=?, completed=0, failure=NULL
    WHERE message_id=? AND context_revision != ? RETURNING message_id`,
      revision,
      messageId,
      revision
    )
    .toArray().length > 0;
