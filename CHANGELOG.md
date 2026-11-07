# Changelog / 更新记录

## v0.1.4 — 2026-11-08

Account quota records, customizable layout and interrupted-call diagnostics. / 新增账户额度记录、模块排序与调用中断诊断。

- Added 5-hour and weekly account balances, progress bars, collapsed summary rings and reset countdowns. Both windows independently turn red-orange below 10% remaining.
- Added official quota reads through the installed Codex executable using its existing sign-in: automatic queries at least 60 seconds apart, a manual refresh action, bounded request timeouts and log fallback. No model call or conversation is created.
- Prevented delayed, lower-usage log snapshots from rolling a balance back within the same quota window; fresh official reads can still apply genuine corrections.
- Added observed per-turn quota differences for the selected session. Concurrent activity is labelled; missing/stale boundaries, resets and corrections remain unknown instead of becoming fabricated consumption.
- Added persistent panel ordering with drag handles, up/down buttons, keyboard controls and restore-defaults. The session selector remains fixed, while existing panel state and scroll positions are preserved.
- Unified compact collapsed-card dimensions and placed layout, language and theme controls together in the header.
- Added exact-call diagnostics for code-mode host interruptions. Unreturned calls show completion unconfirmed with a stop/retry suggestion; a late return repairs the same row without declaring the whole task terminated.
- Updated English/Chinese documentation and retained the standard MIT License. This remains a source release without an installer.
- 134 automated tests passed on Windows with Node.js 24.19.0. Isolated-browser checks covered ordering persistence, drag/button/keyboard interactions, state preservation, toolbar alignment and light/dark quota colors.

新增 5 小时与周额度展示、恢复倒计时、折叠圆环、低于 10% 的红橙色提示及官方主动刷新。每轮记录为账户快照的观测差值，不是精确的单轮计费；多开或其他设备可能共同消耗。模块支持拖动、按钮和键盘排序并保存顺序，折叠卡片统一为紧凑布局。脚本宿主中断但调用未返回时显示“结束未确认”，保留真实未知状态，迟到返回后恢复同一行。继续采用纯 MIT 许可证。

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
