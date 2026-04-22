# figma-to-code 前端还原能力升级方向

更新日期：2026-04-21 18:38:40 CST

## 1. 文档目标

这份文档不直接写代码，而是明确 `skills/figma-to-code` 下一阶段应如何升级，目标是让它更稳定地把 Figma 设计稿还原为前端代码，并且让“提取 → 基线截图 → 分区对比 → 代码收敛”的链路更适合 AI Agent 持续消费。

本轮重点不是泛泛增强插件能力，而是围绕以下目标收敛：

1. 更好支持用户选择元素/选区的提取。
2. 支持一个页面、多个页面、多个元素的批量提取与组织。
3. 为每个页面生成可用于后续前端对比的截图基线。
4. 把视觉比对从“整页一次 diff”升级为“分层、分区、可定位问题”的验证链路。
5. 借鉴现有相似 skill 的高价值思路，但不盲目照搬其架构。

结论先行：
- 主线仍应是 `Bridge-first`，不要急着改成 Dev Mode/codegen-only。
- 下一阶段最值得做的是“多页面/多选区 bundle 提取 + 页面级截图基线 + 层级化区域 diff + 路由升级策略”。
- 当前 skill 已经可用，但还不够像“还原系统”；更像“单次提取器 + 简化 query + 基础视觉校验器”。

---

## 2. 本轮输入与依据

本文件综合了以下来源：

1. 当前本地实现：
   - `skills/figma-to-code/SKILL.md`
   - `skills/figma-to-code/README.md`
   - `skills/figma-to-code/plugin/code.js`
   - `skills/figma-to-code/plugin/ui.html`
   - `skills/figma-to-code/plugin/manifest.json`
   - `skills/figma-to-code/bridge.mjs`
   - `skills/figma-to-code/scripts/query.mjs`
   - `skills/figma-to-code/scripts/visual-diff.mjs`
   - `skills/figma-to-code/scripts/validate.mjs`

2. 已有研究报告：
   - `docs/figma-to-code-capability-upgrade-report.md`
   - `figma-to-code-audit.md`
   - `figma-api-research-findings.md`

3. 官方 Figma Plugin API 文档（本轮实际核查的关键点）：
   - API Reference: `https://developers.figma.com/docs/plugins/api/api-reference/`
   - `PageNode.selection`
   - `figma.currentPage`
   - `exportAsync`
   - `getStyledTextSegments`
   - `findAllWithCriteria`
   - `figma.skipInvisibleInstanceChildren`
   - `Variable`
   - `figma.teamLibrary`
   - `getCSSAsync`

4. 可借鉴的相似 skill：
   - `https://github.com/About-JayX/figma-skills`
   - 重点借鉴其 README / SKILL 中的“baseline-first / replay-first / route escalation / scorecard-driven verification”思路。

---

## 3. 当前实现的关键事实

### 3.1 已有能力

当前 `figma-to-code` 已具备：

1. 本地 Plugin + Bridge + CLI 架构。
2. 单节点提取与当前页多选提取。
3. 基础布局、样式、文本、变量别名、组件基础语义提取。
4. 资产导出（SVG/PNG、图片填充、矢量 SVG）。
5. 基础截图导出。
6. `tree / subtree / text / palette` 级别的裁剪查询。
7. `visual-diff` 的区域 diff 基础能力。
8. `validate` 的文本/样式比对能力。

### 3.2 当前最重要的限制

1. `extract-selection` 只读取 `figma.currentPage.selection`，因此当前实现本质上仍是“当前页选区提取”。
2. 多选虽然会生成 `VIRTUAL_GROUP` 根，但截图与资产导出仍锚定到 `selection[0]`，这会导致多选场景下基线不完整。
3. 截图策略偏“单张截图”，还没有“每个页面一张、每个区域一组、每个选中节点可追踪”的产物组织。
4. `query` 还不够面向还原任务，缺少 `pages / regions / variables / styles / components / css / screenshots` 这些 Agent 真正需要的查询面。
5. `visual-diff` 已支持 regions，但当前工作流只把它当成阶段性辅助，还没升级成主诊断系统。
6. `validate` 更像文本样式对比器，不是“设计稿还原验收器”。

