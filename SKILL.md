---
name: meeting-context
version: 0.8.0
description: "获取飞书/企业微信会议内容（逐字稿 + 可选 AI 摘要/待办）并注入 Agent 上下文。飞书支持妙记链接、智能纪要/文字记录文档链接、标题关键词、minute_token；企业微信支持官方 wecom-cli 的会议查询、纪要/待办、转写原文读取。会议结束后使用，自动拉取完整逐字稿供后续分析、需求整理、纪要撰写。"
metadata:
  requires:
    bins: ["lark-cli", "wecom-cli"]
    skills: ["video-to-text"]
---

# meeting-context（飞书 + 企业微信）

**CRITICAL — 平台前置规则**
- 处理飞书会议前，MUST 先用 Read 工具读取 [`~/.agents/skills/lark-shared/SKILL.md`](~/.agents/skills/lark-shared/SKILL.md)，其中包含认证与权限处理规则。
- 处理企业微信会议前，MUST 遵循官方 `wecomcli-shared` 前置检查：确认 `wecom-cli --version` 可用、`wecom-cli auth show --status` 为 `authorized`；未授权时运行 `wecom-cli auth init --noninteractive`。

## 核心能力

给定飞书妙记 URL、飞书智能纪要/文字记录文档 URL、飞书 minute_token、企业微信会议关键词/会议号/会议链接，或自然语言会议标题，拉取完整逐字稿（+ 可选 AI 摘要/待办），格式化后注入当前对话上下文。
若用户提供本地会议录制文件，或明确需要分析屏幕共享/PPT/代码/白板/表格等画面内容，可额外触发 `video-to-text` 作为画面与音频补充；这只是会议内容增强路径，不替代飞书/企业微信官方 CLI 取数路径。

**飞书已验证路径：**
- 妙记 URL → 提取 token → `lark-cli vc +notes` → 读取 `transcript.txt` ✅（属主）
- 标题关键词 → `lark-cli minutes +search --query` → token → `lark-cli vc +notes` ✅
- **文档 URL（`/docx/`）→ `lark-cli docs +fetch` → 摘要/逐字稿 ✅（属主 + 非属主共享均可，2026-06-05 验证）**

**企业微信官方路径：**
- 企业微信会议关键词 / 时间范围 → `wecom-cli meeting list/search/get` → 定位会议
- 会议纪要 / 待办 → `wecom-cli meeting get`
- **完整转写原文** → `wecom-cli meeting original get`，按 `has_more` / `next_cursor` 翻页到底

**本地录制增强路径：**
- 本地 MP4/M4A/MOV 等会议录制 → 触发 `video-to-text` 读取音频文字与屏幕画面线索
- 适用于已有官方逐字稿但需要补充屏幕共享内容，或官方转写不可用但用户手头有录制文件的场景

