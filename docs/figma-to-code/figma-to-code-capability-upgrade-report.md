# figma-to-code 能力升级研究报告

## Executive Summary

**结论：`skills/figma-to-code` 目前已经是一个可用的“Design 模式本地提取链路”，但它本质上仍是一次性快照提取器，不是 mode-aware / style-aware / incremental 的设计语义提取系统。** 当前链路由 `SKILL.md` 定义工作流、Bridge 负责 HTTP/SSE 中转和缓存、Figma 插件负责真实提取与导出、CLI/query 负责对缓存做裁剪查询；它已经覆盖了布局、基础样式、文本、变量别名、组件实例基础信息、图片/矢量导出与截图，但在变量模式解析、样式定义解析、组件/变体语义、增量提取、缓存索引、错误模型和 Agent 协议上还有明显上升空间。[^1][^2][^3][^4][^5]

**官方 Figma Plugins API 提供的高价值能力明显多于当前实现实际利用的能力。** 其中最值得马上利用的是：`getStyledTextSegments` 的全字段文本段提取、`resolvedVariableModes` + `Variable.resolveForConsumer` 的 mode-aware token 解析、`PaintStyle` / `TextStyle` / `GridStyle` 的样式对象解析、`findAllWithCriteria` + `figma.skipInvisibleInstanceChildren` 的大文件遍历优化、`getCSSAsync` 的 inspect/CSS 直出，以及 `TeamLibrary` / `codegen` 的后续扩展路径。[^6][^7][^8][^9][^10][^11][^12][^13][^14][^15]

**推荐路线：优先做“Bridge-first v2”升级，而不是直接改造成 Dev Mode codegen-only 插件。** 原因是当前 skill 的核心价值是“从 Design 模式拿到高保真结构 + 资产 + 截图，再让 Agent 渐进生成代码”；这条价值链与本地 Bridge、截图、导出、多选更兼容。Dev Mode codegen 应该作为第二阶段并行通道，而不是替代当前主链路。[^1][^2][^4][^15][^16][^17]

---

## 研究方法与证据分级

- **已确认事实**：直接来自当前仓库代码或 Figma 官方文档。  
- **推断**：基于代码行为、协议设计、官方 API 边界推导出的高概率结论。  
- **建议**：在已确认事实和推断基础上的升级方案。  

---

## 系统概览：当前 figma-to-code 交互链路

```text
Agent / CLI
   │  HTTP
   ▼
Bridge (localhost:3333)
   │  SSE: extract / extract-selection
   ▼
Plugin UI (iframe)
   │  postMessage
   ▼
Plugin sandbox (code.js)
   │  Figma Plugin API
   ▼
Figma document / selection / export APIs
   │
   ├─ extraction.json
   ├─ assets/*.svg|png
   └─ screenshot.png
```

**已确认事实：**

1. `README.md` 和 `SKILL.md` 将系统定义为“Plugin ←SSE→ Bridge ←HTTP→ CLI / Agent”的本地提取架构，工作流强调先提取，再通过 `query` 对缓存做按需读取，而不是直接读 `extraction.json`。[^1][^18]
2. `bridge.mjs` 提供 `/health`、`/events`、`/extract`、`/extract-selection`、`/jobs/:id/result`、`/jobs/:id/asset` 六类核心接口，使用 SSE 向插件下发任务，使用 HTTP 接收结果并写入 cache。[^2]
3. `plugin/ui.html` 只负责 SSE 连接、状态显示、向 plugin sandbox 转发 `extract` / `extract-selection` 指令，并把 `post-result` / `post-asset` 回传给 Bridge。当前协议没有版本协商、能力协商、分块上传或恢复机制。[^3]
4. `plugin/code.js` 才是真正的提取器：它序列化节点树、变量别名、文本段、组件信息，导出节点资产、图片填充、矢量 SVG 和截图。[^4]
5. `scripts/query.mjs` 只暴露 `tree | node | subtree | text | palette` 五个查询面；`scripts/validate.mjs` 只做“文本节点匹配 + computed style 对比”，不是全视觉/全几何校验器。[^5][^19]

---

## 1. 当前实现概览

### 1.1 能力边界总览

