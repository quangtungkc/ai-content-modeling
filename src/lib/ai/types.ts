export type ProviderMetadata = { provider: string; model: string; usage?: Record<string, number> };
export type StructuredAnalysis = { schemaVersion: string; content: Record<string, unknown>; metadata: ProviderMetadata };
export type ContentPackage = { schemaVersion: string; content: Record<string, unknown>; metadata: ProviderMetadata };
export type ReviewResult = { issues: Array<Record<string, unknown>>; metadata: ProviderMetadata };
export type AssetValidationResult = { result: "APPROVED" | "NEEDS_REVISION"; issues: Array<Record<string, unknown>>; metadata: ProviderMetadata };

export interface AIProvider {
  analyzeSource(input: Record<string, unknown>): Promise<StructuredAnalysis>;
  developProject(input: Record<string, unknown>): Promise<ContentPackage>;
  review(input: Record<string, unknown>): Promise<ReviewResult>;
  validateAsset(input: Record<string, unknown>): Promise<AssetValidationResult>;
}
