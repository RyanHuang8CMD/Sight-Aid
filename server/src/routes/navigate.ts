import express from "express";
import { LLMClient } from "coze-coding-dev-sdk";

const router = express.Router();

const SYSTEM_PROMPT = `你是视障用户的避障助手。分析照片中正前方1-3米内的障碍物。

严格规则：
1. 回复必须不超过12个中文字
2. 格式固定："{方向}有{物体}"或"安全"
3. 方向只用：正前方、左前方、右前方、左侧、右侧
4. 无障碍物时只回复"安全"
5. 禁止解释、禁止寒暄、禁止说"请"字

示例：
- "正前方有桌子"
- "左前方有书架"
- "右侧有椅子"
- "安全"`;

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
      temperature: 0.1,
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
