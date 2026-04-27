# figma-react-restore V1 编码前实现规格

状态：V1 pre-coding freeze  
目标：开始编码前冻结最小可实现范围、数据结构、服务边界、协议、测试计划和实现顺序

## 1. 冻结决策

- Skill 名称：`figma-react-restore`。
- 不兼容旧 `figma-to-code`。
- 不保留旧 `.mjs` 命令 wrapper。
- 第一版只支持已有 React 类项目页面还原。
- 第一版只支持一个 Figma selection 或单主 frame 到一个 React route。
- 第一版只要求 desktop viewport。
- 第一版只启动一个 runtime service。
- 第一版不内置完整 codegen；Agent 修改 React 源码。
- 第一版 runtime 用 TypeScript + Node.js。
- 本地服务使用 Hono + `@hono/node-server`。
- Schema 使用 Zod，并尽量从 Zod schema 推导 TypeScript 类型。
- Bun binary 只保留为后续优化方向。

### 1.1 TypeScript decision

V1 使用 TypeScript，不使用纯 JavaScript。

原因：

- runtime service、plugin protocol、artifact manifest、verify report、repair-plan 都依赖结构化数据。
- Agent 会根据 JSON 输出做修复决策，字段错误会直接影响还原质量。
- TypeScript 提供编译期约束，Zod 提供运行时校验，二者可以降低协议漂移。
- 后续抽取为独立工具或 MCP server 时，TypeScript 更易维护。

规则：

- schema 优先；类型尽量由 Zod schema 推导。
- CLI 和 service 的外部输入必须经过 Zod 校验。
- report / repair-plan 写盘前必须经过 schema 校验。
- 构建产物是 JavaScript，由 Node.js 执行。

## 2. V1 用户流程

```text
1. 用户打开 Figma Desktop，并运行 figma-react-restore plugin
2. 用户在 Figma 中选择目标 frame 或区域
3. Agent 运行 doctor
4. Agent 启动 runtime service
5. Agent 检查 sessions
6. Agent 执行 extract
7. Runtime 保存 extraction artifacts
8. Agent 执行 build-ir
9. Agent 执行 restore，传入 React project 和 route
10. Runtime/CLI 捕获页面截图和 DOM
11. Verification 输出 report
12. Repair planner 输出 repair-plan
13. Agent 修改 React 代码
14. 重复 verify/repair，直到 passed 或 blocked
```

## 3. V1 CLI

必须实现：

```bash
figma-react-restore doctor
figma-react-restore service start
figma-react-restore sessions
figma-react-restore extract --selection
figma-react-restore build-ir --run <runId>
figma-react-restore verify --project <dir> --route <url> --spec <spec>
figma-react-restore repair-plan --report <report>
figma-react-restore restore --project <dir> --route <url> --run <runId> [--dev-command <cmd>]
```

暂不实现：

```bash
figma-react-restore generate
figma-react-restore baseline accept
figma-react-restore cloud-visual
figma-react-restore multi-page-restore
```

## 4. 模块职责

| Module | 常驻 | V1 职责 |
|---|---:|---|
| Skill instructions | 否 | 触发规则、Agent 操作规范、blocked 处理 |
| CLI | 否 | 用户/Agent 命令入口 |
| Runtime service | 是 | Hono 服务；plugin session、job、artifact upload、auth、health |
| Figma plugin adapter | Figma 内 | selection/frame extraction、screenshot、asset export |
| Schema | 否 | V1 数据结构校验 |
| Artifact store | 否 | run/artifact/attempt 文件管理 |
| IR builder | 否 | extraction -> minimal DesignIR |
| React project adapter | 否 | project root、dev command、route readiness |
| Browser capture | 否 | Playwright screenshot、DOM、computed styles |
| Verification engine | 否 | pixel diff、region diff、box/style/overflow/asset checks |
| Repair planner | 否 | report -> repair-plan |
| Restore loop | 否 | attempt state machine、plateau、blocked |
| Doctor | 否 | dependency、browser、font、service、plugin 检查 |

服务数量：1 个 runtime service。React dev server 是目标项目进程，不算 skill 服务。

## 5. V1 Schema 草案

V1 先用 `zod` 定义 schema。

### 5.1 Run

```ts
type Run = {
  runId: string;
  kind: 'extract' | 'build-ir' | 'verify' | 'restore';
  createdAt: string;
  status: 'running' | 'completed' | 'failed' | 'blocked';
  workspaceRoot: string;
  artifactRoot: string;
  inputs: Record<string, unknown>;
  artifactRefs: ArtifactRef[];
  warnings: Warning[];
};
```

### 5.2 ArtifactRef

```ts
type ArtifactRef = {
  artifactId: string;
  kind: 'raw-extraction' | 'screenshot' | 'asset' | 'design-ir' | 'fidelity-spec' | 'verify-report' | 'repair-plan' | 'trace' | 'diff';
  path: string;
  contentHash?: string;
  mediaType?: string;
  sourceNodeId?: string;
  sourcePageId?: string;
};
```

### 5.3 MinimalDesignIR