### 3.3 官方 API 给出的关键升级空间

本轮核查后，可以明确依赖的高价值 API/能力包括：

1. `PageNode.selection`
   - 官方说明：每个页面独立保存自己的 selection。
   - 这意味着未来可以做“跨页面 selection bundle”，而不是只能看当前页面。

2. `figma.root` + `figma.currentPage`
   - `figma.root` 可访问整个文档，children 为所有 `PageNode`。
   - 这意味着插件不必被限制在单页面工作流里。

3. `exportAsync`
   - 官方说明支持 `PageNode`。
   - 这意味着“每个页面一张 page screenshot”是可行方向，不需要继续只依赖“最近 FRAME/COMPONENT 父级截图”。

4. `getStyledTextSegments`
   - 可提取更完整的混排/段落/列表/超链接/变量绑定信息。
   - 这对高保真文本还原很关键。

5. `findAllWithCriteria` + `figma.skipInvisibleInstanceChildren`
   - 官方明确说明在大文件中可大幅提升遍历性能。
   - 这对页面级/多页面提取是必要前提。

6. `getCSSAsync`
   - 适合做 inspect-style 的 CSS hint / debug / cross-check。
   - 但不应替代结构化 schema 本身。

7. `Variable` / `VariableCollection` / `figma.teamLibrary`
   - 变量和 design token 还可以进一步提升，但这不是本轮最优先的用户可感知改造点。

---

## 4. 用户目标翻译为产品需求

基于你的描述，本轮升级不应只写成“增强提取器”，而应定义成以下产品能力：

### P0 目标

1. 用户选中一个页面或一个页面中的关键 frame/section，skill 能完整提取。
2. 用户在一个页面中多选多个元素，skill 能完整提取，并给出 union screenshot + per-node screenshot。
3. 用户在多个页面分别保留 selection，skill 能批量读取这些页面的 selection，并以 bundle 方式输出。
4. 每个页面都生成独立截图，便于后续与前端实现对比。
5. 验证阶段不仅有整页 diff，还能细到 section/region 级别。

### P1 目标

1. 对于复杂页面，skill 能自动拆分比对区域，而不只是让 Agent 人工猜测哪里出问题。
2. 对于复杂节点，skill 能决定是否继续 DOM 还原，还是升级到 `SVG island / Canvas island / Raster lock`。
3. 对于长页面，支持“先 page-level，再 top sections，再局部子树”的分层诊断。

### P2 目标

1. 将变量、样式、组件语义与视觉对比链路更深结合。
2. 将还原过程变成“机械基线 → 定向修复 → 证据化验收”的闭环，而不是一次性代码生成。

---

## 5. 核心判断：主线应升级成什么

推荐的主线不是“更强 codegen”，而是：

`Figma bundle extractor + screenshot baseline pack + hierarchical diff + route escalation`

也就是说，下一阶段最重要的不是让模型一开始就产出更聪明的 React，而是让它先拥有：

1. 更完整的提取产物；
2. 更稳定的页面级/区域级截图；
3. 更好定位问题的 diff 证据；
4. 更清晰的何时锁定视觉、何时继续 DOM 化的决策规则。

这与 About-JayX/figma-skills 最值得借鉴的部分是一致的：
- baseline first
- replay first
- verify before claiming fidelity
- 对 hard node 做 route escalation

但我们不应直接照搬它的整套工程。原因是：
- 它更强调“先机械产出再收敛”的完整 pipeline 仓库；
- 当前 `kw-skills/skills/figma-to-code` 仍是 skill + plugin + bridge 工具链；
- 我们应先把提取/截图/验证面做扎实，再决定是否引入更重的 pipeline 化生成器。

结论：
优先升级“数据、截图、验证、路由”，而不是优先升级“语义化 React 美化”。

---

## 6. 推荐目标架构

## 6.1 从单次 extraction 升级为 bundle extraction

当前输出更像：
- 一个 `extraction.json`
- 若干 assets
- 一张 `screenshot.png`

建议升级为 bundle 产物：

