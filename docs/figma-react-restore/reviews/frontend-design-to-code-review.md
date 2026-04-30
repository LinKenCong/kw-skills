# figma-react-restore 设计稿转前端代码阶段评审

## Executive Summary

`figma-react-restore` 的定位不是完整 Figma-to-React codegen，而是“已有 React 路由的证据驱动还原/修复闭环”。从资深前端开发/前端架构角度看，它在防止 AI 纯截图猜测、保障文本准确性、限制大图作弊、控制上下文读取和建立验证闭环方面明显优于普通视觉还原提示词。

核心优势是流程闭环清楚：Figma selection -> extraction artifacts -> minimal DesignIR / text manifest / fidelity spec -> browser capture -> diff/report -> repair plan -> agent brief -> Agent patch -> rerun。`SKILL.md` 也把关键不变量前置，尤其是精确文本、引用资产禁用、同一 project artifact root、blocked stop condition 等规则。

主要问题集中在“从设计证据转成可维护 React/CSS”的中间层仍偏薄：当前证据和 verifier 更擅长发现差异，而不够擅长指导首次实现和结构化布局决策。布局 IR 只有较少 auto-layout 参数，route state / wrong-state 诊断不足，responsive 基本停留在提示词层面，DOM 映射在提示中是“where practical”但验证逻辑近似强制所有 region 都映射，资产策略也可能与项目现有 icon/component 体系冲突。

因此，本 skill 对“已有页面高保真修复”是更好的基础设施；对“设计稿转前端代码”完整生产链路，目前还需要补足 design-to-code implementation brief、layout constraints、responsive matrix、source ownership 和更细粒度的 repair guidance。

## Strengths

1. **证据驱动优先级正确**  
   `SKILL.md` 明确要求优先使用 CLI/runtime 证据而不是人工视觉判断，并要求每轮先读 `agent-brief.json` 和 `text-manifest.json`。这能显著降低 AI 通过截图主观猜测导致的不可重复结果。参考：`skills/figma-react-restore/SKILL.md:14`、`skills/figma-react-restore/SKILL.md:15`。

2. **文本规则足够强硬**  
   visible text 以 `text-manifest.json` 为权威来源，禁止从截图猜文本，且要求先修 `text-content` 再修 layout/assets/color。实现侧也通过 Figma `TEXT.characters` 生成 manifest，并在 verify 中做 normalized exact text check。参考：`skills/figma-react-restore/SKILL.md:16`、`skills/figma-react-restore/references/evidence.md:31`、`skills/figma-react-restore/src/ir/build.ts:67`、`skills/figma-react-restore/src/verify/report.ts:409`。

3. **资产反作弊规则明确**  
   `assets.md` 对 baseline screenshot、section slice、`reference-only` asset 的禁用表达清晰，并要求 live DOM/CSS、真实资产和语义结构。实现侧也有 `allowedUse`、reference-only 检测和 large raster overlay 检测。参考：`skills/figma-react-restore/references/assets.md:5`、`skills/figma-react-restore/references/assets.md:31`、`skills/figma-react-restore/src/verify/report.ts:466`、`skills/figma-react-restore/src/verify/capture.ts:199`。

4. **上下文拆分方向正确**  
   `agent-brief.json`、`text-manifest.json`、`repair-plan.json`、`report.json`、`design-ir.json`、raw extraction、trace 的默认读取层级设计合理，避免一次性把全部 Figma tree、DOM dump 和截图证据塞进模型上下文。参考：`skills/figma-react-restore/references/evidence.md:5`、`skills/figma-react-restore/references/evidence.md:16`、`skills/figma-react-restore/src/summary/agent-brief.ts:81`。

5. **React/CSS 修复顺序符合前端经验**  
   implementation order 先 route state / scale，再 exact text，再 macro layout、region layout、typography、assets、visual styling、responsive/interaction polish。这能避免在错误布局或错误文本上调颜色、阴影、radius。参考：`skills/figma-react-restore/references/implementation-order.md:5`、`skills/figma-react-restore/references/implementation-order.md:9`、`skills/figma-react-restore/references/implementation-order.md:18`。

6. **停止条件降低无效迭代**  
   skill 和 restore loop 都定义了 passed / blocked / no-improvement / max-iterations 等终止逻辑，避免 Agent 在 diff 无改善时无限做 CSS 微调。参考：`skills/figma-react-restore/SKILL.md:59`、`skills/figma-react-restore/references/workflow.md:71`、`skills/figma-react-restore/src/restore/loop.ts:155`。

## Findings

### High

