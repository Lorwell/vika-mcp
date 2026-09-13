---
name: vika-fusion-mcp
description: Use when an agent needs to work with Vika through the configured vika-fusion-mcp MCP server. The MCP tool names mirror the official Vika API reference page slugs in snake_case. Prefer these tools over direct HTTP when the server is available.
---

# Vika MCP

Use this skill to operate Vika through the `vika-fusion-mcp` MCP tools instead of composing raw HTTP requests.

## Hard Rules

- Prefer `vika-fusion-mcp` tools over direct API calls whenever the MCP server is available.
- Keep tool selection aligned with the public Vika API reference.
- Resolve targets with `get_spaces`, `search_nodes`, and `get_node_details` before mutating records when the user provides names instead of IDs.
- Read `get_fields` before record writes unless the user already supplied verified field names and values.
- Use `get_records` with `recordIds` for narrow reads instead of inventing an extra single-record flow.
- `get_records` uses Fusion v3 by default. Set `apiVersion: "v1"` explicitly only when the caller chooses the v1 contract; the server never silently falls back.
- Treat `403` from node, member, or folder reads as a resource-level permission issue, not as proof the whole endpoint family is unavailable.
- Require clear user intent before using any tool that needs `confirm_destructive: true`.

## Default Workflow

1. Confirm the `vika-fusion-mcp` MCP server is configured and reachable.
2. If `spaceId` is unknown, call `get_spaces`.
3. If `nodeId` or `datasheetId` is unknown, call `search_nodes` and, when needed, `get_node_details`.
4. Before record mutations, call `get_fields`.
5. For reads, use `get_records`.
6. For writes, use `create_records` or `update_records`.
7. For attachments, upload first with `upload_attachments`, then patch the record with the returned attachment payload.
8. For org operations or delete operations, read [references/workflows.md](references/workflows.md) before acting.

## Tool Surface

- Records:
  - `get_records`
  - `create_records`
  - `update_records`
  - `delete_records`
- Fields:
  - `get_fields`
  - `delete_fields`
  - Text and identifiers: `create_single_text_field`, `create_text_field`, `create_url_field`, `create_phone_field`, `create_email_field`, `create_work_doc_field`
  - Numbers and choices: `create_number_field`, `create_currency_field`, `create_percent_field`, `create_single_select_field`, `create_multi_select_field`, `create_checkbox_field`, `create_rating_field`
  - Dates and people: `create_date_time_field`, `create_member_field`, `create_created_time_field`, `create_last_modified_time_field`, `create_created_by_field`, `create_last_modified_by_field`
  - Links and calculations: `create_one_way_link_field`, `create_two_way_link_field`, `create_magic_lookup_field`, `create_formula_field`, `create_auto_number_field`, `create_button_field`, `create_attachment_field`
- Views:
  - `get_views`
- Datasheets and attachments:
  - `upload_attachments`
  - `create_datasheets`
- Space and nodes:
  - `get_spaces`
  - `get_nodes`
  - `search_nodes`
  - `get_node_details`
  - `create_embedlinks`
  - `get_embedlinks`
  - `delete_embedlinks`
- Org:
  - `get_a_member`
  - `update_a_member`
  - `delete_a_member`
  - `list_the_team_members`
  - `list_teams`
  - `create_a_team`
  - `update_a_team`
  - `delete_a_team`
  - `list_units_under_the_role`
  - `list_roles`
  - `create_a_role`
  - `update_a_role`
  - `delete_a_role`

The public AI chat-completions operation is intentionally outside this MCP server's supported scope.

## Response Pattern

- Return the concrete IDs you discover, especially `spaceId`, `nodeId`, `datasheetId`, and organization `unitId` values.
- When a tool fails, surface the structured error category and request only the next missing input.
- If a delete operation is requested, restate what will be removed before calling the tool.

## References

- For common task sequences and payload tips, read [references/workflows.md](references/workflows.md).