| 领域 | 当前实现 | 结论 |
|---|---|---|
| 提取入口 | Figma URL / 当前选区 | **已确认事实：** 支持两种入口；URL 仅解析 `fileKey + nodeId`，真实提取仍依赖当前打开的 Figma 文件里能找到该 node。[^2][^4] |
| 树结构 | 单节点整棵子树 / 多选虚拟根 | **已确认事实：** 支持单选整棵树和多选 `VIRTUAL_GROUP`。[^4] |
| 样式 | fills / strokes / effects / radius / opacity / blend mode | **已确认事实：** 已覆盖常见视觉属性，但仍是“节点内联样式快照”。[^4] |
| 文本 | characters / font / size / lineHeight / letterSpacing / align / case / 部分 segments | **已确认事实：** 有文本段提取，但输出字段被明显裁剪。[^4][^5] |
| 变量 | `boundVariables` / `inferredVariables` / alias name/type / default mode flat values | **已确认事实：** 已接入变量 API，但没有 mode-aware 解析，也没有完整 token catalog。[^4] |
| 组件语义 | `componentProperties` / `variantProperties` / `getMainComponentAsync` | **已确认事实：** 只提取了实例级基础语义，没有 override / exposed instance / slot / defaultVariant 级别信息。[^4] |
| 资产导出 | 根节点 SVG/PNG、图片填充 bytes、最多 50 个矢量 SVG、父级截图 | **已确认事实：** 资产能力可用，但策略较粗。[^4] |
| 查询粒度 | `tree/node/subtree/text/palette` | **已确认事实：** 没有 `variables/styles/components/assets/css` 查询面。[^5] |
| 缓存 | `cache/<fileKey>/<nodeId>/` | **已确认事实：** 有持久化缓存，但没有 schema version migration / index / invalidation。[^2] |
| 校验 | 文本节点 + style 属性组 | **已确认事实：** 能做结构化样式比对，但不等于设计高保真验证。[^19] |

### 1.2 当前实现的关键强项

- **已确认事实：设计数据不只是“截图 OCR”。** 插件直接使用 Figma Plugin API 读取节点、文本、paint、effect、vector、component、variable 结构，因此比单纯 REST 截图或像素分析更适合 Agent 代码生成。[^4][^6][^9][^11]
- **已确认事实：已经具备“按需裁剪查询”意识。** `query.mjs` 的 `subtree/text/palette` 显著降低了 Agent 读取 token 开销，这一点和 `SKILL.md` 的“渐进式查询”思路是一致的。[^5][^18]
- **已确认事实：本地 Bridge 方案绕开了 MCP/远程凭证问题。** 当前 skill 只依赖本机 Figma Desktop + localhost bridge，安装和权限模型都比较直接。[^1][^20][^21]

### 1.3 当前实现的硬边界

- **已确认事实：URL 提取不是“远程文件访问”，而是“把 URL 里的 nodeId 映射到当前已打开文件”。** `bridge.mjs` 会从 URL 解析 `fileKey` 和 `nodeId`，但 `plugin/code.js` 只调用 `figma.getNodeByIdAsync(figmaNodeId)`；`fileKey` 仅用于 meta 和 cache 路径，不参与文件一致性校验。[^2][^4]
- **已确认事实：所有 query 都会先完整读取并解析 `extraction.json`。** 也就是说，虽然对 Agent 暴露的是裁剪结果，但进程内成本仍是“整文件 parse + 查找 + prune”。[^5]
- **已确认事实：`validate.mjs` 只检查文本节点和固定样式属性集合。** 它不检查 SVG path、图片内容、阴影视觉、背景渐变、组件关系、像素级布局等。[^19]

---

## 2. 能力缺口矩阵

