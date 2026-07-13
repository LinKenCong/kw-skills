# 高级功能

## 多项目支持

多项目是主流程能力，不是额外分析功能。

规则：

- 一个日期范围生成一个周报文件。
- 多个项目写入同一个周期文件。
- 只写有记录的项目。
- 无记录项目静默跳过，不写入报告正文、项目范围、数据说明或跳过列表。
- 非 Git 项目、路径不存在、无法读取 Git 记录的项目作为异常跳过。
- 异常跳过原因写入最终回复；已生成报告可在“数据说明”中列出。

## 脚本优先

优先使用当前 skill 目录下的脚本。脚本路径应从 `SKILL.md` 所在目录解析，不要硬编码 `.agents/skills/...`：

```bash
sh "<skill_dir>/scripts/collect-git-activity.sh" \
  --author "作者过滤条件" \
  --since "YYYY-MM-DD" \
  --until "YYYY-MM-DD" \
  --project "/path/to/project-a" \
  --project "/path/to/project-b"
```

脚本只负责收集 Git 数据，不负责写最终周报。这样 agent 可以根据用户语境整理中文表达。

脚本依赖尽量少：

- `sh`
- `git`
- 基础命令：`printf`、`sed`、`awk`、`sort`、`wc`

不依赖：

- Python
- Node.js
- jq
- GNU date
- 第三方包

## 兜底执行

如果脚本失败，直接执行 `references/execution-flow.md` 中的手动 Git 命令。

兜底流程和脚本流程必须产出同样语义的数据：

- 项目是否 Git 仓库
- 指定作者在指定周期的提交列表
- 主要文件和模块
- 异常跳过项目及原因

## 智能整理

允许做这些增强：

- 把英文 commit message 翻译成中文
- 把简短 commit message 扩写成自然工作描述
- 合并相似 commit 为一个工作项
- 按模块和主题归类

禁止做这些增强：

- 工作量评估
- 趋势分析
- 按日期产出描述
- 历史周期对比
- 编造没有 Git 记录支撑的工作内容