```text
cache/<bundleId>/
  bundle.json
  pages/
    <pageId>/
      page.json
      extraction.json
      regions.level1.json
      regions.level2.json
      screenshots/
        page.png
        selection-union.png
        annotated-selection.png
        nodes/
          <nodeId>.png
      assets/
        ...
  indexes/
    pages.json
    nodes.json
    screenshots.json
    regions.json
```

### 为什么要改成 bundle

1. 一个还原任务往往不是一个 node，而是一个页面或多个页面。
2. 后续视觉对比天然是按 page / region / node 分层的。
3. Agent 后续不应该反复猜“这张截图对应哪个页面/哪个区域”。
4. bundle 更适合缓存、回放、验证和增量更新。

结论：
“page-aware bundle” 比 “single extraction.json” 更适合作为还原工作流的主载体。

---

## 6.2 提取入口应拆成 4 类，而不是继续只靠 `extract-selection`

建议将未来提取入口拆成以下几类：

### A. `extract-selection`
用途：当前页内选中一个或多个节点。

输出重点：
- 当前页 extraction
- `selection-union.png`
- `screenshots/nodes/<nodeId>.png`
- `VIRTUAL_GROUP` root

### B. `extract-pages`
用途：按 pageId/pageName 显式提取一个或多个页面。

输出重点：
- 每页一个 `page.png`
- 每页自己的 extraction
- page-level regions

### C. `extract-selected-pages-bundle`
用途：从整个文档中找出“有 selection 的页面”，把这些页面打成一个 bundle。

这是本轮最值得新增的模式之一。
原因：
- 官方文档明确说每个页面独立保存自己的 `selection`；
- 插件可遍历 `figma.root.children` 中的每个 `PageNode`；
- 这样用户可以在多个页面各自保留 selection，再一键打包提取。

### D. `extract-frame-list`
用途：用户传入多个 frame/section/node ID，按显式清单提取。

适合：
- 多页面 landing page
- 设计系统组件集
- 分区比对任务

结论：
“多页面 bundle” 不应硬塞进当前 `extract-selection`；应该成为独立提取模式。

---

## 6.3 截图应成为一等产物，而不是附带产物

建议把截图体系升级为 4 层：

### 1. Page screenshot
每个页面一张完整截图：`pages/<pageId>/screenshots/page.png`

用途：
- 与最终前端页面做整页回归对比
- 长页面分段裁切的母图
- 对页面级布局问题快速定位

### 2. Selection union screenshot
每个页面中当前选择集合的合并截图：`selection-union.png`

用途：
- 当用户只想还原当前选区，而不是整页时，提供直接基线
- 多选时比“第一节点截图”更符合预期

### 3. Per-node screenshot
每个选中节点一张截图：`screenshots/nodes/<nodeId>.png`

用途：
- 单独分析卡片、hero、button、illustration 等局部
- 后续做局部 route escalation

### 4. Annotated screenshot
额外生成带框选或编号覆盖层的截图：`annotated-selection.png`

用途：
- 让 Agent 和用户更容易确认“哪些区域/元素被纳入当前任务”
- 让分区 diff 和代码实现之间更容易建立映射

结论：
截图不应只是一张 `screenshot.png`，而应是一组带语义的 screenshot pack。

---

## 7. 分区与比对：从整页 diff 升级为层级化验证

你提到“将页面分区做更细节的对比”，这件事应该成为主设计，而不是附属优化。

建议把对比链路升级为 4 层：

### Layer 1: Page-level diff
比较整页截图与前端页面截图。

回答：
- 这个页面整体偏差是否已经可接受？
- 问题主要在顶部、中部、底部哪个区段？

### Layer 2: Top-section diff
从 page extraction 中提取顶层 sections / frames / major blocks，做区域 diff。

回答：
- Hero、pricing、footer、gallery 哪一块最差？
- 是单一区域爆炸，还是整体都漂？

### Layer 3: Nested-region diff
对问题最大的 section 继续向下展开一层或两层子树，生成更细区域 diff。

回答：
- 具体是标题区、按钮区、媒体区、装饰区哪一块不对？

### Layer 4: Semantic checks
结合结构化 extraction 做非像素指标比对：
- text coverage
- font drift
- token drift
- alignment drift
- box size drift
- spacing drift
- asset coverage