| 能力主题 | 当前状态 | 官方 API 现状 | Gap 判断 | 优先级 |
|---|---|---|---|---|
| 变量 / modes / alias 解析 | **Partial**：仅 alias reachable + default mode flat values | `boundVariables`、`inferredVariables`、`resolvedVariableModes`、`setExplicitVariableModeForCollection`、`Variable.resolveForConsumer`、`valuesByMode`、`codeSyntax`、`scopes`、extended collections 都已存在 | **大 gap**：当前 token 不是 mode-aware，也不是 platform-aware。[^4][^7][^8][^9][^10][^11] | P0 |
| 样式 / styles / tokens | **Weak**：只保留 styleId，不拉样式定义 | `PaintStyle`、`TextStyle`、`GridStyle` 是正式对象，可带 `boundVariables` 和 consumers | **大 gap**：无法还原 style catalog，也无法把 style 与 token 系统真正对齐。[^4][^12][^13][^14] | P0 |
| 文本保真 | **Partial**：有 segments，但字段裁剪严重 | `getStyledTextSegments` 支持 `fontWeight`、`textStyleId`、`fillStyleId`、`hyperlink`、`boundVariables`、`listOptions`、`paragraphSpacing`、`openTypeFeatures` 等 | **大 gap**：富文本、列表、链接、变量绑定、段落属性丢失。[^4][^6][^22][^23] | P0 |
| Auto layout / constraints / geometry | **Good but incomplete** | `absoluteBoundingBox`、`absoluteRenderBounds`、`absoluteTransform`、constraints、auto-layout 属性都已支持 | **中 gap**：当前提取未利用 `absoluteTransform`；查询层也丢掉了部分 min/max 信息和 render-bounds 细节。[^4][^9] | P1 |
| Component / variant / instance 语义 | **Partial**：`componentProperties` / `variantProperties` / `mainComponent` | `ComponentSetNode.defaultVariant`、`InstanceNode.overrides`、`exposedInstances`、`swapComponent`、`removeOverrides`、component property system 更完整 | **大 gap**：无法稳定表达 design-system 组件语义。[^4][^24][^25][^26] | P0 |
| 图片 / 矢量 / export | **Good**：`exportAsync`、image bytes、vector export | `exportAsync` 还支持 `SVG_STRING`、`JSON_REST_V1`；`Paint` 覆盖 IMAGE/VIDEO/PATTERN；`working-with-images` 给出 bytes/canvas worker 路线 | **中 gap**：当前导出策略保守，格式和语义未最大化。[^4][^27][^28] | P1 |
| 多选与子树提取 | **Partial**：支持 `VIRTUAL_GROUP` | 官方支持多选读取当前选区，但语义需要插件自行定义 | **大 gap**：多选 root 正确，但资产/截图只跟随第一选中节点。[^4] | P0 |
| 渐进式 / 增量提取 | **None** | 官方 API 支持按页加载、按节点查找、遍历优化，不要求每次整树全量序列化 | **大 gap**：当前是 full snapshot；没有 node fingerprint、delta、chunk。[^4][^5][^20] | P0 |
| 遍历性能 | **Manual traversal** | `findAllWithCriteria` + `figma.skipInvisibleInstanceChildren` 被官方明确标为大文件高性能组合 | **大 gap**：当前完全没利用官方遍历优化。[^4][^29][^30] | P1 |
| CSS / code hints | **None in extractor** | `getCSSAsync()`、`isAsset`、Dev Mode `codegen` 都是官方一等能力 | **高价值未利用**：可显著提升代码生成稳定性与解释性。[^15][^16][^17][^24][^25] | P1 |
| Team library | **None** | `figma.teamLibrary` 可枚举已启用库的 variable collections；manifest 需 `teamlibrary` 权限 | **中 gap**：无法消费团队样式/变量源。[^11][^14][^21] | P2 |
| Agent 协议 / 错误模型 | **Basic**：SSE + HTTP，错误码少 | 官方 `showUI` / `ui.postMessage` 支持结构化消息；manifest/networkAccess/dynamic-page 有更明确约束 | **中 gap**：没有版本协商、流式上传、幂等 job、能力声明。[^2][^3][^20][^31][^32][^33] | P1 |

---

## 3. Top 10 升级建议

### 1. 把变量提取升级为 **mode-aware token graph**

- **已确认事实**：当前只解析 alias reachable variables，并把每个变量压扁成 default mode 的 `flat.colors/numbers/strings/booleans`。[^4]
- **已确认事实**：官方 API 允许读取 `resolvedVariableModes`、显式设置 mode、按 consumer 做 `resolveForConsumer`，还可读取 `valuesByMode`、`codeSyntax`、`scopes`。[^7][^8][^9][^10]
- **建议**：输出 `variables.collections[] / variables.items[] / variables.bindings[] / variables.resolved[]` 四层结构；保留 collection、mode、alias chain、resolved value、codeSyntax、scope。

