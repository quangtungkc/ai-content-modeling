export type ChannelDNA = {
  name: string;
  topic: string;
  subTopic?: string | null;
  targetCountry: string;
  language: string;
  audience: string;
  contentStyle: string;
  visualStyle: string;
  videoDuration?: number | null;
  hasDialogue: boolean;
  creativeInstructions?: string | null;
  timezone: string;
};

export type VideoContext = {
  id: string;
  url: string;
  caption?: string | null;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
  duration?: number | null;
  transcript?: string | null;
  content?: string | null;
};

export type AIInput = { channelDNA: ChannelDNA; video: VideoContext };
export type VideoUnderstandingInput = { channelDNA?: ChannelDNA; videoId: string; videoFileUri: string; mimeType: string; instruction?: string };

export type VideoAnalysis = {
  schemaVersion: "1.0";
  summary: string;
  hook: string;
  setup: string;
  conflict: string;
  escalation: string;
  twist: string;
  payoff: string;
  theGag: string;
  cameraPattern: string;
  editingRhythm: string;
  characterInteractions: string[];
  soundPattern: string;
  retentionMechanism: string;
  whyItWorks: string[];
};

export type ModelingDirection = { title: string; coreConcept: string; script: string; characterDesign: string; setting: string; artStyle: string; sourceMechanism: string; whatIsPreserved: string[]; whatIsChanged: string[]; targetMarketAdaptation: string; similarityRisk: "low" | "medium" | "high"; whyWorthDeveloping: string };
export type ModelingIdeas = { schemaVersion: "1.0"; modelingDirections: ModelingDirection[] };
export type VisualTimelineEvent = { timestamp: string; event: string; observableEvidence: string };
export type VisualBreakdown = { schemaVersion: "1.0"; videoSummary: string; openingHook: string; timeline: VisualTimelineEvent[]; characters: Array<{ name: string; description: string; role: string }>; setting: string; visualGag: string; escalation: string; twist: string; payoff: string; cameraPattern: string; audioPattern: string; whyItLikelyWorks: string[] };
export type FinalReviewInput = { projectId: string; draftPackage: Record<string, unknown>; scenes: Array<Record<string, unknown>> };
export type ReviewIssue = { id: string; category: "missing_detail" | "continuity" | "ambiguity" | "prompt_improvement" | "safety"; severity: "low" | "medium" | "high"; location: string; issue: string; suggestion: string; confidence: number };
export type FinalReview = { schemaVersion: "1.0"; issues: ReviewIssue[]; overallSummary: string };
export type AssetValidationInput = { assetId: string; assetType: "character" | "background" | "prop"; assetUri: string; mimeType: string; expectedDesign: Record<string, unknown>; projectContext?: Record<string, unknown> };
export type AssetValidation = { schemaVersion: "1.0"; result: "APPROVED" | "NEEDS_REVISION"; scores: { characterMatch?: number; styleMatch: number; composition: number }; issues: Array<{ code: string; severity: "low" | "medium" | "high"; message: string; suggestion: string }> };
export type DevelopedIdea = { schemaVersion: "1.0"; deconstruction: Record<string, unknown>; artDirection: Record<string, unknown>; characterDesign: Record<string, unknown>; backgroundDesign: Record<string, unknown>; storyboard: Array<{ sceneNumber: number; visualBlock: string; actionBlock: string; audioBlock: string; englishPrompt: string }>; safetyReview: Record<string, unknown> };

export interface AIProvider {
  readonly name: string;
  analyzeVideo(input: AIInput): Promise<VideoAnalysis>;
  generateIdeas(input: AIInput & { analysis: VideoAnalysis; artStyle?: string }): Promise<ModelingIdeas>;
  developIdea(input: AIInput & { analysis: VideoAnalysis; idea: ModelingDirection }): Promise<DevelopedIdea>;
  understandVideo(input: VideoUnderstandingInput): Promise<VisualBreakdown>;
  reviewProject(input: FinalReviewInput): Promise<FinalReview>;
  validateAsset(input: AssetValidationInput): Promise<AssetValidation>;
}
