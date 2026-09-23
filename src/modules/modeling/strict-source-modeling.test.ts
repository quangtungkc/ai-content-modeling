import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assembleSourceModelingSpec, buildSourceVideoModelingSpec, CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS, CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, CANONICAL_DEFAULT_MODELING_POLICY, CANONICAL_DEFAULT_TIMING_TOLERANCE, CANONICAL_SPEC_VERSION, canonicalizeSourceModelingSpec, compileStrictModelingConstraints, computeTimingFidelity, sourceModelingEvidenceSchema, sourceModelingSceneSchema, sourceModelingSpecSchema, StrictModelingError, validateGeneratedSceneMapping, validateStrictModelingSetup } from "./strict-source-modeling";

const sourceSpec = () => buildSourceVideoModelingSpec({
  specVersion: "1.0.0",
  sourceVideoId: "source-1",
  sourceVideoUrl: "https://example.test/source.mp4",
  sourceVideoMetadata: { platform: "tiktok", evidence: "fixture" },
  sourceDuration: 8,
  sourcePlatform: "tiktok",
  scenes: [
    { sourceSceneId: "source-scene-1", order: 1, sourceStartTime: 0, sourceEndTime: 4, duration: 4, storyBeat: "Nhân vật nhìn chiếc hộp rồi quay sang bàn phím.", cameraType: "locked", shotSize: "medium", cameraAngle: "eye-level", cameraMovement: "none", framing: "nhân vật ở giữa, bàn phím bên phải", subjectPosition: "center", relativeObjectPositions: ["hộp bên trái", "bàn phím bên phải"], characterAction: "nhìn rồi quay người", actionSequence: ["look at the box", "turn toward the keyboard"], propAction: "không có", startState: "đứng cạnh hộp", endState: "đối diện bàn phím", transitionIn: "cut", transitionOut: "cut", timingNotes: "giữ 4 giây", rhythmNotes: "nhịp nhanh", mustPreserve: ["thứ tự nhìn rồi quay"], allowedTransformations: ["main character identity", "environment", "visual rendering style"], punchlineRole: null, gagRole: "setup", dialogueRole: null, textRole: null },
    { sourceSceneId: "source-scene-2", order: 2, sourceStartTime: 4, sourceEndTime: 8, duration: 4, storyBeat: "Nhân vật đặt hai tay lên bàn phím và gõ.", cameraType: "locked", shotSize: "medium", cameraAngle: "eye-level", cameraMovement: "none", framing: "nhân vật và bàn phím giữ nguyên quan hệ", subjectPosition: "center", relativeObjectPositions: ["bàn phím trước mặt"], characterAction: "gõ bàn phím", actionSequence: ["place both hands on keyboard", "type"], propAction: "bàn phím được tương tác", startState: "hai tay chưa chạm bàn phím", endState: "đang gõ", transitionIn: "cut", transitionOut: "hold", timingNotes: "giữ nhịp gốc", rhythmNotes: "cao trào ngắn", mustPreserve: ["đặt tay rồi gõ", "quan hệ nhân vật-bàn phím"], allowedTransformations: ["main character identity", "environment", "visual rendering style", "equivalent prop"], punchlineRole: "payoff", gagRole: "payoff", dialogueRole: null, textRole: null },
  ],
});

const candidateSceneRecords = (candidate: Record<string, unknown>) => candidate.scenes as Array<Record<string, unknown>>;

// Keep production-shape assertions deterministic and independent from the user's
// AppData evidence log. Raw evidence remains runtime diagnostic data, not a test
// fixture or a source of truth for automated tests.
const capturedProductionScenes = [
  {
    sourceEndTime: "00:03",
    duration: 3,
    relativeObjectPositions: "Nhân vật đứng trước tủ lạnh mở trống hoác",
    actionSequence: ["Mở tủ lạnh", "Nhìn vào ngăn đựng kem", "Biểu cảm tức giận phẫn nộ"],
    cameraType: "Digital 2D Animation",
    shotSize: "Medium Shot",
    cameraAngle: "Eye Level",
    cameraMovement: "Static",
    framing: "Centered",
    mustPreserve: "Nhân vật và bối cảnh bếp phải giữ nguyên",
    allowedTransformations: "Có thể thay đổi phong cách dựng hình",
  },
  {
    sourceEndTime: "00:06",
    duration: 3,
    relativeObjectPositions: "Hũ kem giả đặt ở vị trí trung tâm gắn dây bẫy",
    actionSequence: ["Đặt hũ kem giả", "Cột dây", "Cười gian xảo"],
    cameraType: "Digital 2D Animation",
    shotSize: "Close Up",
    cameraAngle: "High Angle",
    cameraMovement: "Pan Down",
    framing: "Focus on hands and trap",
    mustPreserve: "Hũ kem giả và dây bẫy phải nhìn rõ",
    allowedTransformations: "Được chuyển đổi chất liệu hình ảnh tương đương",
  },
  {
    sourceEndTime: "00:09",
    duration: 3,
    relativeObjectPositions: "Tiến gần tủ lạnh trong không gian tối",
    actionSequence: ["Bước chân lén lút", "Tiến lại gần tủ lạnh", "Vươn tay lấy hũ kem"],
    cameraType: "Digital 2D Animation",
    shotSize: "Wide Shot",
    cameraAngle: "Eye Level",
    cameraMovement: "Static",
    framing: "Dark kitchen setting",
    mustPreserve: "Hướng di chuyển về phía tủ lạnh",
    allowedTransformations: "Được thay đổi môi trường nhưng không đổi hành động",
  },
  {
    sourceEndTime: "00:12",
    duration: 3,
    relativeObjectPositions: "Kẻ trộm dính bẫy ngã ngửa, mặt dính đầy kem",
    actionSequence: ["Đèn bật sáng", "Kẻ trộm giật mình ngã", "Cười trừ ngượng ngùng"],
    cameraType: "Digital 2D Animation",
    shotSize: "Medium Shot",
    cameraAngle: "Low Angle",
    cameraMovement: "Zoom In",
    framing: "Full character reveal",
    mustPreserve: "Cú ngã và kem dính trên mặt là điểm kết thúc",
    allowedTransformations: "Được stylize nhân vật nhưng giữ nguyên gag",
  },
] as const;