### 2. 增加 `query variables` / `query styles` / `query components`

- **已确认事实**：当前 query 只有五个子命令，没有直接读 token/style/component 语义的面。[^5]
- **建议**：把“面向 Agent 的低 token 成本查询”做成一等能力，而不是逼 Agent 走 `subtree` 间接推断。

### 3. 修复多选导出与截图语义

- **已确认事实**：多选时 `extractMultipleNodes()` 会生成 `VIRTUAL_GROUP` 根，但 `executeExtractSelectionJob()` 仍把 `primaryNode` 传给 `exportAssetsAndPost()`，因此资产导出和截图都锚定第一选中节点。[^4]
- **建议**：多选模式下引入 `exportTarget: "virtual-root" | "per-node" | "primary-node"`，默认 `per-node + union screenshot`。

### 4. 解析样式定义，而不只是保留 styleId

- **已确认事实**：当前只在节点上保留 `fillStyleId` / `strokeStyleId` / `effectStyleId`，并未拉取 `PaintStyle` / `TextStyle` / `GridStyle` 对象。[^4]
- **已确认事实**：官方 Style 对象可携带 style 内容、`boundVariables`、publish status、consumers 等信息。[^12][^13][^14]
- **建议**：抽取 `styles.paint[] / styles.text[] / styles.grid[]`，建立 node->style->variable 三跳关系。

### 5. 扩展文本段输出字段，至少补齐 8 个缺失字段

- **已确认事实**：当前 `serializeTextSegments()` 请求了 `textStyleId`、`fillStyleId`、`hyperlink` 等字段，但输出时只真正保留了 `fontName/fontSize/fills/lineHeight/letterSpacing/textDecoration/textCase`。[^4]
- **已确认事实**：官方 `getStyledTextSegments()` 支持更多字段，包括 `fontWeight`、`boundVariables`、`listOptions`、`paragraphSpacing`、`openTypeFeatures`。[^22]
- **建议**：将文本段 schema 升为富文本/可代码生成级别，而不是只够做简单 typography。

### 6. 在提取前启用官方遍历优化

- **已确认事实**：当前遍历是 `collectSubtreeNodes()` + 递归 `serializeNode()` 的手写 DFS。[^4]
- **已确认事实**：官方明确说明 `findAllWithCriteria` 与 `figma.skipInvisibleInstanceChildren = true` 组合在大文件中可“快几个数量级”。[^29][^30]
- **建议**：在只读提取场景默认打开 `skipInvisibleInstanceChildren`，并用 `findAllWithCriteria` 做类型预扫描。

### 7. 引入 `getCSSAsync()` 作为辅助通道，而非替代通道

- **已确认事实**：当前布局/样式映射完全是手工从 node property 组装。[^4]
- **已确认事实**：官方 `getCSSAsync()` 返回与 Inspect 面板一致的 CSS JSON，可用于 code generation。[^15][^24]
- **建议**：保留现有结构化 schema 作为“设计语义源”，把 `getCSSAsync()` 作为 `query css` 或 debug/fallback 通道，用于校正某些 CSS 细节。

### 8. 升级缓存为 “snapshot + index + delta” 三层

- **已确认事实**：当前 query 每次都完整读 `extraction.json`；cache 目录没有 index、没有 node-level sidecar、没有过期判断。[^2][^5]
- **推断**：在大节点树或反复 query 时，CPU/IO/token 成本会明显放大。
- **建议**：新增 `index.json`（nodeId/name/type/path/offset 摘要）和 `nodes/<id>.json`（subtree shard），后续再演进到 delta。

### 9. 升级桥接协议：版本协商、幂等 job、流式资产上传

- **已确认事实**：当前协议只有 `extract` / `extract-selection`、`post-result` / `post-asset`，没有 schema version、plugin version、job retry、chunk upload、checksum。[^2][^3]
- **建议**：新增 `hello` / `capabilities` / `job-ack` / `chunk` / `complete`，并在 Bridge 侧校验 `schemaVersion`。