回答：
- 这是纯视觉差异，还是布局/token/text 的真实差异？

结论：
后续验证应是“page → section → region → semantic”的层级化诊断，而不是只靠一次 pixelmatch。

---

## 8. 应新增的高价值能力

## 8.1 `query pages`
返回 bundle 中有哪些页面、页面尺寸、截图路径、region 索引。

价值：
让 Agent 先建立页面地图，而不是先读大 JSON。

## 8.2 `query screenshots`
返回所有 page / selection / node 截图及其语义。

价值：
让视觉验证工具和 Agent 不需要猜路径。

## 8.3 `query regions`
支持：
- `--page <pageId>`
- `--depth 1|2|3`
- `--node <nodeId>`

返回：
- 区域名
- 区域 bbox
- 对应 nodeId
- 建议截图路径

价值：
把分区比对变成标准工作流，而不是临时构造 JSON。

## 8.4 `query css`
基于 `getCSSAsync()` 提供 inspect-style 的 CSS hint。

规则：
- 仅作为辅助面
- 不作为结构化 schema 的 source of truth

价值：
当 DOM/CSS 实现出现边界差异时，可快速用官方 inspect CSS 做交叉验证。

## 8.5 `query components` / `query variables` / `query styles`
这三项不是本轮唯一重点，但非常值得同步进入 roadmap。

价值：
- 还原组件页面时能更清晰识别 design-system semantics
- 还原 token-heavy 页面时能减少纯视觉猜测

结论：
下一阶段 query 层必须从“树结构查询器”升级为“还原任务查询面”。

---

## 9. 更好还原设计稿为代码的具体策略

下面是比“多提一点字段”更重要的策略升级。

## 9.1 机械基线优先，而不是直接语义化重构

借鉴相似 skill 的合理部分：
先产出一个可运行、接近 Figma 的“机械基线”，再决定做哪些语义化清理。

原因：
- 先做语义化很容易把视觉结构做丢；
- 先拿到 baseline，后面每一次修改都可以被验证。

建议：
把后续工作流改成：
1. extract bundle
2. 生成 baseline HTML/React
3. page/section/region diff
4. 再做语义化与可维护性改造

## 9.2 引入 route escalation

不是所有 Figma 节点都应该强行翻译成纯 DOM。

建议引入三档路由：

1. `DOM-first`
   - 常规 layout/text/button/form/card
   - 优先可维护性

2. `Hybrid-SVG`
   - 对复杂 icon、复杂 vector、装饰边框、组合图形
   - 保留主要 DOM 结构，但局部锁成 SVG island

3. `Visual-lock`
   - 对复杂滤镜、遮罩、稀有图形、极重装饰层
   - 直接 raster lock 或 image lock

价值：
减少“明明应该锁定视觉，却反复硬调 DOM”的浪费。

## 9.3 引入 replay-first artifacts

即使不完全照搬 About-JayX 的 pipeline，也建议借鉴它的“replay-first”思想。

至少要做到：
- 同一个 bundle 可以重复被 query / diff / codegen / validate 消费
- 截图、区域、节点、资产的路径固定可回放
- Agent 的每轮修复都基于同一份 bundle，而不是重新猜测输入

## 9.4 引入 scorecard，而不是只看 diff 图

建议最终验收至少输出一个 scorecard：
- page mismatch
- worst section mismatch
- worst nested region mismatch
- text coverage
- font match rate
- spacing/alignment drift count
- locked region count
- unresolved issues

价值：
让“这次还原够不够好”变成证据驱动，而不是口头感觉。

---

## 10. 文件级升级方向

这里不写实现代码，只写未来应该在哪些文件落点。

### `skills/figma-to-code/plugin/code.js`
主战场。

建议新增/重构：
1. 多页面 selection bundle 提取
2. page-level extraction
3. page screenshot / selection-union screenshot / per-node screenshot
4. region index 生成
5. `findAllWithCriteria` + `skipInvisibleInstanceChildren`
6. richer text extraction via `getStyledTextSegments`
7. optional CSS hints via `getCSSAsync`

