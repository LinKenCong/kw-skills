# figma-react-restore 新 skill 设计文档

状态：V1 实现基线
日期：2026-04-28
对象：全新 skill，不兼容旧 `figma-to-code` 运行时和命令
目标：让 Agent 能在已有 React 类项目中自主还原 Figma 页面，并通过自回归测试、诊断和修复达到可生产可用的精度

## 1. 定位

`figma-react-restore` 不是通用 Figma API 客户端，也不是第一版就完整自动生成 React 项目的代码生成器。

第一版定位：

```text
React 页面还原的 Agent 验证与修复工具
```

核心闭环：

```text
Figma selection/frame
  -> extraction artifacts
  -> minimal DesignIR
  -> fidelity spec
  -> React route screenshot
  -> region-aware visual diff
  -> DOM/style diff
  -> repair-plan
  -> Agent patch
  -> repeat until passed or blocked
```

## 2. 目标

- 支持从 Figma 当前 selection 或单个主 frame 提取还原证据。
- 支持已有 React 项目指定 route 的浏览器验证。
- 支持 region-aware screenshot diff。
- 支持 DOM bounding box、computed style、overflow 和 asset 检查。
- 输出面向 Agent 的 `repair-plan.json`。
- Agent 按“从整体到局部，从布局到细节”的顺序修复代码。
- 多轮修复无改善时停止，并输出 plateau / blocked 原因。

## 3. 非目标

第一版不做：

- 旧 `figma-to-code` 命令兼容。
- 完整项目生成器。
- 完整 Figma-to-React codegen。
- 多页面 bundle restore。
- 多 viewport matrix 必选。
- OCR。
- SSIM。
- OpenCV。
- LPIPS。
- Percy / Chromatic / Applitools adapter。
- AST 自动改写 React 源码。
- 大面积 raster fallback 伪造通过。

## 4. 运行模型

默认只启动 1 个本地常驻服务：`figma-react-restore runtime service`。

```text
Figma Plugin UI  <->  runtime service  <->  CLI / Agent
```

常驻服务负责必须长连接或集中状态的部分：

- plugin session 管理
- job 派发和状态管理
- artifact upload
- artifact 写入
- health/sessions/jobs 查询

其它模块不常驻，由 CLI 按需执行：

- extraction planner
- DesignIR builder
- fidelity spec builder
- query
- browser capture
- verification
- repair planner
- restore loop
- doctor

不拆多个服务的原因：

- 用户只需要启动和诊断一个服务。
- Figma plugin 只需要连接一个 endpoint。
- 固定本地端口、日志和 lockfile 更简单。
- MVP 阶段避免服务间协议和分布式状态。

artifact root 规则：

- artifact root 固定写入目标 React project root 下的 `.figma-react-restore/`。
- CLI 必须从 React project root 运行，或所有相关命令显式传入同一个 `--project <react-project>`。
- `doctor` 不创建 `.figma-react-restore/`，只做非持久化写入探测。
- `service start/dev` 在创建 artifact root 前校验 project root 是 React 项目，避免在 app 父级目录生成未使用的 sibling artifact root。

## 5. Runtime 策略

- 使用 TypeScript 实现 skill 内 runtime。
- 默认 Node.js 运行构建产物。
- 使用 Hono + `@hono/node-server` 实现本地 runtime service。
- 使用 Zod 做运行时 schema 校验，并尽量从 schema 推导 TypeScript 类型。
- 不使用 Bun-only API，保持 Bun-compatible。
- Bun 编译 binary 作为后续分发优化，不作为 V1 前提。
- 不再用零散 `.mjs` 小脚本承载核心逻辑。
- 因为是全新 skill，不需要保留旧 `.mjs` wrapper 兼容。

## 6. Agent 还原策略

还原顺序固定为同一套优先级：先确定页面状态/尺度，再把精确文本作为硬门槛，然后从大到小修布局和细节。

```text
1. Page shell
2. Exact text content from Figma TextNode evidence
3. Macro layout
4. Region layout
5. Typography metrics with tolerance
6. Assets
7. Visual styling
8. Interaction and responsive polish
```

原因：

- 整体布局错误会污染局部 diff。
- 文本内容是硬约束；Figma 可提取 `TextNode.characters` 时不能让 Agent 从截图猜。
- 字体换行和容器宽度错误会造成大面积差异。
- 先修颜色、阴影、radius 容易在错误布局上过拟合。
- 大结构稳定后，region diff 才能可靠定位细节问题。

## 7. Verification 策略

V1 必选 gate：

- full-page screenshot diff
- region screenshot diff
- exact text content diff
- DOM bounding box diff
- text computed style diff
- overflow/clipping check
- missing asset check

字体包缺失策略：

- exact text content 是硬约束，不能跳过。
- computed typography 已匹配但 text region pixel diff 仍失败时，判定为字体包/渲染风险 warning，不继续围绕该文本像素差异反复修复。
- Agent 应告知用户安装设计字体可提升文本 raster fidelity，然后继续修其它 layout、asset、color 问题。

V1 暂缓 gate：

- OCR visible text
- SSIM structural score
- OpenCV anchor matching
- LPIPS perceptual score
- cloud visual testing

通过条件不使用单一 aggregate score。full-page diff 只做总览，真正修复优先依赖 region diff、DOM/style diff 和 repair-plan。

Asset 提取原则：

