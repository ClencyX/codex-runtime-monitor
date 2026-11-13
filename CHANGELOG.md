# Changelog / 更新记录

## v0.1.6 — 2026-11-13

- Improved Codex TCP/UDP traffic attribution and fixed cases where unrelated UDP traffic could be counted as Codex traffic.
- The traffic chart no longer connects missing samples with a dashed line when the gap exceeds 10 seconds.
- Fixed automatic following switching to a chat that was only opened or preparing; it now follows the session whose task started most recently.
- Fixed elapsed durations being truncated in Recent activity in some layouts.
- Improved task-title reading in account quota records when messages contain empty content blocks.

完善 Codex TCP/UDP 流量归属，修复部分情况下将无关 UDP 流量计入 Codex 的问题。流量趋势图超过 10 秒的采样缺口不再用虚线连接。修复仅打开或准备会话就触发自动跟随的问题，改为跟随最近开始执行任务的会话。修复部分布局下“最近活动”耗时显示不全的问题。改进消息包含空内容块时账户额度记录中的任务标题读取。

## v0.1.5 — 2026-11-10

Manual update checks and a bilingual visual feature tour. / 手动检查更新与中英文图文功能介绍。

- Added a local version display and an explicit, user-triggered check for the latest stable GitHub Release. Startup and background monitoring do not check automatically.
- Added numeric version comparison, publication dates and release/download links. Checks use a fixed anonymous endpoint, bounded responses, timeouts, shared in-flight requests and a 30-second result cache. Failed checks never report that the application is up to date. Downloads and installation remain manual.
- Clarified that monitoring data stays local: no conversation content, task/tool records, working directories or traffic statistics are uploaded, and no telemetry is collected. Documented official quota queries and user-triggered GitHub requests separately.
- Rebuilt the English and Chinese README with language-matched full-window screenshots, feature details and actual UI animations generated from synthetic data. Added a reproducible local-only capture tool.
- Removed four unreferenced legacy screenshots from the current source tree; historical releases and commits remain available.
- Corrected outdated account-summary and App Server descriptions, and translated the remaining English quota-table status.
- 139 automated tests passed on Windows with Node.js 24.19.0. Isolated-browser checks covered both languages, narrow layouts, update success/failure, all panels and zero external page requests during documentation capture.
- Retained the standard MIT License and source-based distribution. Existing releases and tags are preserved.

新增底部手动检查更新：仅用户点击时匿名查询 GitHub 正式版信息，在本机比较版本，提供日期与下载入口，不自动安装。完善“不上传监控数据、无遥测”的声明，同时说明官方额度查询和 GitHub 请求的联网范围。中英文 README 分别配套完整界面、功能截图与动态演示，全部使用合成数据。修正折叠额度摘要、App Server 和英文状态文案。保留历史版本和纯 MIT 许可证。

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