1. **布局证据不足以稳定指导可维护 React/CSS 实现**  
   `implementation-order.md` 要求 Agent 把设计证据转成 flex/grid、container widths、min/max sizes、padding、gaps、alignment、responsive constraints，并强调结果应适配合理 viewport/content changes。参考：`skills/figma-react-restore/references/implementation-order.md:40`、`skills/figma-react-restore/references/implementation-order.md:49`、`skills/figma-react-restore/references/implementation-order.md:79`。  
   但当前 `layoutHintSchema` 只有 `display`、`direction`、`gap`、`padding`、`box` 等字段，plugin 侧 `collectLayoutHints` 也只收集 `layoutMode`、`itemSpacing`、padding 和 box。参考：`skills/figma-react-restore/src/schema.ts:143`、`skills/figma-react-restore/plugin/code.js:230`。验证侧核心仍是绝对 box diff：`buildDomResults` 用 Figma box 与 DOM box 做 tolerance 比对。参考：`skills/figma-react-restore/src/verify/report.ts:385`、`skills/figma-react-restore/src/verify/report.ts:716`。  
   影响：Agent 容易从 screenshot/box 反推 CSS，出现固定宽高、magic number、过度 absolute positioning 或只针对单一截图调参；设计系统、响应式约束、内容伸缩能力都无法被充分表达。对“设计稿转前端代码”而言，这是目前最大的 implementation quality 风险。

2. **route state/page shell 被列为第一优先级，但 verifier 缺少可靠 wrong-state 诊断**  
   文档要求先确认 route、viewport、登录态、tab/modal/menu/carousel/form state、mock data、loading/error state，并要求 state 不等价时报告 mismatch。参考：`skills/figma-react-restore/references/implementation-order.md:20`、`skills/figma-react-restore/references/implementation-order.md:24`、`skills/figma-react-restore/references/implementation-order.md:30`。schema 和 repair planner 也保留了 `wrong-state` 类别与建议动作。参考：`skills/figma-react-restore/src/schema.ts:203`、`skills/figma-react-restore/src/restore/repair-plan.ts:105`。  
   但当前 verify 主要在 full-page diff 超阈值时按宽度是否匹配归类为 `scale-mismatch` 或 `layout-spacing`，没有实际 state contract、selected tab/modal/form-state 检测，也没有基于 expected visible state 的 ready selector 或 data precondition。参考：`skills/figma-react-restore/src/verify/report.ts:157`、`skills/figma-react-restore/src/verify/report.ts:160`。  
   影响：如果 React route 处于错误业务状态，repair plan 很可能把错误状态解释为 layout/text/asset 问题，导致 Agent 过拟合 CSS 或修改不该改的组件，而不是先修 route fixture、mock data、URL、localStorage/cookie 或交互状态。

3. **`data-figma-node` 在提示中是可选实践，但验证逻辑近似强制所有 region 映射**  
   `SKILL.md` 说“where practical”给 important DOM nodes 添加 `data-figma-node`。参考：`skills/figma-react-restore/SKILL.md:20`。`implementation-order.md` 也强调不要添加 misleading mappings。参考：`skills/figma-react-restore/references/implementation-order.md:83`、`skills/figma-react-restore/references/implementation-order.md:89`。  
   但 plugin `collectRegions` 给每个 region 写入 `nodeId`，verify 的 `buildDomResults` 会遍历所有非 ignored regions，并要求 DOM 中存在同名 `[data-figma-node="..."]`；缺失时写 `missing`，随后转成 `layout-spacing` failure。参考：`skills/figma-react-restore/plugin/code.js:152`、`skills/figma-react-restore/src/verify/report.ts:388`、`skills/figma-react-restore/src/verify/report.ts:392`、`skills/figma-react-restore/src/verify/report.ts:98`。  
   影响：在真实项目里，把 Figma node id 加到所有 frame/group/text/icon/container 上会污染组件 API 和 markup，也会让 repair plan 被“missing DOM mapping”淹没。它会推动 Agent 为了验证器而改结构，而不是按项目架构最小侵入地实现页面。

### Medium

