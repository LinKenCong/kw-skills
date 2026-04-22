# figma-to-code Research Backlog

## 目标

本文件只保留仍有后续价值、但尚未进入当前稳定能力面的研究结论。已经变成当前实现事实的内容，不再重复记录。

## 进入下一轮之前的总原则

- 新能力必须继续走 capability-first 暴露方式。
- 不允许因为研究新 API，就把插件退化成 raw API executor。
- mutation 相关 API 即使可用，也不自动进入稳定能力面。
- `getCSSAsync()`、Team Library、Variables 等高级能力，只有在边界和可用性被验证后才能提升为稳定对外能力。

## 高价值后续方向

### 1. Mode-aware variables and token graph

当前稳定能力只覆盖了变量提取和基础查询，还没有形成完整 token graph。

下一轮最有价值的补充点：
- local variable collections
- collection modes / default mode
- alias resolution
- `resolveForConsumer(...)`
- `codeSyntax`
- `scopes`
- typography variable bindings

价值：
- 让 token 输出从“扁平定义”升级为“可用于代码消费的 mode-aware graph”
- 降低 Web token 命名和平台映射的猜测成本

### 2. Style definitions and style consumers

当前还缺：
- style definition 自身的结构化提取
- style folder / grouping 信息
- style consumer 关系

价值：
- 避免只暴露 `styleId` 却缺失样式定义
- 让样式级别的复用关系可查询、可分析

### 3. CSS hints as an auxiliary channel

`getCSSAsync()` 仍值得继续研究，但只能作为辅助通道。

应继续验证的问题：
- 在真实文件中的可用率
- 对复杂节点的实际帮助程度
- 和结构化抽取结果之间的差异与冲突

边界：
- 不把 CSS hint 变成唯一事实来源
- 不因为 CSS 可拿到，就跳过结构和资源面

### 4. Bundle scale and query performance

当前 bundle 聚合查询已经对 `pages` / `screenshots` / `regions` / `variables` / `components` / `css` 建立了 index-first 路径，但结构查询仍有读放大。

可继续研究的方向：
- subtree shards
- page / node index 的进一步细化
- 大 bundle 下的读取性能
- Agent token 消耗控制

价值：
- 继续降低 tree / subtree / node 类查询在大文件、多页 bundle 下的读放大
- 减少 query latency 和重复解析成本

### 5. Dynamic-page and page loading strategy

虽然已经接入 `documentAccess: dynamic-page`，但更完整的问题还没完全结束：

- URL / nodeId 定位时的页加载策略
- `loadAsync()` 与更广范围加载的边界
- 多页面 bundle 在大文件中的稳定性

价值：
- 降低大文件代价
- 让 bundle 工作流在真实复杂文件中更可预测

### 6. Component semantics

当前组件能力还是偏“可识别”，不是“可消费语义”。

可继续研究：
- component property definitions
- instance property values
- main component mapping
- variants / component sets
- override and exposed instance signals

价值：
- 提升组件级还原与组件库对齐能力

### 7. Team library read-only discovery

若未来要扩 token / style 生态，还需要单独研究只读 library 能力：

- published variables
- remote collection metadata
- import boundary
- 权限与组织摩擦

注意：
- 这类能力即使进入实现，也应先作为显式 capability，而不是隐式增强。

## 当前不建议优先推进的方向

以下方向暂不应抢占主线：

- 把当前插件直接改造成 Dev Mode codegen-only 插件
- 稳定 mutation API
- 任意官方 API 透传
- 在没有验证数据面的情况下先重做大规模 codegen 流程

## 何时把研究项提升为稳定能力

至少满足以下条件：

- 有清晰 capability 名称、输入、输出和失败语义
- 已补自动化测试
- 已完成真实 Figma Desktop live 验证
- 不破坏当前 Bridge-first 主线
- 不扩大到 raw API executor 模式
