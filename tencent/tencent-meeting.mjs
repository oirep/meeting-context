#!/usr/bin/env node
/**
 * tencent-meeting — CLI for Tencent Meeting Open Platform API
 *
 * Auth: JWT (HMAC-SHA256) with SecretId/SecretKey
 * Base: https://api.meeting.qq.com
 *
 * Commands:
 *   setup                         Store credentials (AppId, SecretId, SecretKey, SdkId)
 *   whoami                        Show stored credentials (masked)
 *   search  --date YYYY-MM-DD     List meetings on a date
 *   recordings <meetingId>        List recording files for a meeting
 *   transcript <recordFileId>     Fetch full transcript text
 *   fetch <meetingId|url>         All-in-one: recordings → transcript
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'

// ── Config storage ──────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.config', 'meeting-context')
const CONFIG_FILE = path.join(CONFIG_DIR, 'tencent.json')

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
}

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

function requireConfig() {
  const cfg = loadConfig()
  if (!cfg) {
    console.error('未找到凭据，请先运行: tencent-meeting setup')
    process.exit(1)
  }
  return cfg
}

// ── HMAC-SHA256 request signing ──────────────────────────────────────────────
// Tencent Meeting API signature spec:
//   StringToSign = Method\nPath\nQueryString\nTimestamp\nNonce\n
//   Signature    = Base64(HMAC-SHA256(SecretKey, StringToSign))

function sign({ method, path: urlPath, query = '', secretKey }) {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = Math.floor(Math.random() * 999999999) + 1
  const stringToSign = `${method}\n${urlPath}\n${query}\n${timestamp}\n${nonce}\n`
  const sig = crypto
    .createHmac('sha256', secretKey)
    .update(stringToSign, 'utf8')
    .digest('base64')
  return { timestamp, nonce, sig }
}

function buildHeaders({ method, urlPath, query = '', cfg, extraHeaders = {} }) {
  const { timestamp, nonce, sig } = sign({ method, path: urlPath, query, secretKey: cfg.secretKey })
  return {
    'Content-Type': 'application/json',
    'X-TC-Key': cfg.secretId,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Nonce': String(nonce),
    'X-TC-Signature': sig,
    'AppId': cfg.appId,
    ...(cfg.sdkId ? { 'SdkId': cfg.sdkId } : {}),
    ...extraHeaders,
  }
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

function apiRequest({ method = 'GET', path: urlPath, query = '', body = null, cfg, extraHeaders = {} }) {
  return new Promise((resolve, reject) => {
    const headers = buildHeaders({ method, urlPath, query, cfg, extraHeaders })
    const fullPath = query ? `${urlPath}?${query}` : urlPath
    const options = {
      hostname: 'api.meeting.qq.com',
      path: fullPath,
      method,
      headers,
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => (data += chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode, body: data })
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// ── STS Token (required for recording detail queries since 2026-01-16) ───────

async function getStsToken(cfg) {
  const res = await apiRequest({
    method: 'POST',
    path: '/v1/corp/token',
    body: { operator_id: cfg.operatorId, operator_id_type: 1 },
    cfg,
  })
  if (res.status !== 200 || !res.body?.token) {
    // Non-fatal: some orgs don't need this; return null and let caller decide
    return null
  }
  return res.body.token
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdSetup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q) => new Promise(r => rl.question(q, r))

  console.log('腾讯会议开放平台凭据配置')
  console.log('前往 https://meeting.tencent.com/marketplace/manage 获取以下信息：\n')

  const appId     = (await ask('AppId (应用ID):      ')).trim()
  const secretId  = (await ask('SecretId:            ')).trim()
  const secretKey = (await ask('SecretKey:           ')).trim()
  const sdkId     = (await ask('SdkId (可选，留空): ')).trim()
  const operatorId = (await ask('Operator UserId (企业管理员 userId，可选): ')).trim()

  rl.close()

  saveConfig({ appId, secretId, secretKey, sdkId: sdkId || undefined, operatorId: operatorId || undefined })
  console.log(`\n✅ 凭据已保存到 ${CONFIG_FILE} (权限 600)`)
}

function cmdWhoami() {
  const cfg = loadConfig()
  if (!cfg) { console.log('未配置，运行: tencent-meeting setup'); return }
  console.log(`AppId:    ${cfg.appId}`)
  console.log(`SecretId: ${cfg.secretId?.slice(0, 6)}${'*'.repeat(10)}`)
  console.log(`SdkId:    ${cfg.sdkId || '(未设置)'}`)
  console.log(`Config:   ${CONFIG_FILE}`)
}

async function cmdSearch({ date }) {
  const cfg = requireConfig()
  if (!date) { console.error('用法: tencent-meeting search --date YYYY-MM-DD'); process.exit(1) }

  // Convert date to Unix timestamp range (local midnight → next midnight)
  const start = Math.floor(new Date(`${date}T00:00:00+08:00`).getTime() / 1000)
  const end   = start + 86400

  const query = `start_time=${start}&end_time=${end}&operator_id_type=1`
  const res = await apiRequest({ method: 'GET', path: '/v1/meetings', query, cfg })

  if (res.status !== 200) {
    console.error(`API 错误 ${res.status}:`, JSON.stringify(res.body, null, 2))
    process.exit(1)
  }

  const meetings = res.body?.meeting_info_list || []
  if (!meetings.length) { console.log('该日期无会议记录'); return }

  console.log(`\n找到 ${meetings.length} 场会议 (${date}):\n`)
  meetings.forEach((m, i) => {
    const start = new Date(m.start_time * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    console.log(`${i + 1}. [${start}] ${m.subject}`)
    console.log(`   ID: ${m.meeting_id}  状态: ${m.current_sub_meeting_status === 3 ? '已结束' : m.current_sub_meeting_status}`)
  })
}

async function cmdRecordings({ meetingId }) {
  const cfg = requireConfig()
  if (!meetingId) { console.error('用法: tencent-meeting recordings <meetingId>'); process.exit(1) }

  const query = `operator_id_type=1&page_size=10`
  const res = await apiRequest({
    method: 'GET',
    path: `/v1/meetings/${meetingId}/recordings`,
    query,
    cfg,
  })

  if (res.status !== 200) {
    console.error(`API 错误 ${res.status}:`, JSON.stringify(res.body, null, 2))
    process.exit(1)
  }

  const files = res.body?.record_files || []
  if (!files.length) { console.log('该会议无录制文件'); return }

  console.log(JSON.stringify({ meeting_id: meetingId, record_files: files }, null, 2))
}

async function cmdTranscript({ recordFileId }) {
  const cfg = requireConfig()
  if (!recordFileId) { console.error('用法: tencent-meeting transcript <recordFileId>'); process.exit(1) }

  // Newer recordings require STS token
  const stsToken = await getStsToken(cfg).catch(() => null)
  const extraHeaders = stsToken ? { 'X-TC-Token': stsToken } : {}

  const query = `operator_id_type=1&record_file_id=${encodeURIComponent(recordFileId)}`
  const res = await apiRequest({
    method: 'GET',
    path: '/v1/records/transcripts/details',
    query,
    cfg,
    extraHeaders,
  })

  if (res.status !== 200) {
    console.error(`API 错误 ${res.status}:`, JSON.stringify(res.body, null, 2))
    process.exit(1)
  }

  // Format transcript to readable text
  const paragraphs = res.body?.ai_transcript_paragraph || []
  if (!paragraphs.length) { console.log('该录制暂无逐字稿（可能未开启 AI 转录功能）'); return }

  const lines = []
  for (const p of paragraphs) {
    const ts = formatMs(p.paragraph_timestamp)
    const speaker = p.user_name || p.userid || '未知发言人'
    const text = (p.sentence_list || []).map(s => s.text).join('')
    if (text.trim()) lines.push(`[${ts}] ${speaker}：${text}`)
  }

  console.log(lines.join('\n\n'))
}

// All-in-one: meeting ID/URL → recordings → transcript
async function cmdFetch({ target }) {
  const cfg = requireConfig()
  if (!target) { console.error('用法: tencent-meeting fetch <meetingId|URL>'); process.exit(1) }

  // Extract meeting ID from URL if needed
  // URL format: https://meeting.tencent.com/dm/xxxxxxx  or  meeting ID directly
  let meetingId = target.trim()
  const urlMatch = target.match(/\/dm\/([a-zA-Z0-9]+)/)
  if (urlMatch) meetingId = urlMatch[1]

  console.error(`[tencent-meeting] 查询会议 ${meetingId} 的录制文件...`)

  const recQuery = `operator_id_type=1&page_size=10`
  const recRes = await apiRequest({
    method: 'GET',
    path: `/v1/meetings/${meetingId}/recordings`,
    query: recQuery,
    cfg,
  })

  if (recRes.status !== 200) {
    console.error(`获取录制失败 ${recRes.status}:`, JSON.stringify(recRes.body, null, 2))
    process.exit(1)
  }

  const files = recRes.body?.record_files || []
  if (!files.length) { console.error('该会议无录制文件'); process.exit(1) }

  // Use first recording file that has transcript
  const file = files[0]
  const recordFileId = file.record_file_id
  console.error(`[tencent-meeting] 录制文件 ID: ${recordFileId}，拉取逐字稿...`)

  const stsToken = await getStsToken(cfg).catch(() => null)
  const extraHeaders = stsToken ? { 'X-TC-Token': stsToken } : {}

  const txQuery = `operator_id_type=1&record_file_id=${encodeURIComponent(recordFileId)}`
  const txRes = await apiRequest({
    method: 'GET',
    path: '/v1/records/transcripts/details',
    query: txQuery,
    cfg,
    extraHeaders,
  })

  if (txRes.status !== 200) {
    console.error(`获取逐字稿失败 ${txRes.status}:`, JSON.stringify(txRes.body, null, 2))
    process.exit(1)
  }

  const paragraphs = txRes.body?.ai_transcript_paragraph || []
  if (!paragraphs.length) {
    console.error('该录制暂无逐字稿（需开启 AI 转录且等待处理完成）')
    process.exit(1)
  }

  // Output formatted transcript to stdout
  const subject = recRes.body?.subject || meetingId
  const startTime = file.record_start_time
    ? new Date(file.record_start_time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : ''

  const header = [`腾讯会议 | ${subject}`, startTime, ''].filter(Boolean).join('\n')
  const lines = []
  for (const p of paragraphs) {
    const ts = formatMs(p.paragraph_timestamp)
    const speaker = p.user_name || p.userid || '未知发言人'
    const text = (p.sentence_list || []).map(s => s.text).join('')
    if (text.trim()) lines.push(`[${ts}] ${speaker}：${text}`)
  }

  process.stdout.write(header + '\n' + lines.join('\n\n') + '\n')
}

// ── Utilities ────────────────────────────────────────────────────────────────

function formatMs(ms) {
  if (!ms) return '00:00:00'
  const totalSec = Math.floor(ms / 1000)
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0')
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0')
  const s = String(totalSec % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function parseArgs(argv) {
  const args = { flags: {}, positional: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      args.flags[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
    } else {
      args.positional.push(argv[i])
    }
  }
  return args
}

// ── Entry point ──────────────────────────────────────────────────────────────

const [,, cmd, ...rest] = process.argv
const parsed = parseArgs(rest)

switch (cmd) {
  case 'setup':      await cmdSetup(); break
  case 'whoami':     cmdWhoami(); break
  case 'search':     await cmdSearch({ date: parsed.flags.date }); break
  case 'recordings': await cmdRecordings({ meetingId: parsed.positional[0] }); break
  case 'transcript': await cmdTranscript({ recordFileId: parsed.positional[0] }); break
  case 'fetch':      await cmdFetch({ target: parsed.positional[0] }); break
  default:
    console.log(`tencent-meeting <command> [options]

Commands:
  setup                         配置凭据（AppId/SecretId/SecretKey）
  whoami                        显示当前凭据（脱敏）
  search --date YYYY-MM-DD      按日期搜索会议
  recordings <meetingId>        查询会议的录制文件列表
  transcript <recordFileId>     获取录制逐字稿
  fetch <meetingId>             一键获取逐字稿（录制 → 逐字稿）

Auth docs:  https://meeting.tencent.com/marketplace/manage
API docs:   https://cloud.tencent.com/document/product/1095`)
}