```ts
type MinimalDesignIR = {
  schemaVersion: 1;
  runId: string;
  evidenceLevel: 'L3-structured' | 'L2-partial' | 'L1-visual-only' | 'L0-blocked';
  page: {
    pageId?: string;
    pageName?: string;
    width?: number;
    height?: number;
  };
  regions: Region[];
  texts: TextEvidence[];
  assets: AssetEvidence[];
  colors: ColorEvidence[];
  typography: TypographyEvidence[];
  layoutHints: LayoutHint[];
  warnings: Warning[];
};
```

### 5.4 Region

```ts
type Region = {
  regionId: string;
  nodeId?: string;
  name?: string;
  kind: 'page' | 'section' | 'component' | 'text' | 'image' | 'unknown';
  box: { x: number; y: number; w: number; h: number };
  strictness: 'layout' | 'strict' | 'perceptual' | 'ignored';
};
```

### 5.5 FidelitySpec

```ts
type FidelitySpec = {
  schemaVersion: 1;
  runId: string;
  route: string;
  viewport: { width: number; height: number; dpr: number };
  baselineScreenshot: string;
  regions: Region[];
  thresholds: {
    fullPageMaxDiffRatio: number;
    regionMaxDiffRatio: number;
    boxTolerancePx: number;
  };
};
```

### 5.6 VerifyReport

```ts
type VerifyReport = {
  schemaVersion: 1;
  status: 'passed' | 'failed' | 'blocked';
  attemptId: string;
  route: string;
  viewport: { width: number; height: number; dpr: number };
  fullPage: {
    diffRatio: number;
    diffPixels: number;
    expectedPath: string;
    actualPath: string;
    diffPath: string;
  };
  regionResults: RegionResult[];
  domResults: DomResult[];
  failures: Failure[];
  warnings: Warning[];
};
```

### 5.7 RepairPlan

```ts
type RepairPlan = {
  schemaVersion: 1;
  status: 'needs-repair' | 'passed' | 'blocked';
  attemptId: string;
  summary: string;
  worstFailures: RepairFailure[];
  nextActions: string[];
  blockedReason?: string;
};
```

### 5.8 RestoreAttempt

```ts
type RestoreAttempt = {
  attemptId: string;
  index: number;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'passed' | 'failed' | 'blocked';
  reportPath?: string;
  repairPlanPath?: string;
  patchSummaryPath?: string;
};
```

## 6. Artifact Store V1

V1 最小落盘结构：

```text
.figma-react-restore/
  runs/
    <runId>/
      run.json
      artifacts.json
      extraction.raw.json
      design-ir.json
      fidelity-spec.json
      restore/
        attempts/
          001/
            actual.png
            expected.png
            diff.png
            report.json
            repair-plan.json
            trace.zip
          002/
            ...
      final-report.json
  assets/
    <hash-or-artifact-id>.<ext>
```

规则：

- 所有写入路径必须限制在 artifact root 内。
- 图片 artifact 记录 content hash。
- report 中引用 artifact path，不内嵌大图。
- V1 不做复杂 global indexes。

## 7. Runtime Service API V1

### 7.1 Service framework

V1 使用 Hono + `@hono/node-server`。

要求：

- 所有 response 使用 JSON。
- 错误响应使用统一 `{ ok: false, error }` 格式。
- auth/token 校验作为 middleware。
- body size limit 必须明确。
- 不使用多服务拆分。

### 7.2 Health

```http
GET /health
```

返回：

```json
{
  "ok": true,
  "service": "figma-react-restore",
  "version": "0.1.0",
  "pluginConnected": true,
  "activeJobs": 0
}
```

### 7.3 Sessions

```http
GET /sessions
POST /sessions/register
```

session register payload：

```json
{
  "pluginSessionId": "ps_...",
  "fileName": "Marketing Site",
  "currentPageId": "12:34",
  "currentPageName": "Home",
  "selectionCount": 1,
  "capabilities": ["extract.selection"]
}
```

### 7.4 Plugin event stream

```http
GET /events?sessionId=<id>
```

V1 可以继续使用 SSE。WebSocket 暂缓。

### 7.5 Jobs

```http
POST /jobs
GET /jobs/:jobId
POST /jobs/:jobId/progress
POST /jobs/:jobId/result
POST /jobs/:jobId/cancel
```

extract job payload：

```json
{
  "capability": "extract.selection",
  "sessionId": "ps_...",
  "options": {
    "screenshots": true,
    "assets": true
  }
}
```

### 7.6 Artifact upload

```http
POST /jobs/:jobId/artifacts
```

V1 可先使用 JSON + base64，但必须保留升级 binary/chunk upload 的接口边界。

限制：

- max body size。
- content type allowlist。
- artifact kind allowlist。
- safe path validation。

## 8. Plugin Protocol V1

Plugin 必须支持：

- register session
- receive extract selection job
- send progress
- upload screenshot / asset artifacts
- send final extraction result
- send structured error

Plugin extraction result 最小内容：

```json
{
  "schemaVersion": 1,
  "meta": {
    "pageId": "12:34",
    "pageName": "Home",
    "selectedNodeCount": 1,
    "extractedAt": "..."
  },
  "root": {},
  "regions": [],
  "screenshots": [],
  "assets": [],
  "warnings": []
}
```

