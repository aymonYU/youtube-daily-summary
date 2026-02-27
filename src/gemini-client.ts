const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_NAME = "gemini-2.5-flash";

// 支持多 API Key 轮换，某个 key 连续失败后自动切换下一个
export class GeminiClient {
  private apiKeys: string[];
  private currentKeyIndex = 0;
  private timeout: number;
  private maxRetriesPerKey: number;

  constructor(apiKeys: string[], timeout = 60000, maxRetriesPerKey = 1) {
    if (apiKeys.length === 0) {
      throw new Error("At least one Gemini API key is required");
    }
    this.apiKeys = apiKeys;
    this.timeout = timeout;
    this.maxRetriesPerKey = maxRetriesPerKey;
  }

  private get currentKey(): string {
    return this.apiKeys[this.currentKeyIndex];
  }

  // 轮换到下一个 API Key（循环）
  private rotateKey(): void {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
  }

  // 通过 file_data.file_uri 直接传入 YouTube 链接，让 Gemini 原生读取视频内容（字幕/画面）
  // 同时附上视频元数据作为文字上下文，补充模型可能无法从视频中获取的信息
  async summarizeVideo(
    videoId: string,
    title: string,
    description: string,
    channelTitle: string,
    publishedAt: string,
    promptTemplate: string
  ): Promise<string | null> {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const videoContext = [
      `视频标题: ${title}`,
      `频道: ${channelTitle}`,
      `发布时间: ${publishedAt}`,
      `视频描述: ${description}`,
      `视频链接: ${videoUrl}`,
    ].join("\n");

    // prompts.md 模板 + 视频元数据拼接为完整 prompt
    const fullPrompt = `${promptTemplate}\n${videoContext}`;

    const url = `${GEMINI_API_BASE}/${MODEL_NAME}:generateContent`;
    const payload = {
      contents: [
        {
          parts: [
            // file_data 方式：Gemini 会直接抓取并理解 YouTube 视频内容
            { file_data: { file_uri: videoUrl } },
            { text: fullPrompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,   // 适度确定性，避免摘要内容过于发散
        maxOutputTokens: 8192,
      },
    };

    const totalKeys = this.apiKeys.length;
    let keysTried = 0;

    // 外层：遍历所有可用 key；内层：每个 key 最多重试 maxRetriesPerKey 次
    while (keysTried < totalKeys) {
      const key = this.currentKey;
      const keyLabel = `key#${this.currentKeyIndex + 1}/${totalKeys}`;

      for (let attempt = 1; attempt <= this.maxRetriesPerKey; attempt++) {
        try {
          console.log(
            `[INFO] Requesting Gemini [${keyLabel}, attempt ${attempt}/${this.maxRetriesPerKey}] for video: ${videoId}`
          );

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), this.timeout);

          const resp = await fetch(`${url}?key=${encodeURIComponent(key)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
          }

          const data = await resp.json();
          const candidates = data.candidates ?? [];
          if (candidates.length > 0) {
            const parts = candidates[0]?.content?.parts ?? [];
            if (parts.length > 0) {
              const text = parts[0]?.text ?? "";
              if (text) {
                console.log(
                  `[INFO] Successfully generated summary for video ${videoId} using ${keyLabel}`
                );
                return text;
              }
            }
          }

          // 请求成功但内容为空，不再重试（非网络问题）
          console.warn(`[WARN] Empty response from Gemini for video: ${videoId}`);
          return null;
        } catch (err) {
          console.warn(
            `[WARN] Gemini API failed [${keyLabel}, attempt ${attempt}/${this.maxRetriesPerKey}] for video ${videoId}: ${err}`
          );
          // 指数退避：1s, 2s, ...
          if (attempt < this.maxRetriesPerKey) {
            await Bun.sleep(2 ** attempt * 1000);
          }
        }
      }

      // 当前密钥所有重试用尽，轮换到下一个
      console.warn(`[WARN] All retries exhausted for ${keyLabel}, rotating to next key...`);
      this.rotateKey();
      keysTried++;
      await Bun.sleep(1000);
    }

    console.error(
      `[ERROR] Gemini API failed after trying all ${totalKeys} keys for video: ${videoId}`
    );
    return null;
  }
}
