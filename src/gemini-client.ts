const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_NAME = "gemini-2.5-flash";

export class GeminiClient {
  private apiKeys: string[];
  private currentKeyIndex = 0;
  private timeout: number;
  private maxRetriesPerKey: number;

  constructor(apiKeys: string[], timeout = 60000, maxRetriesPerKey = 2) {
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

  private rotateKey(): void {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
  }

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

    const fullPrompt = `${promptTemplate}\n${videoContext}`;

    const url = `${GEMINI_API_BASE}/${MODEL_NAME}:generateContent`;
    const payload = {
      contents: [
        {
          parts: [
            { file_data: { file_uri: videoUrl } },
            { text: fullPrompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192,
      },
    };

    const totalKeys = this.apiKeys.length;
    let keysTried = 0;

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

          console.warn(`[WARN] Empty response from Gemini for video: ${videoId}`);
          return null;
        } catch (err) {
          console.warn(
            `[WARN] Gemini API failed [${keyLabel}, attempt ${attempt}/${this.maxRetriesPerKey}] for video ${videoId}: ${err}`
          );
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