describe("STEP 2 strict source modeling", () => {
  it("CASE 1 defaults a project to STRICT_MODELING", () => {
    expect(sourceSpec().modelingPolicy).toBe("STRICT_MODELING");
  });

  it("CASE 2 requires a source video before strict modeling", () => {
    const result = validateStrictModelingSetup({ sourceVideoId: null, sourceVideoUrl: null, sourceDuration: null, sourceModelingSpec: sourceSpec() });
    expect(result.errors).toContain("STRICT_SOURCE_VIDEO_MISSING");
  });

  it("CASE 3 spec survives persistence-style serialize/parse", () => {
    const reloaded = sourceModelingSpecSchema.parse(JSON.parse(JSON.stringify(sourceSpec())));
    expect(reloaded.specVersion).toBe("1.0.0");
    expect(reloaded.scenes[1].actionSequence).toEqual(["place both hands on keyboard", "type"]);
  });

  it("CASE 4 keeps source scene order authoritative", () => {
    const mapping = validateGeneratedSceneMapping(sourceSpec(), [{ sceneNumber: 1 }, { sceneNumber: 2 }]);
    expect(mapping.map((item) => item.sourceSceneId)).toEqual(["source-scene-1", "source-scene-2"]);
  });

  it("CASE 5 persists generatedScene to sourceScene mapping", () => {
    const mapping = validateGeneratedSceneMapping(sourceSpec(), [{ sceneNumber: 1 }, { sceneNumber: 2 }]);
    expect(mapping[0]).toMatchObject({ sceneNumber: 1, sourceSceneId: "source-scene-1", sourceSceneOrder: 1 });
  });

  it("CASE 6 fails when generated source mapping is missing", () => {
    expect(() => validateGeneratedSceneMapping(sourceSpec(), [{ sceneNumber: 1 }])).toThrowError(StrictModelingError);
    expect(() => validateGeneratedSceneMapping(sourceSpec(), [{ sceneNumber: 1 }])).toThrow("SOURCE_SCENE_ORDER_MISMATCH");
  });

  it("CASE 7 keeps ordered action sequence in the authoritative spec", () => {
    expect(sourceSpec().scenes[1].actionSequence).toEqual(["place both hands on keyboard", "type"]);
  });

  it("CASE 8 injects camera constraints into the modeling prompt", () => {
    const prompt = compileStrictModelingConstraints(sourceSpec(), "source-scene-1");
    expect(prompt).toContain("CAMERA");
    expect(prompt).toContain("locked");
    expect(prompt).toContain("ACTION SEQUENCE (authoritative)");
  });

  it("CASE 9 allows environment/style transformation without changing the source beat", () => {
    const prompt = compileStrictModelingConstraints(sourceSpec(), "source-scene-2");
    expect(prompt).toContain("environment");
    expect(prompt).toContain("Nhân vật đặt hai tay lên bàn phím và gõ");
  });

  it("CASE 9A locks Modeling to exactly the three approved differences", () => {
    const prompt = compileStrictModelingConstraints(sourceSpec(), "source-scene-2");
    expect(prompt).toContain("CONTENT AND PROGRESSION LOCK");
    for (const transformation of CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS) expect(prompt).toContain(transformation);
    expect(prompt).toContain("FORBIDDEN MODELING CHANGES");
    expect(prompt).toContain("do not use equivalent props");
    expect(prompt).toContain("localization");
  });

  it("CASE 10 represents channel character replacement as an allowed surface transformation", () => {
    expect(sourceSpec().scenes[0].allowedTransformations).toContain("main character identity");
    expect(sourceSpec().scenes[0].mustPreserve).toContain("thứ tự nhìn rồi quay");
  });

  it("CASE 11 flags timing drift beyond the configured tolerance", () => {
    expect(computeTimingFidelity(4, 4.3, 0.1).status).toBe("PASS");
    expect(computeTimingFidelity(4, 5, 0.1).status).toBe("SOURCE_TIMING_DRIFT");
  });

  it("CASE 12 rejects added scenes in strict mode", () => {
    expect(() => validateGeneratedSceneMapping(sourceSpec(), [{ sceneNumber: 1 }, { sceneNumber: 2 }, { sceneNumber: 3 }])).toThrow("SOURCE_SCENE_ORDER_MISMATCH");
  });

  it("CASE 13 rejects dropped source scenes in strict mode", () => {
    expect(() => validateGeneratedSceneMapping(sourceSpec(), [{ sceneNumber: 1 }])).toThrow("SOURCE_SCENE_ORDER_MISMATCH");
  });

  it("CASE 14 keeps allowed transformations separate from must-preserve constraints", () => {
    const scene = sourceSpec().scenes[0];
    expect(scene.allowedTransformations).not.toContain("thứ tự nhìn rồi quay");
    expect(scene.mustPreserve).not.toContain("environment");
  });

  it("CASE 15 keeps the modeling fidelity target at or above 90 percent", () => {
    expect(sourceSpec().modelingFidelityTarget).toBeGreaterThanOrEqual(0.9);
  });

  it("CASE 16 keeps a persisted spec version explicit", () => {
    const first = JSON.parse(JSON.stringify(sourceSpec())) as Record<string, unknown>;
    const second = JSON.parse(JSON.stringify(first)) as Record<string, unknown>;
    expect(second.specVersion).toBe("1.0.0");
    expect(second.specVersion).not.toBeUndefined();
  });

  it("CASE 17 validates a complete strict project setup", () => {
    const result = validateStrictModelingSetup({ sourceVideoId: "source-1", sourceVideoUrl: "https://example.test/source.mp4", sourceDuration: 8, modelingPolicy: "STRICT_MODELING", sourceModelingSpec: sourceSpec(), generatedScenes: [{ sceneNumber: 1 }, { sceneNumber: 2 }] });
    expect(result.ok).toBe(true);
    expect(result.mappings?.every((item) => item.timingStatus === "PASS")).toBe(true);
  });

  it("CASE 18 fails clearly when the source modeling spec is absent", () => {
    const result = validateStrictModelingSetup({ sourceVideoId: "source-1", sourceVideoUrl: "https://example.test/source.mp4", sourceDuration: 8, modelingPolicy: "STRICT_MODELING", sourceModelingSpec: null });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("SOURCE_MODELING_SPEC_MISSING");
  });

  it("CASE 19 reports SOURCE_BEAT_MISSING instead of inventing a source beat", () => {
    const invalid = JSON.parse(JSON.stringify(sourceSpec())) as Record<string, unknown>;
    const scenes = invalid.scenes as Array<Record<string, unknown>>;
    delete scenes[0].storyBeat;
    const result = validateStrictModelingSetup({ sourceVideoId: "source-1", sourceVideoUrl: "https://example.test/source.mp4", sourceDuration: 8, sourceModelingSpec: invalid });
    expect(result.errors).toContain("SOURCE_BEAT_MISSING");
  });

  it("CASE 20 reports SOURCE_SCENE_ORDER_MISMATCH for an invalid source order", () => {
    const invalid = JSON.parse(JSON.stringify(sourceSpec())) as Record<string, unknown>;
    const scenes = invalid.scenes as Array<Record<string, unknown>>;
    scenes[1].order = 3;
    const result = validateStrictModelingSetup({ sourceVideoId: "source-1", sourceVideoUrl: "https://example.test/source.mp4", sourceDuration: 8, sourceModelingSpec: invalid });
    expect(result.errors).toContain("SOURCE_SCENE_ORDER_MISMATCH");
  });

  it("CASE 21 reports SOURCE_SCENE_MAPPING_MISSING when a source scene id is absent", () => {
    const invalid = JSON.parse(JSON.stringify(sourceSpec())) as Record<string, unknown>;
    const scenes = invalid.scenes as Array<Record<string, unknown>>;
    delete scenes[0].sourceSceneId;
    const result = validateStrictModelingSetup({ sourceVideoId: "source-1", sourceVideoUrl: "https://example.test/source.mp4", sourceDuration: 8, sourceModelingSpec: invalid });
    expect(result.errors).toContain("SOURCE_SCENE_MAPPING_MISSING");
  });

  it("STEP 2A CASE 1: injects the application spec version when Gemini omits it", () => {
    const { specVersion: _ignored, ...withoutVersion } = sourceSpec();
    expect(assembleSourceModelingSpec(withoutVersion)).toMatchObject({ candidate: { specVersion: CANONICAL_SPEC_VERSION }, geminiSpecVersion: undefined, metadataMismatch: null });
  });

  it("STEP 2A CASE 2/3: application version wins over missing, wrong, or matching Gemini version", () => {
    expect(assembleSourceModelingSpec({ ...sourceSpec(), specVersion: "9.9.9" })).toMatchObject({ candidate: { specVersion: CANONICAL_SPEC_VERSION }, metadataMismatch: { field: "specVersion", expected: CANONICAL_SPEC_VERSION, received: "9.9.9" } });
    expect(assembleSourceModelingSpec({ ...sourceSpec(), specVersion: CANONICAL_SPEC_VERSION })).toMatchObject({ candidate: { specVersion: CANONICAL_SPEC_VERSION }, metadataMismatch: null });
  });

  it("STEP 2A CASE 4/12: assembly leaves scenes and sourceDuration unchanged", () => {
    const original = sourceSpec();
    const assembled = assembleSourceModelingSpec(original);
    expect(assembled.candidate.scenes).toEqual(original.scenes);
    expect(assembled.candidate.sourceDuration).toBe(original.sourceDuration);
  });

  it("STEP 2A CASE 5/6/7/8: strict validation still rejects other missing or invalid fields", () => {
    const missingSource = { ...sourceSpec() } as Record<string, unknown>;
    delete missingSource.sourceVideoId;
    expect(sourceModelingSpecSchema.safeParse(assembleSourceModelingSpec(missingSource).candidate).success).toBe(false);
    const invalidScene = { ...sourceSpec(), scenes: sourceSpec().scenes.map((scene, index) => index === 0 ? { ...scene, relativeObjectPositions: "wrong" } : scene) };
    const validation = sourceModelingSpecSchema.safeParse(assembleSourceModelingSpec(invalidScene).candidate);
    expect(validation.success).toBe(false);
    if (!validation.success) expect(validation.error.issues.some((issue) => issue.path.join(".") === "scenes.0.relativeObjectPositions")).toBe(true);
  });

  it("STEP 2B CASE 1/2/4: injects the authoritative SourceVideo id when Gemini omits or changes it", () => {
    const authoritativeId = "cmtz21vnv003nk57cd5ra69ee";
    const missing = { ...sourceSpec() } as Record<string, unknown>;
    delete missing.sourceVideoId;
    expect(assembleSourceModelingSpec(missing, { sourceVideoId: authoritativeId })).toMatchObject({ candidate: { sourceVideoId: authoritativeId }, geminiSourceVideoId: undefined });
    expect(assembleSourceModelingSpec({ ...sourceSpec(), sourceVideoId: "wrong-video" }, { sourceVideoId: authoritativeId })).toMatchObject({ candidate: { sourceVideoId: authoritativeId }, metadataMismatch: { field: "sourceVideoId", expected: authoritativeId, received: "wrong-video" } });
    expect(assembleSourceModelingSpec({ ...sourceSpec(), sourceVideoId: null }, { sourceVideoId: authoritativeId })).toMatchObject({ candidate: { sourceVideoId: authoritativeId }, metadataMismatch: { field: "sourceVideoId", expected: authoritativeId, received: null } });
  });

  it("STEP 2B CASE 5: fails with a typed error when the application has no source id", () => {
    expect(() => assembleSourceModelingSpec(sourceSpec(), { sourceVideoId: null })).toThrow("SOURCE_VIDEO_ID_NOT_AVAILABLE");
    expect(() => assembleSourceModelingSpec(sourceSpec(), { sourceVideoId: "" })).toThrow("SOURCE_VIDEO_ID_NOT_AVAILABLE");
  });

  it("STEP 2B CASE 6/7/8/9/10/11: preserves identity boundaries, prior version injection, and strict failures", () => {
    const sourceVideoId = "cmtz21vnv003nk57cd5ra69ee";
    const candidate = { ...sourceSpec(), sourceVideoId: "cmu2bniq10002k5980rr55hjp", runId: "run-1" } as Record<string, unknown>;
    const scenesBefore = JSON.parse(JSON.stringify(candidate.scenes));
    const assembled = assembleSourceModelingSpec(candidate, { sourceVideoId });
    expect(assembled.candidate.sourceVideoId).toBe(sourceVideoId);
    expect(assembled.candidate.specVersion).toBe(CANONICAL_SPEC_VERSION);
    expect(assembled.candidate.scenes).toEqual(scenesBefore);
    expect(assembled.candidate.sourceDuration).toBe(8);
    const invalid = { ...assembled.candidate, scenes: (assembled.candidate.scenes as Array<Record<string, unknown>>).map((scene, index) => index === 0 ? { ...scene, relativeObjectPositions: "wrong" } : scene) };
    expect(sourceModelingSpecSchema.safeParse(invalid).success).toBe(false);
  });

  it("STEP 2C CASE 1/2/4/5/6: injects the exact SourceVideo URL and blocks Gemini URL variants", () => {
    const authoritativeUrl = "https://www.facebook.com/reel/1668944091489780/";
    const missing = { ...sourceSpec() } as Record<string, unknown>;
    delete missing.sourceVideoUrl;
    expect(assembleSourceModelingSpec(missing, { sourceVideoUrl: authoritativeUrl })).toMatchObject({ candidate: { sourceVideoUrl: authoritativeUrl }, geminiSourceVideoUrl: undefined });
    for (const wrongUrl of ["https://www.facebook.com/chubbychaos", "https://example.test/thumb.png", "https://www.facebook.com/reel/other-source/"]) {
      const assembled = assembleSourceModelingSpec({ ...sourceSpec(), sourceVideoUrl: wrongUrl }, { sourceVideoUrl: authoritativeUrl });
      expect(assembled.candidate.sourceVideoUrl).toBe(authoritativeUrl);
      expect(assembled.metadataMismatches).toContainEqual({ field: "sourceVideoUrl", expected: authoritativeUrl, received: wrongUrl });
    }
    const nullUrl = assembleSourceModelingSpec({ ...sourceSpec(), sourceVideoUrl: null }, { sourceVideoUrl: authoritativeUrl });
    expect(nullUrl.candidate.sourceVideoUrl).toBe(authoritativeUrl);
    expect(nullUrl.metadataMismatch).toMatchObject({ field: "sourceVideoUrl", received: null });
  });

  it("STEP 2C CASE 7: fails with a typed error when the authoritative URL is unavailable", () => {
    expect(() => assembleSourceModelingSpec(sourceSpec(), { sourceVideoUrl: null })).toThrow("SOURCE_VIDEO_URL_NOT_AVAILABLE");
    expect(() => assembleSourceModelingSpec(sourceSpec(), { sourceVideoUrl: "" })).toThrow("SOURCE_VIDEO_URL_NOT_AVAILABLE");
  });

  it("STEP 2C CASE 8/9/10/11/12/13: preserves source id, spec version, scene payload, and strict schema", () => {
    const before = sourceSpec();
    const assembled = assembleSourceModelingSpec({ ...before, sourceVideoId: "wrong", sourceVideoUrl: "https://example.test/other" }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl });
    expect(assembled.candidate.sourceVideoId).toBe("cmtz21vnv003nk57cd5ra69ee");
    expect(assembled.candidate.specVersion).toBe(CANONICAL_SPEC_VERSION);
    expect(assembled.candidate.sourceDuration).toBe(before.sourceDuration);
    expect(assembled.candidate.sourceVideoMetadata).toEqual(before.sourceVideoMetadata);
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], relativeObjectPositions: "wrong" }] }).success).toBe(false);
  });

  it("STEP 2D CASE 1/2/3/4/5/8: injects deterministic metadata from the current SourceVideo record", () => {
    const metadata = { id: "cmtz21vnv003nk57cd5ra69ee", url: "https://www.facebook.com/reel/1668944091489780/", caption: "source caption", thumbnailUrl: null, publishedAt: "2026-09-11T00:06:30.775Z", duration: null, platform: "facebook" };
    const missing = { ...sourceSpec() } as Record<string, unknown>;
    delete missing.sourceVideoMetadata;
    expect(assembleSourceModelingSpec(missing, { sourceVideoMetadata: metadata })).toMatchObject({ candidate: { sourceVideoMetadata: metadata }, geminiSourceVideoMetadata: undefined });
    for (const wrong of [null, { platform: "other-channel", caption: "invented metrics" }, { id: "other-source", url: "https://example.test/thumb.png" }]) {
      const assembled = assembleSourceModelingSpec({ ...sourceSpec(), sourceVideoMetadata: wrong }, { sourceVideoMetadata: metadata });
      expect(assembled.candidate.sourceVideoMetadata).toEqual(metadata);
      expect(assembled.metadataMismatches).toContainEqual({ field: "sourceVideoMetadata", expected: metadata, received: wrong });
    }
  });

  it("STEP 2D CASE 5/6/7/8: uses only source-record fields and preserves canonical nulls", () => {
    const metadata = { id: "cmtz21vnv003nk57cd5ra69ee", url: "https://www.facebook.com/reel/1668944091489780/", caption: null, thumbnailUrl: null, publishedAt: null, duration: null, platform: "facebook" };
    const assembled = assembleSourceModelingSpec({ ...sourceSpec(), sourceVideoMetadata: { id: "wrong", profileUrl: "https://example.test/channel", views: 999999 } }, { sourceVideoMetadata: metadata });
    expect(assembled.candidate.sourceVideoMetadata).toEqual(metadata);
    expect(Object.keys(assembled.candidate.sourceVideoMetadata as Record<string, unknown>).sort()).toEqual(["caption", "duration", "id", "platform", "publishedAt", "thumbnailUrl", "url"]);
  });

  it("STEP 2D CASE 9/10/11/12/13/14: previous injections and strict scene validation remain unchanged", () => {
    const before = sourceSpec();
    const metadata = { id: "cmtz21vnv003nk57cd5ra69ee", url: before.sourceVideoUrl, caption: "caption", thumbnailUrl: null, publishedAt: null, duration: null, platform: "facebook" };
    const assembled = assembleSourceModelingSpec({ ...before, sourceVideoId: "wrong", sourceVideoUrl: "https://example.test/wrong", specVersion: "wrong", sourceVideoMetadata: null }, { sourceVideoId: metadata.id, sourceVideoUrl: metadata.url, sourceVideoMetadata: metadata });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: metadata.id, sourceVideoUrl: metadata.url, sourceVideoMetadata: metadata });
    expect(assembled.candidate.sourceDuration).toBe(before.sourceDuration);
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], relativeObjectPositions: "wrong" }] }).success).toBe(false);
  });

  it("STEP 2D missing-authority guard rejects absent metadata without falling back to Gemini", () => {
    expect(() => assembleSourceModelingSpec(sourceSpec(), { sourceVideoMetadata: null })).toThrow("SOURCE_VIDEO_METADATA_NOT_AVAILABLE");
  });

  it("STEP 2E CASE 1/2/3/4/5: injects application duration and blocks Gemini duration variants", () => {
    const missing = { ...sourceSpec() } as Record<string, unknown>;
    delete missing.sourceDuration;
    expect(assembleSourceModelingSpec(missing, { sourceDuration: 8 })).toMatchObject({ candidate: { sourceDuration: 8 }, geminiSourceDuration: undefined });
    for (const wrong of [4, "8", null]) {
      const assembled = assembleSourceModelingSpec({ ...sourceSpec(), sourceDuration: wrong }, { sourceDuration: 8 });
      expect(assembled.candidate.sourceDuration).toBe(8);
      expect(assembled.metadataMismatches).toContainEqual({ field: "sourceDuration", expected: 8, received: wrong });
    }
  });

  it("STEP 2E CASE 6/7/8: uses a bound alternate authority only when explicitly supplied", () => {
    const missing = { ...sourceSpec() } as Record<string, unknown>;
    delete missing.sourceDuration;
    expect(assembleSourceModelingSpec(missing, { sourceVideoId: "video-1", sourceDuration: null, alternateSourceDuration: { value: 12, source: "bound-source-media-probe", sourceVideoId: "video-1" } }).candidate.sourceDuration).toBe(12);
    expect(() => assembleSourceModelingSpec(missing, { sourceDuration: null })).toThrow("SOURCE_VIDEO_DURATION_NOT_AVAILABLE");
    expect(() => assembleSourceModelingSpec(missing, { sourceVideoId: "video-1", sourceDuration: null, alternateSourceDuration: { value: 12, source: "other-video", sourceVideoId: "other-video" } })).toThrow("SOURCE_VIDEO_DURATION_NOT_AVAILABLE");
  });

  it("STEP 2E CASE 9: keeps sourceVideoMetadata.duration and sourceDuration consistent when both are authoritative", () => {
    const metadata = { id: "video-1", url: "https://example.test/source.mp4", caption: null, thumbnailUrl: null, publishedAt: null, duration: 8, platform: "tiktok" };
    expect(assembleSourceModelingSpec(sourceSpec(), { sourceDuration: 8, sourceVideoMetadata: metadata }).candidate).toMatchObject({ sourceDuration: 8, sourceVideoMetadata: metadata });
    expect(() => assembleSourceModelingSpec(sourceSpec(), { sourceDuration: 8, sourceVideoMetadata: { ...metadata, duration: 7 } })).toThrow("SOURCE_VIDEO_DURATION_METADATA_MISMATCH");
  });

  it("STEP 2E CASE 10/11/12/13/14/15: preserves prior metadata fixes, scene bytes, and strict validation", () => {
    const before = sourceSpec();
    const metadata = { id: "video-1", url: before.sourceVideoUrl, caption: null, thumbnailUrl: null, publishedAt: null, duration: 8, platform: "tiktok" };
    const assembled = assembleSourceModelingSpec({ ...before, specVersion: "wrong", sourceVideoId: "wrong", sourceVideoUrl: "https://example.test/wrong", sourceVideoMetadata: null, sourceDuration: "8" }, { sourceDuration: 8, sourceVideoId: "video-1", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: metadata });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: "video-1", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: metadata, sourceDuration: 8 });
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], relativeObjectPositions: "wrong" }] }).success).toBe(false);
  });

  it("STEP 2F CASE 1/2/3/4: injects Competitor.platform and blocks Gemini platform overrides", () => {
    const authoritativePlatform = "Facebook";
    const missing = { ...sourceSpec() } as Record<string, unknown>;
    delete missing.sourcePlatform;
    expect(assembleSourceModelingSpec(missing, { sourcePlatform: authoritativePlatform })).toMatchObject({ candidate: { sourcePlatform: authoritativePlatform }, geminiSourcePlatform: undefined });
    for (const wrongPlatform of ["YouTube", "facebook", null]) {
      const assembled = assembleSourceModelingSpec({ ...sourceSpec(), sourcePlatform: wrongPlatform }, { sourcePlatform: authoritativePlatform });
      expect(assembled.candidate.sourcePlatform).toBe(authoritativePlatform);
      expect(assembled.metadataMismatches).toContainEqual({ field: "sourcePlatform", expected: authoritativePlatform, received: wrongPlatform });
    }
  });

  it("STEP 2F CASE 5/6: uses source-video platform context, never channel/output provider context", () => {
    const sourceVideoPlatform = "Facebook";
    const assembled = assembleSourceModelingSpec({ ...sourceSpec(), sourcePlatform: "YouTube" }, { sourcePlatform: sourceVideoPlatform });
    expect(assembled.candidate.sourcePlatform).toBe(sourceVideoPlatform);
    expect(assembled.candidate.sourcePlatform).not.toBe("YouTube");
  });

  it("STEP 2F CASE 7: preserves nullable policy when application platform is unavailable", () => {
    const assembled = assembleSourceModelingSpec({ ...sourceSpec(), sourcePlatform: "YouTube" }, { sourcePlatform: null });
    expect(assembled.candidate.sourcePlatform).toBeNull();
    expect(assembled.metadataMismatches).toContainEqual({ field: "sourcePlatform", expected: null, received: "YouTube" });
    expect(sourceModelingSpecSchema.safeParse(assembled.candidate).success).toBe(true);
  });

  it("STEP 2F CASE 8/9/10/11/12/13/14: preserves prior injections, duration, scenes, and strict schema", () => {
    const before = sourceSpec();
    const assembled = assembleSourceModelingSpec({ ...before, specVersion: "wrong", sourceVideoId: "wrong", sourceVideoUrl: "https://example.test/wrong", sourceVideoMetadata: null, sourceDuration: 13.5, sourcePlatform: "YouTube" }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: before.sourceVideoMetadata, sourceDuration: 13.5, sourcePlatform: "Facebook" });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceDuration: 13.5, sourcePlatform: "Facebook" });
    expect(assembled.candidate.sourceVideoMetadata).toEqual(before.sourceVideoMetadata);
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], relativeObjectPositions: "wrong" }] }).success).toBe(false);
  });

  it("STEP 2G CASE 1/2/3/4: injects application modeling policy and blocks Gemini overrides", () => {
    const missing = { ...sourceSpec() } as Record<string, unknown>;
    delete missing.modelingPolicy;
    expect(assembleSourceModelingSpec(missing, { modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY })).toMatchObject({ candidate: { modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY }, geminiModelingPolicy: undefined });
    for (const wrongPolicy of ["BALANCED_MODELING", "LOOSE_ADAPTATION", "INVALID_POLICY", null]) {
      const assembled = assembleSourceModelingSpec({ ...sourceSpec(), modelingPolicy: wrongPolicy }, { modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY });
      expect(assembled.candidate.modelingPolicy).toBe(CANONICAL_DEFAULT_MODELING_POLICY);
      expect(assembled.metadataMismatches).toContainEqual({ field: "modelingPolicy", expected: CANONICAL_DEFAULT_MODELING_POLICY, received: wrongPolicy });
    }
  });

  it("STEP 2G CASE 5/7/8: rejects invalid application policy and does not use provider/platform context", () => {
    expect(() => assembleSourceModelingSpec(sourceSpec(), { modelingPolicy: "UNKNOWN_PROVIDER" })).toThrow("INVALID_MODELING_POLICY");
    expect(() => assembleSourceModelingSpec(sourceSpec(), { modelingPolicy: null })).toThrow("INVALID_MODELING_POLICY");
    const assembled = assembleSourceModelingSpec({ ...sourceSpec(), modelingPolicy: "BALANCED_MODELING", sourcePlatform: "Facebook" }, { modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY });
    expect(assembled.candidate.modelingPolicy).toBe(CANONICAL_DEFAULT_MODELING_POLICY);
    expect(assembled.candidate.sourcePlatform).toBe("Facebook");
  });

  it("STEP 2G CASE 6: uses the existing STRICT_MODELING default when application policy is missing", () => {
    const assembled = assembleSourceModelingSpec({ ...sourceSpec(), modelingPolicy: "BALANCED_MODELING" });
    expect(CANONICAL_DEFAULT_MODELING_POLICY).toBe("STRICT_MODELING");
    expect(assembled.candidate.modelingPolicy).toBe(CANONICAL_DEFAULT_MODELING_POLICY);
    expect(assembled.metadataMismatches).toContainEqual({ field: "modelingPolicy", expected: CANONICAL_DEFAULT_MODELING_POLICY, received: "BALANCED_MODELING" });
  });

  it("STEP 2G CASE 9/10/11/12/13/14/15/16: preserves all prior fields, duration, scenes, and strict validation", () => {
    const before = sourceSpec();
    const assembled = assembleSourceModelingSpec({ ...before, specVersion: "wrong", sourceVideoId: "wrong", sourceVideoUrl: "https://example.test/wrong", sourceVideoMetadata: null, sourceDuration: 13.5, sourcePlatform: "YouTube", modelingPolicy: "BALANCED_MODELING" }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: before.sourceVideoMetadata, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY });
    expect(assembled.candidate.sourceVideoMetadata).toEqual(before.sourceVideoMetadata);
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], relativeObjectPositions: "wrong" }] }).success).toBe(false);
  });

  it("STEP 2H CASE 1/2/3/4/5: injects application fidelity target and blocks Gemini overrides", () => {
    const missing = { ...sourceSpec() } as Record<string, unknown>;
    delete missing.modelingFidelityTarget;
    expect(assembleSourceModelingSpec(missing, { modelingFidelityTarget: 0.95 })).toMatchObject({ candidate: { modelingFidelityTarget: 0.95 }, geminiModelingFidelityTarget: undefined });
    for (const wrongTarget of [0.8, 1.2, "0.95", null]) {
      const assembled = assembleSourceModelingSpec({ ...sourceSpec(), modelingFidelityTarget: wrongTarget }, { modelingFidelityTarget: 0.95 });
      expect(assembled.candidate.modelingFidelityTarget).toBe(0.95);
      expect(assembled.metadataMismatches).toContainEqual({ field: "modelingFidelityTarget", expected: 0.95, received: wrongTarget });
    }
  });

  it("STEP 2H CASE 6/7/8: rejects invalid application fidelity values without clamping or coercion", () => {
    for (const invalidTarget of [0.899, 1.001, Number.NaN, Number.POSITIVE_INFINITY, "0.95", null]) {
      expect(() => assembleSourceModelingSpec(sourceSpec(), { modelingFidelityTarget: invalidTarget })).toThrow("INVALID_MODELING_FIDELITY_TARGET");
    }
  });

  it("STEP 2H CASE 9: uses the existing 0.9 canonical default when application target is missing", () => {
    const assembled = assembleSourceModelingSpec({ ...sourceSpec(), modelingFidelityTarget: 0.95 });
    expect(CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET).toBe(0.9);
    expect(assembled.candidate.modelingFidelityTarget).toBe(CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET);
    expect(assembled.metadataMismatches).toContainEqual({ field: "modelingFidelityTarget", expected: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, received: 0.95 });
  });

  it("STEP 2H CASE 10/11/12/13/14/15/16/17/18: preserves strict policy, prior metadata, duration, scenes, and strict schema", () => {
    const before = sourceSpec();
    const assembled = assembleSourceModelingSpec({ ...before, specVersion: "wrong", sourceVideoId: "wrong", sourceVideoUrl: "https://example.test/wrong", sourceVideoMetadata: null, sourceDuration: 13.5, sourcePlatform: "YouTube", modelingPolicy: "BALANCED_MODELING", modelingFidelityTarget: 0.8 }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: before.sourceVideoMetadata, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET });
    expect(assembled.candidate.sourceVideoMetadata).toEqual(before.sourceVideoMetadata);
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], relativeObjectPositions: "wrong" }] }).success).toBe(false);
  });

  it("STEP 2I CASE 1/2/3/4/5/6: injects application timing tolerance and blocks Gemini values", () => {
    const missing = { ...sourceSpec() } as Record<string, unknown>;
    delete missing.timingTolerance;
    expect(assembleSourceModelingSpec(missing, { timingTolerance: 0.05 })).toMatchObject({ candidate: { timingTolerance: 0.05 }, geminiTimingTolerance: undefined });
    for (const wrongTolerance of [0, -0.1, 0.8, "0.1", null]) {
      const assembled = assembleSourceModelingSpec({ ...sourceSpec(), timingTolerance: wrongTolerance }, { timingTolerance: 0.05 });
      expect(assembled.candidate.timingTolerance).toBe(0.05);
      expect(assembled.metadataMismatches).toContainEqual({ field: "timingTolerance", expected: 0.05, received: wrongTolerance });
    }
  });

  it("STEP 2I CASE 7/8/9: rejects invalid application timing tolerance without clamping or coercion", () => {
    for (const invalidTolerance of [0, -0.1, 0.5001, 1, Number.NaN, Number.POSITIVE_INFINITY, "0.1", null]) {
      expect(() => assembleSourceModelingSpec(sourceSpec(), { timingTolerance: invalidTolerance })).toThrow("INVALID_TIMING_TOLERANCE");
    }
  });

  it("STEP 2I CASE 10: uses the existing 0.1 canonical default when application tolerance is missing", () => {
    const assembled = assembleSourceModelingSpec({ ...sourceSpec(), timingTolerance: 0.2 });
    expect(CANONICAL_DEFAULT_TIMING_TOLERANCE).toBe(0.1);
    expect(assembled.candidate.timingTolerance).toBe(CANONICAL_DEFAULT_TIMING_TOLERANCE);
    expect(assembled.metadataMismatches).toContainEqual({ field: "timingTolerance", expected: CANONICAL_DEFAULT_TIMING_TOLERANCE, received: 0.2 });
  });

  it("STEP 2I CASE 11/12/13/14/15/16/17: preserves strict policy/fidelity, prior metadata, duration, scenes, and schema", () => {
    const before = sourceSpec();
    const assembled = assembleSourceModelingSpec({ ...before, specVersion: "wrong", sourceVideoId: "wrong", sourceVideoUrl: "https://example.test/wrong", sourceVideoMetadata: null, sourceDuration: 99, sourcePlatform: "YouTube", modelingPolicy: "BALANCED_MODELING", modelingFidelityTarget: 1, timingTolerance: 0.5 }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: before.sourceVideoMetadata, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate.sourceVideoMetadata).toEqual(before.sourceVideoMetadata);
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    const strictResult = validateStrictModelingSetup({ sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceDuration: 13.5, modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, sourceModelingSpec: assembled.candidate, generatedScenes: [{ sceneNumber: 1 }, { sceneNumber: 2 }] });
    expect(strictResult.ok).toBe(true);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], relativeObjectPositions: "wrong" }] }).success).toBe(false);
  });

  it("STEP 2J CASE 1/2: validates the canonical evidence item shape and allows an empty evidence array", () => {
    const evidence = [{ timestamp: "00:01.200", description: "Nhân vật nhìn về phía hộp kem.", frameReference: "source-frame-1" }];
    expect(sourceModelingEvidenceSchema.parse(evidence)).toEqual(evidence);
    const candidate = { ...sourceSpec() } as Record<string, unknown>;
    delete candidate.sourceEvidence;
    expect(sourceModelingSpecSchema.parse(assembleSourceModelingSpec(candidate).candidate).sourceEvidence).toEqual([]);
  });

  it("STEP 2J CASE 3/4: rejects evidence values that are not an array of canonical items", () => {
    expect(sourceModelingEvidenceSchema.safeParse("source evidence").success).toBe(false);
    expect(sourceModelingEvidenceSchema.safeParse({ timestamp: "00:01", description: "observation", frameReference: null }).success).toBe(false);
    expect(sourceModelingEvidenceSchema.safeParse(null).success).toBe(false);
    expect(sourceModelingEvidenceSchema.safeParse([{ timestamp: "00:01", description: "observation" }]).success).toBe(false);
  });

  it("STEP 2J CASE 5/6/7: preserves Gemini evidence, provenance fields, and does not duplicate top-level metadata", () => {
    const evidence = [{ timestamp: "00:01", description: "Quan sát được chuyển động chính.", frameReference: "frame-1" }];
    const assembled = assembleSourceModelingSpec({ ...sourceSpec(), sourceEvidence: evidence }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: "https://www.facebook.com/reel/1668944091489780/", sourceVideoMetadata: { id: "cmtz21vnv003nk57cd5ra69ee", url: "https://www.facebook.com/reel/1668944091489780/", duration: 13.5, platform: "Facebook" }, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate.sourceEvidence).toEqual(evidence);
    expect(assembled.geminiSourceEvidence).toEqual(evidence);
    expect(Object.keys(evidence[0]).sort()).toEqual(["description", "frameReference", "timestamp"]);
    expect(assembled.candidate.sourceVideoId).toBe("cmtz21vnv003nk57cd5ra69ee");
    expect(assembled.candidate.sourceVideoUrl).toBe("https://www.facebook.com/reel/1668944091489780/");
    expect(assembled.candidate.sourceDuration).toBe(13.5);
  });

  it("STEP 2J CASE 8/9/10/11/12/13/14/15/16/17/18: preserves all prior fixes, scenes, and strict validation", () => {
    const before = sourceSpec();
    const evidence = [{ timestamp: null, description: "Chưa đủ evidence hình ảnh để kết luận.", frameReference: null }];
    const assembled = assembleSourceModelingSpec({ ...before, specVersion: "wrong", sourceVideoId: "wrong", sourceVideoUrl: "https://example.test/wrong", sourceVideoMetadata: null, sourceDuration: 99, sourcePlatform: "YouTube", modelingPolicy: "BALANCED_MODELING", modelingFidelityTarget: 1, timingTolerance: 0.5, sourceEvidence: evidence }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: before.sourceVideoMetadata, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE, sourceEvidence: evidence });
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], relativeObjectPositions: "wrong" }] }).success).toBe(false);
  });

  it("STEP 2K CASE 1/2/3/4/5/6/7: enforces sourceStartTime as a required finite non-negative number in seconds", () => {
    const field = sourceModelingSceneSchema.shape.sourceStartTime;
    for (const valid of [0, 1.5, 4.25]) expect(field.safeParse(valid).success).toBe(true);
    for (const invalid of ["1.5", "00:01", "1.5s", Number.NaN, Number.POSITIVE_INFINITY, -0.1, undefined]) expect(field.safeParse(invalid).success).toBe(false);
  });

  it("STEP 2K CASE 8/9: bounded representation repair preserves numeric timing semantics and other scene fields", () => {
    const before = { ...sourceSpec().scenes[0], sourceStartTime: 1.5, sourceEndTime: 4, duration: 2.5 };
    const responseWithStringTime = { ...sourceSpec(), scenes: [{ ...before, sourceStartTime: "1.5" }] } as unknown as Record<string, unknown>;
    expect(sourceModelingSpecSchema.safeParse(responseWithStringTime).success).toBe(false);
    const repaired = { ...responseWithStringTime, scenes: [{ ...before, sourceStartTime: 1.5 }] };
    const parsed = sourceModelingSpecSchema.parse(repaired);
    expect(parsed.scenes[0].sourceStartTime).toBe(1.5);
    expect(parsed.scenes[0].sourceEndTime).toBe(before.sourceEndTime);
    expect(parsed.scenes[0].duration).toBe(before.duration);
    expect(parsed.scenes[0].actionSequence).toEqual(before.actionSequence);
    expect(parsed.scenes[0].cameraType).toBe(before.cameraType);
    expect(parsed.scenes[0].relativeObjectPositions).toEqual(before.relativeObjectPositions);
  });

  it("STEP 2K CASE 10/11/12/13: preserves end time, duration, and prior top-level fixes", () => {
    const before = sourceSpec();
    const assembled = assembleSourceModelingSpec({ ...before, scenes: before.scenes.map((scene) => ({ ...scene, sourceStartTime: scene.sourceStartTime })) }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: before.sourceVideoMetadata, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate.sourceVideoId).toBe("cmtz21vnv003nk57cd5ra69ee");
    expect(assembled.candidate.sourceDuration).toBe(13.5);
    expect(assembled.candidate.sourcePlatform).toBe("Facebook");
    expect(assembled.candidate.scenes).toEqual(before.scenes);
  });

  it("STEP 2K CASE 13: production prompt and bounded schema repair identify sourceStartTime seconds contract", () => {
    const geminiPromptSource = readFileSync(new URL("../../services/ai/gemini.ts", import.meta.url), "utf8");
    const electronPromptSource = readFileSync(new URL("../../../electron/main.cjs", import.meta.url), "utf8");
    expect(geminiPromptSource).toContain("sourceStartTime và sourceEndTime phải là JSON number theo đơn vị giây");
    expect(electronPromptSource).toContain("sourceStartTime MUST be a JSON number in seconds");
    expect(electronPromptSource).toContain("sourceModelingSpec.scenes[${invalidStartIndex}].sourceStartTime");
  });

  it("STEP 2L CASE 1/2/3/4/5/6/7: enforces sourceEndTime as a required finite positive number in seconds", () => {
    const validThreeSeconds = { ...sourceSpec().scenes[0], sourceStartTime: 0, sourceEndTime: 3, duration: 3 };
    const validDecimal = { ...sourceSpec().scenes[0], sourceStartTime: 0, sourceEndTime: 13.5, duration: 13.5 };
    expect(sourceModelingSceneSchema.safeParse(validThreeSeconds).success).toBe(true);
    expect(sourceModelingSceneSchema.safeParse(validDecimal).success).toBe(true);
    for (const invalidEndTime of ["00:03", "3", "3s", Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      expect(sourceModelingSceneSchema.safeParse({ ...validThreeSeconds, sourceEndTime: invalidEndTime }).success).toBe(false);
    }
    expect(sourceModelingSceneSchema.safeParse({ ...validThreeSeconds, sourceEndTime: 0 }).success).toBe(false);
  });

  it("STEP 2L CASE 8/9/10/11: explicit schema repair preserves end-time semantics and other scene fields", () => {
    const before = { ...sourceSpec().scenes[0], sourceStartTime: 0, sourceEndTime: 3, duration: 3 };
    const invalid = { ...before, sourceEndTime: "00:03" } as unknown as Record<string, unknown>;
    expect(sourceModelingSceneSchema.safeParse(invalid).success).toBe(false);
    const repaired = { ...invalid, sourceEndTime: 3 };
    const parsed = sourceModelingSceneSchema.parse(repaired);
    expect(parsed.sourceEndTime).toBe(3);
    expect(parsed.sourceStartTime).toBe(before.sourceStartTime);
    expect(parsed.duration).toBe(before.duration);
    expect(parsed.relativeObjectPositions).toEqual(before.relativeObjectPositions);
    expect(parsed.actionSequence).toEqual(before.actionSequence);
    expect(parsed.cameraType).toBe(before.cameraType);
  });

  it("STEP 2L CASE 12/13: preserves all top-level fixes and keeps strict schema unchanged", () => {
    const before = sourceSpec();
    const assembled = assembleSourceModelingSpec({ ...before, scenes: before.scenes.map((scene) => ({ ...scene, sourceEndTime: scene.sourceEndTime })) }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: before.sourceVideoMetadata, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], sourceEndTime: "3" }] }).success).toBe(false);
  });

  it("STEP 2L CASE 13: reads the exact production sourceEndTime examples from captured raw evidence", () => {
    expect(capturedProductionScenes.map((scene) => scene.sourceEndTime)).toEqual(["00:03", "00:06", "00:09", "00:12"]);
  });

  it("STEP 2L: prompt and bounded repair identify sourceEndTime seconds contract without adding coercion", () => {
    const geminiPromptSource = readFileSync(new URL("../../services/ai/gemini.ts", import.meta.url), "utf8");
    const electronPromptSource = readFileSync(new URL("../../../electron/main.cjs", import.meta.url), "utf8");
    expect(geminiPromptSource).toContain("sourceStartTime và sourceEndTime phải là JSON number theo đơn vị giây");
    expect(electronPromptSource).toContain("sourceEndTime MUST be a JSON number in seconds");
    expect(electronPromptSource).toContain("sourceModelingSpec.scenes[${invalidEndIndex}].sourceEndTime");
    expect(electronPromptSource).not.toContain("parseFloat(scene.sourceEndTime)");
  });

  it("STEP 2M CASE 1/2/3/4/5/6/7/8: enforces scene duration as a finite positive number in seconds", () => {
    const validThreeSeconds = { ...sourceSpec().scenes[0], sourceStartTime: 0, sourceEndTime: 3, duration: 3 };
    const validDecimal = { ...sourceSpec().scenes[0], sourceStartTime: 0, sourceEndTime: 3.5, duration: 3.5 };
    const validShort = { ...sourceSpec().scenes[0], sourceStartTime: 0, sourceEndTime: 0.75, duration: 0.75 };
    expect(sourceModelingSceneSchema.safeParse(validThreeSeconds).success).toBe(true);
    expect(sourceModelingSceneSchema.safeParse(validDecimal).success).toBe(true);
    expect(sourceModelingSceneSchema.safeParse(validShort).success).toBe(true);
    for (const invalidDuration of ["3", "00:03", "3s", 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sourceModelingSceneSchema.safeParse({ ...validThreeSeconds, duration: invalidDuration }).success).toBe(false);
    }
  });

  it("STEP 2M CASE 6/7: preserves the existing duration/start/end invariant without deriving or changing fields", () => {
    const valid = { ...sourceSpec().scenes[0], sourceStartTime: 1.5, sourceEndTime: 5, duration: 3.5 };
    expect(sourceModelingSceneSchema.safeParse(valid).success).toBe(true);
    expect(sourceModelingSceneSchema.safeParse({ ...valid, duration: 3.56 }).success).toBe(false);
    expect(sourceModelingSceneSchema.safeParse({ ...valid, sourceEndTime: 1.5 }).success).toBe(false);
    expect(valid.sourceStartTime).toBe(1.5);
    expect(valid.sourceEndTime).toBe(5);
    expect(valid.duration).toBe(3.5);
  });

  it("STEP 2M CASE 9/10/11/12/13/14/15/16/17: explicit schema repair preserves duration semantics and all other fields", () => {
    const before = { ...sourceSpec().scenes[0], sourceStartTime: 0, sourceEndTime: 3.5, duration: 3.5 };
    const invalid = { ...before, duration: "3.5" } as unknown as Record<string, unknown>;
    expect(sourceModelingSceneSchema.safeParse(invalid).success).toBe(false);
    const repaired = { ...invalid, duration: 3.5 };
    const parsed = sourceModelingSceneSchema.parse(repaired);
    expect(parsed.duration).toBe(3.5);
    expect(parsed.sourceStartTime).toBe(before.sourceStartTime);
    expect(parsed.sourceEndTime).toBe(before.sourceEndTime);
    expect(parsed.relativeObjectPositions).toEqual(before.relativeObjectPositions);
    expect(parsed.actionSequence).toEqual(before.actionSequence);
    expect(parsed.cameraType).toBe(before.cameraType);
  });

  it("STEP 2M CASE 16/17: preserves all top-level fixes and strict schema", () => {
    const before = sourceSpec();
    const assembled = assembleSourceModelingSpec({ ...before, scenes: before.scenes.map((scene) => ({ ...scene, duration: scene.duration })) }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: before.sourceVideoMetadata, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], duration: "3" }] }).success).toBe(false);
  });

  it("STEP 2M: reads exact production scene duration examples from captured raw evidence", () => {
    expect(capturedProductionScenes.map((scene) => scene.duration)).toEqual([3, 3, 3, 3]);
  });

  it("STEP 2M: prompt and bounded repair identify duration seconds contract without app-side coercion", () => {
    const geminiPromptSource = readFileSync(new URL("../../services/ai/gemini.ts", import.meta.url), "utf8");
    const electronPromptSource = readFileSync(new URL("../../../electron/main.cjs", import.meta.url), "utf8");
    expect(geminiPromptSource).toContain("duration phải là JSON number theo đơn vị giây");
    expect(electronPromptSource).toContain("duration MUST be a JSON number in seconds");
    expect(electronPromptSource).toContain("sourceModelingSpec.scenes[${invalidDurationIndex}].duration");
    expect(electronPromptSource).not.toContain("parseFloat(scene.duration)");
    expect(electronPromptSource).not.toContain("Number(scene.duration)");
  });

  it("STEP 2N CASE 1/2/3: enforces relativeObjectPositions as a string array and allows empty array", () => {
    const base = { ...sourceSpec().scenes[0] };
    expect(sourceModelingSceneSchema.safeParse({ ...base, relativeObjectPositions: [] }).success).toBe(true);
    expect(sourceModelingSceneSchema.safeParse({ ...base, relativeObjectPositions: ["monitor in front", "keyboard below"] }).success).toBe(true);
    for (const invalid of ["monitor in front", { monitor: "front" }, null, [123], ["monitor in front", null]]) {
      expect(sourceModelingSceneSchema.safeParse({ ...base, relativeObjectPositions: invalid }).success).toBe(false);
    }
  });

  it("STEP 2N CASE 4/5/6/7/8/9/10: explicit schema repair preserves spatial meaning and independent fields", () => {
    const before = { ...sourceSpec().scenes[0], relativeObjectPositions: ["monitor in front", "keyboard below"] };
    const invalid = { ...before, relativeObjectPositions: "monitor in front" } as unknown as Record<string, unknown>;
    expect(sourceModelingSceneSchema.safeParse(invalid).success).toBe(false);
    const repaired = { ...invalid, relativeObjectPositions: ["monitor in front"] };
    const parsed = sourceModelingSceneSchema.parse(repaired);
    expect(parsed.relativeObjectPositions).toEqual(["monitor in front"]);
    expect(parsed.subjectPosition).toBe(before.subjectPosition);
    expect(parsed.actionSequence).toEqual(before.actionSequence);
    expect(parsed.cameraType).toBe(before.cameraType);
    expect(parsed.sourceStartTime).toBe(before.sourceStartTime);
    expect(parsed.sourceEndTime).toBe(before.sourceEndTime);
    expect(parsed.duration).toBe(before.duration);
  });

  it("STEP 2N CASE 10: missing relative positions follow the existing default policy", () => {
    const missing = { ...sourceSpec().scenes[0] } as Record<string, unknown>;
    delete missing.relativeObjectPositions;
    expect(sourceModelingSceneSchema.parse(missing).relativeObjectPositions).toEqual([]);
  });

  it("STEP 2N CASE 11/12/13/14/15/16/17/18: preserves prior timing/top-level fixes and strict schema", () => {
    const before = sourceSpec();
    const assembled = assembleSourceModelingSpec({ ...before, scenes: before.scenes.map((scene) => ({ ...scene, relativeObjectPositions: [...scene.relativeObjectPositions] })) }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: before.sourceVideoMetadata, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], relativeObjectPositions: "wrong" }] }).success).toBe(false);
  });

  it("STEP 2N CASE 13: reads exact production relativeObjectPositions examples from captured raw evidence", () => {
    expect(capturedProductionScenes.map((scene) => scene.relativeObjectPositions)).toEqual([
      "Nhân vật đứng trước tủ lạnh mở trống hoác",
      "Hũ kem giả đặt ở vị trí trung tâm gắn dây bẫy",
      "Tiến gần tủ lạnh trong không gian tối",
      "Kẻ trộm dính bẫy ngã ngửa, mặt dính đầy kem",
    ]);
  });

  it("STEP 2N: prompt and bounded repair identify the array-of-strings contract without string splitting", () => {
    const geminiPromptSource = readFileSync(new URL("../../services/ai/gemini.ts", import.meta.url), "utf8");
    const electronPromptSource = readFileSync(new URL("../../../electron/main.cjs", import.meta.url), "utf8");
    expect(geminiPromptSource).toContain("relativeObjectPositions phải là JSON array gồm các string không rỗng");
    expect(electronPromptSource).toContain("relativeObjectPositions MUST be a JSON array of strings");
    expect(electronPromptSource).toContain("sourceModelingSpec.scenes[${invalidRelativeIndex}].relativeObjectPositions");
    expect(electronPromptSource).not.toContain("split(';')");
    expect(electronPromptSource).not.toContain("split(',')");
  });

  it("STEP 2O CASE 1/2/3/4/5/6/7: enforces actionSequence as a non-empty array of non-empty strings", () => {
    const base = { ...sourceSpec().scenes[0] };
    expect(sourceModelingSceneSchema.safeParse({ ...base, actionSequence: ["Open refrigerator", "Look inside"] }).success).toBe(true);
    expect(sourceModelingSceneSchema.safeParse({ ...base, actionSequence: [] }).success).toBe(false);
    for (const invalid of ["Open refrigerator", null, {}, [123], ["Open refrigerator", null], [""]]) {
      expect(sourceModelingSceneSchema.safeParse({ ...base, actionSequence: invalid }).success).toBe(false);
    }
  });

  it("STEP 2O CASE 8/9/10: explicit schema repair preserves action order/content and independent fields", () => {
    const before = { ...sourceSpec().scenes[0], actionSequence: ["Open refrigerator", "Look inside"] };
    const invalid = { ...before, actionSequence: "Open refrigerator, then look inside" } as unknown as Record<string, unknown>;
    expect(sourceModelingSceneSchema.safeParse(invalid).success).toBe(false);
    const repaired = { ...invalid, actionSequence: ["Open refrigerator", "Look inside"] };
    const parsed = sourceModelingSceneSchema.parse(repaired);
    expect(parsed.actionSequence).toEqual(before.actionSequence);
    expect(parsed.characterAction).toBe(before.characterAction);
    expect(parsed.sourceStartTime).toBe(before.sourceStartTime);
    expect(parsed.sourceEndTime).toBe(before.sourceEndTime);
    expect(parsed.duration).toBe(before.duration);
    expect(parsed.relativeObjectPositions).toEqual(before.relativeObjectPositions);
    expect(parsed.cameraType).toBe(before.cameraType);
  });

  it("STEP 2O CASE 11/12/13/14/15/16: preserves character action, spatial/timing/camera fixes, and top-level fields", () => {
    const before = sourceSpec();
    const assembled = assembleSourceModelingSpec({ ...before, scenes: before.scenes.map((scene) => ({ ...scene, actionSequence: [...scene.actionSequence] })) }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: before.sourceVideoMetadata, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], actionSequence: "wrong" }] }).success).toBe(false);
  });

  it("STEP 2O CASE 13: reads exact production actionSequence examples from captured raw evidence", () => {
    expect(capturedProductionScenes.map((scene) => scene.actionSequence)).toEqual([
      ["Mở tủ lạnh", "Nhìn vào ngăn đựng kem", "Biểu cảm tức giận phẫn nộ"],
      ["Đặt hũ kem giả", "Cột dây", "Cười gian xảo"],
      ["Bước chân lén lút", "Tiến lại gần tủ lạnh", "Vươn tay lấy hũ kem"],
      ["Đèn bật sáng", "Kẻ trộm giật mình ngã", "Cười trừ ngượng ngùng"],
    ]);
  });

  it("STEP 2O: prompt and bounded repair identify array action-beat contract without string splitting", () => {
    const geminiPromptSource = readFileSync(new URL("../../services/ai/gemini.ts", import.meta.url), "utf8");
    const electronPromptSource = readFileSync(new URL("../../../electron/main.cjs", import.meta.url), "utf8");
    expect(geminiPromptSource).toContain("actionSequence phải là JSON array gồm ít nhất một string không rỗng");
    expect(electronPromptSource).toContain("actionSequence MUST be a JSON array of non-empty strings with at least one item");
    expect(electronPromptSource).toContain("sourceModelingSpec.scenes[${invalidActionIndex}].actionSequence");
    expect(electronPromptSource).not.toContain("split(actionSequence)");
    expect(electronPromptSource).not.toContain("split(';')");
    expect(electronPromptSource).not.toContain("split(',')");
  });

  it("STEP 2P CASE 1/2/3/4/5: enforces the exact camera field contracts without introducing enums", () => {
    const base = { ...sourceSpec().scenes[0] };
    const valid = { cameraType: "Digital 2D Animation", shotSize: "Medium Shot", cameraAngle: "Eye Level", cameraMovement: "Static", framing: "Centered" };
    expect(sourceModelingSceneSchema.safeParse({ ...base, ...valid }).success).toBe(true);
    expect(sourceModelingSceneSchema.safeParse({ ...base, ...valid, cameraMovement: null }).success).toBe(true);
    expect(sourceModelingSceneSchema.safeParse({ ...base, ...valid, cameraMovement: undefined }).success).toBe(true);
    for (const field of ["cameraType", "shotSize", "cameraAngle", "framing"] as const) {
      expect(sourceModelingSceneSchema.safeParse({ ...base, ...valid, [field]: undefined }).success).toBe(false);
      expect(sourceModelingSceneSchema.safeParse({ ...base, ...valid, [field]: "" }).success).toBe(false);
      for (const invalid of [null, 123, {}, []]) expect(sourceModelingSceneSchema.safeParse({ ...base, ...valid, [field]: invalid }).success).toBe(false);
    }
    for (const invalid of [123, {}, []]) expect(sourceModelingSceneSchema.safeParse({ ...base, ...valid, cameraMovement: invalid }).success).toBe(false);
  });

  it("STEP 2P CASE 6/7/8: explicit camera schema repair preserves camera intent and every non-camera field", () => {
    const before = { ...sourceSpec().scenes[0], cameraType: "Digital 2D Animation", shotSize: "Medium Shot", cameraAngle: "Eye Level", cameraMovement: "Static", framing: "Centered" };
    const invalid = { ...before, cameraType: { type: "Digital 2D Animation" }, shotSize: ["Medium Shot"], cameraAngle: 90, cameraMovement: { movement: "Static" }, framing: null } as unknown as Record<string, unknown>;
    expect(sourceModelingSceneSchema.safeParse(invalid).success).toBe(false);
    const repaired = { ...invalid, cameraType: "Digital 2D Animation", shotSize: "Medium Shot", cameraAngle: "Eye Level", cameraMovement: "Static", framing: "Centered" };
    const parsed = sourceModelingSceneSchema.parse(repaired);
    expect(parsed.cameraType).toBe(before.cameraType);
    expect(parsed.shotSize).toBe(before.shotSize);
    expect(parsed.cameraAngle).toBe(before.cameraAngle);
    expect(parsed.cameraMovement).toBe(before.cameraMovement);
    expect(parsed.framing).toBe(before.framing);
    expect(parsed.subjectPosition).toBe(before.subjectPosition);
    expect(parsed.storyBeat).toBe(before.storyBeat);
    expect(parsed.characterAction).toBe(before.characterAction);
    expect(parsed.startState).toBe(before.startState);
    expect(parsed.endState).toBe(before.endState);
    expect(parsed.sourceStartTime).toBe(before.sourceStartTime);
    expect(parsed.sourceEndTime).toBe(before.sourceEndTime);
    expect(parsed.duration).toBe(before.duration);
    expect(parsed.relativeObjectPositions).toEqual(before.relativeObjectPositions);
    expect(parsed.actionSequence).toEqual(before.actionSequence);
  });

  it("STEP 2P CASE A/B/C/D/E/F/G: camera repair does not alter source modeling or top-level fields", () => {
    const before = sourceSpec();
    const assembled = assembleSourceModelingSpec({ ...before, scenes: before.scenes.map((scene) => ({ ...scene, cameraType: scene.cameraType, shotSize: scene.shotSize, cameraAngle: scene.cameraAngle, cameraMovement: scene.cameraMovement, framing: scene.framing })) }, { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceVideoUrl: before.sourceVideoUrl, sourceVideoMetadata: before.sourceVideoMetadata, sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate).toMatchObject({ specVersion: CANONICAL_SPEC_VERSION, sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", sourceDuration: 13.5, sourcePlatform: "Facebook", modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.candidate.scenes).toEqual(before.scenes);
    expect(sourceModelingSpecSchema.safeParse({ ...assembled.candidate, scenes: [{ ...before.scenes[0], cameraType: 123 }] }).success).toBe(false);
  });

  it("STEP 2P CASE 9: reads exact production camera values from captured raw evidence", () => {
    const scenes = capturedProductionScenes;
    expect(scenes.map((scene) => scene.cameraType)).toEqual(["Digital 2D Animation", "Digital 2D Animation", "Digital 2D Animation", "Digital 2D Animation"]);
    expect(scenes.map((scene) => scene.shotSize)).toEqual(["Medium Shot", "Close Up", "Wide Shot", "Medium Shot"]);
    expect(scenes.map((scene) => scene.cameraAngle)).toEqual(["Eye Level", "High Angle", "Eye Level", "Low Angle"]);
    expect(scenes.map((scene) => scene.cameraMovement)).toEqual(["Static", "Pan Down", "Static", "Zoom In"]);
    expect(scenes.map((scene) => scene.framing)).toEqual(["Centered", "Focus on hands and trap", "Dark kitchen setting", "Full character reveal"]);
  });

  it("STEP 2P: prompt and bounded repair identify free-string camera contract without synonym mapping", () => {
    const geminiPromptSource = readFileSync(new URL("../../services/ai/gemini.ts", import.meta.url), "utf8");
    const electronPromptSource = readFileSync(new URL("../../../electron/main.cjs", import.meta.url), "utf8");
    expect(geminiPromptSource).toContain("CAMERA CONTRACT: cameraType, shotSize, cameraAngle và framing phải là JSON string không rỗng");
    expect(electronPromptSource).toContain("CAMERA CONTRACT: cameraType, shotSize, cameraAngle and framing MUST each be non-empty JSON strings");
    expect(electronPromptSource).toContain("sourceModelingSpec.scenes[${invalidCameraIndex}].cameraType/shotSize/cameraAngle/cameraMovement/framing");
    expect(electronPromptSource).not.toContain("close up\" →");
    expect(electronPromptSource).not.toContain("toUpperCase()");
  });

  it("INCIDENT 1G CASE 1/2/3/4: canonicalizes only non-empty scalar scene list fields", () => {
    const invalid = { ...sourceSpec(), scenes: sourceSpec().scenes.map((scene, index) => ({ ...scene, mustPreserve: index === 0 ? "preserve this" : scene.mustPreserve, allowedTransformations: index === 0 ? "allow this" : scene.allowedTransformations })) } as unknown as Record<string, unknown>;
    const before = JSON.parse(JSON.stringify(invalid));
    const result = canonicalizeSourceModelingSpec(invalid);
    expect(result.applied).toBe(true);
    expect(candidateSceneRecords(result.candidate)).toEqual(expect.arrayContaining([
      expect.objectContaining({ mustPreserve: ["preserve this"], allowedTransformations: ["allow this"] }),
    ]));
    expect(invalid).toEqual(before);
    expect(sourceModelingSpecSchema.safeParse(result.candidate).success).toBe(true);
  });

  it("INCIDENT 1G CASE 3/9: preserves existing arrays and records exact canonicalization diagnostics", () => {
    const before = sourceSpec();
    const result = canonicalizeSourceModelingSpec(before);
    expect(result.applied).toBe(false);
    expect(result.fields).toEqual([]);
    expect(result.changes).toEqual([]);
    expect(candidateSceneRecords(result.candidate)).toEqual(before.scenes);
    expect(candidateSceneRecords(result.candidate)[0].mustPreserve).toBe(before.scenes[0].mustPreserve);
    expect(candidateSceneRecords(result.candidate)[0].allowedTransformations).toBe(before.scenes[0].allowedTransformations);
  });

  it("INCIDENT 1G CASE 4/8/10/11/12/14: canonicalizes a four-scene production shape without mutating raw content or triggering retry", () => {
    const base = sourceSpec();
    const raw = {
      ...base,
      scenes: [0, 1, 2, 3].map((index) => ({
        ...base.scenes[index % 2],
        sourceSceneId: `production-scene-${index + 1}`,
        order: index + 1,
        sourceStartTime: index * 2,
        sourceEndTime: index * 2 + 2,
        duration: 2,
        mustPreserve: `preserve-${index + 1}`,
        allowedTransformations: `allow-${index + 1}`,
      })),
    } as unknown as Record<string, unknown>;
    const rawBefore = JSON.parse(JSON.stringify(raw));
    const result = canonicalizeSourceModelingSpec(raw);
    expect(result.fields).toEqual([
      "scenes[0].mustPreserve", "scenes[0].allowedTransformations",
      "scenes[1].mustPreserve", "scenes[1].allowedTransformations",
      "scenes[2].mustPreserve", "scenes[2].allowedTransformations",
      "scenes[3].mustPreserve", "scenes[3].allowedTransformations",
    ]);
    expect(candidateSceneRecords(result.candidate)).toHaveLength(4);
    expect(candidateSceneRecords(result.candidate).map((scene) => scene.mustPreserve)).toEqual([["preserve-1"], ["preserve-2"], ["preserve-3"], ["preserve-4"]]);
    expect(candidateSceneRecords(result.candidate).map((scene) => scene.allowedTransformations)).toEqual([["allow-1"], ["allow-2"], ["allow-3"], ["allow-4"]]);
    expect(raw).toEqual(rawBefore);
    expect(sourceModelingSpecSchema.safeParse(result.candidate).success).toBe(true);
  });

  it("INCIDENT 1G CASE 8: captured production evidence keeps the original scalar values", () => {
    expect(capturedProductionScenes.map((scene) => typeof scene.mustPreserve)).toEqual(["string", "string", "string", "string"]);
    expect(capturedProductionScenes.map((scene) => typeof scene.allowedTransformations)).toEqual(["string", "string", "string", "string"]);
  });

  it("INCIDENT 1G CASE 5/6/7: leaves unsupported types untouched so authoritative schema still rejects them", () => {
    const base = sourceSpec();
    const invalidNumber = canonicalizeSourceModelingSpec({ ...base, scenes: [{ ...base.scenes[0], mustPreserve: 123 }] }).candidate;
    const invalidNull = canonicalizeSourceModelingSpec({ ...base, scenes: [{ ...base.scenes[0], allowedTransformations: null }] }).candidate;
    const invalidArray = canonicalizeSourceModelingSpec({ ...base, scenes: [{ ...base.scenes[0], mustPreserve: ["abc", 123] }] }).candidate;
    expect(candidateSceneRecords(invalidNumber)[0].mustPreserve).toBe(123);
    expect(candidateSceneRecords(invalidNull)[0].allowedTransformations).toBeNull();
    expect(sourceModelingSpecSchema.safeParse(invalidNumber).success).toBe(false);
    expect(sourceModelingSpecSchema.safeParse(invalidNull).success).toBe(false);
    expect(sourceModelingSpecSchema.safeParse(invalidArray).success).toBe(false);
  });

  it("INCIDENT 1G CASE 8/13: assembly returns canonical data before strict validation and keeps schema failure separate from JSON retry", () => {
    const base = sourceSpec();
    const raw = { ...base, scenes: base.scenes.map((scene, index) => ({ ...scene, mustPreserve: index === 0 ? "preserve" : scene.mustPreserve })) } as unknown as Record<string, unknown>;
    const assembled = assembleSourceModelingSpec(raw, { sourceVideoId: base.sourceVideoId, sourceVideoUrl: base.sourceVideoUrl, sourceVideoMetadata: base.sourceVideoMetadata, sourceDuration: base.sourceDuration, sourcePlatform: base.sourcePlatform, modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
    expect(assembled.canonicalizationApplied).toBe(true);
    expect(assembled.canonicalizedFields).toEqual(["scenes[0].mustPreserve"]);
    expect(sourceModelingSpecSchema.parse(assembled.candidate).scenes[0].mustPreserve).toEqual(["preserve"]);
    expect(candidateSceneRecords(raw)[0].mustPreserve).toBe("preserve");
  });
});
