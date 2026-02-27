# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the main script
bun run src/main.ts

# Install dependencies
bun install
```

There are no tests. The GitHub Actions workflow (`daily-summary.yml`) runs `bun run src/main.ts` on a schedule (every 4 hours) and can also be triggered manually.

## Architecture

This is a GitHub Actions automation that fetches recent YouTube videos, summarizes them using Gemini AI, stores results in Supabase, and sends notifications to Telegram.

**Data flow in `main.ts`:**
1. Load config (env vars + `prompts.md` as the AI prompt template)
2. For each channel handle in `YOUTUBE_CHANNELS`: resolve channel ID → fetch latest N videos
3. For each video: check Supabase for existing record
   - Already exists + Telegram sent → skip
   - Already exists + not sent → retry Telegram only
   - New video → generate Gemini summary → save to Supabase → send Telegram

**Modules:**
- `src/config.ts` — reads env vars and loads `prompts.md` as `promptTemplate`
- `src/youtube-client.ts` — resolves channel handles (via `forHandle` param, falls back to search) and fetches latest videos; has built-in retry with exponential backoff
- `src/gemini-client.ts` — calls Gemini API (`gemini-2.5-flash` model) with key rotation and retry; sends the YouTube video URL directly as `file_data` so Gemini can access the video content
- `src/supabase-client.ts` — wraps the `video_summaries` table (columns: `video_id`, `title`, `channel`, `summary`, `telegram_sent`)
- `src/telegram-client.ts` — sends Markdown messages, splits at 4096-char limit on paragraph boundaries, falls back to plain text on parse errors
- `prompts.md` — the Chinese-language system prompt instructing Gemini to summarize videos for Telegram display

**Key design details:**
- Gemini API key rotation: multiple keys in `GEMINI_API_KEYS`, each retried up to 2 times before switching to next key
- Rate limiting: 5-second delay between video processing, 0.5-second delay between Telegram message segments
- Idempotent: Supabase record status prevents duplicate processing on re-runs

## Required Environment Variables / Secrets

| Variable | Description |
|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `GEMINI_API_KEYS` | Comma-separated Gemini API keys (rotated on failure) |
| `YOUTUBE_CHANNELS` | Comma-separated channel handles (e.g. `@channel1,@channel2`) |
| `MAX_VIDEOS_PER_CHANNEL` | Max videos to process per channel (default: 5) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase anon/service key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Target Telegram chat/channel ID |

In production these are GitHub Actions secrets. For local runs, set them as environment variables before running `bun run src/main.ts`.
