# figma-to-code Docs

本目录只保留补充 `skills/figma-to-code/` runtime 文档的高价值项目文档，不再混放历史计划、研究草稿、已过时方案和执行清单。

运行时事实与调用方式以以下文件为准：
- `skills/figma-to-code/README.md`
- `skills/figma-to-code/SKILL.md`
- `skills/figma-to-code/plugin/API_CAPABILITIES.md`
- `skills/figma-to-code/plugin/capabilities.json`

本目录现在只保留 3 份蒸馏文档：

1. `current-state.md`
   - 当前主线、能力边界、产物模型、关键设计决策。
2. `validation-status.md`
   - 自动化验证、真实 Figma Desktop live 验证、尚未 live 验证的点。
3. `research-backlog.md`
   - 仍有价值但尚未进入稳定能力面的官方 API 研究和后续方向。

本轮文档蒸馏后的硬结论：

- 主线继续保持 `Bridge-first / Scheme B / capability-driven`。
- 插件不是任意 raw Figma Plugin API 执行器。
- mutation API 不作为稳定能力对外开放。
- crop/selection-union 截图路线已经在真实 live 验证后被否决，不再作为当前方案。
- 多节点提取以节点级直接导出为准，资源按 node-scoped 目录组织。
- bundle 消费优先走 query 和 bundle metadata，不建议手写路径拼接逻辑。

本目录替代了之前分散的 audit / report / todo / implementation plan / memo 类型文档，目的不是保留全过程，而是保留当前仍值得被维护者继续使用的结论。
