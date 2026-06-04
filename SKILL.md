---
name: meeting-context
version: 0.3.0
description: "获取飞书或腾讯会议内容（逐字稿 + 摘要 + 待办）并注入 Claude 上下文。支持：飞书妙记链接（*.feishu.cn/minutes/...）、飞书会议标题关键词、腾讯会议链接或 ID（meeting.tencent.com）、企业微信会议 ID。会议结束后使用，自动拉取完整逐字稿供后续分析、需求整理、纪要撰写。当用户说「读取会议内容」「获取会议逐字稿」「把会议内容作为上下文」「这个妙记链接」「昨天的产品评审会」「腾讯会议 ID xxx」等时触发。"
metadata:
  requires:
    bins: ["lark-cli", "node"]
  cliHelp: "node tencent/tencent-meeting.mjs --help"
---

# meeting-context

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

**情况 C：用户直接给了 minute_token**

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

> 飞书：只能访问**自己拥有的妙记**（`owner_id` = 当前用户）。参与别人组织的会议不能自动获取对方的妙记，需要对方通过飞书共享妙记链接。
>
> 腾讯会议：需要企业商业版，逐字稿 API 仅支持 JWT (SecretId/SecretKey) 认证，无 OAuth 路径。

---

## 腾讯会议路径（Platform B）

> **策略：API 优先，浏览器兜底。**
> - **Path B1**（API）：有企业凭据时使用，全自动
> - **Path B2**（agent-browser）：无凭据或 API 失败时自动切换，适用所有账号类型

### 路径选择逻辑

```
有 ~/.config/meeting-context/tencent.json？
  ├── 是 → 尝试 Path B1 API
  │         ├── 成功 → 返回逐字稿
  │         └── 失败（401/403/空）→ 切换到 Path B2 并告知原因
  └── 否 → 直接走 Path B2（浏览器）
```

---

### Path B1：开放平台 API

> 需要企业商业版账号 + 自建应用凭据（SecretId/SecretKey）。

**一次性配置**（有企业凭据时）：

```bash
node <skill_dir>/tencent/tencent-meeting.mjs setup
```

引导填入：AppId、SecretId、SecretKey（从 `企业管理 → 高级 → REST API` 获取）。

**执行**：

```bash
SKILL_DIR="$(dirname $(realpath ~/.agents/skills/meeting-context/SKILL.md))"

# 检查是否已配置
node "$SKILL_DIR/tencent/tencent-meeting.mjs" whoami 2>/dev/null

# 一键获取逐字稿
node "$SKILL_DIR/tencent/tencent-meeting.mjs" fetch <meetingId|URL>
```

`fetch` 自动完成：录制文件列表 → STS Token → 逐字稿 → 格式化 stdout。

**B1 错误处理**：

| 错误 | 原因 | 处理 |
|------|------|------|
| 未找到凭据 | 未配置 | 切换 Path B2 |
| API 401 | 凭据错误 | 切换 Path B2，提示重新 `setup` |
| API 403 | 非企业版或无权限 | 切换 Path B2 |
| 逐字稿为空 | AI 转录未完成 | 提示 1-5 分钟后重试，可先走 B2 |

---

### Path B2：agent-browser 浏览器自动化

> 适用所有账号类型（个人版/企业版均可）。用户需已在浏览器中登录腾讯会议网页版。

**前提检查**：

```bash
agent-browser --version   # 确认已安装
```

如未安装：`npm i -g agent-browser && agent-browser install`

#### Step B2-1：启动会话并导航到云录制

```bash
agent-browser skills get core   # 加载操作指南（首次或不确定时）
```

打开腾讯会议云录制页面：

```
导航到: https://meeting.tencent.com/user-center/cloud-record
```

- 如果页面跳转到登录页，提示用户：**「请先在浏览器中登录腾讯会议网页版，登录完成后告诉我」**，然后重新导航
- 登录成功后，页面显示云录制列表

#### Step B2-2：定位目标会议录制

根据用户输入定位会议：

| 用户输入 | 定位方式 |
|---------|---------|
| 日期 | 页面按日期分组，找到对应日期段 |
| 标题关键词 | 在列表中匹配会议标题 |
| 会议 ID（数字）| 匹配会议 ID 字段 |
| URL `meeting.tencent.com/dm/xxx` | 提取 ID 后匹配 |

- 如有多条匹配，展示列表让用户选择（标题 + 时间 + 时长）
- 点击目标会议进入详情页

#### Step B2-3：获取逐字稿内容

进入录制详情后：

1. 找「AI 纪要」或「转写文本」或「逐字稿」标签，点击切换
2. 如果有「加载更多」或需要滚动，滚动到底部加载全部内容
3. 用 accessibility snapshot 读取全部段落文本
4. 每段包含：时间戳 + 发言人名 + 内容

如果没有转写文本标签：
- 录制可能未开启 AI 转录
- 提示用户：会议录制中需要开启「智能转写」功能才能生成逐字稿
- 可以尝试下载录制文件（如有下载权限），进入 Phase 3 音频转录 fallback

#### Step B2-4：格式化输出

将抓取的内容按统一格式封装：

```markdown
## 会议内容 — {标题} ({日期})

**来源**: 腾讯会议云录制（浏览器）
**时长**: {时长}

### 逐字稿

[HH:MM:SS] **发言人A**：内容…

[HH:MM:SS] **发言人B**：内容…
```

**B2 错误处理**：

| 情况 | 处理 |
|------|------|
| 未登录 | 提示用户先登录网页版，完成后重试 |
| 录制列表为空 | 确认录制是否已上传到云端（会议结束后约 30 分钟同步） |
| 无转写文本 | 提示开启智能转写，或走 Phase 3 音频转录 fallback |
| agent-browser 未安装 | 提示安装命令，或告知用户手动导出 TXT 后提供 |

---

## 平台路由规则

用户输入时，根据以下规则自动选择路径：

1. 包含 `feishu.cn/minutes/` → 飞书妙记路径（Path A）
2. 包含 `meeting.tencent.com` 或输入是纯数字 → 腾讯会议路径（Path B：B1 优先，B2 兜底）
3. `obcn` 开头的字符串 → 飞书 minute_token，直接走 Path A
4. 纯文字（标题/关键词）：先尝试飞书 `minutes +search`；若无结果，询问用户是否是腾讯会议并提供 ID 或日期

### URL / ID 识别

| 输入格式 | 平台 | 提取值 |
|---------|------|--------|
| `*.feishu.cn/minutes/<token>` | 飞书 | minute_token |
| `obcn...` 字符串 | 飞书 | minute_token |
| `meeting.tencent.com/dm/<id>` | 腾讯会议 | 会议 ID |
| 纯数字（9-18 位）| 腾讯会议 | 会议 ID |
| 其他文字 | 先飞书搜索 | — |

## 使用示例

```
用户: 帮我读取这个会议的内容
      https://rcnq4lf7hi5o.feishu.cn/minutes/obcn1jllqwj26n8q41vv985p

用户: 获取昨天的产品评审会内容

用户: 把「工艺实验与设备升级讨论」这个会的逐字稿作为上下文，帮我整理需求

用户: 腾讯会议 https://meeting.tencent.com/dm/xxxxxxx
      （→ 先尝试 B1 API；无凭据则切 B2 打开浏览器云录制页面）

用户: 腾讯会议 ID 123456789，帮我获取逐字稿

用户: 今天下午三点那个腾讯会议，帮我拿逐字稿
      （→ 搜索当天录制，找到后走 B1/B2）
```
