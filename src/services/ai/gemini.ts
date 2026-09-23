import { AIProviderNotConfiguredError, AIStructuredOutputError } from "./errors";
import { modelingIdeasSchema, videoAnalysisSchema } from "./schemas";
import { visualBreakdownSchema } from "./video-schemas";
import { finalReviewSchema } from "./review-schemas";
import { assetValidationSchema } from "./asset-schemas";
import type { AIInput, AIProvider, ModelingDirection, VideoAnalysis, VideoUnderstandingInput, VisualBreakdown, FinalReviewInput, FinalReview, AssetValidationInput, AssetValidation, DevelopedIdea } from "./types";
import { STRICT_GEMINI_PROMPT_COMPILER_SYSTEM_INSTRUCTION } from "@/modules/prompt-fidelity/validator";

function modelingIdeaInstruction(artStyle?: string) {
  return `Bạn đang ở bước TẠO MODELING IDEA cho một video hài hình ảnh ngắn. Hãy "bắt mạch" bản gốc trước khi sáng tạo, dựa trên dữ liệu phân tích được cung cấp.

BƯỚC 1 — PHÂN TÍCH VÀ BẮT MẠCH BẢN GỐC (DECONSTRUCTION):
- Xác định rõ điểm gây cười cốt lõi (The Gag): tiếng cười đến từ sự ngớ ngẩn, tương tác vật lý lố bịch, biểu cảm vô tri, hay khoảng lặng chưng hửng.
- Bảo tồn sự tối giản của nguyên tác. Giữ tinh thần góc máy, nhịp điệu, khoảng lặng và sự trần trụi cần thiết để gag tự phát huy; không tự ý thêm drama, giải thích dài, tình tiết điện ảnh hoặc tuyến phụ làm hỏng mạch hài.
- Đây là modeling bám sát bản gốc: phải giữ nội dung, diễn biến, cốt truyện, thứ tự hành động, số lượng và vai trò nhân vật, đạo cụ chính, điểm gây cười, nhịp, góc máy và logic kết thúc. Không được biến cơ chế gốc thành một câu chuyện khác.
- Chỉ đúng ba khác biệt được phép thay đổi và phải ghi rõ trong whatIsChanged: (1) bối cảnh/môi trường; (2) nhận diện nhân vật chính theo ảnh tham chiếu hoặc Character Identity Pack đã duyệt; (3) phong cách mỹ thuật/rendering được chọn. Bối cảnh có thể được thiết kế lại về hình thức nhưng phải giữ quan hệ không gian, logic đạo cụ và điều kiện để hành động gốc diễn ra.
- Nếu có ảnh nhân vật chính được đính kèm, phải quan sát ảnh đó trước khi viết và dùng đúng nhân vật làm trung tâm trong mọi cảnh. Không được thay bằng nhân vật mới, không được tự suy diễn một nhân vật khác.
- Không thêm nhân vật, đạo cụ, tuyến phụ, hành động, camera, nhịp, gag hoặc kết thúc mới. Không dùng thay đổi đạo cụ tương đương, bản địa hóa hay đổi setting ngoài policy như một quyền thay đổi bổ sung.

BƯỚC 2 — NÂNG CẤP NGHỆ THUẬT (ART DIRECTION & PHYSICS):
- Tạo hình từng nhân vật phải được mô tả cụ thể và có chủ đích gây cười ngay từ cái nhìn đầu tiên. Ưu tiên hình tượng dị biệt, bựa, vô tri, ngớ ngẩn hoặc tương phản bất thường; nét mặt, hình dáng, tỷ lệ, trang phục và đạo cụ phải hỗ trợ hài hình ảnh theo phong cách hài được ưa chuộng.
- Áp dụng vật lý hoạt hình Squash & Stretch một cách nhất quán cho nhân vật, đạo cụ và môi trường khi phù hợp: co giãn đàn hồi, nảy, phập phồng, méo, va đập và rơi xuống phải tạo ra tiếng cười thị giác nhưng vẫn đọc được hành động.
- Mô tả tổng thể không gian thật rõ: bố cục, vật thể chính, khoảng trống, ánh sáng, màu sắc và cảm giác mà bối cảnh mang lại.

BƯỚC 3 — MẠCH KỊCH BẢN PHÂN CẢNH:
- Trường script phải mô tả chi tiết các phân cảnh nối tiếp nhau chặt chẽ, không rời rạc hoặc "nối bịch". Mỗi cảnh phải kế thừa vị trí, trạng thái, đạo cụ và hậu quả của cảnh trước; có mở đầu, tích lũy, va chạm/gag và kết rõ ràng. Mỗi cảnh chỉ có một hành động chính, không gộp nhiều hành động liên tiếp vào một ảnh.
- Mỗi phân cảnh phải làm rõ: tổng thể không gian; tư thế, biểu cảm và trạng thái của từng nhân vật; diễn biến hành động theo thứ tự; vật lý/va chạm; điểm gây cười; và âm thanh hoặc khoảng lặng tương ứng.
- Không làm phức tạp hóa video. Nếu nguyên tác là hài vô ngôn/slapstick, ưu tiên hành động dễ hiểu, ít lời và nhịp hài trực diện.

YÊU CẦU ĐẦU RA:
- Trả đúng một JSON hợp lệ, không Markdown, không bình luận, có đúng một phần tử modelingDirections.
- Viết các trường phân tích bằng tiếng Việt; riêng postText phải viết đúng ngôn ngữ của kênh.
- modelingDirections phải có các trường title, coreConcept, script, characterDesign, setting, artStyle, sourceMechanism, whatIsPreserved, whatIsChanged, targetMarketAdaptation, similarityRisk, whyWorthDeveloping, postText.
- postText là caption ngắn sẵn sàng đăng kèm video, viết đúng ngôn ngữ channelDNA.language và có cách diễn đạt phù hợp channelDNA.targetCountry. Nội dung phải bám sát tình huống video mới, tự nhiên, thu hút và không chứa hashtag vì hashtag kênh sẽ được ghép riêng.
- script, characterDesign và setting phải đủ chi tiết để bước sau có thể chuyển thẳng thành storyboard và prompt tạo ảnh/video.
- Không nêu tên, bắt chước hoặc ám chỉ studio, thương hiệu, nghệ sĩ, thương hiệu phong cách hay nhân vật có bản quyền; chỉ dùng thuộc tính hình ảnh chung.

Phong cách mỹ thuật được chọn: ${artStyle ?? "Dùng phong cách hiện có của kênh"}.`;
}

