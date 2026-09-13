# vika-fusion-mcp

An MCP server and TypeScript library for the public [Vika Fusion API](https://developers.vika.cn/api/introduction/). It exposes 55 tools over `stdio`, including records, 26 type-specific field creators, attachments, nodes, embed links, and organization management.

[简体中文](./README.zh-CN.md)

## Highlights

- Covers the documented non-AI Vika Fusion operations under `/fusion/v1`, `/fusion/v2`, and `/fusion/v3`.
- Uses Fusion v3 for record reads by default, with an explicit v1 option and no silent downgrade.
- Accepts local files or public HTTP(S) URLs for attachment uploads.
- Protects URL downloads with size and time limits, DNS/IP validation, redirect checks, DNS pinning, and HTTPS downgrade blocking.
- Requires `confirm_destructive: true` for all six destructive tool families.
- Ships as both the `vika-fusion-mcp` CLI and a side-effect-free ESM library.
- Includes contract tests plus an opt-in live matrix with at least two real calls for every tool.

## Requirements

- Node.js 22 or newer
- A Vika API token
- A Vika host, normally `https://vika.cn`

## Quick start

Run the published package without installing it globally:

```bash
npx -y vika-fusion-mcp@1.0.0
```

The server uses `stdio`, so it is normally started by an MCP client rather than used interactively.

### MCP client configuration

```json
{
  "mcpServers": {
    "vika": {
      "command": "npx",
      "args": ["-y", "vika-fusion-mcp@1.0.0"],
      "env": {
        "VIKA_HOST": "https://vika.cn",
        "VIKA_TOKEN": "replace-with-your-api-token",
        "VIKA_TIMEOUT_MS": "15000",
        "VIKA_LOG_LEVEL": "info"
      }
    }
  }
}
```

Pinning a version makes MCP startup reproducible. Replace `@1.0.0` with `@latest` if automatic upgrades are preferred.

### Global installation

```bash
npm install --global vika-fusion-mcp@1.0.0
vika-fusion-mcp
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VIKA_HOST` | Yes | — | Vika origin, for example `https://vika.cn` |
| `VIKA_TOKEN` | Yes | — | Vika API token; keep it outside source control |
| `VIKA_TIMEOUT_MS` | No | `15000` | Timeout for Vika API requests |
| `VIKA_PROXY_URL` | No | — | HTTP(S) proxy used for Vika API traffic |
| `VIKA_ALLOW_INSECURE_TLS` | No | `false` | Accept an untrusted TLS certificate; intended only for controlled private deployments |
| `VIKA_LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, or `error` |

Logs are written to stderr so MCP messages on stdout remain valid.

## Use as a TypeScript library

The package root is safe to import: importing it does not start a server. `runStdioServer` starts the standard transport, while `createVikaMcpServer` returns an unconnected `McpServer` for custom transports or embedding.

```ts
import { runStdioServer } from 'vika-fusion-mcp';

await runStdioServer({
  host: 'https://vika.cn',
  token: process.env.VIKA_TOKEN!,
  timeoutMs: 15_000,
  allowInsecureTls: false,
  logLevel: 'info',
});
```

The public library exports are:

- `createVikaMcpServer(config?)`
- `runStdioServer(config?)`
- `loadConfig(env?)`
- `PUBLIC_TOOL_NAMES`
- `AppConfig`

## Tool catalog

The registered tool list is centralized in `PUBLIC_TOOL_NAMES` and contract-tested to contain exactly 55 entries.

| Area | Tools |
| --- | --- |
| Spaces and nodes (4) | `get_spaces`, `get_nodes`, `search_nodes`, `get_node_details` |
| Datasheets, attachments, and embeds (5) | `create_datasheets`, `upload_attachments`, `get_embedlinks`, `create_embedlinks`, `delete_embedlinks` |
| Records (4) | `get_records`, `create_records`, `update_records`, `delete_records` |
| Fields (28) | `get_fields`, the 26 field creators listed below, `delete_fields` |
| Views (1) | `get_views` |
| Organization (13) | `get_a_member`, `update_a_member`, `delete_a_member`, `list_the_team_members`, `list_teams`, `create_a_team`, `update_a_team`, `delete_a_team`, `list_units_under_the_role`, `list_roles`, `create_a_role`, `update_a_role`, `delete_a_role` |

The 26 field creation tools are intentionally type-specific:

- Text and identifiers: `create_single_text_field`, `create_text_field`, `create_url_field`, `create_phone_field`, `create_email_field`, `create_work_doc_field`
- Numbers and choices: `create_number_field`, `create_currency_field`, `create_percent_field`, `create_single_select_field`, `create_multi_select_field`, `create_checkbox_field`, `create_rating_field`
- Dates and people: `create_date_time_field`, `create_member_field`, `create_created_time_field`, `create_last_modified_time_field`, `create_created_by_field`, `create_last_modified_by_field`
- Links and computed values: `create_one_way_link_field`, `create_two_way_link_field`, `create_magic_lookup_field`, `create_formula_field`, `create_auto_number_field`, `create_button_field`, `create_attachment_field`

### Important behavior

- `create_datasheets` creates an empty datasheet. Create columns afterward with the type-specific field tools.
- `get_records` defaults to `apiVersion: "v3"`. Pass `apiVersion: "v1"` explicitly when required; a v3 failure never causes an implicit fallback.
- Record sorting uses objects such as `[{ "field": "Created time", "order": "desc" }]` and is encoded in the Fusion query format.
- Record creation and update accept 1–10 records per call and support `viewId` and `fieldKey`.
- Organization operations use the official `unitId` naming.
- `delete_records`, `delete_fields`, `delete_embedlinks`, `delete_a_member`, `delete_a_team`, and `delete_a_role` require `confirm_destructive: true`.
- AI chat completions and undocumented node, form, import, and view-write endpoints are intentionally not exposed.

## Attachment uploads

`upload_attachments` accepts exactly one source:

- `filePath`: an absolute or relative local file path
- `url`: a public `http://` or `https://` URL downloaded by the server before upload

URL example:

```json
{
  "datasheetId": "dstXXXXXXXXXXXXXX",
  "url": "https://example.com/report.pdf",
  "fileName": "quarterly-report.pdf",
  "mimeType": "application/pdf",
  "maxBytes": 20971520,
  "downloadTimeoutMs": 15000
}
```

`fileName` and `mimeType` are optional. The default size limit is 20 MiB, the configurable hard maximum is 100 MiB, the default download timeout is 15 seconds, and the maximum timeout is 120 seconds.

Remote downloads reject URL credentials, private/reserved/local addresses, unsafe redirects, HTTPS-to-HTTP redirects, DNS rebinding, responses whose declared size is too large, and streams that exceed the limit. Redirects are limited to five hops. These controls reduce SSRF exposure, but operators should still apply outbound network policy where possible.

## Development and verification

```bash
npm ci
npm run check
npm test
npm run build
```

Run the source build locally:

```powershell
$env:VIKA_HOST = "https://vika.cn"
$env:VIKA_TOKEN = "replace-with-your-api-token"
node dist/cli.js
```

Available verification commands:

| Command | Purpose |
| --- | --- |
| `npm run check` | Type-check without emitting files |
| `npm test` | Run offline contract and security tests |
| `npm run build` | Produce ESM JavaScript and declarations in `dist/` |
| `npm run test:smoke` | Run a small opt-in live smoke test |
| `npm run test:live:all` | Run at least two real calls for every one of the 55 tools |

Live tests require `VIKA_TOKEN`, `VIKA_TEST_SPACE_ID`, `VIKA_TEST_NODE_ID`, and `VIKA_TEST_DATASHEET_ID`. The full matrix additionally requires `VIKA_LIVE_ALLOW_DESTRUCTIVE=true`. Set `VIKA_TEST_ATTACHMENT_URL` to make one attachment case use a real remote URL.

The matrix cleans up records, fields, embed links, teams, and roles that it creates. Test datasheets remain because the aligned public API does not provide a datasheet-delete operation. Plan-restricted embed or organization endpoints are reported separately from unexpected failures.

## Publishing to npm

This repository is release-ready as an npm CLI and ESM library. The package includes only `bin/`, `dist/`, the two README files, `package.json`, and the license.

Before publishing:

```bash
npm ci
npm run check
npm test
npm pack --dry-run
npm login --registry=https://registry.npmjs.org/
npm publish --registry=https://registry.npmjs.org/
```

`prepublishOnly` repeats type checking and tests, while `prepack` rebuilds `dist/`. The official npm registry is also fixed in `publishConfig` so a local mirror cannot accidentally receive the release. This project uses the new `vika-fusion-mcp` name to avoid colliding with the existing `vika-mcp` package and starts its release line at `1.0.0`.

### Automated GitHub releases

The [publish workflow](./.github/workflows/publish-npm.yml) runs whenever a GitHub Release is published. It checks out the release tag, verifies that `vX.Y.Z` or `X.Y.Z` matches `package.json`, installs with `npm ci`, runs the package's publish-time checks, and publishes with provenance. Normal releases use the npm `latest` tag; GitHub prereleases use `next`.

The recommended authentication method is npm Trusted Publishing:

1. Publish the new package once manually, or temporarily add a granular npm automation token as the repository secret `NPM_TOKEN` for the bootstrap release.
2. In the npm settings for `vika-fusion-mcp`, add a GitHub Actions trusted publisher with user `Lorwell`, repository `vika-mcp`, and workflow filename `publish-npm.yml`.
3. Leave the npm environment field empty unless a matching GitHub Environment is later added.
4. Remove `NPM_TOKEN` after OIDC publishing succeeds.
5. For each release, update `package.json` and `package-lock.json` to the same unused version, push the commit, then publish a GitHub Release whose tag is `v<version>`.

The workflow deliberately fails on a version/tag mismatch and never silently republishes a different revision.

## About `uvx`

An npm package cannot be launched directly with `uvx`. `uvx` is an alias for `uv tool run` and resolves Python packages into isolated Python environments; the native one-shot runner for this package is:

```bash
npx -y vika-fusion-mcp@1.0.0
```

If an integration strictly requires `uvx vika-fusion-mcp`, publish a second package with that name to PyPI containing a small Python console-script wrapper. That wrapper should locate `npx` and execute a pinned npm release such as `npx -y vika-fusion-mcp@1.0.0`. This works, but it still requires Node.js, adds a second registry and release lifecycle, and must keep the PyPI and npm versions synchronized. A pure Python port is the only way to remove that Node.js dependency.

For most MCP clients, the npm-only `npx` configuration is the simpler and safer distribution model.

## License

Licensed under `GPL-3.0-only`. See [LICENSE](./LICENSE).