错误格式：

```json
{
  "ok": false,
  "error": {
    "code": "NO_SELECTION",
    "message": "No Figma selection found",
    "recoverable": true,
    "hint": "Select one frame or component and retry"
  }
}
```

## 9. React Project Adapter V1

职责：

- 检查 project root。
- 检测 package manager。
- 可选启动 `devCommand`。
- 等待 route ready。
- 收集 package scripts。
- 报告环境问题。

V1 不做：

- 自动识别所有框架细节。
- 自动重写路由。
- 自动生成组件文件。

## 10. Verification V1

输入：

- `fidelity-spec.json`
- route URL
- artifact root
- optional source map

流程：

```text
1. Playwright 打开 route
2. 等待 network/fonts/render idle
3. 截图 actual.png
4. 根据 spec 找 expected screenshot
5. full-page pixel diff
6. region crop + pixel diff
7. DOM selector bounding box / computed style check
8. overflow check
9. missing asset check
10. 写 report.json
```

V1 thresholds 默认：

```json
{
  "fullPageMaxDiffRatio": 0.03,
  "regionMaxDiffRatio": 0.01,
  "boxTolerancePx": 3
}
```

这些阈值必须可通过 spec 覆盖。

## 11. Repair Planner V1

输入：`verify-report.json`。

输出：`repair-plan.json`。

排序规则：

1. wrong state / scale mismatch
2. macro layout / region box mismatch
3. typography mismatch
4. asset missing / asset crop
5. color mismatch
6. overflow
7. low-severity visual polish

每条 failure 至少包含：

- category
- severity
- regionId
- nodeId if available
- selector if available
- evidence path
- expected / actual key data
- recommended action

## 12. Restore Loop V1

默认策略：

- `maxIterations = 3` 到 `5`，V1 不建议默认 8。
- 每轮运行 verify。
- 每轮写 report 和 repair-plan。
- Agent 根据 repair-plan patch。
- 如果连续 2 轮核心指标无改善，停止 blocked。
- 如果环境错误，立即 blocked。
- 如果 evidence insufficient，blocked 或 partial。

V1 不要求工具自动修改代码。

## 13. Doctor V1

检查：

- Node.js version。
- package dependencies。
- Playwright browser installed。
- `sharp` can load。
- runtime service health。
- plugin session connected。
- artifact root writable。
- route reachable when provided。
- required fonts best-effort check。

输出 JSON：

```json
{
  "ok": false,
  "checks": [],
  "failures": [
    {
      "code": "PLAYWRIGHT_BROWSER_MISSING",
      "message": "Playwright browser is not installed",
      "fix": "npx playwright install chromium"
    }
  ]
}
```

## 14. Test Plan Before Implementation

编码前先准备测试目标和 fixtures。

### 14.1 Unit tests

- schema parse success/failure。
- safe path validation。
- artifact write/read。
- region crop coordinate conversion。
- pixel diff known images。
- verify report -> repair-plan 分类。
- restore plateau policy。

### 14.2 Service integration tests

- health。
- session register/list。
- job create/progress/result。
- artifact upload。
- auth token missing/invalid。
- no plugin session error。

### 14.3 Browser tests

- Playwright route capture。
- computed style extraction。
- bounding box extraction。
- overflow detection。

### 14.4 React fixture

准备一个最小 React fixture route：

- hero section
- title/body text
- button
- image or colored panel
- known spacing/color/font

人为制造错误：

- spacing 错。
- font size 错。
- color 错。
- image crop 错。
- overflow 错。

用于验证 repair-plan 分类和定位。

### 14.5 Live Figma test

至少准备一个真实 Figma file/selection：

- 单 frame。
- 含文本、按钮、图片/色块。
- 有截图 baseline。
- 可重复 extraction。

## 15. Implementation Order

建议编码顺序：

1. 初始化新 skill skeleton 和 package metadata。
2. 定义 schema。
3. 实现 artifact store。
4. 实现 CLI skeleton。
5. 实现 runtime service health/session/job skeleton。
6. 实现 plugin session register 和 extract selection 协议。
7. 实现 extraction artifact 写入。
8. 实现 minimal IR builder。
9. 实现 fidelity spec builder。
10. 实现 Playwright browser capture。
11. 实现 region pixel diff。
12. 实现 DOM box/style inspector。
13. 实现 verify report。
14. 实现 repair planner。
15. 实现 restore loop。
16. 写/更新 `SKILL.md`。
17. 用 React fixture 跑端到端。
18. 用真实 Figma selection 跑端到端。

## 16. Definition of Done for V1

V1 完成条件：

- `figma-react-restore doctor` 可用。
- runtime service 可启动并注册 plugin session。
- 能从 Figma selection 提取 artifacts。
- 能生成 minimal DesignIR 和 fidelity spec。
- 能验证 React route 并输出 screenshot diff。
- 能输出 repair-plan。
- restore loop 至少支持 3 轮 attempt。
- plateau / blocked 状态可解释。
- React fixture 端到端通过。
- 至少一个真实 Figma selection 端到端通过或给出合理 blocked reason。