- baseline screenshot 只作为验证证据，不作为页面实现资产。
- 资产提取阶段不使用“防大图作弊”作为硬过滤；候选资产应尽量导出，避免真实背景图、装饰图或大尺寸图片被误删。
- 提取结果通过 `allowedUse` 标记用途：`implementation` 可用于页面实现，`reference-only` 只能作为视觉参考。
- 当候选数量超过导出上限时，先导出 `implementation` 候选，再导出 `reference-only` 参考候选，避免参考切片挤掉真实图片/icon。
- 包含文本 descendant 的整节点导出应标记为 `reference-only`，文本必须作为 live DOM 实现；直接 image fill 仍应导出为可实现资产。
- 大 section/frame/layout container 可以导出为参考证据，但默认标记为 `reference-only`，除非它是明确的真实图片/矢量/装饰资产。
- 图像、照片、真实 icon/vector 可以导出为资产。
- 真实 vector/icon/logo 优先导出 SVG，同时导出 PNG fallback；前端默认使用 SVG，只有 SVG 渲染不准或组件栈不支持时使用 PNG fallback。
- 照片、image fill、复杂 raster 只导出 PNG，不额外包装成 SVG。
- `reference-only` 资产会写 warning，例如 `REFERENCE_ONLY_ASSET_EXPORTED`，提示 Agent 用 DOM/CSS 还原结构、文本和样式。
- 防作弊放在 Skill 提示词和验证器：Agent 不得把 baseline、section 切片或 `reference-only` 资产作为实现内容；验证器对违规使用输出 `screenshot-overlay`。
- AI/Agent 不应通过视觉截图来决定把整块 section 当作图片；只在结构信息不足时把截图作为判断辅助。

## 8. Token 策略

V1 将本地计算和模型上下文分离：

- 本地可以生成完整 screenshot、diff、region crop、DOM/style、trace、report。
- Agent 默认不读取完整 extraction、DesignIR、DOM dump 或 trace。
- Agent 默认读取 `text-manifest.json` 作为可见 copy 的权威来源。
- 每轮 verify/repair 额外生成 `agent-brief.json`，作为 Agent 必读入口。
- `agent-brief.json` 只包含状态、核心指标、top failures、top regions、nextActions 和 artifact paths。
- 只有 brief 中的 `nodeId`、`regionId`、`selector`、`evidencePath` 不足以定位问题时，才按需读取完整 `report.json`、`repair-plan.json`、`design-ir.json` 或图像证据。

目标 token 预算：

- 正常修复轮：读取 brief + 相关源码，避免超过必要上下文。
- 不把完整 Figma node tree 或所有 region crops 放入模型上下文。
- 不用 vision model 替代本地 diff；vision 只作为疑难 fallback。

## 9. 兼容和降级

Evidence levels：

| Level | 可用证据 | V1 策略 |
|---|---|---|
| `L3-structured` | node tree + screenshot + regions + assets | 完整 V1 restore loop |
| `L2-partial` | node tree 部分可用 | 用 screenshot 和 DOM diff 补足，低置信修复 |
| `L1-visual-only` | 只有截图 | V1 只做有限支持，默认标记风险或 blocked |
| `L0-blocked` | 截图也缺失或无法稳定捕获 | 停止，要求补充证据 |

V1 不承诺完整 visual-only reconstruction。

## 10. 依赖取舍

推荐 V1 依赖：

| 类别 | 推荐库 | 原因 |
|---|---|---|
| 浏览器捕获 | `playwright` | 真实浏览器截图、DOM、trace，不可替代 |
| 像素对比 | `pixelmatch` | 轻量、适合 region diff |
| PNG 解析 | `pngjs` | 配合 pixelmatch |
| 图片处理 | `sharp` | crop、resize、metadata、diff 辅助图 |
| Schema | `zod` | TypeScript 友好，适合 V1 快速冻结数据结构 |
| CLI | `commander` | 成熟、简单 |
| 子进程 | `execa` | 启动 dev server / 执行命令更安全 |
| 包管理检测 | 内置轻量检测 | 通过 lockfile 和 scripts 识别 npm/pnpm/yarn/bun，避免新增依赖 |
| 本地服务 | `hono` + `@hono/node-server` | 减少路由/body/CORS 代码量，仍保持轻量 |

暂缓：

- `ssim.js`
- Tesseract / `tesseract.js`
- OpenCV
- LPIPS
- Percy / Chromatic / Applitools
- `ts-morph` / Babel / jscodeshift
- native diff binary

## 10. MVP

V1 必须包含：

- skill metadata 和说明。
- runtime service 单服务模型。
- plugin session。
- selection/frame extraction。
- artifact store 最小版。
- minimal DesignIR。
- minimal fidelity spec。
- Playwright browser capture。
- region-aware pixel diff。
- DOM bounding box / computed style check。
- overflow / missing asset check。
- repair-plan。
- restore loop with max iterations。
- plateau / blocked report。
- React route verification。

V1 可暂不包含：

- 内置完整 codegen。
- 多页面 restore。
- OCR / SSIM / OpenCV / LPIPS。
- cloud visual testing。
- 完整 visual-only reconstruction。
- AST 自动修复。

## 11. 成功标准

- 能连接 Figma plugin 并提取当前 selection/frame。
- 能打开已有 React 项目的指定 route。
- 能保存每轮 attempt artifact。
- 能按 Figma regions 生成 diff。
- 能输出可执行的 repair-plan。
- 能输出 token-optimized agent-brief，并与 `text-manifest.json` 一起作为 Agent 默认读取入口。
- Agent 能基于 repair-plan 修改 React 代码。
- 至少支持 3 轮 restore attempt。
- 连续 full-page diff 或 exact text-content failure 无改善时能停止并输出 blocked reason。
- 对至少一个真实 React 页面完成可接受还原。

## 12. 后续演进

V2 之后再考虑：

- 多页面 restore。
- 多 viewport matrix。
- baseline manager。
- SSIM / OCR / OpenCV。
- codegen adapters。
- cloud visual service adapters。
- Bun binary 分发。
- MCP server。