### 10. 规划 Dev Mode companion，而不是一口气替换主架构

- **已确认事实**：官方 Dev Mode `codegen` 可直接把结果展示在 Inspect Code 区，支持 `preferences`、`refresh` 和多语言输出。[^15][^16][^17]
- **已确认事实**：Dev Mode 是只读表面，且选择行为、页面加载、UI 容器都不同于 Design 模式。[^17]
- **建议**：把它做成“第二通道”，共享抽取/查询核心，但不要直接取代当前 Bridge 提取路径。

---

## 4. 两种架构方案对比

### 方案 A：**Bridge-first v2（推荐）**

**定义**：保留当前 Design 模式插件 + Bridge + CLI 主链路，把 extractor schema、query 面、缓存和协议升到 v2。

**核心动作：**

1. `plugin/code.js` 升为 schema v3：变量 modes、styles、component semantics、css hints。  
2. `bridge.mjs` 增加 cache index / schema 版本 / job 协议增强。  
3. `query.mjs` 增加 `variables/styles/components/assets/css`。  
4. `bridge_client.mjs` 增加细粒度 query 与 extract 参数。  

**优点：**

- 延续当前 skill 触发与用户心智；  
- 保留多选、截图、资产导出、本地缓存的优势；  
- 与现有 Agent 流程兼容最好；  
- 风险集中在 schema 和协议，不需要改变用户工作模式。[^1][^2][^4][^18]

**缺点：**

- 仍需要用户打开 Figma Desktop 并跑插件；  
- 没有天然嵌入 Dev Mode Code 面板；  
- 如果继续不处理 dynamic-page，大文件性能改善有限。[^20][^21]

### 方案 B：**Dual-path（Design Extractor + Dev Mode Codegen）**

**定义**：保留现有 Bridge 提取链路，同时新增 Dev Mode 插件，用 `figma.codegen` 在 Inspect 面板提供代码/Token/语义解释。

**核心动作：**

1. 抽公共 `extract-core` / `schema-core`；  
2. Design 模式走 Bridge + assets + screenshot；  
3. Dev Mode 走 `figma.codegen.on('generate')` + `getCSSAsync()` + lightweight query；  
4. 两条通路共享 token/style/component 语义层。  

**优点：**

- 对开发者场景更顺手，能直接进入 Figma Inspect / VS Code；  
- 更适合做“代码解释、代码片段、import hint、i18n extract”。[^15][^16][^17]

**缺点：**

- 架构复杂度高；  
- Dev Mode 只读、单选、15 秒 codegen 超时等约束会让主链路替代困难；  
- 需要新增 manifest/capabilities/editorType 设计。[^16][^17][^34]

### 对比结论

| 维度 | 方案 A：Bridge-first v2 | 方案 B：Dual-path |
|---|---|---|
| 与现有 skill 兼容性 | **高** | 中 |
| 资产 / 截图 / 多选 | **强** | 弱到中 |
| Dev experience | 中 | **强** |
| 改造风险 | **低到中** | 高 |
| 交付速度 | **快** | 慢 |
| 适合作为主线 | **是** | 否，适合作为第二阶段 |

---

## 5. 推荐方案

**推荐：先实施方案 A（Bridge-first v2），并在 major 阶段演进到方案 B 的 dual-path。**

### 推荐理由

1. **已确认事实**：当前 skill 的核心工作流围绕“提取 → query → golden HTML → validate → convert”，它依赖缓存、截图、资产文件和多轮 Agent 查询，而这些都更贴近当前 Bridge 架构。[^18]
2. **已确认事实**：官方 `getCSSAsync()`、变量 mode 解析、样式对象、遍历优化等高价值能力，并不要求先切到 Dev Mode 才能用。[^7][^8][^9][^11][^15]
3. **推断**：如果现在直接切 codegen-first，会在用户体验上得到 Inspect 面板集成，但会失去当前 skill 最关键的“高保真提取 + 缓存 + 多选 + 截图”主价值。

### Roadmap

#### Quick wins