1. **资产验证可能与现有设计系统/icon 组件冲突**  
   `assets.md` 允许把真实 asset evidence 转成 `<img>`、inline/external SVG、现有 icon component 或 CSS mask。参考：`skills/figma-react-restore/references/assets.md:20`、`skills/figma-react-restore/references/assets.md:23`。  
   但 `buildAssetUsageFailures` 对 `implementation` asset 的通过条件主要是 rendered page 中出现 extracted asset path/fallback basename；否则即使 node 上使用了项目已有 icon component、sprite symbol 或视觉等价的内部 SVG，也会报 `asset-missing`。参考：`skills/figma-react-restore/src/verify/report.ts:466`、`skills/figma-react-restore/src/verify/report.ts:470`、`skills/figma-react-restore/src/verify/report.ts:504`。  
   影响：这会把 Agent 推向“导入 Figma 导出的资源文件”而不是优先复用项目组件库，长期看会增加重复图标、破坏 theming、降低可维护性。对 logo/photo/image-fill 可以强制资产路径；对 icon/vector/decorative primitive 应允许 semantic-equivalent。

2. **responsive 目前是提示词要求，不是验证闭环的一部分**  
   implementation order 把 responsive and interaction polish 放在最后，并要求 layout repair 包含 responsive constraints。参考：`skills/figma-react-restore/references/implementation-order.md:16`、`skills/figma-react-restore/references/implementation-order.md:49`。  
   但 V1 明确只要求 desktop viewport，multi viewport matrix 被列为非目标/后续演进；fidelity spec 也是单 viewport，build spec 和 Playwright capture 一次只使用一个 viewport。参考：`docs/figma-react-restore/v1-implementation-spec.md:13`、`docs/figma-react-restore/design.md:51`、`docs/figma-react-restore/design.md:282`、`skills/figma-react-restore/src/schema.ts:174`、`skills/figma-react-restore/src/ir/spec.ts:26`、`skills/figma-react-restore/src/verify/capture.ts:90`。  
   影响：Agent 可能做出单断点高保真但移动端不可用的实现。对于现代前端，“设计稿转代码”至少需要在 desktop baseline 外提供 mobile/tablet smoke verification 或明确声明 responsive 不在验收范围。

3. **agent brief 对“找哪些 React/CSS 文件改”帮助不足**  
   workflow 只说读 `agent-brief.json`、`text-manifest.json` 和 relevant React/CSS files。参考：`skills/figma-react-restore/SKILL.md:54`、`skills/figma-react-restore/references/evidence.md:9`。`agent-brief` 当前主要包含 metrics、artifact paths、failure counts、nextActions、topFailures、topRegions、warnings。参考：`skills/figma-react-restore/src/summary/agent-brief.ts:74`、`skills/figma-react-restore/src/summary/agent-brief.ts:107`、`skills/figma-react-restore/src/summary/agent-brief.ts:116`。  
   影响：在 Next.js/Vite/Remix 大项目里，Agent 仍要靠全仓搜索 route、component、CSS module、Tailwind class、design token 文件。上下文拆分虽然节省 token，但缺少“source ownership / likely files / route component graph”会增加误改文件、漏改样式入口和重复实现的概率。

4. **repair plan 的动作粒度偏通用，不能充分替代前端实现计划**  
   `repair-plan.ts` 会按类别排序并截取 top 10 failures，然后生成通用推荐动作，如修 container width、padding、gap、font metrics、asset crop 等。参考：`skills/figma-react-restore/src/restore/repair-plan.ts:63`、`skills/figma-react-restore/src/restore/repair-plan.ts:99`、`skills/figma-react-restore/src/restore/repair-plan.ts:139`。  
   影响：对简单 fixture 足够，但对真实页面，Agent 还需要“先建哪些组件、哪些 tokens、哪些容器负责响应式、哪些 asset 放 public/assets、哪些现有组件可复用”的 implementation plan。当前 repair plan 更像差异列表，不是 design-to-code construction plan。

### Low

1. **文本验证强，但对复杂文本组合仍有边界**  
   文本提取能深度遍历 Figma tree 并避免 serialized root 深度限制。参考：`skills/figma-react-restore/plugin/code.js:164`、`docs/figma-react-restore/figma-plugin-validation.md:27`。verify 侧则按单个 mapped node 的 `innerText/textContent/ariaLabel/alt/value` 与 expected text 比对。参考：`skills/figma-react-restore/src/verify/report.ts:409`、`skills/figma-react-restore/src/verify/report.ts:433`。  
   边界是：Figma 一个 TextNode 在 React 中被拆成多个 inline element、或 React 多个节点组合成一个视觉文本时，需要额外映射策略；否则可能被判 failed/mapping-missing。当前 normalized whitespace 处理合理，但 rich text span-level style 不在 V1 表达范围。

