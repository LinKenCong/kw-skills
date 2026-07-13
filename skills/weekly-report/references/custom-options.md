# 自定义选项

## 必须询问或确认

1. 项目路径
   - 默认当前路径项目
   - 用户指定一个或多个项目路径

2. 日期范围
   - 如果用户未指定，询问默认本周内或自定义日期范围
   - 支持一次指定多个日期范围

3. 输出目录
   - 默认 `.scratch/weekly-report/`
   - 用户指定其他目录

4. 执行前最终确认
   - 报告人 Git username
   - Git 作者过滤条件
   - 日期范围列表
   - 项目路径列表
   - 输出目录
   - 计划文件名；默认建议为 `weekly-report_YYYY-MM-DD_YYYY-MM-DD_<git username>.md`，但必须允许用户确认或修改

## 默认但不主动询问

1. Git 作者
   - 默认当前 Git 账户
   - 只在用户指定作者或无法解析当前账户时询问

2. 输出格式
   - 固定 Markdown
   - 不询问 text/html

3. 报告详细程度
   - 固定标准周报结构
   - 不询问简洁版、标准版、详细版

## 已移除选项

不要提供这些选项：

- 工作量评估
- 趋势分析
- 按天产出统计
- 历史周期对比

## 确认话术模板

```markdown
准备生成周报，请确认：

- 报告人：[Git username]
- 作者过滤：[作者过滤条件]
- 时间范围：
  1. YYYY-MM-DD ~ YYYY-MM-DD
- 项目路径：
  1. /path/to/project
- 输出目录：/path/to/output
- 计划文件：
  1. weekly-report_YYYY-MM-DD_YYYY-MM-DD_git-user.md

确认后我才会读取 git 记录并生成文件。
```