function developedIdeaInstruction(aspectRatio?: string) {
  return `${STRICT_GEMINI_PROMPT_COMPILER_SYSTEM_INSTRUCTION}

Phát triển Modeling Idea này thành gói sẵn sàng triển khai cho video hài hình ảnh ngắn. Trong vai trò prompt compiler, không viết lại câu chuyện và không thêm sáng tạo ngoài source evidence. Trước khi viết storyboard, bắt buộc thực hiện đủ ba bước sau:

BƯỚC 1 — PHÂN TÍCH VÀ BẮT MẠCH BẢN GỐC (DECONSTRUCTION):
- Trong deconstruction, chỉ ra điểm gây cười cốt lõi (The Gag), bằng chứng từ phân tích, góc máy, nhịp điệu, khoảng lặng và phần tối giản cần bảo tồn.
- Đây là bản chuyển thể bám sát: giữ nguyên nội dung, ý nghĩa, chuỗi sự kiện, thứ tự hành động, số lượng và vai trò nhân vật, đạo cụ chính, góc máy, nhịp, gag và kết quả của bản gốc. Không được tự ý viết một tình huống khác.
- Chỉ đúng ba lớp được phép thay đổi: bối cảnh/môi trường, nhận diện nhân vật chính theo ảnh tham chiếu/Character Identity Pack đã duyệt, và phong cách mỹ thuật/rendering. Nếu thiếu dữ liệu, phải ghi rõ thiếu dữ liệu thay vì bịa thêm.

BƯỚC 2 — NÂNG CẤP NGHỆ THUẬT (ART DIRECTION & PHYSICS):
- Trong artDirection, mô tả bối cảnh/môi trường mới, bố cục, ánh sáng, màu sắc, cảm giác bối cảnh, phong cách hài thị giác và ngôn ngữ máy quay; chỉ thay đổi diện mạo môi trường, không thay đổi quan hệ không gian hoặc logic hành động nguồn.
- Áp dụng Squash & Stretch nhất quán cho nhân vật, đạo cụ và môi trường khi phù hợp: co giãn, phập phồng, nảy, méo, va đập và rơi xuống phải đồng bộ với gag.
- Trong characterDesign, mô tả riêng từng nhân vật với silhouette, tỷ lệ, khuôn mặt, ánh mắt, trang phục, đạo cụ, tư thế và trạng thái. Nhân vật phải dị biệt, bựa, vô tri, ngớ ngẩn hoặc tương phản bất thường để bản thân tạo hình đã gây cười; không dùng nhân vật có bản quyền.
- Trong backgroundDesign, mô tả rõ bối cảnh/môi trường được phép thay đổi và quy tắc giữ quan hệ không gian, đạo cụ, continuity và điều kiện hành động của bản gốc nhất quán giữa các cảnh.

BƯỚC 3 — STORYBOARD SCRIPT NỐI TIẾP CHẶT CHẼ:
- storyboard phải gồm các cảnh nối tiếp hợp lý, không rời rạc. Cảnh sau bắt đầu từ trạng thái, vị trí, đạo cụ và hậu quả ở cuối cảnh trước; không tự ý đổi không gian hoặc reset nhân vật. Mỗi cảnh chỉ có một hành động chính, phù hợp video 4 giây.
- Mỗi cảnh phải tuân thủ đúng ba khối rạch ròi trong storyboard và có thêm hai prompt sản xuất riêng:
  1. visualBlock: ghi rõ [HÌNH ẢNH / KHÔNG GIAN / TƯ THẾ / TRẠNG THÁI], gồm tổng thể không gian, cảm giác bối cảnh, ánh sáng, vị trí vật thể và tư thế/trạng thái ban đầu của từng nhân vật.
  2. actionBlock: liệt kê theo thứ tự 1, 2, 3... toàn bộ diễn biến hành động, tương tác vật lý, chuyển động cơ thể, va đập, co giãn, nảy lên, rơi xuống và điểm gag.
  3. audioBlock: liệt kê Foley đồng bộ 100% với từng hành động; ghi rõ nhịp, cao trào và khoảng lặng. Sự im lặng cũng được coi là một loại âm thanh để tấu hài.
- startFramePrompt là prompt tiếng Anh riêng để tạo đúng một ảnh bắt đầu đứng yên cho cảnh 4 giây. Prompt phải mô tả chính xác khung hình đầu: không gian, bố cục, tư thế và trạng thái ban đầu, vị trí nhân vật/đạo cụ, ánh sáng, góc máy và phong cách; dùng ảnh nhân vật chính cùng ảnh bối cảnh làm tham chiếu; tuyệt đối không mô tả chuyển động tiếp diễn, không tạo collage, storyboard, sheet, chữ hoặc nhiều biến thể.
- englishPrompt là prompt tiếng Anh riêng cho video quay 4 giây sau khi đã có ảnh bắt đầu. Prompt phải chỉ rõ cách animate từ đúng ảnh bắt đầu, giữ nguyên ý nghĩa, thứ tự hành động, nhân vật, đạo cụ, bối cảnh, nhịp máy quay, điểm gag và kết thúc; không được biến thành một câu chuyện khác hoặc thêm hành động mới.
- Trong sourceModelingSpec, chỉ ghi phần bằng chứng nội dung của video gốc; sourceVideoId do ứng dụng lắp ráp từ SourceVideo record, không tự phát minh. sourceEvidence là evidence do Gemini quan sát/tổng hợp, có thể là mảng rỗng nếu không có evidence đủ chắc chắn; nếu có phần tử thì phải đúng shape {"timestamp": string|null, "description": string|null, "frameReference": string|null}. Không nhồi sourceVideoId, sourceVideoUrl, sourceVideoMetadata, sourceDuration hoặc platform vào sourceEvidence. sourceStartTime và sourceEndTime phải là JSON number theo đơn vị giây; sourceStartTime không âm, sourceEndTime dương và lớn hơn sourceStartTime. duration phải là JSON number theo đơn vị giây và khớp sourceEndTime - sourceStartTime trong tolerance của schema. relativeObjectPositions phải là JSON array gồm các string không rỗng; [] hợp lệ nếu không có evidence quan hệ vật thể. Không được trả một string đơn, string phân tách bằng dấu phẩy/chấm phẩy, object hoặc null. actionSequence phải là JSON array gồm ít nhất một string không rỗng cho mỗi action beat theo đúng thứ tự thời gian trong scene. Không gộp toàn bộ chuỗi hành động vào một string, numbered prose, object, null hoặc array rỗng. CAMERA CONTRACT: cameraType, shotSize, cameraAngle và framing phải là JSON string không rỗng mô tả camera intent nguồn; cameraMovement phải là JSON string hoặc null mô tả chuyển động camera, có thể bỏ qua khi dùng default null. Không trả object, array hoặc number cho các field camera. Không tự map synonym về enum vì schema hiện không có enum. Ví dụ hợp lệ: sourceStartTime 0, sourceEndTime 3, duration 3, relativeObjectPositions ["monitor in front of character", "keyboard below monitor"], actionSequence ["Character approaches", "Character opens the door"], cameraType "Medium Shot", shotSize "Medium Shot", cameraAngle "Eye Level", cameraMovement "Static", framing "Centered"; sourceStartTime 1.5, sourceEndTime 5, duration 3.5, relativeObjectPositions [], actionSequence ["Character looks inside"], cameraType "Wide Shot", shotSize "Wide Shot", cameraAngle "Eye Level", cameraMovement null, framing "Full scene". Không được trả chuỗi như "00:03", "3", "3s" hoặc "00:13.5" cho duration hay timestamp. Một source scene cho từng shot/beat lớn gồm sourceSceneId, order, timestamp bắt đầu/kết thúc, storyBeat, camera, framing, vị trí tương đối, actionSequence theo thứ tự, start/end state, transitions, timing/rhythm notes, mustPreserve và allowedTransformations. Chỉ ghi điều quan sát được từ source context; thiếu bằng chứng thì ghi rõ thiếu dữ liệu, không bịa.
- Mỗi storyboard item ngoài sceneNumber, visualBlock, actionBlock, audioBlock, startFramePrompt và englishPrompt bắt buộc phải có sourceSceneId, sourceBeat, actionSequence (mảng theo thứ tự), cameraSpec, spatialSpec, startState, endState và targetDuration. Đây là bằng chứng cấu trúc để validator so sánh sớm, không được thay bằng prose mơ hồ.
- Trong visualBlock, startFramePrompt và englishPrompt, phải ghi rõ nhân vật chính cố định của kênh được giữ nguyên nhận diện qua các cảnh; ảnh tham chiếu kênh sẽ được đính kèm ở bước tạo ảnh và video. Không được dùng ảnh tham chiếu để tạo sheet, collage hoặc nhân vật thứ hai.

Trả đúng JSON có schemaVersion là chuỗi "1.0", gồm sourceModelingSpec, deconstruction, artDirection, characterDesign, backgroundDesign, storyboard và safetyReview. Mỗi phần tử storyboard bắt buộc có sceneNumber, sourceSceneId, sourceBeat, actionSequence, cameraSpec, spatialSpec, startState, endState, targetDuration, visualBlock, actionBlock, audioBlock, startFramePrompt và englishPrompt. Viết các trường mô tả bằng tiếng Việt, riêng startFramePrompt và englishPrompt phải viết bằng tiếng Anh để gửi cho Google Flow. Khung hình đã chọn: ${aspectRatio ?? "9:16"}. Chỉ dùng mô tả hình ảnh nguyên bản, không nêu tên hoặc bắt chước studio, thương hiệu, nghệ sĩ hay nhân vật có bản quyền.`;
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY,
    private readonly model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
    private readonly fallbackModel = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash-lite",
  ) {}
  analyzeVideo(input: AIInput) {
    return this.request(
      "Analyze the video. Return exactly one JSON object, with no Markdown fences and no commentary. Use exactly these keys: schemaVersion (string \"1.0\"), summary, hook, setup, conflict, escalation, twist, payoff, theGag, cameraPattern, editingRhythm, soundPattern, retentionMechanism (all strings), characterInteractions and whyItWorks (arrays of strings). Write the analysis in Vietnamese. If evidence is missing, use a short honest explanation instead of inventing details.",
      input,
      videoAnalysisSchema,
      normalizeVideoAnalysis,
      videoAnalysisResponseSchema,
      { includeMainCharacterImage: false },
    );
  }
  generateIdeas(input: AIInput & { analysis: VideoAnalysis; artStyle?: string }) { return this.request(modelingIdeaInstruction(input.artStyle), input, modelingIdeasSchema, normalizeModelingIdeas, modelingIdeasResponseSchema); }
  developIdea(input: AIInput & { analysis: VideoAnalysis; idea: ModelingDirection; aspectRatio?: string }) { return this.request(developedIdeaInstruction(input.aspectRatio), input, { parse: (value: unknown) => normalizeDevelopedIdea(value) as DevelopedIdea }, normalizeDevelopedIdea, developedIdeaResponseSchema); }
  async understandVideo(input: VideoUnderstandingInput): Promise<VisualBreakdown> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const systemPrompt = input.instruction ?? "Analyze this short-form competitor video. Do not propose a new idea yet. Return structured JSON with videoSummary, openingHook, timeline with MM:SS timestamps, characters, setting, visualGag, escalation, twist, payoff, cameraPattern, audioPattern, whyItLikelyWorks. Focus on observable evidence and distinguish evidence from inference.";
    const response = await this.generateContent({ contents: [{ parts: [{ file_data: { file_uri: input.videoFileUri, mime_type: input.mimeType } }, { text: `${systemPrompt}\nChannel DNA context:\n${JSON.stringify(input.channelDNA ?? {})}` }] }], generationConfig: { responseMimeType: "application/json" } });
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try { return visualBreakdownSchema.parse(parseJsonText(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "")); } catch (error) { throw new AIStructuredOutputError(this.name, error); }
  }
  async reviewProject(input: FinalReviewInput): Promise<FinalReview> {
    return this.request("Review this draft content package. Do not rewrite it and do not generate a new package. Return only structured JSON listing missing details, continuity problems, ambiguities, prompt improvements, safety concerns, location, severity, and suggested corrections. The user will decide Apply or Ignore.", input, finalReviewSchema);
  }
  async validateAsset(input: AssetValidationInput): Promise<AssetValidation> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const prompt = "Validate this uploaded asset against the expected design. Return only JSON. AI may recommend APPROVED or NEEDS_REVISION, but do not make a user decision. Score characterMatch when relevant, styleMatch, and composition from 0 to 100. If the character is cut off or the scene lacks required space, report a concrete issue and suggestion.";
    const response = await this.generateContent({ contents: [{ parts: [{ file_data: { file_uri: input.assetUri, mime_type: input.mimeType } }, { text: `${prompt}\nAsset type: ${input.assetType}\nExpected design: ${JSON.stringify(input.expectedDesign)}\nProject context: ${JSON.stringify(input.projectContext ?? {})}` }] }], generationConfig: { responseMimeType: "application/json" } });
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try { return assetValidationSchema.parse(parseJsonText(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "")); } catch (error) { throw new AIStructuredOutputError(this.name, error); }
  }
  async generateImage(prompt: string, aspectRatio: string, references: Array<{ mimeType: string; data: string }> = []) {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const input = [
      ...references.map((reference) => ({ type: "image", mime_type: reference.mimeType, data: reference.data })),
      { type: "text", text: `${prompt}\nOutput aspect ratio: ${aspectRatio}.` },
    ];
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      signal: AbortSignal.timeout(5 * 60_000),
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ model: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image", input, response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: aspectRatio, image_size: "1K" } }),
    });
    if (!response.ok) throw new AIStructuredOutputError(this.name, await readApiError(response));
    const body = await response.json() as { output_image?: { mime_type?: string; data?: string }; steps?: Array<{ type?: string; content?: Array<{ type?: string; mime_type?: string; data?: string }> }> };
    const image = body.output_image?.data
      ? { mimeType: body.output_image.mime_type ?? "image/png", data: body.output_image.data }
      : (() => {
        const part = body.steps?.flatMap((step) => step.type === "model_output" ? (step.content ?? []) : []).find((item) => item.type === "image" && item.data);
        return part?.data ? { mimeType: part.mime_type ?? "image/png", data: part.data } : undefined;
      })();
    if (!image?.data) throw new AIStructuredOutputError(this.name, { message: "Gemini Image API không trả về dữ liệu ảnh." });
    return { mimeType: image.mimeType, data: image.data };
  }
  private async request<T>(instruction: string, input: unknown, schema: { parse(value: unknown): T }, normalize?: (value: unknown) => unknown, responseSchema?: Record<string, unknown>, options?: { includeMainCharacterImage?: boolean }): Promise<T> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const response = await this.generateContent({ contents: [{ parts: buildGeminiRequestParts(instruction, input, options?.includeMainCharacterImage !== false) }], generationConfig: { responseMimeType: "application/json", ...(responseSchema ? { responseSchema } : {}) } });
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try {
      const parsed = parseJsonText(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
      return schema.parse(normalize ? normalize(parsed) : parsed);
    } catch (error) { throw new AIStructuredOutputError(this.name, error); }
  }
  private async generateContent(body: unknown): Promise<Response> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);

    const models = [...new Set([this.model, this.fallbackModel])];
    let lastError = { status: 503, message: "Gemini đang quá tải. App đã tự thử lại nhưng chưa nhận được phản hồi." };

    for (const [modelIndex, model] of models.entries()) {
      // Ưu tiên chuyển ngay sang model nhẹ hơn khi model chính báo quá tải.
      const attempts = modelIndex === 0 ? 1 : 3;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const response = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(5 * 60_000),
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
        });
        if (response.ok) return response;

        const message = await readApiError(response);
        lastError = { status: response.status, message };
        if (!isTransientGeminiError(response.status)) {
          throw new AIStructuredOutputError(this.name, lastError);
        }
        if (attempt < attempts - 1) await delay(1_000 * (attempt + 1));
      }
    }

    throw new AIStructuredOutputError(this.name, lastError);
  }
}

