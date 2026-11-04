# Changelog / 更新记录

## v0.1.1 — 2026-11-04

License-only release. / 仅变更许可及相关文档。

- Replaced the project-specific no-paid-redistribution license with the standard MIT License.
- Commercial use, modification, redistribution, sublicensing and selling copies are permitted under MIT.
- Updated the bilingual README, repository description and release information.
- Runtime behavior is unchanged. The v0.1.0 tag and source archives retain their original license text.

改为标准 MIT 许可证，移除禁止收费销售、收费分发及另行书面授权的附加限制。程序运行逻辑未变更；v0.1.0 历史标签和源码归档保留原有许可文本。

## v0.1.0 — 2026-11-03

Initial public source release. / 首个公开源码版本。

- Local Codex session monitoring independent of the agent loop.
- Task timing, first reply wait and time since the latest activity.
- Tool-call start/return merging, task history and explicit parent/child grouping.
- Retry, failure and transport-fallback summaries with expandable details.
- Codex-owned proxy traffic, process filtering and up to 30 minutes of chart history.
- Chinese/English interface, light/dark themes and collapsible panels.
- Millisecond source timestamps retained; readable integer-second duration display.
- Bilingual README files and screenshots rendered from synthetic demo data.
- Source-available license: commercial use permitted; paid redistribution requires separate written permission.
- 97 local automated tests passing on Windows with Node.js 24.19.0.

This version is distributed as source; no packaged installer is included.

本版以源码形式提供，尚无打包安装程序。详细功能、环境要求和使用边界见 [中文 README](README.zh-CN.md)。
