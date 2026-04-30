# figma-react-restore Backend / Plugin / Service 架构评审

## Executive Summary

本次评审范围覆盖 `skills/figma-react-restore` 中 Figma plugin、本地 runtime service、CLI、artifact store、schema、job/session、service lifecycle、verification/restore 后端流程，以及 `SKILL.md` / `references` 中的服务说明。

总体判断：当前实现已经形成了可运行的 V1 闭环，模块边界基本清晰：Figma plugin 负责采集，runtime service 负责 session/job/artifact 协议，CLI 负责编排，artifact store 持久化 run evidence，verify/restore 负责离线验证和 repair plan。它比临时脚本式 Figma-to-React 流程更可审计、更可复现。

但从资深后端/架构视角看，runtime service 仍偏“本地 demo service”而不是稳健的本地 agent runtime：本地 HTTP 服务没有任何认证或 origin 约束，job/session 状态完全驻留内存且生命周期状态机较弱，lockfile/service lifecycle 对并发启动和异常退出的防护不足，artifact schema/path 边界仍有可被污染或误用的入口。若该 skill 会被频繁用于真实项目或含敏感 Figma 内容的项目，建议先补齐这些后端边界，再扩展功能。

## Architecture Assessment

当前架构的主要数据流是：

1. Agent/CLI 通过 `figma-react-restore extract --selection` 创建 extraction job。
2. 本地 runtime service 通过 Hono 暴露 `/sessions`、`/events`、`/jobs`、`/jobs/:id/artifacts`、`/jobs/:id/result`。
3. Figma plugin UI 固定连接 `http://localhost:49327`，注册 session，接收 SSE job 或轮询 pending jobs。
4. plugin main thread 采集 selection、node tree、文本、baseline screenshot、asset bytes，并经 UI 上传 artifact 和 result。
5. `ArtifactStore` 将 run、artifact refs、raw extraction、DesignIR、fidelity spec、verify report、repair plan、agent brief 写到 `<react-project>/.figma-react-restore`。
6. `build-ir`、`verify`、`restore` 在 extraction 之后离线读取 artifacts，不再依赖 runtime service。

正向评价：

- 模块职责拆分基本符合 V1 spec：CLI、service、schema、artifact store、IR、verify、repair、restore loop 分离，后续可替换 service transport 或 artifact backend。
- schema-first 方向正确，核心 report/plan/run 数据写盘前多数经过 Zod 校验，降低了 agent 读取错误字段的概率。
- artifact root 被限定为 React project 下的 `.figma-react-restore`，普通 artifact 写入路径走 `resolveSafePath`，有基本路径穿越防护。
- service stop 流程有 pid/workspace health 校验，并拒绝在 active jobs 存在时默认停止，体现了本地进程治理意识。
- verification/restore 不依赖 service，能把 browser capture、diff、DOM/style/text checks、repair plan 和 agent brief 持久化，架构上利于复现和回归。
- plugin 已区分 implementation asset 与 `reference-only` evidence，并在 verifier 中阻止大截图/参考切片作为实现内容，能约束常见“截图糊页面”反模式。

主要架构风险：

- Runtime service 当前是无认证、宽 CORS、固定端口的本地 HTTP API，任何能访问本机端口的进程或网页都可读写协议面。
- job/session 是纯内存状态，缺少严格状态机、owner 校验、幂等键和 restart recovery；artifact run 与 runtime job 的一致性依赖 happy path。
- lockfile 是单进程提示文件，不是强互斥；service start 没有已运行检测、端口预检或启动失败回滚。
- schema 对外部输入的语义约束不足：capability、job transition、artifact path/ref、base64、media sniffing、service lock URL 等仍偏宽松。
- plugin UI/main 是大体量原生 JS，和 TypeScript/Zod 协议定义之间没有自动生成或共享校验，协议漂移风险较高。

## Findings

### High

