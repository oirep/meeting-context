---
name: meeting-context
version: 0.6.0
description: "获取飞书会议内容（逐字稿 + 可选 AI 摘要/待办）并注入 Claude 上下文。支持：飞书妙记链接（*.feishu.cn/minutes/...）、飞书智能纪要/文字记录文档链接（*.feishu.cn/docx/...）、会议标题关键词、minute_token。会议结束后使用，自动拉取完整逐字稿供后续分析、需求整理、纪要撰写。即使不是会议属主、仅有共享/参会权限也可读取（经文档路径）。当用户说「读取会议内容」「获取会议逐字稿」「把会议内容作为上下文」「这个妙记链接」「这个纪要链接」「昨天的产品评审会」等时触发。"
metadata:
  requires:
    bins: ["lark-cli"]
---

# meeting-context（飞书 MVP）

**CRITICAL — 开始前 MUST 先用 Read 工具读取 [`~/.agents/skills/lark-shared/SKILL.md`](~/.agents/skills/lark-shared/SKILL.md)，其中包含认证与权限处理规则。**

## 核心能力

给定飞书妙记 URL、智能纪要/文字记录文档 URL、会议标题关键词、或 minute_token，拉取完整逐字稿（+ 可选 AI 摘要/待办），格式化后注入当前对话上下文。

**已验证路径：**
- 妙记 URL → 提取 token → `lark-cli vc +notes` → 读取 `transcript.txt` ✅（属主）
- 标题关键词 → `lark-cli minutes +search --query` → token → `lark-cli vc +notes` ✅
- **文档 URL（`/docx/`）→ `lark-cli docs +fetch` → 摘要/逐字稿 ✅（属主 + 非属主共享均可，2026-06-05 验证）**

