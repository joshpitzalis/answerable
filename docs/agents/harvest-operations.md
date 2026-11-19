# Harvest configuration and rollback

`ProjectHarvest` and the Alchemy `PROJECT_HARVEST` binding keep their identities across releases. Alchemy stages have separate resources; object names additionally separate `fixture:<Project ID>` from `live:<Project ID>`. Do not rename the class, binding, stack or stage to roll out a code change.

Keep each Project ID permanently attached to its original Discord server. Label, slug and Channel display-name changes reuse saved rows. Moving to a different server requires a new Project ID or a separately reviewed migration. Never copy private configuration into this document or fixtures.

Activation, saved reads and alarms use current trusted configuration. Removing a Channel hides its questions and contribution counts and fences pending work; its messages and pagination cursors remain. Re-adding it resumes those cursors. Removing a Project or changing runtime mode suspends its next alarm without collecting. A never-activated Project does not collect merely because its configuration exists.

## Quiesce before rollback

Use this release's `HARVEST_ENABLED` deployment binding before rolling back to code that cannot manage Harvest alarms. The default is `true`; exactly `false` disables collection. This is deployment configuration, not a browser-supplied setting. Deployment still needs the owner's approval.

1. Keep the current stack, stage, mode/token and complete activated Project registry available. If a Project was removed, temporarily restore its trusted definition with the original ID/server for this operation. Do this separately for any stage and mode that has ever collected data.
2. Set `HARVEST_ENABLED=false` in that stage's deployment configuration and deploy this alarm-capable release. Do not change the Discord token or namespace identity during quiescence.
3. Open each activated Project's existing page. Its saved read applies suspension, invalidates old work and awaits native `deleteAlarm()` before returning the paused status. Activation and refresh apply the same suspension and cannot start collection. Confirm every Project reports `suspended` with `nextEligibleAt: null`; merely setting the binding does not prove every object has been visited.
4. Wait for invocations from the previous deployment to drain, then confirm paused reads again. The bounded batch deadline is twenty seconds. A later alarm resolves disabled configuration and clears its alarm again. Storage generation and claim checks prevent an already-running batch from publishing or rearming after suspension.
5. Only after all affected Projects confirm suspension, roll back the application. Retain the namespace, native class export and SQLite data. Do not destroy resources, delete tables or revert the SQL schema version. The rollback target must retain a compatible class/migration reader; otherwise roll back the UI while retaining this release's storage/alarm implementation.

Do not rely on waiting fifteen minutes: a source rate-limit deadline may be farther away. Visiting every activated Project makes quiescence observable without a new administration endpoint. [Cloudflare documents at-least-once alarm delivery and that deleting an alarm does not guarantee cancellation of a running retry](https://developers.cloudflare.com/durable-objects/api/alarms/).

## Re-enable

Deploy the compatible Harvest implementation with the same namespace/class/stage and original Project IDs, set `HARVEST_ENABLED=true`, then open each Project to resume. Previously activated Projects queue retained progress, respecting a persisted global rate-limit pause. Never-activated Projects still require ordinary first activation. Removed Channels stay hidden until re-added. No reset or invented migration from the former in-memory Maps is required.

SQL migrations append to `projectMigrations` and run transactionally. A future schema version is refused rather than reset. Operational confirmation is per Project and per stage; a local fixture test does not prove production quiescence.