function isTransientGeminiError(status: number) {
  return [429, 500, 502, 503, 504].includes(status);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function buildGeminiRequestParts(instruction: string, input: unknown, includeMainCharacterImage = true) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const media = source.mainCharacterImage && typeof source.mainCharacterImage === "object"
    ? source.mainCharacterImage as { mimeType?: unknown; data?: unknown; name?: unknown }
    : undefined;
  const context = { ...source };
  delete context.mainCharacterImage;
  const parts: Array<Record<string, unknown>> = [{ text: instruction }];
  if (includeMainCharacterImage && typeof media?.mimeType === "string" && typeof media.data === "string" && media.data.length > 0) {
    parts.push({ inline_data: { mime_type: media.mimeType, data: media.data } });
    parts.push({ text: `Ảnh tham chiếu nhân vật chính${typeof media.name === "string" ? ` (${media.name})` : ""} đã được đính kèm. Hãy nhìn ảnh này trước khi viết và giữ nguyên nhận diện nhân vật.` });
  }
  parts.push({ text: `DỮ LIỆU CHỮ CỦA KÊNH, VIDEO VÀ PHÂN TÍCH:\n${JSON.stringify(context)}` });
  return parts;
}

async function readApiError(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? "Gemini API từ chối yêu cầu.";
  } catch {
    return "Gemini API từ chối yêu cầu.";
  }
}

