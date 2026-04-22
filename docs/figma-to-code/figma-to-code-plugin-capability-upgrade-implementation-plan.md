# figma-to-code 插件对外能力增强 Implementation Plan

> For Hermes: 按阶段实现，不切到 Dev Mode/codegen-only，不开放任意 raw API executor。

Goal: 把 `skills/figma-to-code` 升级为 capability-driven 的 page-aware bundle extractor，使 Agent 可发现并调用稳定能力面（pages / screenshots / regions / capabilities 等），同时保留 Bridge-first 架构与现有单节点工作流兼容性。

Architecture:
1. 保持 `plugin → bridge → CLI/query` 三层结构不变；新增 capability registry 与 bundle cache，而不是重写为新架构。
2. Bridge 同时支持 legacy extraction cache 与 new bundle cache；Query 同时兼容两类输入。
3. Plugin 只暴露白名单能力，不做任意官方 API 透传；官方 API 通过 capability 文档明确映射。

Tech Stack: 现有 Node.js ESM、Figma Plugin API、内置 `node:test`、README/SKILL/plugin docs。

---

## 计划分解

### Task 1: 建立测试骨架与静态能力数据源
Objective: 为后续对外能力扩展建立最小测试入口与单一能力清单来源。

Files:
- Modify: `skills/figma-to-code/package.json`
- Create: `skills/figma-to-code/plugin/capabilities.json`
- Create: `skills/figma-to-code/tests/query.test.mjs`
- Create: `skills/figma-to-code/tests/fixtures/legacy-extraction/extraction.json`
- Create: `skills/figma-to-code/tests/fixtures/bundle-cache/...`

Verification:
- `node --test skills/figma-to-code/tests/*.test.mjs` 初始失败（缺少新 query/capability 支持）

### Task 2: 扩展 query 为 capability/bundle aware
Objective: 让 query 可以消费 legacy extraction 与 bundle cache 两种结构，并新增对外查询面。

Files:
- Modify: `skills/figma-to-code/scripts/query.mjs`
- Optional Create: `skills/figma-to-code/scripts/lib/cache_readers.mjs`（若需要拆分）

Required features:
- `query capabilities`
- `query pages`
- `query screenshots`
- `query regions`
- `query variables`
- `query components`
- `query css`
- 向后兼容 `tree/node/subtree/text/palette`

Verification:
- fixtures 上所有 query 测试通过

### Task 3: 扩 bridge/CLI 协议与 cache writer
Objective: 新增 extraction job 类型与 bundle cache 写入能力，并提供 CLI 调用入口。

Files:
- Modify: `skills/figma-to-code/bridge.mjs`
- Modify: `skills/figma-to-code/scripts/bridge_client.mjs`

Required features:
- `/capabilities`
- `/extract-pages`
- `/extract-selected-pages-bundle`
- bundle cache writer
- screenshot/region/index writer
- CLI `capabilities` / `extract-pages` / `extract-selected-pages-bundle`

Verification:
- Node 单测覆盖 helper / smoke check CLI usage 输出

### Task 4: 扩 plugin 运行时能力
Objective: 在 plugin 内真正支持 page-aware target resolution、bundle extraction、截图/region 产物生成。

Files:
- Modify: `skills/figma-to-code/plugin/code.js`
- Modify: `skills/figma-to-code/plugin/ui.html`
- Modify: `skills/figma-to-code/plugin/manifest.json`

Required features:
- `documentAccess: dynamic-page`
- `resolveTargets` / `extract-pages` / `extract-selected-pages-bundle`
- page screenshot
- selection-union / node screenshot 策略
- `regions.level1/level2`
- capability-aware status/result payloads

Verification:
- 语法检查通过
- UI 支持新 SSE event
- Bridge 协议字段对齐

### Task 5: 文档和 workflow 升级
Objective: 把能力面显式化，让 Agent 以后不必猜。

Files:
- Create: `skills/figma-to-code/plugin/API_CAPABILITIES.md`
- Modify/Create: `skills/figma-to-code/plugin/capabilities.json`
- Modify: `skills/figma-to-code/README.md`
- Modify: `skills/figma-to-code/SKILL.md`

Required features:
- capability 列表
- 输入输出 schema
- 官方 API 映射
- CLI/Bridge/query 调用方式
- fallback / limitations / mode constraints

### Task 6: 最终验证
Objective: 用自动化和人工自检确认外部能力面可用且文档一致。

Verification commands:
- `node --test skills/figma-to-code/tests/*.test.mjs`
- `node skills/figma-to-code/scripts/bridge_client.mjs capabilities`
- `node skills/figma-to-code/scripts/query.mjs capabilities --cache <fixture-or-real-cache>` 或等价入口
- `git diff --stat`

Acceptance:
- 能列出 capability registry
- 能通过 CLI 触发新增 extraction 命令
- 能查询 bundle 的 pages/screenshots/regions
- 文档与实现字段一致
