# vika-fusion-mcp

基于 [Vika Fusion 开放 API](https://developers.vika.cn/api/introduction/) 的 MCP 服务与 TypeScript 库。通过 `stdio` 暴露 55 个工具，覆盖记录、26 种字段创建、附件、节点、嵌入链接和组织管理。

[English](./README.md)

## 主要能力

- 覆盖 `/fusion/v1`、`/fusion/v2` 和 `/fusion/v3` 下官网公开的非 AI Fusion operation。
- 读取记录默认使用 Fusion v3，可显式选择 v1，不会静默降级。
- 附件既可读取本地文件，也可安全下载公网 HTTP(S) URL 后上传。
- URL 下载包含大小、总超时、DNS/IP、重定向、DNS 固定和 HTTPS 降级防护。
- 六类删除工具全部要求显式传入 `confirm_destructive: true`。
- 同时提供 `vika-fusion-mcp` CLI 和无导入副作用的 ESM 库入口。
- 包含离线契约测试，以及每个工具至少执行两次真实调用的在线测试矩阵。

## 运行要求

- Node.js 22 或更高版本
- Vika API Token
- Vika 服务地址，公开云通常为 `https://vika.cn`

## 快速开始

无需全局安装，直接运行 npm 包：

```bash
npx -y vika-fusion-mcp@1.0.0
```

服务使用 `stdio` 通讯，通常应由 MCP 客户端启动，而不是在终端中交互使用。

### MCP 客户端配置

```json
{
  "mcpServers": {
    "vika": {
      "command": "npx",
      "args": ["-y", "vika-fusion-mcp@1.0.0"],
      "env": {
        "VIKA_HOST": "https://vika.cn",
        "VIKA_TOKEN": "替换为你的-api-token",
        "VIKA_TIMEOUT_MS": "15000",
        "VIKA_LOG_LEVEL": "info"
      }
    }
  }
}
```

固定版本可以保证 MCP 每次启动行为一致；如果希望自动升级，可将 `@1.0.0` 改成 `@latest`。

### 全局安装

```bash
npm install --global vika-fusion-mcp@1.0.0
vika-fusion-mcp
```

## 推荐：使用 MCP Gateway 转为 HTTP 或 SSE

如果需要连接多个远程客户端、部署在反向代理之后，或者客户端无法启动 stdio 子进程，推荐使用 [**lingya-ai/mcp-gateway**](https://github.com/lingya-ai/mcp-gateway)。它可以将 `vika-fusion-mcp` 转换为 Streamable HTTP、SSE 或 WebSocket 服务；网关提供无需 JVM 的原生程序，也提供内置 Node.js 的 Docker 镜像。

当所有客户端共用同一个 Vika 服务地址和 Token 时，`vika-fusion-mcp` **建议使用共享模式**。所有会话复用同一个 MCP 子进程，可以降低启动和内存开销，并复用服务内部的能力缓存。

共享模式的 Streamable HTTP：

```bash
mcp-gateway --from stdio --process-scope shared -- npx -y vika-fusion-mcp@1.0.0
```

默认 MCP 地址为 `http://127.0.0.1:8000/mcp`，健康检查地址为 `http://127.0.0.1:8000/healthz`。启动网关的进程需要已经设置 `VIKA_HOST` 和 `VIKA_TOKEN`，网关会将它们传递给 MCP 子进程。

兼容旧版 SSE 客户端：

```bash
mcp-gateway --from stdio --to sse --process-scope shared --protocol-version 2024-11-05 -- npx -y vika-fusion-mcp@1.0.0
```

SSE 默认地址为 `http://127.0.0.1:8000/sse`。Windows 上的 `npx` 是 `.cmd` 脚本，应改用：

```powershell
mcp-gateway --from stdio --process-scope shared --shell-command "npx.cmd -y vika-fusion-mcp@1.0.0"
```

使用 MCP Gateway 的 Node.js Docker 镜像：

```bash
docker run --rm -p 127.0.0.1:8000:8000 -e VIKA_HOST -e VIKA_TOKEN moailaozi/mcp-gateway:1.0.0-node --from stdio --process-scope shared -- npx -y vika-fusion-mcp@1.0.0
```

共享模式会让客户端共享子进程、资源、订阅和工具内部状态；如果客户端之间必须隔离服务端状态，请改用默认的 isolated 模式。公网部署时应在网关前配置 TLS 和身份认证，因为网关自身只监听 HTTP。如果这个组合对部署有帮助，也欢迎为 [MCP Gateway](https://github.com/lingya-ai/mcp-gateway) 点一个 Star。

## 配置

| 环境变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `VIKA_HOST` | 是 | — | Vika 服务地址，例如 `https://vika.cn` |
| `VIKA_TOKEN` | 是 | — | Vika API Token，请勿提交到版本库 |
| `VIKA_TIMEOUT_MS` | 否 | `15000` | Vika API 请求超时 |
| `VIKA_PROXY_URL` | 否 | — | Vika API 请求使用的 HTTP(S) 代理 |
| `VIKA_ALLOW_INSECURE_TLS` | 否 | `false` | 接受不受信任的 TLS 证书，仅建议在受控私有部署中使用 |
| `VIKA_LOG_LEVEL` | 否 | `info` | `debug`、`info`、`warn` 或 `error` |

日志写入 stderr，不会污染 stdout 上的 MCP 消息。

## 作为 TypeScript 库使用

现在导入包根路径不会自动启动服务。`runStdioServer` 用于启动标准 stdio 传输；`createVikaMcpServer` 返回尚未连接的 `McpServer`，可用于自定义传输或嵌入其他程序。

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

公开库导出包括：

- `createVikaMcpServer(config?)`
- `runStdioServer(config?)`
- `loadConfig(env?)`
- `PUBLIC_TOOL_NAMES`
- `AppConfig`

## 工具目录

注册清单集中定义在 `PUBLIC_TOOL_NAMES`，契约测试会精确断言共 55 个工具。

| 分类 | 工具 |
| --- | --- |
| 空间站与节点（4） | `get_spaces`、`get_nodes`、`search_nodes`、`get_node_details` |
| 表格、附件与嵌入链接（5） | `create_datasheets`、`upload_attachments`、`get_embedlinks`、`create_embedlinks`、`delete_embedlinks` |
| 记录（4） | `get_records`、`create_records`、`update_records`、`delete_records` |
| 字段（28） | `get_fields`、下列 26 个字段创建工具、`delete_fields` |
| 视图（1） | `get_views` |
| 组织管理（13） | `get_a_member`、`update_a_member`、`delete_a_member`、`list_the_team_members`、`list_teams`、`create_a_team`、`update_a_team`、`delete_a_team`、`list_units_under_the_role`、`list_roles`、`create_a_role`、`update_a_role`、`delete_a_role` |

26 个字段创建工具按类型拆分：

- 文本与标识：`create_single_text_field`、`create_text_field`、`create_url_field`、`create_phone_field`、`create_email_field`、`create_work_doc_field`
- 数值与选择：`create_number_field`、`create_currency_field`、`create_percent_field`、`create_single_select_field`、`create_multi_select_field`、`create_checkbox_field`、`create_rating_field`
- 日期与人员：`create_date_time_field`、`create_member_field`、`create_created_time_field`、`create_last_modified_time_field`、`create_created_by_field`、`create_last_modified_by_field`
- 关联与计算：`create_one_way_link_field`、`create_two_way_link_field`、`create_magic_lookup_field`、`create_formula_field`、`create_auto_number_field`、`create_button_field`、`create_attachment_field`

### 关键行为

- `create_datasheets` 只创建空表；随后使用类型专用字段工具逐列创建字段。
- `get_records` 默认 `apiVersion: "v3"`。需要时显式传 `apiVersion: "v1"`；v3 失败不会触发隐式降级。
- 记录排序使用对象数组，例如 `[{ "field": "创建时间", "order": "desc" }]`，服务会按 Fusion 官方格式编码查询参数。
- 记录创建和更新每次接受 1–10 条记录，并支持 `viewId` 和 `fieldKey`。
- 通讯录接口统一使用官网的 `unitId` 命名。
- `delete_records`、`delete_fields`、`delete_embedlinks`、`delete_a_member`、`delete_a_team` 和 `delete_a_role` 必须传 `confirm_destructive: true`。
- AI 会话补全以及未公开的节点、表单、导入和视图写入接口不会暴露。

## 附件上传

`upload_attachments` 必须且只能选择一种来源：

- `filePath`：本地绝对或相对文件路径
- `url`：由服务端先下载、再上传的公网 `http://` 或 `https://` 地址

URL 示例：

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

`fileName` 和 `mimeType` 可选。默认大小限制为 20 MiB，可配置硬上限为 100 MiB；默认总下载超时为 15 秒，最大为 120 秒。

远程下载会拒绝 URL 凭据、私有/保留/本地地址、不安全重定向、HTTPS 降级、DNS 重绑定、声明尺寸超限的响应，以及实际数据流超限的内容；最多允许五次重定向。这些措施用于降低 SSRF 风险，生产环境仍建议配合出站网络策略。

## 开发与验收

```bash
npm ci
npm run check
npm test
npm run build
```

本地启动构建产物：

```powershell
$env:VIKA_HOST = "https://vika.cn"
$env:VIKA_TOKEN = "替换为你的-api-token"
node dist/cli.js
```

可用验收命令：

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 只做 TypeScript 类型检查 |
| `npm test` | 运行离线契约与安全测试 |
| `npm run build` | 在 `dist/` 生成 ESM JavaScript 和类型声明 |
| `npm run test:smoke` | 运行小型、显式启用的在线冒烟测试 |
| `npm run test:live:all` | 对全部 55 个工具各执行至少两次真实调用 |

在线测试需要 `VIKA_TOKEN`、`VIKA_TEST_SPACE_ID`、`VIKA_TEST_NODE_ID` 和 `VIKA_TEST_DATASHEET_ID`。完整矩阵还要求 `VIKA_LIVE_ALLOW_DESTRUCTIVE=true`。设置 `VIKA_TEST_ATTACHMENT_URL` 后，其中一个附件用例会测试真实远程 URL。

矩阵会清理其创建的记录、字段、嵌入链接、小组和角色。由于对齐后的公开 API 没有删除数据表 operation，测试创建的数据表会保留。套餐不支持的嵌入链接或组织接口会与非预期失败分开报告。

## 发布到 npm

仓库现在可同时作为 npm CLI 与 ESM 库发布。npm 包只包含 `bin/`、`dist/`、两份 README、`package.json` 和许可证。

发布前执行：

```bash
npm ci
npm run check
npm test
npm pack --dry-run
npm login --registry=https://registry.npmjs.org/
npm publish --registry=https://registry.npmjs.org/
```

`prepublishOnly` 会再次执行类型检查与测试，`prepack` 会重新构建 `dist/`。`publishConfig` 还固定了 npm 官方 registry，避免误将版本发布到本地配置的镜像。本项目采用新的 `vika-fusion-mcp` 名称以避开已有的 `vika-mcp` 包，并从 `1.0.0` 开始发布。

### GitHub Release 自动发布

[npm 发布工作流](./.github/workflows/publish-npm.yml) 会在 GitHub Release 发布时运行。它会检出 Release tag，检查 `vX.Y.Z` 或 `X.Y.Z` 是否与 `package.json` 一致，通过 `npm ci` 安装依赖，执行包内置的发布前检查，并携带 provenance 发布。正式 Release 使用 npm 的 `latest` 标签，GitHub Prerelease 使用 `next`。

推荐使用 npm Trusted Publishing：

1. 首个版本需要先为 npm 账户启用“授权与写入”2FA，再从可信本地终端手动发布一次，并输入 npm 提示的一次性验证码。npm 要求包已经存在，才能配置 Trusted Publishing 或 staged publishing。
2. 在 npm 的 `vika-fusion-mcp` 包设置中添加 GitHub Actions Trusted Publisher：用户填写 `Lorwell`，仓库填写 `vika-mcp`，工作流文件名填写 `publish-npm.yml`。
3. 除非以后创建了同名 GitHub Environment，否则 npm 的 environment 字段保持空白。
4. 删除仓库 Secret `NPM_TOKEN` 并撤销所有引导 token。工作流不再提供 token 回退，只使用短期 OIDC 凭据认证。
5. 后续每次发版前将 `package.json` 和 `package-lock.json` 更新为同一个未使用版本，推送提交，再创建 tag 为 `v<version>` 的 GitHub Release。

Release tag 与包版本不一致时工作流会直接失败，不会静默发布其他代码版本。工作流支持幂等重跑：如果完全相同的版本已经存在且位于预期 npm dist-tag 下，会报告并成功结束，不再重复发布。

## 关于 `uvx`

npm 包不能直接通过 `uvx` 启动。`uvx` 是 `uv tool run` 的别名，它会在隔离的 Python 环境中解析和运行 Python 包；本项目原生的一次性启动方式是：

```bash
npx -y vika-fusion-mcp@1.0.0
```

如果某个集成强制要求 `uvx vika-fusion-mcp`，需要另外向 PyPI 发布一个同名的 Python console-script 启动桥。该启动桥负责定位 `npx`，并执行固定版本的 npm 命令，例如 `npx -y vika-fusion-mcp@1.0.0`。这种方案可以工作，但依然依赖 Node.js，同时增加第二套包仓库、发布流程和版本同步成本。只有完整的 Python 重写才能去除 Node.js 依赖。

对绝大多数 MCP 客户端，直接配置 npm 的 `npx` 是更简单、风险更低的分发方案。

## 许可证

本项目采用 `GPL-3.0-only` 许可证，详见 [LICENSE](./LICENSE)。
