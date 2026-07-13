# 参数配置

## 必要信息

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `project_paths` | 项目路径列表。必须向用户确认；允许一个或多个路径 | 当前工作目录，但必须确认 |
| `date_ranges` | 日期范围列表。允许一次指定多个范围 | 当前日期所在自然周的周一到今天，但必须确认 |
| `output_dir` | 周报输出目录。必须向用户确认 | `.scratch/weekly-report/` |
| `final_confirmation` | 执行前最终确认。包含作者、日期范围、项目路径、输出目录、计划文件名 | 无，必须等待用户确认 |

## 自动解析信息

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `author_filter` | Git 作者过滤条件。可优先用邮箱以提高 `git log --author` 匹配稳定性；用户指定作者时使用用户指定值 | 当前 Git 账户 |
| `report_user` | 报告人展示名。必须来自 Git username（`git config user.name`）或用户明确指定的用户名，不用邮箱 | 当前 Git username |
| `output_files` | 计划生成文件名。每个日期范围一个 Markdown 文件；默认只是建议，执行前必须让用户确认或修改 | `weekly-report_YYYY-MM-DD_YYYY-MM-DD_<git username>.md` |
| `format` | 输出格式 | Markdown |

## 作者解析规则

1. 用户明确指定 Git 账户、用户名、邮箱时，直接使用用户指定值作为过滤条件；如果用户只给邮箱，仍要单独确认报告人展示名。
2. 用户未指定时，默认当前 Git 账户，不单独询问作者。
3. 同时读取当前工作目录的 `git config user.name` 和 `git config user.email`。
4. `report_user` 优先使用 `git config user.name`；如果取不到 `user.name`，从项目列表或全局 Git 配置继续解析；仍取不到时，询问用户指定 Git username。不要把邮箱直接作为报告人。
5. `author_filter` 可优先使用 `git config user.email`；没有邮箱时使用 `git config user.name`。如果当前工作目录无法解析，再从项目列表中按顺序读取第一个能解析出账户的项目；如果都解析失败，再读全局 Git 配置。
6. 如果仍然无法解析作者过滤条件，询问用户指定 Git 作者。
7. 最终确认清单必须展示报告人和实际使用的作者过滤条件，用户可在确认前修改；生成报告时只把报告人写入正文，不默认展示完整邮箱。

## Git 用户名和文件名规则

- 默认文件名格式：`weekly-report_YYYY-MM-DD_YYYY-MM-DD_<git username>.md`。
- `<git username>` 默认来自 `git config user.name`，同时用于报告人展示和建议文件名。
- 如果 `user.name` 为空，先尝试从其他项目或全局 Git 配置读取；仍为空时，询问用户指定 Git username。只有在用户同意时，才可用 Git 邮箱 `@` 前的本地部分作为文件名后缀；不要把完整邮箱写入默认文件名或报告人。
- 文件名中的 Git 用户名要做安全化处理：去掉首尾空白，把空白、路径分隔符和不适合文件名的字符替换为 `-`，保留字母、数字、`.`、`_`、`-`。
- 如果用户指定文件名，以用户指定为准；如果用户没指定，最终确认清单展示默认建议文件名并等待确认。
- 如果目标文件已存在，执行前确认清单应说明会覆盖，或询问用户是否改名。

## 日期范围规则

- 日期必须在执行前转换成绝对日期：`YYYY-MM-DD ~ YYYY-MM-DD`。
- “本周内”表示当前日期所在自然周的周一到今天。
- `since` 使用开始日期当天 `00:00:00`。
- `until` 使用结束日期当天 `23:59:59`。
- 多个日期范围分别生成多个文件。
- 如果某个日期范围所有项目都没有记录，不生成空周报文件。

## 文件命名规则

默认建议文件名：

```text
weekly-report_YYYY-MM-DD_YYYY-MM-DD_<git username>.md
```

例子：

```text
weekly-report_2026-07-06_2026-07-10_bob.md
weekly-report_2026-06-29_2026-07-05_alice-chen.md
```
