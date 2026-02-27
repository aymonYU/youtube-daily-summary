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

/**
 * 加载运行配置：从环境变量读取各服务凭证，从 prompts.md 读取 Gemini 提示词模板。
 * GEMINI_API_KEYS 支持逗号分隔的多个密钥，失败时轮换；也兼容单密钥 GEMINI_API_KEY。
 */
export async function loadConfig(): Promise<Config> {
  // 基于当前文件路径定位项目根目录，确保无论从哪里执行都能找到 prompts.md
  const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

  // 读取 prompts.md
  const promptsPath = resolve(projectRoot, "prompts.md");
  const promptsFile = Bun.file(promptsPath);
  if (!(await promptsFile.exists())) {
    throw new Error(`prompts.md not found at ${promptsPath}`);
  }
  const promptTemplate = await promptsFile.text();

  // 优先使用逗号分隔的多密钥列表，为空时回退到单密钥环境变量
  const geminiApiKeys = getEnvList("GEMINI_API_KEYS");
  if (geminiApiKeys.length === 0) {
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
