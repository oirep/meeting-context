# meeting-context

> 一个 Claude Code / 飞书生态的 **会议内容获取 skill**：给一个飞书妙记链接、智能纪要文档链接、或会议标题关键词，自动拉取**完整逐字稿 + AI 摘要 + 待办**并注入对话上下文，供后续分析、需求整理、纪要撰写。

即使你**不是会议属主**、只有共享/参会权限，也能读到内容（经飞书文档路径）。

---

## 安装（3 步）

### 1. 安装 skill

```bash
npx skills add oirep/meeting-context
```

> 安装后，Claude Code / Codex 等支持 skills 的 agent 会自动加载它。

### 2. 安装并配置 lark-cli（飞书命令行）

skill 依赖 `lark-cli`。若未安装：

```bash
npm install -g @larksuite/cli      # 需 Node.js ≥ 18
lark-cli config init                # 首次配置应用（按提示扫码/打开链接）
```

### 3. 授权所需权限（首次）

```bash
lark-cli auth login --scope "minutes:minutes:readonly minutes:minutes.artifacts:read minutes:minutes.transcript:export"
```

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
```

支持的输入：

| 输入 | 说明 |
|------|------|
| 妙记链接 `*.feishu.cn/minutes/<token>` | 最快，一步到位 |
| 智能纪要 / 文字记录文档 `*.feishu.cn/docx/<token>` | **非属主共享场景的可靠通道** |
| 会议标题 / 关键词 | 自动搜索匹配的妙记 |
| `minute_token`（`obcn` 开头） | 直接取数 |

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
| `command not found: lark-cli` | 按上方第 2 步安装 |
| `missing_scope` | 重新运行第 3 步授权命令 |
| 逐字稿 `403`（非属主） | 改用「文字记录」文档链接；摘要/待办仍可正常获取 |
| `404` / 妙记未生成 | 飞书 AI 转录需 1–5 分钟，稍后重试 |

---

## 关于

- **规范源（SSoT）**：本 skill 的开发与维护在 `kevinw99/base` 仓库的 `skills/meeting-context/`，本仓库是其分发镜像，由 `git subtree` 自动同步。
- 当前为飞书 MVP（v0.5.0）。腾讯会议 / 企业微信支持在路线图中（`tencent/` 目录含早期实现，尚未验证）。
- 反馈与 issue 请提交到本仓库。