> **关键权限结论**：`vc +notes` 的**逐字稿文件下载**仅属主可用（非属主返回 403），但**摘要/章节/待办**非属主也能拿。完整逐字稿对非属主而言要走「**文字记录** docx」文档路径。详见下方[非属主 / 共享场景](#非属主--共享场景必读)。

## 自动化执行原则（必须遵守）

除非遇到明确需要用户本人参与的动作，否则 agent 必须自行完成安装、升级、检查、重试和配置命令，不要把命令丢给用户让用户手动执行。

**必须自动完成：**
- 检查 `lark-cli` / `wecom-cli` 是否存在、版本是否可用
- CLI 不存在或版本过旧时，自动安装/升级最新版 CLI
- 安装后自动复查版本与命令可用性
- 已有凭据时自动检查授权状态
- 读取会议前自动选择飞书或企业微信流程

**只有这些情况才让用户参与：**
- 飞书 `lark-cli config init` / `lark-cli auth login` 需要用户扫码、打开浏览器、选择账号或确认授权
- 企业微信 `wecom-cli auth init --noninteractive` 需要用户用企业微信扫码或确认授权
- 企业微信成员授权审批需要管理员审批
- 本机缺少 Node.js/npm，或安装命令因系统权限/网络/宿主审批机制失败，agent 无法继续自动完成

当必须让用户参与时，先说明“已自动完成了哪些步骤、当前卡在哪一步、用户只需要做什么”，然后等待用户完成后继续复查，不要让用户重新跑整套流程。

## 前置检查（首次使用 / 新机器必做）

按输入来源选择对应 CLI。只处理飞书会议时不要求企业微信已授权；只处理企业微信会议时不要求飞书已授权。

### 飞书前置检查

执行任何飞书取数命令前，**先自动确认 `lark-cli` 已安装并完成配置**。按顺序检查：

### 1. 检查 lark-cli 是否安装

```bash
command -v lark-cli && lark-cli --version || echo "NOT_INSTALLED"
```

若输出 `NOT_INSTALLED`（或 command not found），agent 必须自动安装/升级最新版：

```bash
npm install -g @larksuite/cli
```

安装后必须自动复查：

```bash
lark-cli --version
```

若用户没有 Node/npm，或 `npm install -g` 因权限/网络/宿主审批失败，说明失败原因并让用户处理该基础环境问题；不要假装已安装成功。

### 2. 检查配置与认证

```bash
lark-cli auth status 2>&1 | head -20
```

- 报「未配置应用」/ 无 appId → agent 执行 `lark-cli config init`；若命令进入扫码/浏览器/账号选择，提示用户完成授权
- `user` 身份非 ready，或下一步报 `missing_scope` → agent 执行下方授权命令；若命令进入扫码/浏览器/账号选择，提示用户完成授权

### 3. 授权所需 scope（首次或权限报错时）

```bash
lark-cli auth login --scope "minutes:minutes:readonly minutes:minutes.artifacts:read minutes:minutes.transcript:export minutes:minutes.search:read vc:note:read"
```

> 三步全部就绪后再进入「标准执行流程」。已装好的老用户可跳过本节。

### 企业微信前置检查

执行任何企业微信取数命令前，**先自动确认 `wecom-cli` 已安装、版本可用并完成授权**。企业微信官方 CLI 文档见 <https://open.work.weixin.qq.com/help2/pc/21676>。

#### 1. 检查 wecom-cli 是否安装

```bash
command -v wecom-cli && wecom-cli --version || echo "NOT_INSTALLED"
```

若输出 `NOT_INSTALLED`（或 command not found），agent 必须自动安装/升级官方 CLI 与官方 skill：

```bash
npm install -g @wecom/cli
npx skills add WeComTeam/wecom-cli -y -g
```

安装后必须自动复查：

```bash
wecom-cli --version
```

#### 2. 检查授权状态

```bash
wecom-cli auth show --status
```

- 输出 `authorized` → 可以继续企业微信会议流程
- 输出 `unauthorized` → agent 运行下方初始化命令；进入扫码/授权页后再提示用户完成授权
- 其他报错 → 停止业务操作，如实告知错误，不猜测授权状态

#### 3. 初始化授权（仅未授权时）

```bash
wecom-cli auth init --noninteractive
```

该命令会展示企业微信扫码授权入口。此时需要用户扫码；用户完成后，agent 必须重新执行：

```bash
wecom-cli auth show --status
```

仅当输出 `authorized` 时继续。

#### 4. 企业微信权限提醒

读取会议内容需要授权「搜索与获取会议信息」。若企业开启成员授权审批，需等待管理员审批；企业也可在「管理后台 → 安全与管理 → 管理工具 → 智能机器人 → 管理」配置指定成员或全企业免审。

## 所需 scope

首次使用如遇权限错误，运行以下命令完成授权（浏览器扫码或打开链接）：

```bash
lark-cli auth login --scope "minutes:minutes:readonly minutes:minutes.artifacts:read minutes:minutes.transcript:export minutes:minutes.search:read vc:note:read"
```

| scope | 用途 |
|-------|------|
| `minutes:minutes.search:read` | 按关键词/时间搜妙记列表 |
| `minutes:minutes:readonly` | 访问妙记基础信息 |
| `minutes:minutes.artifacts:read` | 获取 AI 产物（摘要、待办、章节） |
| `minutes:minutes.transcript:export` | 下载逐字稿文本文件 |
| `vc:note:read` | `vc +notes` 读取会议纪要数据（缺失会报 `missing_scope`，2026-06-10 实测） |

## 飞书标准执行流程

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

### Step 5（可选）：本地录制 / 屏幕内容补充

当用户提供本地会议录制文件路径，或明确要求补充屏幕共享、PPT、代码、白板、表格、演示画面时，使用 `video-to-text` skill 读取录制内容，并把结果作为会议上下文补充。

适用原则：
- 已能通过飞书/企业微信 CLI 获取会议文本时，先使用官方文本；`video-to-text` 只补充画面内容或核对音频遗漏
- 会议录制包含屏幕共享/PPT/代码/白板/表格时，应优先把视觉信息摘要为“画面内容补充”
- 录制只有摄像头画面、无共享屏幕，且官方逐字稿已经完整时，不必额外触发视频分析
- 官方逐字稿/转写为空，但用户提供本地录制文件时，可以使用 `video-to-text` 从录制中提取可用内容，并明确来源是本地录制

输出时把补充内容放在会议正文后：

```markdown
### 屏幕内容补充（来自本地录制）
{PPT/代码/白板/表格/演示画面的要点}
```

## 错误处理

| 错误 | 原因 | 处理 |
|------|------|------|
| `missing_scope` | 缺少授权 | 输出授权命令，引导用户完成后重试 |
| 逐字稿下载 `HTTP 403` | 非妙记 owner（无逐字稿导出权） | **不要直接放弃**：摘要/章节/待办仍可用；完整逐字稿改走「文字记录」docx 文档路径，见[非属主 / 共享场景](#非属主--共享场景必读) |
| `docs +fetch` 返回 403/无权限 | 文档未共享给当前用户 | 提示用户向组织者索取文档共享访问 |
| `HTTP 404` | token 无效或妙记未生成 | 提示用户：妙记可能尚未生成（飞书 AI 转录需 1-5 分钟），稍后重试 |
| 搜索结果为空 | 关键词不匹配或时间范围错误 | 建议扩大时间范围或换关键词；提醒用户也可直接粘贴妙记/纪要链接；若用户有本地录制文件，可转 `video-to-text` 提取录制内容 |

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

1. 包含 `feishu.cn/minutes/` → 飞书：提取 minute_token，走飞书 Step 2（情况 A）
2. 包含 `feishu.cn/docx/` → 飞书：提取 doc_token，走飞书 Step 1 情况 D（`docs +fetch`）
3. `obcn` 开头的字符串 → 飞书：即 minute_token，走飞书 Step 2（情况 C）
4. 包含 `work.weixin.qq.com`、`wecom`、`企业微信`、`企微`、或用户明确说「企业微信会议」→ 企业微信：走[企业微信标准执行流程](#企业微信标准执行流程)
5. 本地视频/音频文件路径，或用户明确说「录制」「屏幕共享」「PPT」「代码」「白板」「表格画面」→ 先按会议来源读取官方文本；如需补充画面或官方文本不可用，触发 `video-to-text`
6. 其他文字（标题/关键词）→ 默认飞书搜索；若用户组织主要使用企业微信或上下文指向企微，改走企业微信搜索。无法判断时，简短询问「要读取飞书会议还是企业微信会议？」

## 企业微信标准执行流程

企业微信会议读取只使用官方 `wecom-cli`。

### Step 1：完成官方前置检查

先按[企业微信前置检查](#企业微信前置检查)确认：

```bash
wecom-cli --version
wecom-cli auth show --status
```

未授权时运行：

```bash
wecom-cli auth init --noninteractive
```

### Step 2：定位会议

有明确标题/关键词时用搜索；只有时间范围或泛浏览时用列表。

```bash
wecom-cli meeting search --json '{"keywords":["<会议关键词>"],"limit":20}'
```

或：

```bash
wecom-cli meeting list --json '{"begin_time":"YYYY-MM-DD HH:mm:ss","end_time":"YYYY-MM-DD HH:mm:ss","limit":20}'
```

注意：
- `meeting list` 返回 `has_more == true` 时，必须携带 `next_cursor` 继续翻页直到 `has_more == false`
- 多个候选会议时，展示 2-4 个候选（标题 + 时间 + 发起人/参与人摘要），请用户选择
- 禁止在最终回复里暴露 `meeting_id`、`sub_meeting_id`、`cursor`、`userid` 等内部 ID

### Step 3：读取会议详情 / 官方纪要

定位到会议后先读取详情：

```bash
wecom-cli meeting get --json '{"meeting_ids":[{"meeting_id":"<meeting_id>"}]}'
```

- 单次 `meeting get` 最多 10 个会议 ID，超过 10 个必须分批
- 用户只要官方纪要/待办且接口返回可用内容时，直接输出 `notes` 中的纪要/待办
- 用户要求“按某结构整理 / 提炼需求 / 列决策点 / 逐字稿 / 原话”时，必须继续读取转写原文

### Step 4：读取完整转写原文

```bash
wecom-cli meeting original get --json '{"meeting_id":"<meeting_id>","limit":100}'
```

- 未指定第几段时，不传 `media_index`，让接口返回全部段
- 返回 `has_more == true` 时，必须带 `next_cursor` 续拉，直到 `false`
- `original_data` 是逐句原始发言记录；用户要逐字稿/原话时原样保留时间戳 + 说话人，不总结、不裁剪
- 当 `original_data` 作为会议总结素材时，可以按用户指定结构加工

### Step 5：格式化输出

```markdown
## 会议内容 — {标题} ({日期})

**来源**: 企业微信会议
**时长**: {时长}
**参会人**: {可读姓名列表}

### AI 纪要 / 待办
{官方 notes 中的纪要或待办；没有则说明无现成纪要}

### 逐字稿

[HH:MM:SS] **发言人A**：内容…
```

### Step 6（可选）：本地录制 / 屏幕内容补充

若企业微信官方转写已拿到，但用户还提供了本地会议录制，或明确要求分析屏幕共享/PPT/代码/白板/表格等画面，触发 `video-to-text` skill 补充视觉内容。输出时标明补充来源是本地录制，且不要把视觉摘要混写成官方转写原文。

### 企业微信错误处理

| 错误 | 原因 | 处理 |
|------|------|------|
| `command not found: wecom-cli` | 未安装官方 CLI | agent 自动执行 `npm install -g @wecom/cli` 和 `npx skills add WeComTeam/wecom-cli -y -g`，安装后复查版本 |
| `unauthorized` | 未初始化机器人授权 | 执行 `wecom-cli auth init --noninteractive`，扫码后复查状态 |
| 需要审批 / 无权限 | 企业开启成员授权审批，或未授权「搜索与获取会议信息」 | 告知用户等待管理员审批或配置免审 |
| 无 `notes` | 会议没有官方纪要/待办或无权限 | 尝试 `meeting original get` 读取转写原文 |
| `original_data` 为空 | 未开启转写、会议未开始、处理未完成或无发言 | 如实说明，不编造内容；若用户提供本地录制文件，可转 `video-to-text` 提取录制内容 |
| 分页中途失败 | 网络/权限/服务异常 | 输出已拿到的部分，并提示内容可能不完整 |

## 使用示例

```
用户: 帮我读取这个会议的内容
      https://rcnq4lf7hi5o.feishu.cn/minutes/obcn1jllqwj26n8q41vv985p

用户: 这个团队会议纪要帮我读一下（非我组织的会）
      https://rcnq4lf7hi5o.feishu.cn/docx/JL8hdgyqoo2aM4xLXPicOJEKn9j

用户: 获取昨天的产品评审会内容

用户: 把「工艺实验与设备升级讨论」这个会的逐字稿作为上下文，帮我整理需求

用户: meeting-context obcn1jllqwj26n8q41vv985p

用户: 读取一下企业微信里昨天的项目复盘会，作为上下文帮我整理待办

用户: 把企微会议「供应链需求评审」的转写原文发我

用户: 这个会议还有一份本地录屏，帮我补充一下屏幕共享里的 PPT 和代码内容
```