1. 本地 runtime service 缺少认证与 origin 约束，且 CORS 全开放，可被任意本地网页或本机进程驱动。
   - 证据：服务只按端口启动，未指定 host 或认证 token，见 `skills/figma-react-restore/src/service/index.ts:23`；所有请求统一设置 `access-control-allow-origin: *`，见 `skills/figma-react-restore/src/service/http.ts:27`；允许 `GET,POST,OPTIONS` 和 `content-type`，见 `skills/figma-react-restore/src/service/http.ts:29`；plugin UI 固定连接 `http://localhost:49327` 且不带 token，见 `skills/figma-react-restore/plugin/ui.html:22`；reference 文档也描述“不需要 token”，见 `skills/figma-react-restore/references/workflow.md:37`。
   - 影响：恶意网页可经浏览器 CORS 读 `/sessions`、`/jobs`，创建 job、取消 job、上传 artifact、提交 result。已完成 job 的 `result` 可能包含 Figma 文本、节点名、页面结构和 artifact paths；本地项目的 `.figma-react-restore` evidence 可被污染或导致 Agent 基于伪造 evidence 修改代码。
   - 风险等级理由：这是 service trust boundary 问题，不只是代码质量问题；即使限定为本地开发工具，浏览器访问 localhost API 是现实攻击面。

2. Job API 没有 session/owner 授权，也没有严格状态机，任意调用方可篡改或终结任意 job。
   - 证据：创建 job 只选择 connected session，见 `skills/figma-react-restore/src/service/http.ts:78`；progress/result/cancel 只按 `jobId` 操作，没有校验调用方属于该 job 的 session，见 `skills/figma-react-restore/src/service/http.ts:101`、`skills/figma-react-restore/src/service/http.ts:136`、`skills/figma-react-restore/src/service/http.ts:157`；`RuntimeState` 的 `addProgress`、`completeJob`、`failJob`、`cancelJob` 只是 patch 状态，没有禁止 terminal job 再被 result 覆盖，见 `skills/figma-react-restore/src/service/state.ts:126`、`skills/figma-react-restore/src/service/state.ts:137`、`skills/figma-react-restore/src/service/state.ts:141`、`skills/figma-react-restore/src/service/state.ts:145`。
   - 影响：多 plugin session、重复连接或恶意本地客户端都可对同一个 job 竞争提交 result；cancel 后仍可能被 result 改回 completed；CLI 轮询看到的终态不一定可信。该问题和无认证叠加后，会直接破坏 extraction evidence 的完整性。
   - 风险等级理由：job/result 是后续 build-ir、verify、restore 的事实来源，完整性边界薄弱会传播到整个修复流程。

### Medium

1. Service lifecycle / lockfile 不是强互斥，启动失败或重复启动时可能留下错误 lock 或孤儿服务。
   - 证据：`startRuntimeService` 先创建并写入 service lock，再启动 server，见 `skills/figma-react-restore/src/service/index.ts:17`、`skills/figma-react-restore/src/service/index.ts:20`、`skills/figma-react-restore/src/service/index.ts:23`；`createServiceLock` 不读取已有 lock、不做 health check、不做端口预检，见 `skills/figma-react-restore/src/service/lockfile.ts:10`；`service start` CLI 也没有调用 `readUsableServiceLock`，见 `skills/figma-react-restore/src/cli/index.ts:40`。
   - 影响：端口被占用、服务启动失败或用户重复启动时，lockfile 可能指向未真正可用的 pid/service；旧服务与新 lock 之间可能失配。`service stop` 的 health 校验降低了误杀风险，但不能阻止前置启动阶段的脏状态。

2. Session/job 状态完全驻留内存，缺少 restart recovery 和 run 状态修复。
   - 证据：`RuntimeState` 用内存 `Map` 保存 sessions/jobs/subscribers，见 `skills/figma-react-restore/src/service/state.ts:42`；service restart 后只保留 artifact store 文件，job 状态不恢复；session stale 只在 list/choose 时 prune，见 `skills/figma-react-restore/src/service/state.ts:63`、`skills/figma-react-restore/src/service/state.ts:68`、`skills/figma-react-restore/src/service/state.ts:172`。
   - 影响：service 崩溃或 dev restart 时，run 可能停留在 `running`，CLI 等待的 job 消失，plugin 重连后无法继续原 job。当前更像 ephemeral control plane，没有把 run/job 做成可恢复 state machine。