const videoAnalysisResponseSchema: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    schemaVersion: { type: "STRING" }, summary: { type: "STRING" }, hook: { type: "STRING" }, setup: { type: "STRING" }, conflict: { type: "STRING" }, escalation: { type: "STRING" }, twist: { type: "STRING" }, payoff: { type: "STRING" }, theGag: { type: "STRING" }, cameraPattern: { type: "STRING" }, editingRhythm: { type: "STRING" },
    characterInteractions: { type: "ARRAY", items: { type: "STRING" } }, soundPattern: { type: "STRING" }, retentionMechanism: { type: "STRING" }, whyItWorks: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["schemaVersion", "summary", "hook", "setup", "conflict", "escalation", "twist", "payoff", "theGag", "cameraPattern", "editingRhythm", "characterInteractions", "soundPattern", "retentionMechanism", "whyItWorks"],
};

const modelingIdeasResponseSchema: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    schemaVersion: { type: "STRING" },
    modelingDirections: { type: "ARRAY", minItems: 1, maxItems: 1, items: { type: "OBJECT", properties: { title: { type: "STRING" }, coreConcept: { type: "STRING" }, script: { type: "STRING" }, characterDesign: { type: "STRING" }, setting: { type: "STRING" }, artStyle: { type: "STRING" }, sourceMechanism: { type: "STRING" }, whatIsPreserved: { type: "ARRAY", items: { type: "STRING" } }, whatIsChanged: { type: "ARRAY", items: { type: "STRING" } }, targetMarketAdaptation: { type: "STRING" }, similarityRisk: { type: "STRING" }, whyWorthDeveloping: { type: "STRING" }, postText: { type: "STRING" } }, required: ["title", "coreConcept", "script", "characterDesign", "setting", "artStyle", "sourceMechanism", "whatIsPreserved", "whatIsChanged", "targetMarketAdaptation", "similarityRisk", "whyWorthDeveloping", "postText"] } },
  },
  required: ["schemaVersion", "modelingDirections"],
};

