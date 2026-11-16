export const acquisitionWork = (
  sql: SqlStorage,
  channelIds: readonly string[],
  generation: number
) =>
  sql
    .exec<{ work_id: string; channel_id: string }>(
      `SELECT p.stream_id AS work_id,p.parent_channel_id AS channel_id FROM fetch_progress p
    LEFT JOIN forum_scans s ON s.channel_id=p.stream_id
    WHERE p.stream_id IN (${channelIds.map(() => "?").join(",")})
      AND (s.generation IS NULL OR s.generation!=? OR s.archive_done=0)
    UNION ALL SELECT t.id AS work_id,t.parent_channel_id AS channel_id FROM discord_threads t
    JOIN forum_scans s ON s.channel_id=t.parent_channel_id
    WHERE t.parent_channel_id IN (${channelIds.map(() => "?").join(",")}) AND s.generation=? AND s.archive_done=1
      AND (t.starter_pending=1 OR t.collect_pending=1 OR (t.archived=0 AND t.collected_generation<?))`,
      ...channelIds,
      generation,
      ...channelIds,
      generation,
      generation
    )
    .toArray();
