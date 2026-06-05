---
name: meeting-context
version: 0.4.0
description: "获取飞书妙记会议内容（逐字稿 + 可选 AI 摘要/待办）并注入 Claude 上下文。支持：飞书妙记链接（*.feishu.cn/minutes/...）、会议标题关键词、minute_token。会议结束后使用，自动拉取完整逐字稿供后续分析、需求整理、纪要撰写。当用户说「读取会议内容」「获取会议逐字稿」「把会议内容作为上下文」「这个妙记链接」「昨天的产品评审会」等时触发。"
metadata:
  requires:
    bins: ["lark-cli"]
---

# meeting-context（飞书 MVP）

**CRITICAL — 开始前 MUST 先用 Read 工具读取 [`~/.agents/skills/lark-shared/SKILL.md`](~/.agents/skills/lark-shared/SKILL.md)，其中包含认证与权限处理规则。**

## 核心能力

给定飞书妙记 URL、会议标题关键词、或 minute_token，拉取完整逐字稿（+ 可选 AI 摘要/待办），格式化后注入当前对话上下文。

**已验证路径（2026-06-04）：**
- 妙记 URL → 提取 token → `lark-cli vc +notes` → 读取 `transcript.txt` ✅
- 标题关键词 → `lark-cli minutes +search --query` → token → `lark-cli vc +notes` ✅

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
| `HTTP 403: permission deny` | 不是妙记 owner | 提示用户：只能访问自己拥有的妙记；建议联系会议组织者获取链接 |
| `HTTP 404` | token 无效或妙记未生成 | 提示用户：妙记可能尚未生成（飞书 AI 转录需 1-5 分钟），稍后重试 |
| 搜索结果为空 | 关键词不匹配或时间范围错误 | 建议扩大时间范围或换关键词；提醒用户也可直接粘贴妙记链接 |

## 权限说明

> 只能访问**自己拥有的妙记**（`owner_id` = 当前用户）。参与别人组织的会议不能自动获取对方的妙记，需要对方通过飞书共享妙记链接。

## 输入路由规则

1. 包含 `feishu.cn/minutes/` → 提取 token，走 Step 2
2. `obcn` 开头的字符串 → 即 minute_token，走 Step 2
3. 其他文字（标题/关键词）→ 走 Step 1 情况 B 搜索

## 使用示例

```
用户: 帮我读取这个会议的内容
      https://rcnq4lf7hi5o.feishu.cn/minutes/obcn1jllqwj26n8q41vv985p

用户: 获取昨天的产品评审会内容

用户: 把「工艺实验与设备升级讨论」这个会的逐字稿作为上下文，帮我整理需求

用户: meeting-context obcn1jllqwj26n8q41vv985p
```

---

## 路线图：腾讯会议 / 企业微信（未纳入 MVP）

腾讯会议（企业微信会议同底层）支持仍在开发中，**不属于本 MVP 范围**。
相关实现保留在 `tencent/tencent-meeting.mjs`（API 路径，需企业版凭据）与设计文档
`specs/04_meeting-content-ingestion/`（含 agent-browser 浏览器兜底方案）。
待飞书 MVP 稳定后再合入。
