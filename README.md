# YouTube 视频摘要自动化

本项目通过 GitHub Actions 定时拉取指定 YouTube 频道的近期视频，使用 Google Gemini 生成摘要，将结果写入 Supabase，并通过 Telegram 推送通知。同一视频可重复运行而不会重复摘要（由数据库记录与发送状态控制）。

## 环境要求

- [Bun](https://bun.sh/)（本地运行与 CI 均使用 Bun）

## 本地运行

```bash
bun install
```

配置好下方环境变量后执行：

```bash
bun run src/main.ts
```

或使用 `package.json` 中的脚本：

```bash
bun run start
```

## 环境变量

生产环境（GitHub Actions）中，下列变量一般配置在仓库的 **Secrets** 中；本地运行时导出为环境变量即可。

| 变量 | 必填 | 说明 |
|------|------|------|
| `YOUTUBE_API_KEY` | 是 | YouTube Data API v3 密钥 |
| `GEMINI_API_KEYS` | 二选一* | 逗号分隔的多个 Gemini API 密钥，失败时轮换 |
| `GEMINI_API_KEY` | 二选一* | 单个 Gemini 密钥；仅在未设置 `GEMINI_API_KEYS` 时使用 |
| `YOUTUBE_CHANNELS` | 否** | 逗号分隔的频道 handle，例如 `@channel1,@channel2` |
| `MAX_VIDEOS_PER_CHANNEL` | 否 | 每个频道最多处理的视频数，默认 `5` |
| `SUPABASE_URL` | 是 | Supabase 项目 URL |
| `SUPABASE_KEY` | 是 | Supabase anon 或服务密钥 |
| `TELEGRAM_BOT_TOKEN` | 是 | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | 是 | 目标聊天或频道的 Chat ID |

\* 至少需要配置 `GEMINI_API_KEYS` 或 `GEMINI_API_KEY` 之一。  
\** 若列表为空，程序在逻辑上可能没有可处理频道；请按实际部署填写。

## 数据流概览

1. 从环境变量与项目根目录的 `prompts.md` 加载配置与提示词模板。
2. 对每个 `YOUTUBE_CHANNELS` 中的 handle：解析频道 ID，拉取最近若干条视频。
3. 对每条视频查询 Supabase：
   - 已存在且已向 Telegram 发送 → 跳过；
   - 已存在但未发送 → 仅重试 Telegram；
   - 新视频 → 调用 Gemini 生成摘要 → 写入 Supabase → 发送 Telegram。

## 主要代码结构

| 路径 | 作用 |
|------|------|
| `src/main.ts` | 入口，编排上述流程 |
| `src/config.ts` | 读取环境变量并加载 `prompts.md` |
| `src/youtube-client.ts` | 频道解析与视频列表拉取（含退避重试） |
| `src/gemini-client.ts` | 调用 Gemini（含多密钥轮询与重试） |
| `src/supabase-client.ts` | `video_summaries` 表封装 |
| `src/telegram-client.ts` | Telegram Markdown 发送与分段 |
| `prompts.md` | 面向 Gemini 的中文摘要提示词模板 |

Supabase 表 `video_summaries` 需包含字段：`video_id`、`title`、`channel`、`summary`、`telegram_sent`（具体以 `src/supabase-client.ts` 为准）。

## GitHub Actions

工作流文件：`.github/workflows/daily-summary.yml`。

- **定时**：每 2 小时执行一次（cron：`17 */2 * * *`）。
- **手动**：可在 Actions 中通过 `workflow_dispatch` 触发。

工作流会将上述 Secrets 注入环境变量后执行 `bun run src/main.ts`。

## 其它说明

- 项目内无自动化测试脚本；变更后可通过本地配置环境变量跑通 `main.ts` 做验证。
- 面向 AI 辅助开发的结构说明见仓库根目录的 `CLAUDE.md`。
