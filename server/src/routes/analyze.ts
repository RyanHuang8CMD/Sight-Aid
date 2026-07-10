import { Router } from "express";
import type { Request, Response } from "express";
import { LLMClient } from "coze-coding-dev-sdk";

const router = Router();

/**
 * POST /api/v1/analyze
 * Body: { images: string[], target?: string }
 * - images: base64 data URI array (data:image/jpeg;base64,...)
 * - target: what the user is looking for (default: "洗手间/厕所")
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { images, target } = req.body as {
      images: string[];
      target?: string;
    };

    if (!images || images.length === 0) {
      res.status(400).json({ error: "请提供至少一张图片" });
      return;
    }

    // Build image URLs - pass data URIs directly to LLM
    const imageUrls: string[] = images.map((img) => {
      // Ensure proper data URI format
      if (img.startsWith("data:")) {
        return img;
      }
      return `data:image/jpeg;base64,${img}`;
    });

    const client = new LLMClient();

    const targetDesc = target || "洗手间/厕所";

    const contentParts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } }
    > = [
      {
        type: "text",
        text: `你是视障用户的导航助手。用户原地转了一圈，拍了周围360度的照片（按顺序排列，第1张正前方，每张约旋转45度）。

任务：在这些照片中找到「${targetDesc}」。

回复规则：
1. 如果找到目标，格式固定为："{方向}约{X}米有{目标}，{一句话指引}"
2. 如果没找到目标，先说"未发现{targetDesc}"，然后详细描述周围各方向有什么物体，格式为："未发现{targetDesc}。你的{方向}有{物体}，{方向}有{物体}，{方向}有{物体}"，至少列出3到4个方向的物体
3. 方向只用：正前方、左前方、左侧、左后方、正后方、右后方、右侧、右前方
4. 距离用"约X米"，根据画面中物体大小估算
5. 找到目标时不超过30字；没找到时不超过50字
6. 禁止解释方法、禁止寒暄

示例：
- "正前方约8米有洗手间，直行即可"
- "右侧约5米有电梯，左转"
- "未发现洗手间。正前方有便利店，左侧有桌椅，右侧有玻璃门，后方有楼梯"`,
      },
    ];

    for (const url of imageUrls) {
      contentParts.push({
        type: "image_url",
        image_url: {
          url,
          detail: "high",
        },
      });
    }

    const messages = [
      {
        role: "system" as const,
        content:
          "你是一位专业的视障用户导航 AI。你的任务是通过分析用户周围 360 度拍摄的照片，帮助用户找到目标位置。你必须给出精确的方向和具体的距离数值（精确到米，如'正前方约8米'），而不是模糊的描述。请尽可能利用画面中的参照物（门、人、地砖等）来提高距离估算的准确性。回答必须简洁、清晰、适合语音播报。使用中文回答。",
      },
      {
        role: "user" as const,
        content: contentParts,
      },
    ];

    const response = await client.invoke(messages, {
      model: "doubao-seed-2-0-pro-260215",
      temperature: 0.1,
    });

    res.json({
      success: true,
      result: response.content,
    });
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: "分析失败，请重试" });
  }
});

export default router;
