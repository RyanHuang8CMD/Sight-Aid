import { Router } from "express";
import type { Request, Response } from "express";
import { LLMClient, Config, HeaderUtils, S3Storage } from "coze-coding-dev-sdk";

const router = Router();

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: "",
  secretKey: "",
  bucketName: process.env.COZE_BUCKET_NAME,
  region: "cn-beijing",
});

/**
 * Extract raw base64 string from a data URI (e.g. "data:image/jpeg;base64,abc...")
 */
function extractBase64(dataUri: string): string {
  const match = dataUri.match(/^data:image\/\w+;base64,(.+)$/);
  return match ? match[1] : dataUri;
}

/**
 * POST /api/v1/analyze
 * Body: { images: string[], target?: string }
 * - images: base64 data URI array (data:image/jpeg;base64,...)
 * - target: what the user is looking for (default: "洗手间/厕所")
 */
router.post("/", async (req: Request, res: Response) => {
  const uploadedKeys: string[] = [];
  try {
    const { images, target } = req.body as {
      images: string[];
      target?: string;
    };

    if (!images || images.length === 0) {
      res.status(400).json({ error: "请提供至少一张图片" });
      return;
    }

    // Upload each base64 image to object storage and get HTTP URLs
    const imageUrls: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const base64Data = extractBase64(images[i]);
      const buffer = Buffer.from(base64Data, "base64");
      const key = await storage.uploadFile({
        fileContent: buffer,
        fileName: `sight-aid/frame_${Date.now()}_${i}.jpg`,
        contentType: "image/jpeg",
      });
      uploadedKeys.push(key);
      const url = await storage.generatePresignedUrl({
        key,
        expireTime: 3600,
      });
      imageUrls.push(url);
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    const targetDesc = target || "洗手间/厕所";

    const contentParts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } }
    > = [
      {
        type: "text",
        text: `你是一位帮助视障用户的 AI 导航助手。用户刚刚在原地缓慢转了一圈，拍摄了周围 360 度环境的多张照片（按拍摄顺序均匀排列，第1张是正前方，后续每张大约旋转45度）。

请仔细分析这些照片，完成以下任务：

1. **寻找目标**：重点寻找「${targetDesc}」的标志、图标或相关设施。如果没有找到目标，也要描述周围最显著的地标。

2. **精确方向**：根据照片的拍摄顺序，判断目标相对于用户的精确方向。使用以下8个方位：正前方、左前方、左侧、左后方、正后方、右后方、右侧、右前方。

3. **精确距离估算**（这是最重要的任务，请仔细计算）：
   请使用以下方法综合估算目标距离（单位：米）：

   **方法一：参照物尺寸法（最准确）**
   找到目标附近的已知尺寸物体作为参照：
   - 标准门把手高度：约 1 米
   - 标准门的高度：约 2 米
   - 成年人身高：约 1.7 米
   - 标准洗手间标志（男女头像）：边长约 25-30 厘米
   - 楼梯台阶高度：约 15 厘米
   - 地砖/瓷砖：常见边长 60 厘米 或 80 厘米
   物体在画面中占的比例越小，距离越远。

   **方法二：多帧交叉验证**
   如果同一目标出现在多张照片中，注意它在不同帧中的大小变化：
   - 目标在画面中央时往往最近（正对方向）
   - 目标出现在边缘帧时往往更远（侧面视角）
   取多帧估算的平均值或中间值。

   **方法三：透视与深度线索**
   - 地面上的物体：越靠近地平线越远
   - 遮挡关系：被近物遮挡的物体更远
   - 纹理细节：能看清细节的近，模糊的远
   - 阴影长度：也可辅助判断

   请给出一个**精确到米的具体数字**，例如"约8米"、"约15米"。
   如果信心不足，给出一个窄范围，例如"约5到7米"。

4. **路径指引**：如果找到目标，给出简洁的行走建议。

请用简洁、清晰的中文回答，适合语音播报。回答格式示例：
"正前方约8米处发现洗手间标志，建议直行。左前方约15米有便利店。"
回答控制在100字以内。`,
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
      temperature: 0.3,
    });

    res.json({
      success: true,
      result: response.content,
    });
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: "分析失败，请重试" });
  } finally {
    // Clean up uploaded files from storage
    for (const key of uploadedKeys) {
      storage.deleteFile({ fileKey: key }).catch(() => {});
    }
  }
});

export default router;
