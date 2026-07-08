import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { ASRClient, Config } from "coze-coding-dev-sdk";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * POST /api/v1/asr
 * 语音识别：将录音转为文字
 * Body: FormData with 'audio' field (audio file)
 */
router.post("/", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "请提供音频文件" });
      return;
    }

    const audioBase64 = req.file.buffer.toString("base64");

    const config = new Config();
    const asrClient = new ASRClient(config);

    const result = await asrClient.recognize({
      uid: "sight-aid-user",
      base64Data: audioBase64,
    });

    console.log("[ASR] Recognized text:", result.text);

    res.json({ text: result.text || "" });
  } catch (error: any) {
    console.error("[ASR] Error:", error.message || error);
    res.status(500).json({ error: "语音识别失败", detail: error.message || String(error) });
  }
});

export default router;