3. Artifact path/ref 边界不一致：普通写入安全，但 artifact ref 解析和 schema 允许绝对路径或外部路径进入后续流程。
   - 证据：`resolveSafePath` 会拒绝绝对路径和穿越，见 `skills/figma-react-restore/src/paths.ts:16`；`writeRunBuffer` 通过 `getRunFile` 写入 run 内部，见 `skills/figma-react-restore/src/artifact/store.ts:102`；但 `resolveArtifactPath` 和 `resolveRunPath` 遇到绝对路径会直接返回，见 `skills/figma-react-restore/src/artifact/store.ts:125`、`skills/figma-react-restore/src/artifact/store.ts:131`；`artifactRefSchema.path` 只是普通 string，见 `skills/figma-react-restore/src/schema.ts:33`；`addArtifact` 不校验 path 必须在 artifact root 内，见 `skills/figma-react-restore/src/artifact/store.ts:108`。
   - 影响：一旦 run.json/artifact refs 被外部工具、手工编辑或未授权 service 调用污染，后续 `build-ir`、`verify`、`restore` 可能读取 artifact root 之外的文件，破坏证据可追踪性，也违背 reference/spec 中“所有写入/引用都在项目 artifact root 内”的约束。

4. 对外错误语义过于粗糙，业务错误普遍变成 HTTP 500，不利于 CLI 自动化和问题定位。
   - 证据：全局 `onError` 只把 ZodError 映射为 400，其他 Error 全部映射为 500，见 `skills/figma-react-restore/src/service/http.ts:38`；无 session、multiple sessions、unknown job 等业务错误都是普通 `Error`，见 `skills/figma-react-restore/src/service/state.ts:68`、`skills/figma-react-restore/src/service/state.ts:107`。
   - 影响：CLI/Agent 无法稳定区分 `NO_PLUGIN_SESSION`、`MULTIPLE_SESSIONS`、`JOB_NOT_FOUND`、`INVALID_JOB_STATE`、`SERVICE_CONFLICT` 等可恢复/不可恢复状态，只能解析 message。测试中 no plugin session 期望 500，也固化了该语义。

5. Plugin 端 job handling 不具备可靠重试语义，瞬时上传失败会让 job 卡住直到 CLI timeout。
   - 证据：UI 在 `handleJob` 中一收到 job 就设置 `state.handledJobs[job.jobId] = true`，见 `skills/figma-react-restore/plugin/ui.html:221`；artifact 上传和 result 提交串行执行，见 `skills/figma-react-restore/plugin/ui.html:230`；如果 `finishExtraction` 失败，`failExtraction` 也依赖同一个 runtime 连接，见 `skills/figma-react-restore/plugin/ui.html:247`。
   - 影响：网络抖动、service restart、单个 artifact 超限或 result 提交失败时，plugin 已把 job 标记为 handled；轮询 fallback 后不会重新处理 pending/running job。CLI 只能超时，run 也可能残留不完整 artifacts。

6. Restore 流程在异常路径上的状态记录不完整，阻塞状态可能无法进入 final report/state。
   - 证据：`runRestoreAttempt` catch 只把当前 `attempt.json` 写成 blocked，然后重新抛错，没有 `appendAttempt` 或 `writeFinalReport`，见 `skills/figma-react-restore/src/restore/loop.ts:122`；dev server 子进程 finally 只 `SIGTERM`，不等待退出，也不处理子进程树，见 `skills/figma-react-restore/src/restore/loop.ts:127`。
   - 影响：verify/capture/repair-plan 早期异常时，CLI 只输出泛化 error，`.figma-react-restore/runs/<runId>/final-report.json` 可能缺失，plateau/max-iteration 的状态历史也不完整；带 `--dev-command` 的项目可能残留子进程。

7. Schema 对协议层输入约束偏宽，不能充分表达 V1 contract。
   - 证据：`jobCreateSchema.capability` 是任意 string，见 `skills/figma-react-restore/src/schema.ts:471`；`artifactUploadSchema.dataBase64` 是任意 string，`mediaType` 也是 optional string，见 `skills/figma-react-restore/src/schema.ts:478`；`serviceLockSchema.url` 是普通 string，见 `skills/figma-react-restore/src/schema.ts:503`。
   - 影响：runtime 需要在业务代码里补大量校验，且当前仍会接受无效 base64 字符串、未知 capability、弱 URL/path 语义。随着 capability 增加，协议漂移会更明显。

