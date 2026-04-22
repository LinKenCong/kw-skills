# figma-to-code Validation Status

更新时间：2026-04-22

## 目的

本文件区分三件事：

- 自动化和静态验证是否通过
- 哪些能力已经在真实 Figma Desktop 中 live 验证
- 哪些能力目前只有代码实现，还没有完成 live 验证

## 已完成的自动化与静态验证

以下项已通过：

- `cd skills/figma-to-code && npm test`
- `cd skills/figma-to-code && npm run check`
- `node skills/figma-to-code/scripts/bridge_client.mjs capabilities`
- 静态安全扫描未发现 secrets / shell injection / `eval` / `exec` / pickle / SQL injection 模式匹配

本轮补修并验证过的阻塞问题：

1. bridge 资产写入路径穿越风险
   - `relativePath` 不再直接拼接落盘。
   - 目标路径会先做真实路径边界校验，越界会直接拒绝。

2. bundle page 目录读取与实际落盘不一致
   - query 读取路径已与 bridge 落盘逻辑对齐。
   - 含 `:` 等特殊字符的 pageId 场景已补测试覆盖。

结论：
- 代码质量阻塞项已清零。
- 自动化层面可以继续迭代，不存在已知的 reviewer 阻塞项。

## 已完成的真实 Figma Desktop live 验证

以下点已经做过真实 Desktop 验证：

- 插件重启后能重新连上 bridge
- `extract-selection --assets --screenshot --node-screenshots`
- 单节点 direct screenshot 清晰度可用
- 多节点 direct per-node screenshot 可用
- 多节点资源按 node-scoped 子目录落盘
- 重复提取时旧缓存会被正确清理，不会残留上一轮节点资源

明确结论：
- 当前可接受的截图来源是 direct export。
- crop-derived screenshot 路线已经被真实验证否决，不应再作为当前方案回归。

## 已实现但尚未完成 live 验证的点

以下能力目前只能声明为“代码已实现”，不能声明为“真实链路已验收完成”：

- `extract.pages`
- `extract-selected-pages-bundle`
- bundle cache 下的多页面真实提取链路
- `query.pages` 在真实 bundle 上的 live 验证
- `query.screenshots` 在真实 bundle 上的 live 验证
- `query.regions` 在真实 bundle 上的 live 验证
- `query.variables` 在真实 bundle 上的 live 验证
- `query.components` 在真实 bundle 上的 live 验证
- `query.css` 在真实 bundle 上的 live 验证
- 更复杂节点场景下 SVG/PNG 资源完整性的更广覆盖 live 验证

这些点的状态应表述为：
- code implemented
- automated checks passed
- live validation pending

不应表述为：
- product-ready
- fully verified in Figma Desktop

## 当前可做出的判断

### 可以做出的判断

- 代码主干已完成。
- reviewer 指出的阻塞 bug 已修复。
- 自动化测试、检查和静态安全扫描已通过。
- 单节点与多节点的 direct screenshot 主线已在真实 Desktop 中验证可用。

### 不能做出的判断

- 不能宣称整个能力面都已经完成真实 Desktop 验收。
- 不能宣称 bundle 工作流已经达到产品级完全可用。
- 不能再把 crop / selection-union 截图路线描述为当前可选主方案。

## 当前是否适合进入 commit 阶段

以代码质量和已修阻塞项来看，可以进入 commit 阶段。

但如果目标是“对整个增强能力面做产品级验收后再发布”，仍有剩余 live 验证缺口，主要集中在 bundle extraction 和 bundle-aware query 的真实 Desktop 链路。
