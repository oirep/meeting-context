# meeting-context

> 一个 Claude Code / Codex 会议内容获取 skill：给一个飞书妙记链接、飞书智能纪要文档链接、企业微信会议关键词/会议链接、会议标题关键词，或本地会议录制文件，自动拉取**完整逐字稿 + AI 摘要 + 待办**，并可补充录制里的屏幕共享内容，供后续分析、需求整理、纪要撰写。

飞书支持非属主共享场景（经文档路径）；企业微信支持官方 `wecom-cli` 的会议纪要与转写原文读取。本地录制中的屏幕共享/PPT/代码/白板/表格画面可通过 `video-to-text` 作为补充能力读取。

---

## 安装 / 升级

### 1. 安装或升级 skill

**若你有 `kevinw99/base` 读权限（内部协作者优先用此路径，始终拿到最新版）：**

```bash
npx skills add kevinw99/base --path skills/meeting-context
```

**公开镜像仓库（无内部权限时）：**

```bash
npx skills add oirep/meeting-context
```

> 安装后，Claude Code / Codex 等支持 skills 的 agent 会自动加载它。

### 2. CLI 自动安装 / 升级策略

使用本 skill 时，agent 会按会议来源自动检查依赖：

- 飞书会议：检查 `lark-cli`
- 企业微信会议：检查 `wecom-cli` 和官方 `WeComTeam/wecom-cli` skill

如果本机没有相关 CLI，或版本不可用，agent 应自动安装/升级最新版并复查，不需要用户手动执行这些命令：

```bash
npm install -g @larksuite/cli
npm install -g @wecom/cli
npx skills add WeComTeam/wecom-cli -y -g
```

如果本机缺少 Node.js/npm，或安装命令因系统权限、网络、宿主审批机制失败，agent 会说明失败原因并让你处理基础环境问题。

### 3. 只有授权类步骤需要你操作

agent 会自动检查授权状态；只有进入扫码、浏览器授权、账号选择、管理员审批这类必须人工参与的步骤时，才会停下来让你配合。

飞书：

```bash
lark-cli config init
lark-cli auth login --scope "minutes:minutes:readonly minutes:minutes.artifacts:read minutes:minutes.transcript:export minutes:minutes.search:read vc:note:read"
```

这些命令由 agent 发起；你只需要按提示扫码、打开浏览器或确认授权。

企业微信：

```bash
wecom-cli auth show --status
wecom-cli auth init --noninteractive
```

`auth init` 由 agent 在未授权时发起；你只需要用企业微信扫码。企业微信读取会议内容需要授权「搜索与获取会议信息」。若企业开启成员授权审批，需要等待管理员审批；企业也可以在管理后台配置智能机器人免审。

完成后即可使用。

---

## 用法

直接对 Claude 说，例如：

```
帮我读取这个会议的内容
https://xxx.feishu.cn/minutes/obcn1jllqwj26n8q41vv985p

把「产品评审会」的逐字稿作为上下文，帮我整理需求

这个团队会议纪要帮我读一下（非我组织的会）
https://xxx.feishu.cn/docx/JL8hdgyqoo2aM4xLXPicOJEKn9j

读取一下企业微信里昨天的项目复盘会，作为上下文帮我整理待办

把企微会议「供应链需求评审」的转写原文发我

这个会议我还有本地录屏，帮我补充一下屏幕共享里的 PPT 和代码内容
```

支持的输入：

| 输入 | 说明 |
|------|------|
| 妙记链接 `*.feishu.cn/minutes/<token>` | 最快，一步到位 |
| 智能纪要 / 文字记录文档 `*.feishu.cn/docx/<token>` | **非属主共享场景的可靠通道** |
| 飞书会议标题 / 关键词 | 自动搜索匹配的妙记 |
| `minute_token`（`obcn` 开头） | 直接取数 |
| 企业微信会议标题 / 关键词 | 通过官方 `wecom-cli meeting search/list/get/original get` 定位并读取 |
| 企业微信会议纪要 / 转写原文 | 读取官方纪要、待办；需要完整原话时拉取 `original_data` |
| 本地会议录制文件 | 可选增强：通过 `video-to-text` 补充音频内容和屏幕共享画面，不替代飞书/企业微信官方路径 |

---

## 权限说明（重要）

飞书会议内容的访问权限是**分粒度**的：

| 内容 | 属主 | 非属主（有共享/参会权限）|
|------|:---:|:---:|
| AI 摘要 / 章节 / 待办 | ✅ | ✅ |
| 逐字稿文件下载（妙记导出接口） | ✅ | ❌ |
| 完整逐字稿（**文字记录文档**） | ✅ | ✅ |

→ 非属主想拿**完整逐字稿**，走「文字记录」**文档**链接（`/docx/...`）即可。skill 会自动处理这个兜底。

---

## 故障排查

| 现象 | 处理 |
|------|------|
| `command not found: lark-cli` | agent 自动执行 `npm install -g @larksuite/cli` 并复查 |
| `missing_scope` | agent 自动发起飞书授权命令；你完成扫码/浏览器授权 |
| 逐字稿 `403`（非属主） | 改用「文字记录」文档链接；摘要/待办仍可正常获取 |
| `404` / 妙记未生成 | 飞书 AI 转录需 1–5 分钟，稍后重试 |
| `command not found: wecom-cli` | agent 自动执行 `npm install -g @wecom/cli` 和 `npx skills add WeComTeam/wecom-cli -y -g` 并复查 |
| `wecom-cli auth show --status` 输出 `unauthorized` | agent 自动执行 `wecom-cli auth init --noninteractive`；你完成企业微信扫码 |
| 企业微信提示需要审批 / 无权限 | 等待管理员审批「搜索与获取会议信息」，或由管理员配置智能机器人免审 |
| 企业微信 `original_data` 为空 | 可能未开启会议转写、会议未开始、处理未完成或无发言记录；如有本地录制文件，可用 `video-to-text` 提取录制内容 |
| 需要读取录制里的屏幕共享/PPT/代码/白板/表格 | 提供本地录制文件路径，agent 会触发 `video-to-text` 作为会议内容补充 |

---

## 关于

- **规范源（SSoT）**：本 skill 的开发与维护在 `kevinw99/base` 仓库的 `skills/meeting-context/`，本仓库是其分发镜像，由 `git subtree` 自动同步。
- 当前版本支持飞书 + 企业微信。企业微信路径只基于官方 `@wecom/cli` / `WeComTeam/wecom-cli`；本地录制画面增强使用 `video-to-text`。
- 反馈与 issue 请提交到本仓库。
