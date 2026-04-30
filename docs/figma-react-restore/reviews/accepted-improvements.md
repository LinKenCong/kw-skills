# figma-react-restore 评审后二次评估：认可改进项一览

来源：

- `docs/figma-react-restore/reviews/frontend-design-to-code-review.md`
- `docs/figma-react-restore/reviews/backend-plugin-service-review.md`

结论：两份报告的总体判断均为“混合”。我认可这个判断：当前 skill 的证据闭环、文本硬规则、反截图作弊和 artifact 分层是正确方向；但距离“生产级设计稿转前端代码 + 稳健本地 runtime”仍有明确差距。以下是我认可应进入后续计划的改进项。

## P0：应优先处理

| 方向 | 认可改进项 | 原因 | 来源 |
|---|---|---|---|
| Runtime 安全边界 | 为本地 runtime 增加最小认证机制：启动时生成 token，CLI / plugin 请求带 token；收紧 CORS；`/health` 只暴露最小信息。 | 当前 localhost service 无认证且 CORS 全开放，可能被任意本地网页或进程驱动，污染 extraction evidence。 | 后端评审 High 1 |
| Job/session 完整性 | 建立严格 job 状态机和 session/owner 校验：禁止 terminal job 被覆盖，progress/artifact/result/cancel 必须校验 job owner。 | extraction result 是后续 DesignIR / verify / restore 的事实来源，完整性必须优先保障。 | 后端评审 High 2 |
| LayoutIR 能力 | 扩展 layout evidence：alignment、size mode、constraints、absolute positioning、wrap、clip、z-order、radius/effects 等。 | 当前只靠 box / gap / padding 容易推动 Agent 写 magic number 或过度 absolute positioning。 | 前端评审 High 1 |
| DOM 映射分层 | 将 `data-figma-node` 映射分为 required / optional / ignored；missing mapping 不应全部转为高优先级 layout failure。 | 当前近似要求所有 regions 映射，会污染真实项目 DOM，并让 repair-plan 被 mapping failure 淹没。 | 前端评审 High 3、后端评审 Low 3 |
| Route state contract | 支持 setup script、localStorage/cookies、query params、mock data、wait selector、expected state assertions。 | wrong state 现在容易被误判为 layout/text/asset 问题，导致 Agent 过拟合 CSS。 | 前端评审 High 2 |

## P1：下一轮架构与产品质量增强

| 方向 | 认可改进项 | 原因 | 来源 |
|---|---|---|---|
| Service lifecycle | `service start` 先检查已有 lock/health；监听成功后再写 lock；增加 idle timeout 和 owner metadata。 | 当前 lockfile 不是强互斥，重复启动或端口占用可能产生脏状态。 | 后端评审 Medium 1、Recommended 3 |
| Artifact contract | 限制 `ArtifactRef.path` 必须为 artifact root 相对路径；默认拒绝绝对路径；schema 校验 path/base64/media type。 | artifact 写入相对安全，但后续 ref 解析仍可能被污染到 artifact root 外。 | 后端评审 Medium 3、Recommended 4 |
| Error model | 引入结构化 `ServiceError`：`code`、`httpStatus`、`recoverable`、`hint`；CLI 根据 code 给下一步。 | 当前业务错误大量表现为 500，Agent/CLI 无法稳定区分可恢复状态。 | 后端评审 Medium 4、Recommended 5 |
| Restore 异常记录 | `runRestoreAttempt` catch 分支也写 `final-report.json`、append state，并记录错误分类。 | 异常路径现在可能缺 final report，降低复现和 blocked 诊断能力。 | 后端评审 Medium 6、Recommended 7 |
| Design-to-code brief | 在 `agent-brief` 外生成 implementation brief：结构树、关键 sections、assets、tokens、layout constraints、component boundaries、likely files。 | 现在 repair-plan 更像差异列表，不足以指导从 0 到 1 的可维护 React/CSS 实现。 | 前端评审 Medium 3/4、Recommended 1 |
| Source ownership discovery | 探测 Next/Vite/Remix route、CSS modules、Tailwind config、design token 文件，在 brief 中输出 likely files。 | 上下文拆分减少了读证据，但没有减少找代码位置的成本。 | 前端评审 Medium 3、Recommended 7 |
| Asset equivalence | 对 icon/vector/decorative 支持 existing icon component、inline SVG、CSS mask、sprite symbol 等 semantic-equivalent 通过条件。 | 当前 asset verifier 容易强迫导入 Figma 导出文件，和项目设计系统冲突。 | 前端评审 Medium 1、Recommended 6 |
| Responsive matrix | 支持多 viewport spec 或至少 final mobile/tablet smoke check。 | 单 desktop 通过不代表现代前端页面可用。 | 前端评审 Medium 2、Recommended 5 |

## P2：稳定性、维护性和测试增强

| 方向 | 认可改进项 | 原因 | 来源 |
|---|---|---|---|
| Plugin 可靠性 | `handledJobs` 从 boolean 改为状态表；支持 artifact upload retry；service restart 后能恢复/失败原 job。 | 当前瞬时上传失败可能让 job 卡住直到 CLI timeout。 | 后端评审 Medium 5、Recommended 6 |
| Plugin 代码维护 | 拆分 `plugin/code.js` 的 serialization、asset policy、message handling；共享或生成协议常量/validator。 | Plugin 端未类型化且体量较大，协议漂移风险高。 | 后端评审 Low 1、Recommended 6 |
| Upload 传输 | 从 JSON + base64 演进到 chunk/resume 或至少更明确的大文件失败恢复。 | 大 selection / 大图下 base64 膨胀和失败重试成本高。 | 后端评审 Low 2 |
| Region strictness | 将 `strictness` 映射为 per-region threshold，而不是统一 region diff 阈值。 | text/icon/image/background 对 diff 容忍度不同。 | 前端评审 Low 2 |
| Text rich mapping | 支持一个 Figma TextNode 对应多个 inline React 节点，或多个 DOM 节点组合成视觉文本。 | rich text / inline span 在真实前端常见，当前 exact mapping 有边界。 | 前端评审 Low 1 |
| Cleanup archive | final cleanup 前提供 archive option，或保留 final report / last brief / last report。 | 自动清理会丢失 PR 说明、审计和复现证据。 | 前端评审 Low 3 |
| 测试补强 | 增加 security、job state、artifact pollution、wrong state、responsive、existing icon、upload retry 等用例。 | 当前 unit/browser tests 覆盖基础能力，不足以保护生产级演进。 | 两份报告 Recommended |

## 不立即采纳或需降级处理的点

| 建议 | 处理意见 | 原因 |
|---|---|---|
| 立即做完整 codegen adapter | 暂不作为 P0。 | 当前 skill 定位仍是 Agent 修复闭环；先补 evidence、state、mapping、brief，比直接 codegen 更稳。 |
| 强制所有响应式断点成为默认 gate | 降级为 P1。 | V1 明确 desktop baseline，直接强制多 viewport 会扩大复杂度；可先做 final smoke 或 opt-in matrix。 |
| 全面云视觉服务 adapter | 暂不纳入近期。 | 目前主要瓶颈在本地 runtime 安全、状态机、layout evidence 和 implementation brief。 |

## 建议执行顺序

1. 先做后端 P0：runtime token / CORS、job owner/state machine。
2. 并行做前端 P0：LayoutIR 扩展、DOM mapping tier、route state contract。
3. 再做 P1：artifact contract、structured errors、implementation brief、source ownership、asset equivalence。
4. 最后补 P2：plugin retry/type sharing、region thresholds、cleanup archive、系统化 eval/test cases。