### Low

1. Plugin main code 体量较大且未类型化，维护成本高。
   - 证据：`plugin/code.js` 同时处理 selection 序列化、文本提取、颜色/排版、asset 策略、导出、错误映射，入口从 `skills/figma-react-restore/plugin/code.js:42` 一直延伸到大量 helper；UI 也自行实现 session、SSE、polling、upload、日志逻辑，入口见 `skills/figma-react-restore/plugin/ui.html:61`。
   - 影响：plugin 与 `src/schema.ts` 的协议没有共享类型或生成校验，字段新增/改名容易造成 silent break。长期建议把协议类型/常量生成到 plugin 或增加轻量 runtime validation。

2. Artifact upload 使用 JSON + base64，V1 可接受，但大 selection 下内存和失败恢复能力有限。
   - 证据：HTTP body limit 和 artifact limit 固定为 35MB/24MB，见 `skills/figma-react-restore/src/service/http.ts:20`；plugin 将 bytes 转成 base64 后再 JSON 上传，见 `skills/figma-react-restore/plugin/ui.html:230`、`skills/figma-react-restore/plugin/ui.html:297`；V1 spec 也说明 JSON + base64 只是暂时方案，见 `docs/figma-react-restore/v1-implementation-spec.md:442`。
   - 影响：单个大图或多个 asset 时，Figma UI 内存、base64 膨胀和网络失败都会放大；缺少 chunk/resume 会让一次失败导致整个 job 失败。

3. Verification 部分已有较完整 checks，但若无 DOM mapping，很多高价值诊断会退化。
   - 证据：DOM box/style/text mapping 依赖 `[data-figma-node]`，见 `skills/figma-react-restore/src/verify/capture.ts:144`；缺失时 verifier 生成 missing/mapping-missing，见 `skills/figma-react-restore/src/verify/report.ts:385`、`skills/figma-react-restore/src/verify/report.ts:409`；Skill 只建议“where practical”添加 `data-figma-node`，见 `skills/figma-react-restore/SKILL.md:20`。
   - 影响：这是可用性而非后端 correctness 问题。若目标项目很难加 node id，verify 会更依赖 pixel diff，repair plan 的定位精度下降。

4. 文档中的 service lifecycle 规则合理，但实现没有完全编码化。
   - 证据：reference 要求优先 `extract --selection --manage-service`，不要长期保持 service，见 `skills/figma-react-restore/references/workflow.md:18`；要求手动启动后停止 service，见 `skills/figma-react-restore/references/workflow.md:21`；实现侧仍允许直接 `service start`，且没有 idle timeout 或 owner 标记，见 `skills/figma-react-restore/src/cli/index.ts:40`。
   - 影响：依赖 Agent 遵守文档，而不是 runtime 自我约束。对多 agent / 多项目并行场景，容易出现长期运行的本地服务和混淆的 plugin session。

## Recommended Improvements

1. 建立本地 runtime 的最小安全边界。
   - 在 `service start` 时生成随机 one-time token，写入 lockfile；CLI 读取 lockfile 后给所有 service requests 加 header；plugin UI 从用户/CLI 提示或 lockfile bridge 获取 token，所有 mutating API 和 sensitive GET 都校验 token。
   - 将 server 显式绑定到 `127.0.0.1`，并收紧 CORS origin。若 Figma plugin 的 origin 难以稳定识别，至少只允许带 token 的请求读取响应。
   - `/health` 可保持无 token 但只返回最小状态；workspaceRoot、artifactRoot、pid 等敏感信息放到 authenticated health/detail endpoint。

2. 把 job/session 做成明确状态机。
   - 定义 `pending -> running -> uploading -> completed|failed|canceled|expired`，禁止 terminal 状态被覆盖。
   - 给 job 分配 `sessionId` + `jobSecret` 或 `claimToken`，plugin 在 progress/artifact/result/cancel 时必须带上；CLI cancel 也要通过 owner/admin token。
   - 增加 idempotency key：artifact upload/result 可重复提交同一 artifactId/result revision；重复请求返回已有结果，不破坏状态。
   - job terminal 后更新 run status；service 启动时扫描 `running` runs，按 policy 标记 `blocked` 或 `failed`，并写 warning。

