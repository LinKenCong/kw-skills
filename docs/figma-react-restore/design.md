# figma-react-restore 新 skill 设计文档

状态：设计稿 v0.2  
日期：2026-04-27  
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
- auth/token
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
- 端口、token、日志、lockfile 更简单。
- MVP 阶段避免服务间协议和分布式状态。

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

还原顺序固定为从大到小：

```text
1. Page shell
2. Macro layout
3. Region layout
4. Typography and content
5. Assets
6. Visual styling
7. Interaction and responsive polish
```

原因：

- 整体布局错误会污染局部 diff。
- 字体换行和容器宽度错误会造成大面积差异。
- 先修颜色、阴影、radius 容易在错误布局上过拟合。
- 大结构稳定后，region diff 才能可靠定位细节问题。

## 7. Verification 策略

V1 必选 gate：

- full-page screenshot diff
- region screenshot diff
- DOM bounding box diff
- text computed style diff
- overflow/clipping check
- missing asset check

V1 暂缓 gate：

- OCR visible text
- SSIM structural score
- OpenCV anchor matching
- LPIPS perceptual score
- cloud visual testing

通过条件不使用单一 aggregate score。full-page diff 只做总览，真正修复优先依赖 region diff、DOM/style diff 和 repair-plan。

## 8. 兼容和降级

Evidence levels：

| Level | 可用证据 | V1 策略 |
|---|---|---|
| `L3-structured` | node tree + screenshot + regions + assets | 完整 V1 restore loop |
| `L2-partial` | node tree 部分可用 | 用 screenshot 和 DOM diff 补足，低置信修复 |
| `L1-visual-only` | 只有截图 | V1 只做有限支持，默认标记风险或 blocked |
| `L0-blocked` | 截图也缺失或无法稳定捕获 | 停止，要求补充证据 |

V1 不承诺完整 visual-only reconstruction。

## 9. 依赖取舍

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
| 包管理检测 | `package-manager-detector` | 自动识别 npm/pnpm/yarn/bun |
| 本地服务 | `hono` + `@hono/node-server` | 减少路由/body/auth 代码量，仍保持轻量 |

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
- Agent 能基于 repair-plan 修改 React 代码。
- 至少支持 3 轮 restore attempt。
- 连续无改善时能停止并输出 blocked reason。
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
