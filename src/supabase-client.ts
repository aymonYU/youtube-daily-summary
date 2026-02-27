import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** 写入 video_summaries 表时的字段结构 */
export interface VideoSummaryRecord {
  video_id: string;
  title: string;
  channel: string;
  summary: string;
}

/** getSummaryStatus 的返回值，main.ts 据此决定跳过 / 重试 Telegram / 全量处理 */
export interface SummaryStatus {
  exists: boolean;
  telegramSent: boolean;
  summary?: string;
  title?: string;
  channel?: string;
}

/**
 * 封装 video_summaries 表的读写操作。
 * 所有方法在出错时返回安全默认值（false / exists:false）并打印日志，不会抛异常。
 */
export class SupabaseStore {
  private client: SupabaseClient;

  constructor(url: string, key: string) {
    this.client = createClient(url, key);
  }

  /**
   * 查询指定视频的摘要记录状态，包括是否存在以及 Telegram 是否已发送。
   */
  async getSummaryStatus(videoId: string): Promise<SummaryStatus> {
    const { data, error } = await this.client
      .from("video_summaries")
      .select("video_id, title, channel, summary, telegram_sent")
      .eq("video_id", videoId)
      .limit(1);

    if (error) {
      console.error(`[ERROR] Supabase query failed for video ${videoId}: ${error.message}`);
      return { exists: false, telegramSent: false };
    }

    if (!data || data.length === 0) {
      return { exists: false, telegramSent: false };
    }

    const record = data[0];
    return {
      exists: true,
      telegramSent: record.telegram_sent ?? false,
      summary: record.summary,
      title: record.title,
      channel: record.channel,
    };
  }

  /**
   * 标记指定视频的 Telegram 已发送。
   */
  async markTelegramSent(videoId: string): Promise<boolean> {
    const { error } = await this.client
      .from("video_summaries")
      .update({ telegram_sent: true })
      .eq("video_id", videoId);

    if (error) {
      console.error(`[ERROR] Supabase update telegram_sent failed for video ${videoId}: ${error.message}`);
      return false;
    }
    return true;
  }

  /**
   * 保存视频摘要记录到 Supabase。
   */
  async saveSummary(record: VideoSummaryRecord): Promise<boolean> {
    const { error } = await this.client
      .from("video_summaries")
      .insert(record);

    if (error) {
      console.error(
        `[ERROR] Supabase insert failed for video ${record.video_id}: ${error.message}`
      );
      return false;
    }
    console.log(`[INFO] Saved summary to Supabase: ${record.video_id}`);
    return true;
  }
}