const developedIdeaResponseSchema: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    schemaVersion: { type: "STRING" },
    deconstruction: { type: "OBJECT" },
    artDirection: { type: "OBJECT" },
    characterDesign: { type: "OBJECT" },
    backgroundDesign: { type: "OBJECT" },
    sourceModelingSpec: { type: "OBJECT" },
    storyboard: {
      type: "ARRAY",
      minItems: 1,
      items: {
        type: "OBJECT",
        properties: {
          sceneNumber: { type: "INTEGER" },
          sourceSceneId: { type: "STRING" },
          sourceBeat: { type: "STRING" },
          actionSequence: { type: "ARRAY", items: { type: "STRING" } },
          cameraSpec: { type: "OBJECT" },
          spatialSpec: { type: "OBJECT" },
          startState: { type: "STRING" },
          endState: { type: "STRING" },
          targetDuration: { type: "NUMBER" },
          visualBlock: { type: "STRING" },
          actionBlock: { type: "STRING" },
          audioBlock: { type: "STRING" },
          startFramePrompt: { type: "STRING" },
          englishPrompt: { type: "STRING" },
        },
        required: ["sceneNumber", "sourceSceneId", "sourceBeat", "actionSequence", "cameraSpec", "spatialSpec", "startState", "endState", "targetDuration", "visualBlock", "actionBlock", "audioBlock", "startFramePrompt", "englishPrompt"],
      },
    },
    safetyReview: { type: "OBJECT" },
  },
  required: ["schemaVersion", "deconstruction", "artDirection", "characterDesign", "backgroundDesign", "sourceModelingSpec", "storyboard", "safetyReview"],
};

