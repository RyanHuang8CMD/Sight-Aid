import express from "express";
import { LLMClient } from "coze-coding-dev-sdk";

const router = express.Router();

const SYSTEM_PROMPT = `你是一个视障用户的实时避障助手。你会收到一张从胸前拍摄的实时照片。

请分析画面中用户前方 1-3 米范围内可能碰撞到的障碍物。

回复规则：
1. 必须极其简洁，控制在 15 个字以内
2. 直接说出障碍物和方向
3. 方向用：正前方、左前方、右前方、左侧、右侧
4. 如果没有障碍物，回复"安全，继续前行。"
5. 不要说多余的话，不要解释，不要寒暄

示例回复：
- "正前方有桌子，请绕行。"
- "左前方有书架，约两米。"
- "右侧有椅子，请小心。"
- "安全，继续前行。"`;

function normalizeImage(img: string): string {
  const trimmed = img.trim();
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }
  return `data:image/jpeg;base64,${trimmed}`;
}

router.post("/", async (req, res) => {
  try {
    const { image } = req.body as { image: string };

    if (!image) {
      return res.status(400).json({ error: "Missing image" });
    }

    const client = new LLMClient();

    const dataUri = normalizeImage(image);

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "分析这张照片中的障碍物。" },
          { type: "image_url" as const, image_url: { url: dataUri, detail: "low" as const } },
        ],
      },
    ];

    const response = await client.invoke(messages, {
      model: "doubao-seed-2-0-mini-260215", // Use mini model for speed
      temperature: 0.3,
    });

    const result = response.content;

    return res.json({
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Navigation analysis error:", error);
    return res.status(500).json({
      error: "Analysis failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