3. 强化 service lifecycle 和 lockfile 互斥。
   - `service start` 先读取 lockfile 并验证 health；已有健康服务时直接返回 existing service，而不是覆盖 lock。
   - 启动 server 成功监听后再写 lock；启动失败要删除本次写入的临时 lock。
   - 在 lockfile 增加 `tokenHash`、`hostname`、`ownerPid`、`createdByCommand`、`lastHeartbeatAt`，便于 stop/cleanup 判断 ownership。
   - 增加 idle timeout：无 plugin session 且无 active job 一段时间后自动退出，降低长期暴露本地 API 的概率。

4. 收紧 artifact store 和 schema contract。
   - `ArtifactRef.path` 改为 project artifact root 相对路径，schema 层禁止绝对路径和 `..`。
   - `resolveArtifactPath` / `resolveRunPath` 默认拒绝绝对路径；如果需要调试读取外部 reference，使用显式 `allowExternalReference` 选项。
   - `artifactUploadSchema` 校验 base64 格式、最大 encoded size、artifactId/path/name 长度；media type 由 magic bytes/sniffing 与提交值交叉校验。
   - `jobCreateSchema.capability` 改为 enum，未知 capability 直接 400/422。

5. 改善错误模型和 CLI 自动化体验。
   - 引入 `ServiceError`，包含 `code`、`httpStatus`、`recoverable`、`hint`。
   - 将 no session 映射为 409 或 424，multiple sessions 映射为 409，unknown job 映射为 404，invalid job transition 映射为 409，payload/schema 错误保持 400/422。
   - CLI 不要解析 message；根据 error code 给出下一步，例如打开 plugin、传 `--session`、重试 extraction、清理 stale lock。

6. 增强 plugin 可靠性和可维护性。
   - `handledJobs` 从 boolean 改成状态表：`claimed/extracting/uploading/result-submitted/failed`，只有 terminal ack 后才禁止重试。
   - artifact upload 失败时支持同 job retry；service restart 后 plugin 能重新查询 running/pending job 并恢复或 fail with reason。
   - 将 plugin protocol 常量、payload builder、基础 validator 从 `src/schema.ts` 生成或共享到 plugin build，减少 UI/main 与 TypeScript runtime 的协议漂移。
   - 拆分 `plugin/code.js` 的 extraction、asset policy、serialization、message handling，增加离线 fixture 测试或 snapshot 测试。

7. 完善 restore/verify 的异常记录。
   - `runRestoreAttempt` catch 分支也写 `final-report.json`，append restore state，并把 error code/message/trace artifact 写入 attempt。
   - `--dev-command` 启动的子进程使用 process group，退出时等待并处理超时 kill，避免残留 dev server。
   - verification blocked report 中保留原始错误分类，例如 route unreachable、baseline missing、browser launch failed、image compare failed，便于 Agent 决策。

8. 测试补强。
   - 增加无 token/错误 token、跨 session result、cancel 后 result、重复 result、service start existing lock、port busy、service crash recovery、artifact absolute path/ref pollution、invalid base64、large artifact limit 的测试。
   - 对 plugin UI 的 polling/SSE fallback 和 upload retry 做 browser-like 单测或集成测试。
   - 对 restore 异常路径验证 `attempt.json`、`state.json`、`final-report.json` 的一致性。

## Verdict

混合。

理由：相对脚本化或一次性 Figma 导出工具，当前架构明显更好：它有项目级 artifact root、schema、run evidence、verify report、repair plan、agent brief 和独立的 service lifecycle 文档，已经具备 V1 闭环。但以“可长期维护的本地后端 runtime”标准看，安全边界、job/session 状态机、service lifecycle、artifact ref contract 和异常恢复仍不足。

如果仅作为受控本机、短时启动的内部开发 skill，当前实现可继续试用；如果要进入高频真实项目使用，尤其涉及敏感 Figma 文件或多 agent 并行环境，应先修复 High 项，并把 Medium 项中 lifecycle、state machine、artifact contract 三类问题列为下一轮架构硬化任务。