function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(trimmed); } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const candidate = trimmed.slice(start, end + 1);
      try { return JSON.parse(candidate); } catch {
        const repaired = candidate
          .replace(/[“”]/g, '"')
          .replace(/,\s*([}\]])/g, "$1")
          .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":');
        return JSON.parse(repaired);
      }
    }
    throw new Error("Gemini không trả về JSON.");
  }
}

function normalizeVideoAnalysis(value: unknown): unknown {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (item: unknown, fallback = "Chưa có đủ dữ liệu để kết luận.") => {
    if (typeof item === "string") return item;
    if (item === undefined || item === null) return fallback;
    return typeof item === "object" ? JSON.stringify(item) : String(item);
  };
  const list = (item: unknown) => Array.isArray(item) ? item.map(entry => text(entry, "")) : item ? [text(item, "")] : [];
  return {
    schemaVersion: "1.0",
    summary: text(source.summary ?? source.videoSummary ?? source.overview),
    hook: text(source.hook ?? source.openingHook),
    setup: text(source.setup),
    conflict: text(source.conflict),
    escalation: text(source.escalation),
    twist: text(source.twist),
    payoff: text(source.payoff),
    theGag: text(source.theGag ?? source.visualGag),
    cameraPattern: text(source.cameraPattern),
    editingRhythm: text(source.editingRhythm),
    characterInteractions: list(source.characterInteractions ?? source.characters),
    soundPattern: text(source.soundPattern ?? source.audioPattern),
    retentionMechanism: text(source.retentionMechanism ?? source.whyItLikelyWorks),
    whyItWorks: list(source.whyItWorks ?? source.whyItLikelyWorks),
  };
}

