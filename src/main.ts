import { loadConfig } from "./config";
import { getChannelId, getLatestVideos } from "./youtube-client";
import { GeminiClient } from "./gemini-client";
import { SupabaseStore } from "./supabase-client";
import { TelegramClient } from "./telegram-client";

async function main() {
  // 1. 加载配置
  console.log("[INFO] Loading configuration...");
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    console.error(`[ERROR] Configuration error: ${err}`);
    process.exit(1);
  }

  if (config.channels.length === 0) {
    console.error("[ERROR] No channels configured");
    process.exit(1);
  }
  if (config.geminiApiKeys.length === 0) {
    console.error("[ERROR] No Gemini API keys configured");
    process.exit(1);
  }

  console.log(`[INFO] Channels to process: ${config.channels.join(", ")}`);

  // 2. 初始化各模块
  const gemini = new GeminiClient(config.geminiApiKeys);
  const store = new SupabaseStore(config.supabaseUrl, config.supabaseKey);
  const telegram = new TelegramClient(config.telegramBotToken, config.telegramChatId);

  let totalGenerated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalRetried = 0;

  // 发送 Telegram 并标记已发送
  async function sendTelegramAndMark(
    videoId: string,
    title: string,
    channel: string,
    summary: string
  ): Promise<boolean> {
    const telegramMessage = [
      `📺 *${title}*`,
      `📡 频道: ${channel}`,
      `🔗 https://www.youtube.com/watch?v=${videoId}`,
      "",
      summary,
    ].join("\n");

    const sent = await telegram.sendMessage(telegramMessage);
    if (sent) {
      await store.markTelegramSent(videoId);
      console.log(`[INFO] Telegram notification sent for: ${videoId}`);
      return true;
    } else {
      console.warn(`[WARN] Telegram notification failed for: ${videoId}`);
      return false;
    }
  }

  // 3. 遍历每个频道
  for (const channelHandle of config.channels) {
    console.log("=".repeat(60));
    console.log(`[INFO] Processing channel: ${channelHandle}`);

    // 3.1 解析频道 ID
    const channelId = await getChannelId(config.youtubeApiKey, channelHandle);
    if (!channelId) {
      console.error(`[ERROR] Skipping channel ${channelHandle}: could not resolve channel ID`);
      continue;
    }

    // 3.2 获取最新视频
    const videos = await getLatestVideos(
      config.youtubeApiKey,
      channelId,
      config.maxVideosPerChannel
    );
    if (videos.length === 0) {
      console.warn(`[WARN] No videos found for channel ${channelHandle}`);
      continue;
    }

    console.log(`[INFO] Found ${videos.length} videos for ${channelHandle}`);

    // 3.3 逐个处理视频
    for (const video of videos) {
      // 查询记录状态
      const status = await store.getSummaryStatus(video.videoId);

      if (status.exists && status.telegramSent) {
        // 已存在且已发送 Telegram，完全跳过
        console.log(`[INFO] Skipping (already exists & sent): [${video.videoId}] ${video.title}`);
        totalSkipped++;
        continue;
      }

      if (status.exists && !status.telegramSent) {
        // 已存在但未发送 Telegram，重试发送
        console.log(`[INFO] Retrying Telegram for: [${video.videoId}] ${video.title}`);
        const sent = await sendTelegramAndMark(
          video.videoId,
          status.title!,
          status.channel!,
          status.summary!
        );
        if (sent) totalRetried++;
        await Bun.sleep(2000);
        continue;
      }

      // 新视频：生成摘要 -> 存储 -> 发送 Telegram
      console.log(`[INFO] Generating summary for: [${video.videoId}] ${video.title}`);

      const summary = await gemini.summarizeVideo(
        video.videoId,
        video.title,
        video.description,
        video.channelTitle,
        video.publishedAt,
        config.promptTemplate
      );

      if (!summary) {
        console.warn(`[WARN] Failed to generate summary for: [${video.videoId}] ${video.title}`);
        totalFailed++;
        continue;
      }

      // 存储到 Supabase
      const saved = await store.saveSummary({
        video_id: video.videoId,
        title: video.title,
        channel: video.channelTitle,
        summary,
      });

      if (saved) {
        totalGenerated++;
        await sendTelegramAndMark(video.videoId, video.title, video.channelTitle, summary);
      } else {
        totalFailed++;
      }

      // 请求间隔，避免 API 限流
      await Bun.sleep(5000);
    }
  }

  // 4. 输出统计
  console.log("=".repeat(60));
  console.log(
    `[INFO] Done! Generated: ${totalGenerated}, Retried: ${totalRetried}, Skipped: ${totalSkipped}, Failed: ${totalFailed}`
  );
}

main();
