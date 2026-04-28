# figma-react-restore Docs

`figma-react-restore` 是一个全新 skill，用于让 Agent 在已有 React 类项目中还原 Figma 页面。它不兼容旧 `figma-to-code`，也不复用旧命令面。

## 文档结构

1. `design.md`
   - 产品与架构设计。
   - 说明这个 skill 解决什么问题、不解决什么问题、V1 边界和 token 策略。

2. `v1-implementation-spec.md`
   - 编码前冻结规格。
   - 说明 V1 要实现的命令、模块、schema、artifact、runtime API、plugin 协议、测试和验收标准。

3. `figma-plugin-validation.md`
   - Figma 官方文档能力核对。
   - 说明 development plugin、manifest、network access、UI 通信、selection 读取、`exportAsync` 和非付费边界。

## 冻结决策

- Skill 名称：`figma-react-restore`。
- Artifact root：目标 React project root 下的 `.figma-react-restore/`；`doctor` 不创建该目录，`service start/dev` 在创建前校验 project root。
- 语言：TypeScript。
- Runtime：Node.js 执行构建产物。
- Service：Hono + `@hono/node-server`。
- 常驻服务数量：1 个 runtime service。
- Agent 默认读取：`agent-brief.json` 和 `text-manifest.json`；按需读取完整 report / repair-plan / DesignIR。
- Bun binary：后续分发优化，不作为 V1 前提。
- 目标项目：已有 React 类项目。
- V1 不内置完整 codegen；Agent 根据 `repair-plan.json` 修改 React 代码。
