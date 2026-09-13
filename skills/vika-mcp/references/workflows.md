# Vika MCP Workflows

## Resolve a datasheet from names

Use this sequence when the user gives names instead of IDs:

1. Call `get_spaces` if `spaceId` is unknown.
2. Call `search_nodes` with `spaceId`, `type: "Datasheet"`, and the target name in `query`.
3. If the user gave a folder first, call `get_node_details` on that folder and match the child node there.
4. Reuse the returned `nodeId` as the `datasheetId` for record, field, and view reads.

## Inspect schema before record writes

Use this sequence before `create_records` or `update_records`:

1. Call `get_fields`.
2. Record the field names and types you actually need.
3. Build write payloads that match the current datasheet schema.

## Read records safely

Pick the narrowest read shape that fits:

- Use `get_records` with `recordIds` when the user already knows the target record IDs.
- Use `get_records` with `viewId`, `filterByFormula`, `maxRecords`, or `sort` when the user needs filtered or paginated reads.
- Let `get_records` use Fusion v3 by default. If v3 is unavailable, report the failure; retry with `apiVersion: "v1"` only when the caller explicitly chooses v1.
- If the user refers to fields by name, call `get_fields` first.

## Update records safely

Use this sequence for updates:

1. Call `get_fields`.
2. Build the update payload with the current field names and values.
3. Call `update_records`.
4. Echo back the record IDs and the fields you changed.

## Create a datasheet

Use this sequence when the user wants a new table:

1. Confirm the target `spaceId` (call `get_spaces` if unknown).
2. Optionally call `get_node_details` on a folder to position the new datasheet.
3. Call `create_datasheets` with `name` and optional `folderId` or `preNodeId`.
4. Add columns one at a time with the appropriate type-specific field tool.
5. Return the new `datasheetId` and created `fieldId` values from the responses.

## Create a field

Use this sequence when the user wants to add a column:

1. Confirm the target `spaceId` and `datasheetId`.
2. Call `get_fields` to inspect existing schema and avoid name collisions.
3. Choose the matching type-specific tool, such as `create_single_text_field`, `create_number_field`, `create_single_select_field`, or `create_formula_field`.
4. Pass its expanded typed parameters; the tool fixes the official field `type` and assembles `property`.

## Attachment flow

Use this sequence for file attachments:

1. Call `upload_attachments` with exactly one source: local `filePath` or public HTTP(S) `url`. For URLs, set `maxBytes` and `downloadTimeoutMs` when the defaults are not appropriate.
2. Take the returned attachment object or list item exactly as returned.
3. Call `update_records` and assign that attachment payload to the attachment field.

## Delete operations

These tools require `confirm_destructive: true`:

- `delete_records`
- `delete_fields`
- `delete_embedlinks`
- `delete_a_member`
- `delete_a_team`
- `delete_a_role`

Before calling one of them:

1. Confirm the target object and scope.
2. Restate what will be removed.
3. Only then send `confirm_destructive: true`.

## Organization flows

- Use `list_teams` with `unitId: "0"` for top-level teams; omitting `unitId` has the same default.
- Use `list_the_team_members` when the user asks for the members of a known team.
- Use `list_roles` to discover role unit IDs before `list_units_under_the_role`, `update_a_role`, or `delete_a_role`.
- Use `get_a_member` before `update_a_member` when the user only gives a member identifier and wants to inspect the current state first.
- All organization APIs use the official `unitId` parameter. Do not pass the removed `memberId`, `teamId`, or `roleId` aliases.

## View inspection

The public API surface exposed by this server supports view reads only:

1. Confirm the target `datasheetId` (resolve from names if needed).
2. Call `get_views` to list existing views and their IDs.
3. View creation, update, copy, and deletion are not part of this MCP surface.

## AI exclusion

The Vika AI chat-completions operation is intentionally not exposed by this MCP server.
