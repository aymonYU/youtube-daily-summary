const TELEGRAM_API_BASE = "https://api.telegram.org";
// Telegram Bot API 单条消息上限
const MAX_MESSAGE_LENGTH = 4096;

export class TelegramClient {
  private botToken: string;
  private chatId: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  // 对外入口：超长文本自动分段发送，返回所有段均成功时为 true
  async sendMessage(text: string): Promise<boolean> {
    const chunks = this.splitMessage(text);
    let allSuccess = true;

    for (const chunk of chunks) {
      const success = await this.sendChunk(chunk);
      if (!success) {
        allSuccess = false;
      }
      // 多段之间间隔避免触发 Telegram 限流（30msg/s）
      if (chunks.length > 1) {
        await Bun.sleep(500);
      }
    }
    return allSuccess;
  }

  // 优先以 Markdown 模式发送；若 Telegram 返回 400 "can't parse"，
  // 说明摘要内含非法 Markdown 字符，降级为纯文本重试
  private async sendChunk(text: string): Promise<boolean> {
    const url = `${TELEGRAM_API_BASE}/bot${this.botToken}/sendMessage`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: "Markdown",
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        console.warn(`[WARN] Telegram send failed (${resp.status}): ${body}`);
        // Markdown 解析失败时回退到纯文本
        if (resp.status === 400 && body.includes("can't parse")) {
          return this.sendChunkPlain(text);
        }
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[WARN] Telegram send error: ${err}`);
      return false;
    }
  }

  // 纯文本兜底，不带 parse_mode
  private async sendChunkPlain(text: string): Promise<boolean> {
    const url = `${TELEGRAM_API_BASE}/bot${this.botToken}/sendMessage`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
        }),
      });
      if (!resp.ok) {
        console.warn(`[WARN] Telegram plain send failed: ${resp.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[WARN] Telegram plain send error: ${err}`);
      return false;
    }
  }

  // 按段落边界切割长文本，优先级：双换行 > 单换行 > 硬截断
  // 避免在 Markdown 格式中间截断（如标题、加粗块）
  private splitMessage(text: string): string[] {
    if (text.length <= MAX_MESSAGE_LENGTH) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_MESSAGE_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // 在限制范围内找最后一个段落分隔符
      let splitAt = remaining.lastIndexOf("\n\n", MAX_MESSAGE_LENGTH);
      if (splitAt <= 0) {
        // 找不到双换行，尝试单换行
        splitAt = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
      }
      if (splitAt <= 0) {
        // 强制截断
        splitAt = MAX_MESSAGE_LENGTH;
      }

      chunks.push(remaining.slice(0, splitAt));
      // trimStart 去除段首多余空白，保持每段内容整洁
      remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
  }
}