function normalizeModelingIdeas(value: unknown): unknown {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawDirections = Array.isArray(source.modelingDirections) ? source.modelingDirections : Array.isArray(source.ideas) ? source.ideas : [];
  const sourceItem = rawDirections[0] && typeof rawDirections[0] === "object" ? rawDirections[0] as Record<string, unknown> : {};
  const text = (...items: unknown[]) => {
    const item = items.find((candidate) => typeof candidate === "string" && candidate.trim());
    return typeof item === "string" ? item : "Chưa có đủ dữ liệu để kết luận.";
  };
  const list = (item: unknown) => Array.isArray(item) ? item.map((entry) => String(entry)) : [];
  return {
    schemaVersion: "1.0",
    modelingDirections: [{
      title: text(sourceItem.title, sourceItem.name),
      coreConcept: text(sourceItem.coreConcept, sourceItem.concept, sourceItem.idea),
      script: text(sourceItem.script, sourceItem.story, sourceItem.storyline),
      characterDesign: text(sourceItem.characterDesign, sourceItem.characters, sourceItem.character),
      setting: text(sourceItem.setting, sourceItem.background, sourceItem.environment),
      artStyle: text(sourceItem.artStyle, sourceItem.style),
      sourceMechanism: text(sourceItem.sourceMechanism, sourceItem.mechanism),
      whatIsPreserved: list(sourceItem.whatIsPreserved),
      whatIsChanged: list(sourceItem.whatIsChanged),
      targetMarketAdaptation: text(sourceItem.targetMarketAdaptation),
      similarityRisk: sourceItem.similarityRisk === "high" || sourceItem.similarityRisk === "medium" ? sourceItem.similarityRisk : "low",
      whyWorthDeveloping: text(sourceItem.whyWorthDeveloping, sourceItem.reason),
      postText: text(sourceItem.postText, sourceItem.caption, sourceItem.socialCaption, sourceItem.title),
    }],
  };
}