### `skills/figma-to-code/plugin/ui.html`
从“消息中转器”升级为“任务面板”。

建议增加：
1. extraction mode 选择
2. page list / selected pages inspector
3. selection summary
4. progress / logs / retry / cancel
5. screenshot/region generation status

### `skills/figma-to-code/bridge.mjs`
从“单任务接收器”升级为“bundle orchestrator”。

建议增加：
1. bundle manifest
2. per-page output organization
3. screenshot index
4. region index
5. cache versioning
6. structured errors

### `skills/figma-to-code/scripts/query.mjs`
从“单 extraction 的 pruning tool”升级为“bundle query layer”。

建议增加：
- `pages`
- `regions`
- `screenshots`
- `variables`
- `styles`
- `components`
- `css`

### `skills/figma-to-code/scripts/visual-diff.mjs`
从“可选区域 diff”升级为“层级化 diff 引擎”。

建议增加：
1. 接收 page/region manifests
2. 自动递归 worst region
3. 输出热区排行榜
4. 允许 ignore masks / locked regions
5. 输出 scorecard feed

### `skills/figma-to-code/scripts/validate.mjs`
从“文本 style compare”升级为“结构 + 样式 + 局部几何核验器”。

建议增加：
1. 对应 region 级校验
2. 结合 extraction 的 box/alignment checks
3. 与 visual-diff 聚合为统一报告

### `skills/figma-to-code/SKILL.md`
需要更新工作流，不然工具增强了，Agent 还是会错误使用。

必须补上：
1. 何时用 selection extraction
2. 何时用 page bundle extraction
3. 如何消费 screenshots/regions
4. 如何先做 baseline，再做 refactor
5. 如何使用 route escalation

---

## 11. 建议路线图

## Phase 1：让提取结果变得“可用于还原系统”

目标：
补齐多选、多页面、页面截图、区域索引这些基础能力。

建议项：
1. 修复多选截图/资产只跟随 `primaryNode` 的问题。
2. 新增 `page screenshot`。
3. 新增 `selection-union screenshot`。
4. 新增 `per-node screenshot`。
5. 新增 `query pages / screenshots / regions`。
6. 把 page-level 和 top-level section regions 写入 bundle。

验收标准：
- 用户可以提取一个页面，并获得 page screenshot。
- 用户可以在多个页面保留 selection，并打包提取。
- Agent 可以只通过 query 获取页面、截图、区域清单。

## Phase 2：让验证链路成为主闭环

目标：
把验证从辅助脚本升级为主工作流。

建议项：
1. page → section → nested region 分层 diff。
2. 统一输出 scorecard。
3. 增加 alignment/token/text drift 指标。
4. 支持 long page 的分段比对。
5. 支持 ignore masks / locked regions。

验收标准：
- 不只知道“diff 大”，还能知道“哪一页、哪一块、为什么”。
- 每一轮修复都能量化改善。

## Phase 3：让生成策略更聪明，而不是更激进

目标：
让系统知道什么时候继续 DOM，什么时候升级路线。

建议项：
1. 引入 `DOM-first / Hybrid-SVG / Visual-lock` 三档交付模式。
2. 为 hard nodes 做 route escalation。
3. 将 `getCSSAsync()` 作为辅助验证面。
4. 强化组件/变量/样式语义输出，减少设计系统页面的猜测。

验收标准：
- 对复杂节点不再只能“硬写 DOM”。
- 交付方式可解释，可在报告中明确标注 locked regions。

结论：
升级顺序应是“先提取与验证，再增强生成策略”。

---

## 12. 本轮最值得采纳的 10 个具体想法

1. 新增 `extract-selected-pages-bundle`。
2. 每个页面都产出 `page.png`。
3. 每个页面都产出 `selection-union.png`。
4. 每个选中节点都可选地产出单独截图。
5. 自动生成 `regions.level1.json` / `regions.level2.json`。
6. `visual-diff` 从 top-level 扩展到 nested-region diff。
7. 引入 scorecard，避免只看一张 diff 图。
8. 引入 route escalation，而不是强迫全部 DOM 化。
9. 把 `getStyledTextSegments` 用满，提升文本保真度。
10. 把 `findAllWithCriteria + skipInvisibleInstanceChildren` 作为页面级提取的默认性能策略。