2. **region strictness 未充分参与阈值策略**  
   region schema 有 `strictness: layout | strict | perceptual | ignored`。参考：`skills/figma-react-restore/src/schema.ts:78`。但 compare region 时统一使用 `regionMaxDiffRatio`，默认阈值也只有全局 0.03/0.01/3px。参考：`skills/figma-react-restore/src/ir/spec.ts:5`、`skills/figma-react-restore/src/verify/report.ts:79`。  
   影响：text/icon/image/background section 的视觉容忍度不同，统一阈值会带来 false positive/false negative。可以把 `strictness` 映射成 per-region threshold。

3. **最终 cleanup 规则可能过早丢失验收证据**  
   workflow 要求 final verification 通过且用户确认接受后自动清理 artifact root。参考：`skills/figma-react-restore/references/workflow.md:81`、`skills/figma-react-restore/references/workflow.md:87`。同时核心不变量要求接受前不要删除 artifacts。参考：`skills/figma-react-restore/SKILL.md:22`。  
   影响：自动清理对磁盘卫生有利，但如果后续需要审计 diff、复现 bug 或生成 PR 说明，会丢失关键证据。建议至少保留 `final-report.json`、last `agent-brief.json`、last `report.json` 或提供 archive option。

## Recommended Improvements

1. **新增 implementation evidence pack / design-to-code brief**  
   在 `agent-brief` 之外生成一个面向实现的轻量包：页面结构树、关键 sections、text manifest 摘要、asset manifest、design tokens、layout constraints、recommended component boundaries、source file candidates、breakpoint plan。它不需要完整 raw extraction，但应比 repair diff 更适合“从 0 到 1 写 React/CSS”。

2. **扩展 LayoutIR 到可维护 CSS 所需参数**  
   增加 Figma Auto Layout 的 primary/counter axis alignment、layout sizing、min/max constraints、absolute positioning、wrap、constraints、strokes/effects/radius/opacity、z-order、clip content、grid/layout variables 等字段。验证报告里把“box mismatch”拆成 x/y/w/h、padding、gap、alignment、size mode、wrap 等可执行原因。

3. **把 DOM mapping 改成分层策略**  
   将 `data-figma-node` 分为 required/optional/ignored：文本、主要 section、核心 image/icon required；装饰性 group、auto-layout wrapper、无语义 container optional；不可映射节点 ignored。missing mapping 应先作为 mapping failure，而不是全部转成 high layout failure。

4. **引入 route state contract**  
   支持在 restore/verify 里传入 setup script、localStorage/cookies、query params、mock data fixture、wait selector、expected state assertions。wrong-state 应由 verifier 产生明确 failure，而不是让 full-page diff 间接表现。

5. **支持 responsive verification matrix**  
   保持 V1 desktop 默认，但提供 `--viewport` 多值或 spec matrix：desktop/tablet/mobile。至少在最终验收前跑 mobile smoke screenshot、overflow 和 text wrapping 检查；repair plan 应按 viewport 分组显示 failures。

6. **改进 asset equivalence 策略**  
   对 `sourceKind: image-fill` / photo / logo 可继续强制 extracted asset；对 icon/vector/decorative 支持 existing icon component、inline SVG、CSS mask、sprite symbol 的 semantic-equivalent 通过条件，例如 node 映射 + region visual pass + no reference-only path usage。

7. **增加 source ownership discovery**  
   React project adapter 可以探测 Next.js app/pages、React Router、Vite entry、CSS modules、Tailwind config、design token 文件，并在 brief 中输出 likely files。这样上下文拆分不只减少读取，还能减少误读和误改。

8. **让 repair loop 以目标 failure 改善为核心**  
   plateau 不只看 full-page diff 和 exact text count，还应记录每轮 targeted failure 是否改善，例如某 region diff、某 node box delta、某 asset usage、某 typography mismatch。这样能避免 full-page diff 被 unrelated noise 掩盖。

9. **补充真实设计稿到 React 的 eval cases**  
   增加 wrong state、tab/modal、duplicated text、split rich text、existing icon component、reference-only renamed asset、mobile overflow、missing design font、多图片 crop 等用例。现有 unit/browser tests 已覆盖基础文字、资产和 overlay，但还不足以评估生产级 design-to-code 行为。

## Verdict

**混合。**

相对纯提示词或手工截图对照，这个 skill 明显更好：它有确定性 artifact、文本硬门槛、反大图作弊、浏览器验证、repair plan、agent brief 和 blocked 机制。

但相对“生产级设计稿转前端代码”目标，目前仍是混合结果：验证闭环强，implementation guidance 中等；适合已有 React route 的高保真修复，不足以单独保障可维护组件结构、设计系统复用、复杂 route state、响应式和多断点质量。下一阶段应重点补齐 layout constraints、route state contract、DOM mapping tier、responsive matrix 和 source ownership brief。