function normalizeDevelopedIdea(value: unknown): unknown {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const source = raw.content && typeof raw.content === "object" ? raw.content as Record<string, unknown> : raw;
  const record = (item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
  const text = (item: unknown, fallback: string) => typeof item === "string" && item.trim() ? item : fallback;
  const storyboard = Array.isArray(source.storyboard) ? source.storyboard.map((scene, index) => {
    const item = record(scene);
    const parsedNumber = typeof item.sceneNumber === "number" && Number.isFinite(item.sceneNumber) ? item.sceneNumber : index + 1;
    return {
      sceneNumber: parsedNumber > 0 ? Math.trunc(parsedNumber) : index + 1,
      ...(typeof item.sourceSceneId === "string" ? { sourceSceneId: item.sourceSceneId } : {}),
      ...(typeof item.sourceBeat === "string" ? { sourceBeat: item.sourceBeat } : {}),
      ...(Array.isArray(item.actionSequence) ? { actionSequence: item.actionSequence.filter((action): action is string => typeof action === "string") } : {}),
      ...(item.cameraSpec && typeof item.cameraSpec === "object" && !Array.isArray(item.cameraSpec) ? { cameraSpec: item.cameraSpec } : {}),
      ...(item.spatialSpec && typeof item.spatialSpec === "object" && !Array.isArray(item.spatialSpec) ? { spatialSpec: item.spatialSpec } : {}),
      ...(typeof item.startState === "string" ? { startState: item.startState } : {}),
      ...(typeof item.endState === "string" ? { endState: item.endState } : {}),
      ...(typeof item.targetDuration === "number" ? { targetDuration: item.targetDuration } : {}),
      visualBlock: text(item.visualBlock ?? item.visual ?? item.image, "Chưa có mô tả hình ảnh cho cảnh này."),
      actionBlock: text(item.actionBlock ?? item.action, "Chưa có mô tả hành động cho cảnh này."),
      audioBlock: text(item.audioBlock ?? item.audio, "Không có âm thanh đặc biệt."),
      startFramePrompt: text(item.startFramePrompt ?? item.imagePrompt ?? item.startPrompt, "Create one single full-frame vertical 9:16 still image showing the exact starting state of this scene, using the approved main character and background references. Preserve the character identity, environment, lighting, composition, and initial pose. Do not show motion, a collage, a storyboard, text, or multiple variations."),
      englishPrompt: text(item.englishPrompt ?? item.videoPrompt ?? item.prompt, "Create one 4-second video starting from the exact approved still image for this scene. Preserve the character, background, composition, and story meaning, and animate only the specified primary action with synchronized sound."),
    };
  }) : [];
  return {
    schemaVersion: "1.0",
    deconstruction: record(source.deconstruction),
    artDirection: record(source.artDirection),
    characterDesign: record(source.characterDesign ?? source.characters),
    backgroundDesign: record(source.backgroundDesign ?? source.background),
    ...(source.sourceModelingSpec && typeof source.sourceModelingSpec === "object" ? { sourceModelingSpec: source.sourceModelingSpec } : {}),
    storyboard,
    safetyReview: record(source.safetyReview),
  };
}