---

## 13. 风险与边界

### 风险 1：bundle 膨胀
页面截图、节点截图、区域截图一旦全部打开，产物体积会明显增长。

建议：
- 截图分层开关化
- 默认 page + selection-union
- per-node screenshot 作为可选模式

### 风险 2：多页面 selection UX 不够直观
虽然官方允许每个页面保留各自 selection，但用户未必理解这个能力。

建议：
- 插件 UI 明确展示“哪些页面有 selection”
- bundle 生成前先给 summary

### 风险 3：验证维度变多后，Agent 反而不会用
如果只增强工具，不更新 skill 工作流，Agent 还是会走老路径。

建议：
- `SKILL.md` 同步升级
- 让“baseline-first / region-first / evidence-first”进入 skill 主流程

### 风险 4：过早做大规模 codegen 改造
如果在提取和验证基础设施还不稳时就重做 codegen，收益会被高估。

建议：
- 延后大规模 generator 重写
- 先把输入和验证面变可靠

---

## 14. 推荐的 3 个优先级最高的下一步

### 第一优先：把提取模型升级成 page-aware bundle
原因：
这是承接“一个页面 / 多个页面 / 多个元素”的基础。

### 第二优先：把截图升级成 page + selection-union + per-node 三层
原因：
没有稳定截图基线，后续所有对比都不够强。

### 第三优先：把 `visual-diff` 升级为层级化区域诊断
原因：
这直接决定后续修复效率，也决定 skill 是否真的更适合还原任务。

---

## 15. 最终建议

推荐总体策略：

1. 维持 `Bridge-first` 主线，不切换到 codegen-only 架构。
2. 将 `figma-to-code` 从“单次提取器”升级为“bundle extractor + baseline pack + region diff workflow”。
3. 先解决多页面/多选区/每页截图/层级化 diff，再考虑更激进的代码生成升级。
4. 借鉴相似 skill 的“baseline-first、route escalation、scorecard 驱动”思想，但不要一开始就引入过重的工程结构。

一句话结论：
下一阶段最值得做的不是“让 Agent 更会猜代码”，而是“让它拿到更完整的页面包、截图包和证据化 diff”，这样它才有可能真正更稳定地还原 Figma 设计稿为前端代码。

---

## 参考链接与文件

### 本地文件
- `docs/figma-to-code-capability-upgrade-report.md`
- `figma-to-code-audit.md`
- `figma-api-research-findings.md`
- `skills/figma-to-code/plugin/code.js`
- `skills/figma-to-code/scripts/visual-diff.mjs`
- `skills/figma-to-code/scripts/validate.mjs`
- `skills/figma-to-code/SKILL.md`

### 官方文档
- API Reference: `https://developers.figma.com/docs/plugins/api/api-reference/`
- `PageNode.selection`: `https://developers.figma.com/docs/plugins/api/properties/PageNode-selection/`
- `figma`: `https://developers.figma.com/docs/plugins/api/figma/`
- `exportAsync`: `https://developers.figma.com/docs/plugins/api/node-properties/`
- `getStyledTextSegments`: `https://developers.figma.com/docs/plugins/api/properties/TextNode-getstyledtextsegments/`
- `findAllWithCriteria`: `https://developers.figma.com/docs/plugins/api/properties/nodes-findallwithcriteria/`
- `figma.skipInvisibleInstanceChildren`: `https://developers.figma.com/docs/plugins/api/properties/figma-skipinvisibleinstancechildren/`
- `Variable`: `https://developers.figma.com/docs/plugins/api/Variable/`
- `figma.teamLibrary`: `https://developers.figma.com/docs/plugins/api/figma-teamlibrary/`
- `node-properties` / `getCSSAsync`: `https://developers.figma.com/docs/plugins/api/node-properties/`

### 参考 skill
- `https://github.com/About-JayX/figma-skills`
- `https://raw.githubusercontent.com/About-JayX/figma-skills/main/README.md`
- `https://raw.githubusercontent.com/About-JayX/figma-skills/main/skills/figma/SKILL.md`
