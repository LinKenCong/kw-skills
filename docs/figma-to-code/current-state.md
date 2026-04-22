# figma-to-code Current State

## 目标

本文件只描述当前仍有效的实现状态，不记录已经完成的过程管理信息，也不保留已被否决的方案。

## 当前主线

- 继续采用 `Bridge-first / Scheme B / capability-driven`。
- 对外通过 capability registry 暴露稳定能力，不通过“猜测底层 Figma API”工作。
- 保留 Design-mode 插件 + localhost bridge + CLI/query 的三层结构。
- 不把插件升级成任意 raw Figma Plugin API 执行器。
- mutation 能力不进入稳定对外面。

## 当前稳定能力

当前稳定能力与 `plugin/capabilities.json` 一致，主要包括：

- `bridge.health`
- `extract.node`
- `extract.selection`
- `extract.pages`
- `extract-selected-pages-bundle`
- `query.capabilities`
- `query.pages`
- `query.screenshots`
- `query.regions`
- `query.variables`
- `query.components`
- `query.css`

这些能力的稳定调用方式和参数约束，统一以：
- `skills/figma-to-code/plugin/API_CAPABILITIES.md`
- `skills/figma-to-code/plugin/capabilities.json`

为准。

## 当前产物模型

### Legacy extraction cache

适用于单节点或当前选区提取。

关键事实：
- `extract` / `extract-selection` 继续落到 legacy-compatible cache。
- 当启用节点级导出时，资源按 `nodes/<nodeId>/...` 组织。
- 节点目录下会按需包含：
  - `screenshot.png`
  - `exports/` 中的 root SVG / PNG
  - `assets/` 中的图片填充和矢量资源

### Bundle cache

适用于 `extract-pages` 和 `extract-selected-pages-bundle`。

关键事实：
- bundle 是 page-aware 的聚合产物，不再是假设单页单选区。
- page 目录由 bridge 生成稳定目录名；消费方不应假设 raw `pageId` 可直接用于路径拼接。
- 页面内仍可包含 node-scoped 目录，用于保存页面下各节点的直接导出资源。
- 应优先用 `query pages`、`query screenshots`、`query regions` 和 bundle metadata 访问这些内容，而不是手写路径推导。

## 已确认的关键设计决策

### 1. 截图主线改为 direct export，不再采用 crop 路线

已被保留的方案：
- 单节点截图直接由 Figma 导出。
- 多节点场景对每个节点分别导出截图。

已被否决的方案：
- 先导出 page screenshot 或 selection-union screenshot，再裁剪出节点截图。

否决原因：
- 真实 Figma Desktop 验证中，裁剪产物清晰度不足，不满足后续还原与视觉对比要求。

### 2. 多节点资源按 node-scoped 目录组织

原因：
- 多节点输出如果共用平铺目录，后续消费和校验都容易混淆资源归属。
- node-scoped 目录更适合保存截图、SVG、PNG、图片填充、矢量资源等完整节点包。

### 3. 资源格式优先同时保留 SVG 与 PNG

当前原则：
- 能导出 SVG 的资源，优先同时保留 SVG 和 PNG。
- 视觉对比仍优先使用 PNG。
- SVG 的价值主要是保真和后续代码消费，不应把它误当成现成的视觉 diff 输入。

### 4. `query.css` 是辅助面，不是主抽取面

`query.css` 的定位仍是辅助提示：
- 可以作为 DOM/CSS 实现时的参考信号。
- 不能替代结构、变量、组件、资源和截图这些主数据面。
- 不能假设所有场景都一定可用。

## 当前非目标

以下内容不属于本轮稳定范围：

- 任意官方 Plugin API 透传
- 稳定 mutation API
- Dev Mode codegen-only 架构替换主链路
- 未经 capability 声明的隐式行为

## 当前仍成立的实现限制

- query 主要仍基于已有 cache 文件做读取与裁剪，不是 index-first / shard-first 设计。
- style definition、mode-aware token graph、team library token 等更高层语义仍未进入稳定能力面。
- 真正的“产品级完全可用”判断仍取决于更完整的真实 Figma Desktop live 验证，而不只取决于自动化测试。
