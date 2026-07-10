# 执行流程

## 第零步：收集信息，不读取 Git 记录

先从用户请求中提取已提供的信息：

- 项目路径列表
- 日期范围列表
- Git 作者或账户
- 输出目录

缺失信息按下面规则补齐。

### 0.1 确认项目路径

项目路径是必问项。

- 如果用户已给项目路径，复述这些路径并纳入最终确认。
- 如果用户没给项目路径，询问：
  1. 使用当前路径项目
  2. 指定一个或多个项目路径

不要在最终确认前读取 `git log`。

### 0.2 确认日期范围

- 如果用户已给日期范围，转换为绝对日期并纳入最终确认。
- 如果用户没给日期范围，询问：
  1. 默认本周内
  2. 指定一个或多个日期范围

日期范围允许多个。每个范围最终生成一个计划文件。

### 0.3 确认输出目录

输出目录是必问项。

- 默认建议 `.scratch/weekly-report/`
- 用户可以指定任意可写目录
- 最终确认前不要创建目录、不要写文件

### 0.4 解析 Git 作者

用户没有指定作者时，默认当前 Git 账户，不单独询问作者。

允许在最终确认前运行这些轻量命令解析账户；这些命令不是 Git 记录读取：

```bash
git -C <project> config --get user.name
git -C <project> config --get user.email
git config --global --get user.name
git config --global --get user.email
```

优先使用邮箱。优先使用当前工作目录解析出的账户；当前工作目录无法解析时，再使用项目列表中第一个能解析出账户的项目。如果仍无法解析，询问用户指定作者。

### 0.5 准备计划文件名

- 每个日期范围准备一个计划文件名。
- 默认建议格式是 `weekly-report_YYYY-MM-DD_YYYY-MM-DD_<git username>.md`。
- `<git username>` 优先使用 `git config user.name`，并做文件名安全化处理；不要把完整邮箱放进默认文件名。
- 这个文件名只是默认建议，不是固定要求；最终确认清单必须让用户确认或修改。

## 第一步：执行前最终确认

收集完整信息后，必须向用户展示确认清单，等待用户明确确认。

确认清单至少包含：

```markdown
准备生成周报，请确认：

- Git 账户：[作者过滤条件]
- 时间范围：
  1. YYYY-MM-DD ~ YYYY-MM-DD
  2. YYYY-MM-DD ~ YYYY-MM-DD
- 项目路径：
  1. /path/to/project-a
  2. /path/to/project-b
- 输出目录：/path/to/output
- 计划文件：
  1. weekly-report_YYYY-MM-DD_YYYY-MM-DD_git-user.md
  2. weekly-report_YYYY-MM-DD_YYYY-MM-DD_git-user.md

确认后才会读取 git 记录并生成文件。
```

用户确认前，禁止执行：

- `git log`
- `git show`
- `git diff` 用于收集记录
- 创建输出目录
- 写入周报文件

## 第二步：确认后收集 Git 数据

确认后，优先使用脚本收集数据。

脚本路径必须从当前 skill 目录解析，优先使用 `scripts/collect-git-activity.sh`。不要硬编码 `.agents/skills/...`，因为本地开发目录、安装目录和插件缓存目录可能不同。

每个日期范围调用一次：

```bash
sh "<skill_dir>/scripts/collect-git-activity.sh" \
  --author "作者或邮箱" \
  --since "YYYY-MM-DD" \
  --until "YYYY-MM-DD" \
  --project "/path/to/project-a" \
  --project "/path/to/project-b"
```

脚本输出 TSV 风格文本，包含：

- `STATUS	ok`：项目有记录
- `STATUS	no_records`：该项目在该日期范围没有作者记录
- `STATUS	not_git`：不是 Git 仓库
- `STATUS	missing_path`：路径不存在或不可访问
- `COMMIT`、`STAT`、`FILE`、`MODULE`：可用于写周报的数据

## 第三步：脚本失败时兜底

脚本不存在、不可运行、报错、输出无法解析时，不要中断任务。改用手动 Git 命令。

### 3.1 校验项目

```bash
git -C <project> rev-parse --is-inside-work-tree
```

失败则跳过该项目，记录原因。

### 3.2 获取提交记录

```bash
git -C <project> log \
  --since="YYYY-MM-DD 00:00:00" \
  --until="YYYY-MM-DD 23:59:59" \
  --author="作者或邮箱" \
  --date=short \
  --pretty=format:"%h|%ad|%an|%ae|%s"
```

无输出表示该项目该周期无记录，跳过正文内容。

### 3.3 获取代码变更统计

```bash
git -C <project> log \
  --since="YYYY-MM-DD 00:00:00" \
  --until="YYYY-MM-DD 23:59:59" \
  --author="作者或邮箱" \
  --numstat \
  --pretty=format:""
```

用输出统计文件改动条目、新增行、删除行。二进制文件的 `-` 计为未知，不要强行估算。

### 3.4 获取变更文件和模块

```bash
git -C <project> log \
  --since="YYYY-MM-DD 00:00:00" \
  --until="YYYY-MM-DD 23:59:59" \
  --author="作者或邮箱" \
  --name-status \
  --pretty=format:""
```

从路径提取主要模块或目录。不要按日期分组。

## 第四步：分析和合并工作项

按工作主题和模块整理，不按天整理。

可参考 commit message 关键词：

- 功能开发：`feat`、`add`、`implement`、新增、添加、实现
- 问题修复：`fix`、`bug`、修复、解决
- 重构优化：`refactor`、`optimize`、`improve`、重构、优化
- 文档和配置：`docs`、`config`、`build`、`ci`、文档、配置
- 测试相关：`test`、`spec`、测试

把相近提交合并为一个工作项。可以把英文 commit message 翻译或扩写成自然中文，但不要编造 Git 记录之外的事实。

## 第五步：跳过规则

- 非 Git 项目：跳过，并记录原因。
- 路径不存在：跳过，并记录原因。
- 指定范围内没有作者记录：跳过正文，不创建空项目小节。
- 某个日期范围所有项目都无记录：不生成该范围的空周报文件。
- 跳过信息写入最终回复；已生成的周报文件中可放到“数据说明”区块。

## 第六步：生成文件和最终回复

确认有有效记录后，创建输出目录并写入 Markdown 文件。

最终回复包含：

- 已生成文件路径
- 使用的 Git 作者
- 覆盖的日期范围
- 有记录的项目
- 跳过的项目和原因
- 没有生成文件的日期范围及原因
