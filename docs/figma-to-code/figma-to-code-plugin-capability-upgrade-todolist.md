# figma-to-code 插件对外能力增强 TODO

更新日期：2026-04-22
状态：进行中
主线：Scheme B / Bridge-first / capability-driven

## 目标

把 `skills/figma-to-code` 从“单次选区提取器”升级成“面向 Agent 的 page-aware bundle extractor + capability surface”，让 AI 可以按需发现并调用稳定能力，而不是依赖隐式工作流或直接猜底层 Figma API。

## 范围边界

本轮做：
- page-aware / bundle-aware extraction 能力
- plugin → bridge → CLI/query 的对外能力扩展
- capability registry（人类文档 + machine-readable JSON）
- per-page / selection / node 级截图产物组织
- pages / screenshots / regions / capabilities 等查询面
- README / SKILL 工作流升级

本轮不做：
- 全量官方 Plugin API 任意透传
- 默认开放 mutation API
- 直接重写成 Dev Mode / codegen-only 架构
- 复杂的增量提取 / delta cache / remote file access

## 验收标准

### P0 必须完成
- [ ] Bridge 支持新的 extraction job 类型
- [ ] Plugin 支持 `extract-pages`
- [ ] Plugin 支持 `extract-selected-pages-bundle`
- [ ] `extract-selection` 在多选时不再只锚定 `selection[0]` 的截图语义
- [ ] cache 中支持 bundle 输出（至少包含 `bundle.json`、`pages.json`、`screenshots`、`regions`）
- [ ] CLI/query 能读取 `pages` / `screenshots` / `regions` / `capabilities`
- [ ] `plugin/API_CAPABILITIES.md` 写清楚支持能力、输入输出、官方 API 映射、调用方式
- [ ] `plugin/capabilities.json` 可被脚本稳定消费
- [ ] README / SKILL 更新为 capability-first 工作流

### P1 高价值增强
- [ ] page screenshot
- [ ] selection-union screenshot（若插件内直接导出不稳，则先通过 page screenshot + crop 路线落地）
- [ ] per-node screenshots（按需开关）
- [ ] `regions.level1.json`
- [ ] `regions.level2.json`
- [ ] query 支持 `variables` / `components` / `css`（至少能返回可用/不可用状态与原因）

### P2 可延后但应留接口
- [ ] team library 能力声明
- [ ] capability status 标记（stable / experimental / deprecated）
- [ ] scorecard/report feed
- [ ] route hints（DOM-first / Hybrid-SVG / Visual-lock）

## 实施步骤

### 1. 设计与基线
- [ ] 固化 bundle schema
- [ ] 固化 capability registry schema
- [ ] 写 implementation/todolist 文档
- [ ] 建立最小单元测试骨架

### 2. 对外协议扩展
- [ ] Bridge 新增 endpoint / SSE event / result writer
- [ ] CLI 新增命令与 flags
- [ ] UI 支持新 job type 转发

### 3. Plugin extraction 升级
- [ ] page 目标解析
- [ ] selected-pages bundle 解析
- [ ] page extraction
- [ ] region manifest 生成
- [ ] screenshot manifest 生成
- [ ] per-node / per-page 导出策略

### 4. Query 面升级
- [ ] `query capabilities`
- [ ] `query pages`
- [ ] `query screenshots`
- [ ] `query regions`
- [ ] `query variables`
- [ ] `query components`
- [ ] `query css`

### 5. 文档与 workflow
- [ ] `plugin/API_CAPABILITIES.md`
- [ ] `plugin/capabilities.json`
- [ ] README 更新
- [ ] SKILL 更新

### 6. 验证
- [ ] 新增 Node 单元测试并跑通
- [ ] 关键脚本 smoke test
- [ ] git diff 自检

## 风险提醒
- 多页面 selection 的用户心智成本较高，需要在文档中明确说明
- `getCSSAsync()` 可能受模式限制，不能假设任意场景都可用
- Figma plugin main runtime 不适合做“任意 raw API executor”，需坚持 capability 白名单
- screenshot 产物过多会膨胀，默认策略必须保守

## 当前执行顺序
1. 先补计划/TODO与测试骨架
2. 再扩 bridge/CLI/query 对外面
3. 再扩 plugin bundle/page 能力
4. 最后补文档和验收
