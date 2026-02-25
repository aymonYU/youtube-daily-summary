import { resolve, dirname } from "path";

export interface Config {
  youtubeApiKey: string;
  geminiApiKeys: string[];
  channels: string[];
  maxVideosPerChannel: number;
  supabaseUrl: string;
  supabaseKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  promptTemplate: string;
}

function getEnvRequired(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
}

function getEnvList(key: string): string[] {
  const raw = process.env[key] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function loadConfig(): Promise<Config> {
  const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

  // 读取 prompts.md
  const promptsPath = resolve(projectRoot, "prompts.md");
  const promptsFile = Bun.file(promptsPath);
  if (!(await promptsFile.exists())) {
    throw new Error(`prompts.md not found at ${promptsPath}`);
  }
  const promptTemplate = await promptsFile.text();

  const geminiApiKeys = getEnvList("GEMINI_API_KEYS");
  if (geminiApiKeys.length === 0) {
    // 回退到单 key
    const singleKey = process.env["GEMINI_API_KEY"];
    if (singleKey) geminiApiKeys.push(singleKey);
  }

  const channels = getEnvList("YOUTUBE_CHANNELS");

  return {
    youtubeApiKey: getEnvRequired("YOUTUBE_API_KEY"),
    geminiApiKeys,
    channels,
    maxVideosPerChannel: parseInt(process.env["MAX_VIDEOS_PER_CHANNEL"] ?? "5", 10),
    supabaseUrl: getEnvRequired("SUPABASE_URL"),
    supabaseKey: getEnvRequired("SUPABASE_KEY"),
    telegramBotToken: getEnvRequired("TELEGRAM_BOT_TOKEN"),
    telegramChatId: getEnvRequired("TELEGRAM_CHAT_ID"),
    promptTemplate,
  };
}