> **关键权限结论**：`vc +notes` 的**逐字稿文件下载**仅属主可用（非属主返回 403），但**摘要/章节/待办**非属主也能拿。完整逐字稿对非属主而言要走「**文字记录** docx」文档路径。详见下方[非属主 / 共享场景](#非属主--共享场景必读)。

## 前置检查（首次使用 / 新机器必做）

执行任何取数命令前，**先确认 `lark-cli` 已安装并完成配置**。按顺序检查：

### 1. 检查 lark-cli 是否安装

```bash
command -v lark-cli && lark-cli --version || echo "NOT_INSTALLED"
```

若输出 `NOT_INSTALLED`（或 command not found），引导用户安装：

```bash
# 方式 A（推荐，需 Node.js ≥ 18）：
npm install -g @larksuite/cli

# 方式 B：从 GitHub Releases 下载对应平台二进制
#   https://github.com/larksuite/cli/releases
```

- 若用户没有 Node/npm，提示先装 Node.js（https://nodejs.org）或走方式 B
- 安装后重新执行 `lark-cli --version` 确认

### 2. 检查配置与认证

```bash
lark-cli auth status 2>&1 | head -20
```

- 报「未配置应用」/ 无 appId → 引导运行 `lark-cli config init`（详见 lark-shared）
- `user` 身份非 ready，或下一步报 `missing_scope` → 运行下方授权命令

### 3. 授权所需 scope（首次或权限报错时）

```bash
lark-cli auth login --scope "minutes:minutes:readonly minutes:minutes.artifacts:read minutes:minutes.transcript:export"
```

> 三步全部就绪后再进入「标准执行流程」。已装好的老用户可跳过本节。

## 所需 scope

首次使用如遇权限错误，运行以下命令完成授权（浏览器扫码或打开链接）：

```bash
lark-cli auth login --scope "minutes:minutes:readonly minutes:minutes.artifacts:read minutes:minutes.transcript:export"
```

| scope | 用途 |
|-------|------|
| `minutes:minutes.search:read` | 按关键词/时间搜妙记列表 |
| `minutes:minutes:readonly` | 访问妙记基础信息 |
| `minutes:minutes.artifacts:read` | 获取 AI 产物（摘要、待办、章节） |
| `minutes:minutes.transcript:export` | 下载逐字稿文本文件 |

## 标准执行流程

### Step 1：解析输入，确定 minute_token

**情况 A：用户给了飞书妙记 URL**

URL 格式：`https://<tenant>.feishu.cn/minutes/<minute_token>`（token 是 `obcn` 开头的字符串）

```
输入: https://rcnq4lf7hi5o.feishu.cn/minutes/obcn1jllqwj26n8q41vv985p
提取: minute_token = obcn1jllqwj26n8q41vv985p
```

如 URL 含 `?` 参数，截取路径最后一段即为 token。

**情况 B：用户给了标题关键词（或没有 URL）**

```bash
# 搜索妙记，返回匹配的 token 列表
lark-cli minutes +search --query "<关键词>" [--start YYYY-MM-DD] [--end YYYY-MM-DD]
```

- 结果多条时，展示列表让用户选择（显示：标题 + 时间 + 时长）
- 结果为空时，尝试扩大时间范围后重搜；仍为空则提示用户确认关键词或直接提供链接
- `display_info` 第一行是标题（可能含 `<h>高亮词</h>`，展示时清除标签）

**情况 C：用户直接给了 minute_token（`obcn` 开头）**

直接跳到 Step 2。

**情况 D：用户给了飞书文档 URL（`/docx/`）—— 智能纪要或文字记录**

URL 格式：`https://<tenant>.feishu.cn/docx/<doc_token>`

这是会议的**文档形态**（AI 智能纪要 或 文字记录/逐字稿），**走文档路径而非妙记路径**，
且**对非属主的共享访问同样有效**（见[非属主 / 共享场景](#非属主--共享场景必读)）：

```bash
lark-cli docs +fetch --api-version v2 --doc <doc_token> --doc-format markdown
```

- 「智能纪要」文档：含总结、待办、参会人，正文末尾「相关链接」段会给出**妙记链接**和**文字记录文档链接**
- 「文字记录」文档：即完整逐字稿（发言人 + `HH:MM:SS` 时间戳）
- 若用户给的是智能纪要、但需要完整逐字稿：从其「相关链接」里提取「文字记录」的 `/docx/` token，再 `docs +fetch` 一次

### Step 2：拉取逐字稿

```bash
# 在临时目录执行，避免路径限制
cd /tmp && lark-cli vc +notes \
  --minute-tokens <minute_token> \
  --output-dir ./meeting-context-<minute_token> \
  --overwrite \
  --format pretty
```

产物目录结构：
```
/tmp/meeting-context-<token>/
└── artifact-<会议标题>-<token>/
    └── transcript.txt          ← 逐字稿（时间戳 + 发言人 + 内容）
```

### Step 3：读取并格式化输出

读取 `transcript.txt`，按以下结构输出：

```markdown
## 会议内容 — {标题} ({日期})

**时长**: {时长}
**关键词**: {关键词列表}

### 逐字稿

[HH:MM:SS] **发言人A**：内容…

[HH:MM:SS] **发言人B**：内容…
```

- `transcript.txt` 首行格式：`YYYY-MM-DD HH:MM:SS CST|{时长}`
- 关键词在首行后的第三行（`关键词:` 开头）
- 正文格式：`发言人 HH:MM:SS.mmm\n内容`，转换为内联时间戳格式

### Step 4（可选）：补充 AI 摘要

如果 `vc +notes` 返回了 `note_doc_token`（AI 智能纪要文档），且用户需要摘要或待办，追加读取：

```bash
lark-cli docs +fetch --api-version v2 --doc <note_doc_token> --doc-format markdown
```

在输出末尾追加：

```markdown
### AI 摘要
{摘要内容}

### 待办事项
- [ ] {待办1}
- [ ] {待办2}
```

## 错误处理

| 错误 | 原因 | 处理 |
|------|------|------|
| `missing_scope` | 缺少授权 | 输出授权命令，引导用户完成后重试 |
| 逐字稿下载 `HTTP 403` | 非妙记 owner（无逐字稿导出权） | **不要直接放弃**：摘要/章节/待办仍可用；完整逐字稿改走「文字记录」docx 文档路径，见[非属主 / 共享场景](#非属主--共享场景必读) |
| `docs +fetch` 返回 403/无权限 | 文档未共享给当前用户 | 提示用户向组织者索取文档共享访问；若无法获取且有录制文件，改走[录制视频兜底](#录制视频兜底) |
| `HTTP 404` | token 无效或妙记未生成 | 提示用户：妙记可能尚未生成（飞书 AI 转录需 1-5 分钟），稍后重试 |
| 搜索结果为空 | 关键词不匹配或时间范围错误 | 建议扩大时间范围或换关键词；提醒用户也可直接粘贴妙记/纪要链接 |

## 非属主 / 共享场景（必读）

飞书会议内容的访问权限是**分粒度**的，不是「属主才能读」的一刀切。实测结论（2026-06-05）：

| 内容 | 取数命令 | 属主 | 非属主（有共享/参会权限）|
|------|---------|:---:|:---:|
| 元数据（标题/时长/属主） | `minutes minutes get` | ✅ | ✅ |
| AI 摘要 / 章节 / 待办 / 关键词 | `vc +notes` artifacts | ✅ | ✅ |
| **逐字稿文件下载** | `vc +notes` transcript | ✅ | ❌ **403** |
| AI 智能纪要（文档） | `docs +fetch <docx>` | ✅ | ✅ |
| **完整逐字稿（文字记录文档）** | `docs +fetch <docx>` | ✅ | ✅ |

**实操策略**：
1. 给定妙记/minute_token，先 `vc +notes` —— 摘要、章节、待办无论属主与否都能拿
2. 若逐字稿下载 **403**（非属主），**不要终止**。改走文档路径拿完整逐字稿：
   - 若用户同时提供了「智能纪要」`/docx/` 链接 → `docs +fetch` 读取，并从其「相关链接」段提取「文字记录」文档 token → 再 `docs +fetch` 得到完整逐字稿
   - 若只有妙记链接、无文档链接 → 提示用户从妙记页面右上角分享/打开对应的「智能纪要」或「文字记录」文档链接（`/docx/...`）粘贴过来
3. 给定 `/docx/` 链接时（情况 D），直接走 `docs +fetch`，对非属主共享同样有效

> 一句话：**摘要类产物 = 妙记权限；完整逐字稿对非属主 = 文档（docx）权限**。docx 路径是非属主的可靠通道。

## 输入路由规则

1. 包含 `feishu.cn/minutes/` → 提取 minute_token，走 Step 2（情况 A）
2. 包含 `feishu.cn/docx/` → 提取 doc_token，走 Step 1 情况 D（`docs +fetch`）
3. `obcn` 开头的字符串 → 即 minute_token，走 Step 2（情况 C）
4. 其他文字（标题/关键词）→ 走 Step 1 情况 B 搜索

## 使用示例

```
用户: 帮我读取这个会议的内容
      https://rcnq4lf7hi5o.feishu.cn/minutes/obcn1jllqwj26n8q41vv985p

用户: 这个团队会议纪要帮我读一下（非我组织的会）
      https://rcnq4lf7hi5o.feishu.cn/docx/JL8hdgyqoo2aM4xLXPicOJEKn9j

用户: 获取昨天的产品评审会内容

用户: 把「工艺实验与设备升级讨论」这个会的逐字稿作为上下文，帮我整理需求

用户: meeting-context obcn1jllqwj26n8q41vv985p
```

---

## 录制视频兜底

当所有 API 路径均失败，且用户持有会议录制文件（MP4/M4A/MOV）时，改用 `video-to-text` skill：

**触发条件（满足任一）**：
- `vc +notes` 逐字稿下载 403（非 owner），且用户无法提供 `/docx/` 文档链接
- `docs +fetch` 返回 403，且无法获取共享权限
- 腾讯会议录制（飞书 API 不适用）
- 用户直接提供本地视频文件路径

**处理流程**：
1. 若用户尚未下载录制，提示下载渠道：
   - 飞书会议：妙记页面 → 「原始录像」
   - 腾讯会议：网页端 → 录制管理 → 下载
2. 用户提供本地文件路径（MP4/M4A/MOV）后，触发 `video-to-text` skill
3. `video-to-text` 输出含时间戳的完整逐字稿 + 屏幕内容分析（若含屏幕共享），直接注入当前上下文

**依赖提醒**（首次使用时告知）：需 `ffmpeg`、`faster-whisper`（首次下载 ~1.4GB 模型，自动缓存）、`ANTHROPIC_API_KEY`（屏幕内容分析）。

---

## 路线图：腾讯会议 / 企业微信（未纳入 MVP）

腾讯会议（企业微信会议同底层）支持仍在开发中，**不属于本 MVP 范围**。
相关实现保留在 `tencent/tencent-meeting.mjs`（API 路径，需企业版凭据）与设计文档
`specs/04_meeting-content-ingestion/`（含 agent-browser 浏览器兜底方案）。
待飞书 MVP 稳定后再合入。