1. 修复多选导出/截图只跟随第一节点的问题。  
2. 输出完整变量 modes / resolved values / codeSyntax / scopes。  
3. 增加 `query variables`、`query styles`、`query components`。  
4. 扩展文本段字段，至少补 `fontWeight`、`textStyleId`、`fillStyleId`、`hyperlink`、`boundVariables`、`paragraphSpacing`、`listOptions`。  
5. 启用 `skipInvisibleInstanceChildren` 并引入 `findAllWithCriteria` 预扫描。  

#### Medium

1. 引入 style catalog 和 team-library-ready schema。  
2. 建 `index.json + nodes/<id>.json` sidecar，避免每次 query 全量 parse。  
3. 新增 `query css`，把 `getCSSAsync()` 作为辅助校验层。  
4. 提升组件语义：`defaultVariant`、`overrides`、`exposedInstances`、slot/property references。  
5. Bridge 协议补版本协商、校验和、幂等 job。  

#### Major

1. 加 `documentAccess: "dynamic-page"` 并补页面加载策略。  
2. 做 shared extractor core。  
3. 新增 Dev Mode `inspect/codegen` companion。  
4. 演进到增量提取（delta / fingerprint / subtree refresh）。  

---

## 6. 文件级改造建议

| 文件 | 建议改造 |
|---|---|
| `skills/figma-to-code/plugin/manifest.json` | 增加 `documentAccess: "dynamic-page"`；若要支持 library 查询，增加 `permissions: ["teamlibrary"]`；若实施 dual-path，建议新增独立 Dev Mode manifest，而不是把当前 Design 插件强行改成多 editorType 复用。[^21] |
| `skills/figma-to-code/plugin/code.js` | 这是主战场：变量 modes/style catalog/component semantics/schema version/getCSSAsync/query shards/findAllWithCriteria/skipInvisibleInstanceChildren/多选导出语义/错误码都应在这里升级。[^4][^7][^8][^9][^10][^15][^24][^25][^26][^29][^30] |
| `skills/figma-to-code/plugin/ui.html` | 增加 `hello/capabilities` 握手、plugin version 展示、断线重连 backoff、chunk upload、进度与取消能力；把协议从“纯消息转发器”升级为“轻量 transport agent”。[^3][^31][^32] |
| `skills/figma-to-code/bridge.mjs` | 增加 schema/version 校验、cache index、fileKey/nodeId 一致性检查、job retry、structured errors、asset checksum、delta 存储。[^2] |
| `skills/figma-to-code/scripts/bridge_client.mjs` | 新增 `query variables/styles/components/css/assets`，并给 `extract` 增加模式、分页/分块、强制刷新等参数。[^20] |
| `skills/figma-to-code/scripts/query.mjs` | 重构为 index-first 查询器；避免全量读 JSON；补 variables/styles/components/css；保留 pruning，但不要丢关键语义。[^5] |
| `skills/figma-to-code/scripts/validate.mjs` | 从 text-style 校验升级到 geometry/color/image/vector/component-aware 校验，或至少与 screenshot diff 结果统一汇总。[^19] |
| `skills/figma-to-code/README.md` | 把“支持设计 token / variables / styles”的说法改成与真实 query 能力一致；补充 mode-aware / library / multi-select asset 语义说明。[^1] |
| `skills/figma-to-code/SKILL.md` | 把 Agent workflow 升级为面向新 query 面的分层读取协议，明确何时查 variables/styles/components/css，避免一律走 subtree。[^18] |
| `skills/figma-to-code/references/*` | 更新 coding guide 和 acceptance 文档，让 token/style/component 语义进入实现准则和验收清单。[^18] |

---

## 7. 风险、未知点、建议做的 spike

### 风险

1. **已确认事实**：Figma 官方建议新插件使用 `documentAccess: "dynamic-page"`；当前 manifest 缺失该字段。[^21]
   - **推断**：一旦迁移，现有“直接 `getNodeByIdAsync` + 默认整文件加载”的隐性假设会被打破，需要补页加载策略。[^20][^21]

2. **已确认事实**：`TeamLibrary` 需要 manifest 权限，而且变量库必须由用户在 UI 里先启用，Plugin API 不能代替用户启用。[^11][^14][^21]
   - **推断**：library token 能力适合作为增强项，不适合作为主链路硬依赖。

