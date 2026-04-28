# Figma 插件官方能力核对

状态：V1 validation draft  
日期：2026-04-28  
范围：`skills/figma-react-restore/plugin/manifest.json`、`code.js`、`ui.html`

## 1. 结论

- 当前插件应作为 Figma Desktop development plugin 使用，不作为 Marketplace 发布插件。
- 当前插件使用的是 Figma Design 插件标准能力，不依赖 Dev Mode、REST API、webhook、团队库权限、付费插件支付能力或组织级 API。
- Figma 官方帮助文档说明开发插件可在任意 team 或 plan 下创建；运行插件至少支持 Starter plan 的 Figma Design 文件。因此 V1 插件功能不是付费用户专属能力。
- 仍需要用户做一次 Figma Desktop 手工 E2E，因为本地测试环境无法直接运行 Figma 插件沙箱。

## 2. 官方文档对照

| 插件能力 | 当前实现 | 官方支持判断 | 备注 |
| --- | --- | --- | --- |
| Development plugin | `plugin/manifest.json` 由 Figma Desktop 导入 | 支持 | 官方帮助文档说明在 Desktop 通过 `Plugins > Development` 创建或导入开发插件，并且适用于任意 plan。 |
| Figma Design editor | `editorType: ["figma"]` | 支持 | 只运行在 Figma Design，不声明 Dev Mode editor。 |
| Dynamic page access | `documentAccess: "dynamic-page"` | 支持 | 只读取当前 page selection 和被选节点子树，符合动态页面访问模型。 |
| 本地网络连接 | `networkAccess.allowedDomains: ["none"]`，`devAllowedDomains` 指向 localhost | 支持 development plugin | 发布态禁止网络；开发态允许访问本地 runtime。Figma manifest 当前不接受 `127.0.0.1` 作为 development domain。 |
| UI iframe | `figma.showUI(__html__, ...)` | 支持 | 用于展示连接状态，自动注册 runtime session，并在 SSE 不可用时自动降级轮询。 |
| 主线程与 UI 通信 | `figma.ui.postMessage`、`figma.ui.onmessage`、`parent.postMessage` | 支持 | 官方 UI 文档提供该通信模型。 |
| Runtime event stream | UI iframe 内使用 `EventSource` 连接本地 SSE | 支持判断为可用，需手工确认 | 官方说明 UI iframe 可访问浏览器 API，且 network access 通过 CSP 控制连接域名；`EventSource` 未在官方文档中单独列名，因此保留手工 E2E 验证项。 |
| Selection 读取 | `figma.currentPage.selection` | 支持 | 只使用当前页面已选节点，不跨文件或跨页面批量扫描。 |
| 节点结构读取 | `node.children`、`absoluteBoundingBox`、layout/text/paint 属性 | 支持 | Serialized root 限制深度和 children 数量，避免过大 payload。 |
| 完整文本读取 | 直接遍历原始 Figma node tree 的 `TEXT.characters` | 支持 | 文本证据不依赖 serialized root 深度限制；用于生成 `text-manifest.json` 和 exact text gate。 |
| PNG baseline 导出 | `rootNode.exportAsync({ format: "PNG" })` | 支持 | `exportAsync` 支持 PNG export settings。 |
| SVG/PNG asset 导出 | vector-like 节点导出 SVG，图片/命名 asset 导出 PNG | 支持 | `exportAsync` 支持 SVG/PNG；导出失败会写 warning，不阻断整次 extraction。 |
| 混合文本样式 | `fontWeight` 等字段只保留 number/string | 已做兼容 | Figma 文本属性可能出现 mixed value；插件避免把不可 clone 值传给 UI。 |

## 3. 非付费能力边界

V1 没有使用以下可能引入付费、团队或发布门槛的能力：

- Dev Mode 插件入口或 codegen/inspect 专用能力。
- Figma REST API、OAuth、webhook。
- `teamlibrary` permission。
- Plugin payments / paid resource flow。
- Organization/admin 级 API。
- Marketplace 发布态网络能力。

实际前提是：

- 用户能登录 Figma Desktop。
- 用户对目标 Figma 文件有足够权限运行开发插件和选择目标节点。
- 用户必须保持插件 UI 打开；Figma 插件不能作为不可见后台进程长期运行。
- 如果目标文件位于 Organization / Enterprise，Figma 可能要求对应 paid seat 或管理员批准插件；这是 Figma 的文件/组织权限限制，不是 V1 插件 API 依赖付费能力。
- 本地 runtime 对插件暴露为 `http://localhost:49327`。

## 4. 已发现并处理的兼容点

- `networkAccess.allowedDomains` 保持 `["none"]`，避免发布态误连外网；localhost 只放入 `devAllowedDomains`。
- 多选时如果 common parent 是 `PAGE`，不再把整个 page 当 root，而是退回第一个选中节点。
- Figma rich text 的 mixed typography 值不会直接写入 extraction payload。
- `exportAsync` 失败只记录 `ASSET_EXPORT_FAILED` warning，避免个别 asset 阻断整体页面还原。

## 5. 仍需手工验证

本地自动测试无法替代 Figma Desktop 插件沙箱验证。编码完成后必须执行：

1. Figma Desktop 导入 `skills/figma-react-restore/plugin/manifest.json`。
2. 启动 runtime service。
3. 选择一个 frame，打开插件并确认 UI 自动连接到 `http://localhost:49327`。
4. CLI 执行 `extract --selection`。
5. 确认 `.figma-react-restore/runs/<runId>/extraction.raw.json` 包含 screenshot、regions、texts、colors、typography、assets。
6. 确认 screenshot artifact 能打开，asset artifact 不因单个导出失败导致 extraction 失败。

## 6. 官方来源

- Figma plugin manifest: https://developers.figma.com/docs/plugins/manifest/
- Figma development plugin: https://help.figma.com/hc/en-us/articles/360042786733-Create-a-plugin-for-development
- Use plugins in files: https://help.figma.com/hc/en-us/articles/360042532714-Use-plugins-in-files
- Figma plugin quickstart: https://developers.figma.com/docs/plugins/plugin-quickstart-guide/
- Accessing the document: https://developers.figma.com/docs/plugins/accessing-document/
- Creating UI: https://developers.figma.com/docs/plugins/creating-ui/
- Making network requests: https://developers.figma.com/docs/plugins/making-network-requests/
- `exportAsync`: https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/
- Export settings: https://developers.figma.com/docs/plugins/api/ExportSettings/
