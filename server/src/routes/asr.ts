import { Router } from "express";
import type { Request, Response } from "express";
import { ASRClient, Config, HeaderUtils } from "coze-coding-dev-sdk";

const router = Router();

/**
 * POST /api/v1/asr
 * 语音识别：将音频 base64 转换为文字
 * Body: { audioBase64: string }  -- 纯 base64 编码的音频数据（不含 data URI 前缀）
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { audioBase64 } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: "缺少 audioBase64 参数" });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(
      req.headers as Record<string, string>
    );
    const config = new Config();
    const client = new ASRClient(config, customHeaders);

    const result = await client.recognize({
      uid: "sight-aid-user",
      base64Data: audioBase64,
    });

    res.json({ text: result.text || "" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("ASR error:", message);
    res.status(500).json({ error: "语音识别失败", detail: message });
  }
});

export default router;