3. **已确认事实**：Dev Mode `codegen` 的 `generate` 回调有超时约束，且 `showUI` 不能在 generate callback 内调用。[^16][^17]
   - **推断**：如果未来做 dual-path，必须把 extractor core 做轻量化与缓存化，否则很容易超时。

4. **已确认事实**：当前 asset export 里多个导出失败路径被静默吞掉。[^4]
   - **推断**：一旦开始依赖更复杂的 vector/image/export 策略，silent failure 会直接降低 Agent 的判断质量。

### 建议做的 spike

#### Spike 1：`getCSSAsync()` 的实用价值评估

- 目标：确认它对 HTML/CSS/Tailwind 生成究竟是“高价值辅助”还是“噪声源”。  
- 验证点：与现有 `mapLayout/mapStyle` 的差异、可解释性、跨节点一致性、token 对齐能力。[^15]

#### Spike 2：mode-aware token schema

- 目标：设计 `variables.collections/items/resolved/bindings` 的最终输出结构。  
- 验证点：`resolveForConsumer`、`resolvedVariableModes`、alias chain、extended collection、codeSyntax。[^7][^8][^9][^10]

#### Spike 3：多选导出语义

- 目标：决定多选时资产和截图到底是按 union、按每节点，还是按 primary。  
- 验证点：缓存命名、文件数量、Agent 消费体验、golden HTML 工作流一致性。[^4]

#### Spike 4：index-first query

- 目标：验证 `index.json + subtree shard` 是否显著降低 query latency 和 Agent token 消耗。  
- 验证点：大文件 parse 时间、重复查询命中率、CLI 简洁度。[^2][^5]

#### Spike 5：dynamic-page 迁移

- 目标：确认在真实大文件中，迁移到 `dynamic-page` 后如何安全支持 URL 节点定位。  
- 验证点：页加载策略、`loadAsync()` / `loadAllPagesAsync()` 取舍、错误提示。[^20][^21]

---

## Confidence Assessment

- **高信心**：当前实现链路、缓存与协议行为；变量/文本/组件/导出/遍历/Dev Mode 相关官方 API 是否存在；multi-select 资产语义缺陷；query 和 validate 的边界。[^2][^3][^4][^5][^19]
- **中信心**：`getCSSAsync()` 在实际代码生成中的收益上限、dynamic-page 迁移后的最佳页加载策略、TeamLibrary 在真实组织内的可用性摩擦。
- **低信心 / 待验证**：如果未来引入 dual-path，两个插件（Design / Dev）是否应该共享单一 manifest 还是分离发布；这是产品/分发策略问题，不是 API 能力问题。

---

## Footnotes

