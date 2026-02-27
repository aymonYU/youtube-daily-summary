const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/** search API 返回的视频片段信息，供后续 Gemini 摘要和 Supabase 存储使用 */
export interface VideoInfo {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelTitle: string;
  /** 视频时长（秒） */
  durationSeconds: number;
}

/**
 * 解析 ISO 8601 时长格式（如 PT1H2M30S）为秒数。
 */
function parseISO8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * 带重试的 YouTube API 请求。指数退避（2^attempt 秒），超时默认 30s。
 */
async function requestWithRetry(
  url: string,
  params: Record<string, string>,
  maxRetries = 3,
  timeout = 30000
): Promise<any> {
  const searchParams = new URLSearchParams(params);
  const fullUrl = `${url}?${searchParams}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const resp = await fetch(fullUrl, { signal: controller.signal });
      clearTimeout(timer);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      return await resp.json();
    } catch (err) {
      console.warn(
        `[WARN] YouTube API request failed (attempt ${attempt}/${maxRetries}): ${err}`
      );
      if (attempt < maxRetries) {
        await Bun.sleep(2 ** attempt * 1000);
      }
    }
  }
  throw new Error(`YouTube API request failed after ${maxRetries} retries: ${url}`);
}

/**
 * 将频道 handle（如 @channel1）解析为频道 ID。
 * 先尝试 channels API 的 forHandle 参数，失败后回退到 search API。
 */
export async function getChannelId(
  apiKey: string,
  handle: string
): Promise<string | null> {
  const cleanHandle = handle.replace(/^@/, "");

  // 尝试 forHandle 参数
  try {
    const data = await requestWithRetry(`${YOUTUBE_API_BASE}/channels`, {
      part: "id",
      forHandle: cleanHandle,
      key: apiKey,
    });
    const items = data.items ?? [];
    if (items.length > 0) {
      const channelId = items[0].id;
      console.log(`[INFO] Resolved handle @${cleanHandle} -> ${channelId}`);
      return channelId;
    }
  } catch {
    // 继续尝试搜索回退
  }

  // 回退：通过搜索查找频道
  try {
    const data = await requestWithRetry(`${YOUTUBE_API_BASE}/search`, {
      part: "snippet",
      q: `@${cleanHandle}`,
      type: "channel",
      maxResults: "1",
      key: apiKey,
    });
    const items = data.items ?? [];
    if (items.length > 0) {
      const channelId = items[0].snippet.channelId;
      console.log(`[INFO] Resolved handle @${cleanHandle} via search -> ${channelId}`);
      return channelId;
    }
  } catch {
    // 所有方法失败
  }

  console.error(`[ERROR] Failed to resolve channel handle: @${cleanHandle}`);
  return null;
}

/**
 * 获取指定频道的最新视频列表。出错时返回空数组，不会抛异常。
 */
export async function getLatestVideos(
  apiKey: string,
  channelId: string,
  maxResults = 5
): Promise<VideoInfo[]> {
  try {
    const data = await requestWithRetry(`${YOUTUBE_API_BASE}/search`, {
      part: "snippet",
      channelId,
      order: "date",
      type: "video",
      maxResults: String(maxResults),
      key: apiKey,
    });

    const rawItems = (data.items ?? []).slice(0, maxResults);
    const videoIds = rawItems.map((item: any) => item.id.videoId).filter(Boolean);

    // 用 videos API 批量获取时长
    const durationMap: Record<string, number> = {};
    if (videoIds.length > 0) {
      try {
        const detailData = await requestWithRetry(`${YOUTUBE_API_BASE}/videos`, {
          part: "contentDetails",
          id: videoIds.join(","),
          key: apiKey,
        });
        for (const item of detailData.items ?? []) {
          const dur = item.contentDetails?.duration ?? "";
          durationMap[item.id] = parseISO8601Duration(dur);
        }
      } catch (err) {
        console.warn(`[WARN] Failed to fetch video durations: ${err}`);
      }
    }

    const videos: VideoInfo[] = [];
    for (const item of rawItems) {
      const snippet = item.snippet ?? {};
      const vid = item.id.videoId;
      videos.push({
        videoId: vid,
        title: snippet.title ?? "",
        description: snippet.description ?? "",
        publishedAt: snippet.publishedAt ?? "",
        channelTitle: snippet.channelTitle ?? "",
        durationSeconds: durationMap[vid] ?? 0,
      });
    }

    console.log(`[INFO] Found ${videos.length} videos for channel ${channelId}`);
    return videos;
  } catch (err) {
    console.error(`[ERROR] Failed to get videos for channel ${channelId}: ${err}`);
    return [];
  }
}
