# Release notes / 发布说明规范

- Use `### What's new` for English, followed by `### 更新内容` for Chinese. Keep the two lists equivalent.
- List only actual changes to the application: added or changed behavior, fixed problems, and changed compatibility or licensing terms when applicable.
- Describe the user-visible result. Omit implementation details such as pixel adjustments, internal matching algorithms, or source-file names.
- Omit test results, test counts, README edits, screenshot updates, and statements that the license, runtime requirements, or other behavior remain unchanged.
- Do not describe a suspected or unverified issue as fixed. Do not claim broader coverage than the change establishes.
- Keep the existing bilingual `CHANGELOG.md`; separate English and Chinese history files are not required. Do not rewrite historical Releases unless requested.

- 英文使用 `### What's new`，中文使用 `### 更新内容`，两组条目内容对应。
- 只列程序实际改变的内容：新增或调整的行为、修复的问题，以及确实发生变化的兼容性或许可条件。
- 描述用户可感知的结果，不写像素调整、内部匹配算法、源码文件名等实现细节。
- 不列测试结果、测试数量、README 修改、截图更新，以及许可证、运行环境等保持不变的声明。
- 不将疑似或尚未验证的问题写成已修复，不扩大修复范围。
- 保留原有中英合并的 `CHANGELOG.md`，不必另建中英文更新历史文件。未经要求不重写历史 Release。

## Template / 模板

```markdown
### What's new

- Added ...
- Fixed ...

---

### 更新内容

- 新增……
- 修复……
```

## Example / 示例

- Use: “Fixed elapsed durations being truncated in Recent activity in some layouts.”
- Avoid: “Increased the duration column and window width by 8 px.”
- 推荐：“修复部分布局下‘最近活动’耗时显示不全的问题。”
- 避免：“将耗时列和整个窗口加宽 8px。”