[^1]: `/Users/juzixin/CODE_OTHER/kw-skills/skills/figma-to-code/README.md:7-16`, `:71-103`, `:105-147`
[^2]: `/Users/juzixin/CODE_OTHER/kw-skills/skills/figma-to-code/bridge.mjs:11-18`, `:47-76`, `:80-125`, `:127-175`, `:238-366`, `:370-418`
[^3]: `/Users/juzixin/CODE_OTHER/kw-skills/skills/figma-to-code/plugin/ui.html:25-31`, `:65-145`
[^4]: `/Users/juzixin/CODE_OTHER/kw-skills/skills/figma-to-code/plugin/code.js:96-120`, `:177-209`, `:216-233`, `:247-379`, `:385-455`, `:469-523`, `:558-599`, `:605-647`, `:694-804`, `:820-924`, `:930-1005`
[^5]: `/Users/juzixin/CODE_OTHER/kw-skills/skills/figma-to-code/scripts/query.mjs:7-170`, `:173-236`, `:291-321`, `:359-446`, `:481-574`
[^6]: Figma Plugin API reference: <https://developers.figma.com/docs/plugins/api/api-reference/>
[^7]: `boundVariables` / `inferredVariables` / `resolvedVariableModes` / `explicitVariableModes` on scene nodes: <https://developers.figma.com/docs/plugins/api/FrameNode/>
[^8]: Variables API: <https://developers.figma.com/docs/plugins/api/figma-variables/>
[^9]: Variable object (`valuesByMode`, `resolveForConsumer`, `codeSyntax`, `scopes`): <https://developers.figma.com/docs/plugins/api/Variable/>
[^10]: Variable collection (`modes`, `defaultModeId`, `extend`): <https://developers.figma.com/docs/plugins/api/VariableCollection/>
[^11]: Working with variables guide: <https://developers.figma.com/docs/plugins/working-with-variables/>
[^12]: PaintStyle: <https://developers.figma.com/docs/plugins/api/PaintStyle/>
[^13]: TextStyle: <https://developers.figma.com/docs/plugins/api/TextStyle/>
[^14]: TeamLibrary API: <https://developers.figma.com/docs/plugins/api/figma-teamlibrary/> and <https://developers.figma.com/docs/plugins/api/properties/figma-teamlibrary-getavailablelibraryvariablecollectionsasync/>
[^15]: `getCSSAsync()` and `isAsset` on scene nodes: <https://developers.figma.com/docs/plugins/api/FrameNode/>
[^16]: Codegen overview: <https://developers.figma.com/docs/plugins/api/figma-codegen/> and <https://developers.figma.com/docs/plugins/codegen-plugins/>
[^17]: Dev Mode constraints and capabilities: <https://developers.figma.com/docs/plugins/working-in-dev-mode/> and <https://developers.figma.com/docs/plugins/api/properties/figma-codegen-on/>
[^18]: `/Users/juzixin/CODE_OTHER/kw-skills/skills/figma-to-code/SKILL.md:14-29`, `:56-111`, `:121-166`, `:169-276`, `:339-409`
[^19]: `/Users/juzixin/CODE_OTHER/kw-skills/skills/figma-to-code/scripts/validate.mjs:21-44`, `:95-223`, `:225-314`, `:316-381`, `:425-503`
[^20]: Accessing the document / page loading guidance: <https://developers.figma.com/docs/plugins/accessing-document/>
[^21]: Manifest spec (`documentAccess`, `networkAccess`, `permissions`, `capabilities`): <https://developers.figma.com/docs/plugins/manifest/> and `/Users/juzixin/CODE_OTHER/kw-skills/skills/figma-to-code/plugin/manifest.json:1-13`
[^22]: `getStyledTextSegments` supported fields: <https://developers.figma.com/docs/plugins/api/properties/TextNode-getstyledtextsegments/>
[^23]: Text node and font-loading behavior: <https://developers.figma.com/docs/plugins/api/TextNode/> and <https://developers.figma.com/docs/plugins/working-with-text/>
[^24]: ComponentNode: <https://developers.figma.com/docs/plugins/api/ComponentNode/>
[^25]: ComponentSetNode: <https://developers.figma.com/docs/plugins/api/ComponentSetNode/>
[^26]: InstanceNode: <https://developers.figma.com/docs/plugins/api/InstanceNode/>
[^27]: `exportAsync()` and supported export signatures: <https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/>
[^28]: Paint and image semantics: <https://developers.figma.com/docs/plugins/api/Paint/> and <https://developers.figma.com/docs/plugins/working-with-images/>
[^29]: `findAllWithCriteria`: <https://developers.figma.com/docs/plugins/api/properties/nodes-findallwithcriteria/>
[^30]: `figma.skipInvisibleInstanceChildren`: <https://developers.figma.com/docs/plugins/api/properties/figma-skipinvisibleinstancechildren/>
[^31]: `figma.showUI`: <https://developers.figma.com/docs/plugins/api/properties/figma-showui/>
[^32]: `figma.ui.postMessage`: <https://developers.figma.com/docs/plugins/api/properties/figma-ui-postmessage/>
[^33]: `/Users/juzixin/CODE_OTHER/kw-skills/skills/figma-to-code/plugin/manifest.json:7-12` and manifest `networkAccess` rules: <https://developers.figma.com/docs/plugins/manifest/>
[^34]: Codegen callback timeout and UI restrictions: <https://developers.figma.com/docs/plugins/api/properties/figma-codegen-on/> and <https://developers.figma.com/docs/plugins/codegen-plugins/>
