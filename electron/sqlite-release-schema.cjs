const AUTOMATION_RUN_COLUMNS = [
  ["channelId", "TEXT"],
  ["modelingIdeaId", "TEXT"],
  ["lastCompletedStage", "INTEGER NOT NULL DEFAULT 0"],
  ["failedStage", "INTEGER"],
  ["resumeTarget", "TEXT"],
  ["failureFingerprint", "TEXT"],
  ["attemptCount", "INTEGER NOT NULL DEFAULT 0"],
  ["incidentHistory", "JSONB NOT NULL DEFAULT '[]'"],
  ["checkpoint", "JSONB NOT NULL DEFAULT '{}'"],
  ["sourceModelingSpecVersion", "TEXT"],
];

const CONTENT_PROJECT_COLUMNS = [
  ["sourceVideoId", "TEXT"],
  ["sourceVideoUrl", "TEXT"],
  ["sourceVideoMetadata", "JSONB"],
  ["sourceDuration", "REAL"],
  ["sourcePlatform", "TEXT"],
  ["modelingPolicy", "TEXT NOT NULL DEFAULT 'STRICT_MODELING'"],
  ["modelingFidelityTarget", "REAL NOT NULL DEFAULT 0.9"],
  ["sourceModelingSpecVersion", "TEXT"],
  ["sourceModelingSpec", "JSONB"],
  ["sourceSpecCreatedAt", "DATETIME"],
];

const STORYBOARD_SCENE_COLUMNS = [
  ["sourceSceneId", "TEXT"],
  ["sourceSceneOrder", "INTEGER"],
  ["sourceSceneStartTime", "REAL"],
  ["sourceSceneEndTime", "REAL"],
  ["sourceDuration", "REAL"],
  ["targetDuration", "REAL"],
  ["durationDelta", "REAL"],
  ["durationRatio", "REAL"],
  ["timingStatus", "TEXT"],
  ["cameraSpec", "JSONB"],
  ["actionSequence", "JSONB"],
  ["spatialSpec", "JSONB"],
  ["mustPreserve", "JSONB"],
  ["allowedTransformations", "JSONB"],
];

const REQUIRED_TABLES = [
  `CREATE TABLE IF NOT EXISTS "AutomationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceVideoId" TEXT NOT NULL,
    "channelId" TEXT,
    "ideaId" TEXT,
    "modelingIdeaId" TEXT,
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "settings" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "error" TEXT,
    "lastCompletedStage" INTEGER NOT NULL DEFAULT 0,
    "failedStage" INTEGER,
    "resumeTarget" TEXT,
    "failureFingerprint" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "incidentHistory" JSONB NOT NULL DEFAULT '[]',
    "checkpoint" JSONB NOT NULL DEFAULT '{}',
    "sourceModelingSpecVersion" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS "CharacterIdentityPack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "styleType" TEXT NOT NULL DEFAULT 'other',
    "lockedTraits" JSONB NOT NULL DEFAULT '{}',
    "allowedVariations" JSONB NOT NULL DEFAULT '[]',
    "negativeRules" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CharacterIdentityPack_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "CharacterIdentityReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL UNIQUE,
    "storageKey" TEXT NOT NULL,
    "referenceId" TEXT,
    "viewRole" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT,
    "mimeType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CharacterIdentityReference_packId_fkey" FOREIGN KEY ("packId") REFERENCES "CharacterIdentityPack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "PromptFidelityTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "sceneId" TEXT,
    "sourceSceneId" TEXT,
    "promptType" TEXT NOT NULL,
    "sourceSpecVersion" TEXT NOT NULL,
    "expectedStateVersion" TEXT NOT NULL,
    "characterIdentityPackVersion" TEXT NOT NULL,
    "geminiDraftPrompt" TEXT NOT NULL,
    "validatedPrompt" TEXT NOT NULL,
    "validationResults" JSONB NOT NULL,
    "validationEvidence" JSONB NOT NULL,
    "promptHash" TEXT NOT NULL,
    "actualSentPromptHash" TEXT,
    "validatedAt" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "TroubleshootingKnowledgeBase" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "TroubleshootingRule" (
    "issueId" TEXT NOT NULL PRIMARY KEY,
    "knowledgeBaseKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "firstDivergence" TEXT,
    "repairScope" TEXT NOT NULL,
    "autoRepairAllowed" BOOLEAN NOT NULL DEFAULT false,
    "severity" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "automationClass" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "document" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TroubleshootingRule_knowledgeBaseKey_fkey" FOREIGN KEY ("knowledgeBaseKey") REFERENCES "TroubleshootingKnowledgeBase" ("key") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "TroubleshootingIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "projectId" TEXT,
    "sceneNumber" INTEGER,
    "stage" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "checkpoint" JSONB NOT NULL DEFAULT '{}',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "TroubleshootingIncidentAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TroubleshootingIncidentAudit_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "TroubleshootingIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "PostAssemblyQaRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "finalVideoPath" TEXT NOT NULL,
    "finalVideoHash" TEXT NOT NULL,
    "finalVideoVersion" TEXT NOT NULL,
    "validatorVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "qualityStatusBefore" TEXT NOT NULL,
    "qualityStatusAfter" TEXT,
    "validatorsRun" JSONB NOT NULL,
    "findings" JSONB NOT NULL,
    "incidentsCreated" JSONB NOT NULL,
    "repairsTriggered" JSONB NOT NULL,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "PostAssemblyOutputVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdFromVersionId" TEXT,
    "createdByRepairIncidentId" TEXT,
    "repairRuleId" TEXT,
    "validationStatus" TEXT NOT NULL,
    "promotedAt" DATETIME,
    "rejectedAt" DATETIME,
    "rollbackReason" TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS "PostAssemblyOutputVersionAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "outputVersionId" TEXT,
    "event" TEXT NOT NULL,
    "previousCurrentVersionId" TEXT,
    "newCurrentVersionId" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "CodexJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "sourceVideoId" TEXT NOT NULL,
    "contentProjectId" TEXT,
    "automationRunId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "previousResponseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "currentStage" TEXT NOT NULL DEFAULT 'PLAN',
    "currentAction" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" JSONB NOT NULL DEFAULT '{}',
    "finalVideoId" TEXT,
    "finalVideoPath" TEXT,
    "finalVideoUrl" TEXT,
    "generationStatus" TEXT NOT NULL DEFAULT 'RUNNING',
    "qualityStatus" TEXT NOT NULL DEFAULT 'NOT_RUN',
    "outputReady" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS "CodexStageState" ("id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT NOT NULL, "stage" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "expectedState" JSONB, "actualState" JSONB, "validationResult" TEXT, "validationIssues" JSONB, "retryCount" INTEGER NOT NULL DEFAULT 0, "maxRetries" INTEGER NOT NULL DEFAULT 3, "lastErrorSignature" TEXT, "lastStrategy" TEXT, "startedAt" DATETIME, "completedAt" DATETIME, "updatedAt" DATETIME NOT NULL, CONSTRAINT "CodexStageState_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CodexJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS "CodexEvent" ("id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "type" TEXT NOT NULL, "stage" TEXT, "level" TEXT NOT NULL DEFAULT 'INFO', "payload" JSONB NOT NULL DEFAULT '{}', "reasoningSummary" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CodexEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CodexJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS "AgentExperience" ("id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT, "stage" TEXT NOT NULL, "provider" TEXT, "errorSignature" TEXT NOT NULL, "errorMessage" TEXT, "expectedState" JSONB, "actualState" JSONB, "rootCause" TEXT, "attemptedFix" TEXT, "successfulFix" TEXT, "result" TEXT NOT NULL, "occurrenceCount" INTEGER NOT NULL DEFAULT 1, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AgentExperience_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CodexJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS "AppImprovementCandidate" ("id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT, "title" TEXT NOT NULL, "category" TEXT NOT NULL, "affectedModule" TEXT NOT NULL, "evidence" JSONB NOT NULL, "relatedJobs" JSONB NOT NULL DEFAULT '[]', "occurrenceCount" INTEGER NOT NULL DEFAULT 1, "rootCause" TEXT NOT NULL, "currentBehavior" TEXT NOT NULL, "desiredBehavior" TEXT NOT NULL, "proposedFix" TEXT NOT NULL, "externalReferences" JSONB NOT NULL DEFAULT '[]', "alternativeSolutions" JSONB NOT NULL DEFAULT '[]', "riskLevel" TEXT NOT NULL, "expectedBenefit" TEXT NOT NULL, "requiredTests" JSONB NOT NULL DEFAULT '[]', "migrationImpact" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PROPOSED', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "AppImprovementCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CodexJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS "RuntimeFailure" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT, "codexJobId" TEXT, "backgroundJobId" TEXT, "source" TEXT NOT NULL, "stage" TEXT, "failureKind" TEXT NOT NULL DEFAULT 'TECHNICAL_FAILURE', "code" TEXT NOT NULL, "message" TEXT NOT NULL, "stack" TEXT, "context" JSONB NOT NULL DEFAULT '{}', "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0, "codexResponseId" TEXT, "lastAttemptAt" DATETIME, "resolvedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "RuntimeFailure_codexJobId_fkey" FOREIGN KEY ("codexJobId") REFERENCES "CodexJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE)`,
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS "AutomationRun_userId_startedAt_idx" ON "AutomationRun"("userId", "startedAt" DESC)`,
  `CREATE INDEX IF NOT EXISTS "PromptFidelityTrace_projectId_sceneId_promptType_createdAt_idx" ON "PromptFidelityTrace"("projectId", "sceneId", "promptType", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "PromptFidelityTrace_projectId_promptHash_idx" ON "PromptFidelityTrace"("projectId", "promptHash")`,
  `CREATE INDEX IF NOT EXISTS "CharacterIdentityPack_channelId_active_idx" ON "CharacterIdentityPack"("channelId", "active")`,
  `CREATE INDEX IF NOT EXISTS "CharacterIdentityReference_packId_active_viewRole_idx" ON "CharacterIdentityReference"("packId", "active", "viewRole")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PostAssemblyQaRun_projectId_finalVideoHash_validatorVersion_key" ON "PostAssemblyQaRun"("projectId", "finalVideoHash", "validatorVersion")`,
  `CREATE INDEX IF NOT EXISTS "PostAssemblyQaRun_projectId_updatedAt_idx" ON "PostAssemblyQaRun"("projectId", "updatedAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PostAssemblyOutputVersion_projectId_versionNumber_key" ON "PostAssemblyOutputVersion"("projectId", "versionNumber")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PostAssemblyOutputVersion_one_current_per_project" ON "PostAssemblyOutputVersion"("projectId") WHERE "status" = 'CURRENT'`,
  `CREATE INDEX IF NOT EXISTS "PostAssemblyOutputVersion_projectId_status_idx" ON "PostAssemblyOutputVersion"("projectId", "status")`,
  `CREATE INDEX IF NOT EXISTS "PostAssemblyOutputVersion_projectId_fileHash_idx" ON "PostAssemblyOutputVersion"("projectId", "fileHash")`,
  `CREATE INDEX IF NOT EXISTS "PostAssemblyOutputVersionAudit_projectId_createdAt_idx" ON "PostAssemblyOutputVersionAudit"("projectId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "PostAssemblyOutputVersionAudit_outputVersionId_createdAt_idx" ON "PostAssemblyOutputVersionAudit"("outputVersionId", "createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CodexJob_idempotencyKey_key" ON "CodexJob"("idempotencyKey")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CodexJob_sessionId_key" ON "CodexJob"("sessionId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CodexStageState_jobId_stage_key" ON "CodexStageState"("jobId", "stage")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CodexEvent_jobId_sequence_key" ON "CodexEvent"("jobId", "sequence")`,
];

const REAL_COLUMN_TABLES = {
  CompetitorVideo: {
    column: "duration",
    columns: [
      ["id", "TEXT NOT NULL PRIMARY KEY"], ["competitorId", "TEXT NOT NULL"], ["externalId", "TEXT NOT NULL"], ["url", "TEXT NOT NULL"],
      ["title", "TEXT"], ["caption", "TEXT"], ["thumbnailUrl", "TEXT"], ["publishedAt", "DATETIME"], ["duration", "REAL"],
      ["firstSeenAt", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"], ["lastSeenAt", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
    ],
    constraints: [`CONSTRAINT "CompetitorVideo_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE`],
    indexes: [`CREATE UNIQUE INDEX IF NOT EXISTS "CompetitorVideo_competitorId_externalId_key" ON "CompetitorVideo"("competitorId", "externalId")`],
  },
  ContentProject: {
    column: "sourceDuration",
    columns: [
      ["id", "TEXT NOT NULL PRIMARY KEY"], ["channelId", "TEXT NOT NULL"], ["ideaId", "TEXT NOT NULL"], ["status", "TEXT NOT NULL"],
      ["deconstruction", "JSONB"], ["artDirection", "JSONB"], ["characterDesign", "JSONB"], ["backgroundDesign", "JSONB"], ["storyboard", "JSONB"],
      ["safetyReview", "JSONB"], ["productionPrompts", "JSONB"], ["createdBy", "TEXT NOT NULL"], ["createdAt", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      ["updatedAt", "DATETIME NOT NULL"], ["sourceVideoId", "TEXT"], ["sourceVideoUrl", "TEXT"], ["sourceVideoMetadata", "JSONB"],
      ["sourceDuration", "REAL"], ["sourcePlatform", "TEXT"], ["modelingPolicy", "TEXT NOT NULL DEFAULT 'STRICT_MODELING'"],
      ["modelingFidelityTarget", "REAL NOT NULL DEFAULT 0.9"], ["sourceModelingSpecVersion", "TEXT"], ["sourceModelingSpec", "JSONB"], ["sourceSpecCreatedAt", "DATETIME"],
    ],
    constraints: [
      `CONSTRAINT "ContentProject_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
      `CONSTRAINT "ContentProject_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ModelingIdea" ("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    ],
    indexes: [`CREATE UNIQUE INDEX IF NOT EXISTS "ContentProject_ideaId_key" ON "ContentProject"("ideaId")`],
  },
};

async function tableInfo(client, table) {
  return client.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
}

async function ensureColumn(client, table, column, definition) {
  const columns = await tableInfo(client, table);
  if (!columns.some((item) => item?.name === column)) await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
}

async function tableExists(client, table) {
  const rows = await client.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table);
  return rows.length > 0;
}

async function rebuildRealColumn(client, table, spec) {
  const current = await tableInfo(client, table);
  const actual = current.find((item) => item.name === spec.column)?.type?.toUpperCase();
  if (!actual || actual === "REAL") return false;
  const oldTable = `${table}__release_old`;
  const newTable = `${table}__release_new`;
  const existingNames = new Set(current.map((item) => item.name));
  const columns = spec.columns.filter(([name]) => existingNames.has(name));
  const names = columns.map(([name]) => `"${name}"`);
  const definitions = [...columns.map(([name, definition]) => `"${name}" ${definition}`), ...(spec.constraints || [])];
  // SQLite rewrites dependent foreign keys when a table is renamed. Keep the
  // original target names while this compatibility rebuild is in progress.
  await client.$executeRawUnsafe("PRAGMA legacy_alter_table = ON");
  await client.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  try {
    await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "${newTable}"`);
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" RENAME TO "${oldTable}"`);
    await client.$executeRawUnsafe(`CREATE TABLE "${newTable}" (${definitions.join(", ")})`);
    await client.$executeRawUnsafe(`INSERT INTO "${newTable}" (${names.join(", ")}) SELECT ${names.join(", ")} FROM "${oldTable}"`);
    await client.$executeRawUnsafe(`DROP TABLE "${oldTable}"`);
    await client.$executeRawUnsafe(`ALTER TABLE "${newTable}" RENAME TO "${table}"`);
    for (const index of spec.indexes) await client.$executeRawUnsafe(index);
    await client.$executeRawUnsafe("PRAGMA legacy_alter_table = OFF");
    await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    return true;
  } catch (error) {
    try {
      if (await tableExists(client, newTable)) await client.$executeRawUnsafe(`DROP TABLE "${newTable}"`);
      if (!(await tableExists(client, table)) && await tableExists(client, oldTable)) await client.$executeRawUnsafe(`ALTER TABLE "${oldTable}" RENAME TO "${table}"`);
      await client.$executeRawUnsafe("PRAGMA legacy_alter_table = OFF");
      await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    } catch { /* Preserve the original migration error. */ }
    throw error;
  }
}

const STALE_FOREIGN_KEY_REPAIRS = {
  VideoMetricSnapshot: { "CompetitorVideo__release_old": "CompetitorVideo" },
  SourceAnalysis: { "CompetitorVideo__release_old": "CompetitorVideo" },
  ReportItem: { "CompetitorVideo__release_old": "CompetitorVideo" },
  // Rebuilding ContentProject with legacy_alter_table enabled can leave
  // existing dependants pointing at the temporary table name. Repair those
  // references before Prisma attempts the next ContentProject write.
  Asset: { "ContentProject__release_old": "ContentProject" },
  ProjectReview: { "ContentProject__release_old": "ContentProject" },
  StoryboardScene: { "ContentProject__release_old": "ContentProject" },
  UsageEvent: { "ContentProject__release_old": "ContentProject" },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function sqliteTableSql(client, table) {
  const rows = await client.$queryRawUnsafe("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", table);
  return rows[0]?.sql || null;
}

async function sqliteIndexSql(client, table) {
  return client.$queryRawUnsafe("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name", table);
}

async function repairTableForeignKeys(client, table, replacements) {
  if (!(await tableExists(client, table))) return false;
  const foreignKeys = await client.$queryRawUnsafe(`PRAGMA foreign_key_list("${table}")`);
  const stale = foreignKeys.filter((foreignKey) => replacements[foreignKey.table]);
  if (!stale.length) return false;

  const originalSql = await sqliteTableSql(client, table);
  if (!originalSql) throw new Error(`Không tìm thấy schema SQLite của bảng ${table}.`);
  const oldTable = `${table}__release_fk_old`;
  const newTable = `${table}__release_fk_new`;
  if (await tableExists(client, oldTable) || await tableExists(client, newTable)) {
    throw new Error(`Phát hiện bảng tạm còn sót lại khi sửa foreign key của ${table}; dừng để bảo toàn dữ liệu.`);
  }

  const currentColumns = await tableInfo(client, table);
  const names = currentColumns.map((column) => `"${column.name}"`);
  const indexes = await sqliteIndexSql(client, table);
  let createSql = originalSql.replace(
    new RegExp(`^(CREATE\\s+TABLE\\s+)(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"${escapeRegExp(table)}"|${escapeRegExp(table)})`, "i"),
    `$1"${newTable}"`,
  );
  for (const foreignKey of stale) {
    const from = escapeRegExp(foreignKey.table);
    const target = replacements[foreignKey.table];
    createSql = createSql.replace(new RegExp(`"${from}"`, "g"), `"${target}"`);
  }

  // Do not drop any pre-existing table. The temporary-name guard above makes
  // an interrupted repair fail closed instead of risking a data overwrite.
  await client.$executeRawUnsafe("PRAGMA legacy_alter_table = ON");
  await client.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  try {
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" RENAME TO "${oldTable}"`);
    await client.$executeRawUnsafe(createSql);
    await client.$executeRawUnsafe(`INSERT INTO "${newTable}" (${names.join(", ")}) SELECT ${names.join(", ")} FROM "${oldTable}"`);
    await client.$executeRawUnsafe(`DROP TABLE "${oldTable}"`);
    await client.$executeRawUnsafe(`ALTER TABLE "${newTable}" RENAME TO "${table}"`);
    for (const index of indexes) await client.$executeRawUnsafe(index.sql);
    await client.$executeRawUnsafe("PRAGMA legacy_alter_table = OFF");
    await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    return true;
  } catch (error) {
    try {
      if (await tableExists(client, newTable)) await client.$executeRawUnsafe(`DROP TABLE "${newTable}"`);
      if (!(await tableExists(client, table)) && await tableExists(client, oldTable)) await client.$executeRawUnsafe(`ALTER TABLE "${oldTable}" RENAME TO "${table}"`);
      await client.$executeRawUnsafe("PRAGMA legacy_alter_table = OFF");
      await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    } catch { /* Preserve the original migration error. */ }
    throw error;
  }
}

async function repairStaleForeignKeys(client) {
  const repaired = [];
  for (const [table, replacements] of Object.entries(STALE_FOREIGN_KEY_REPAIRS)) {
    if (await repairTableForeignKeys(client, table, replacements)) repaired.push(table);
  }
  return repaired;
}

async function ensureBaseTables(client) {
  for (const statement of REQUIRED_TABLES) await client.$executeRawUnsafe(statement);
}

async function ensureBaseColumns(client) {
  for (const [column, definition] of AUTOMATION_RUN_COLUMNS) await ensureColumn(client, "AutomationRun", column, definition);
  for (const [column, definition] of CONTENT_PROJECT_COLUMNS) await ensureColumn(client, "ContentProject", column, definition);
  for (const [column, definition] of STORYBOARD_SCENE_COLUMNS) await ensureColumn(client, "StoryboardScene", column, definition);
  for (const [column, definition] of [["generationStatus", "TEXT NOT NULL DEFAULT 'RUNNING'"], ["qualityStatus", "TEXT NOT NULL DEFAULT 'NOT_RUN'"], ["outputReady", "BOOLEAN NOT NULL DEFAULT false"]]) await ensureColumn(client, "CodexJob", column, definition);
}

async function ensureIndexes(client) {
  for (const statement of INDEXES) {
    try { await client.$executeRawUnsafe(statement); } catch (error) {
      if (!/already exists|duplicate/i.test(String(error?.message || ""))) throw error;
    }
  }
}

async function ensureSqliteReleaseSchema(client) {
  await ensureBaseTables(client);
  await ensureBaseColumns(client);
  await rebuildRealColumn(client, "CompetitorVideo", REAL_COLUMN_TABLES.CompetitorVideo);
  await rebuildRealColumn(client, "ContentProject", REAL_COLUMN_TABLES.ContentProject);
  const repairedForeignKeys = await repairStaleForeignKeys(client);
  await ensureIndexes(client);
  const automationColumns = await tableInfo(client, "AutomationRun");
  return { automationRunComplete: AUTOMATION_RUN_COLUMNS.every(([column]) => automationColumns.some((item) => item.name === column)), repairedForeignKeys, durationTypes: { competitorVideo: (await tableInfo(client, "CompetitorVideo")).find((item) => item.name === "duration")?.type, contentProject: (await tableInfo(client, "ContentProject")).find((item) => item.name === "sourceDuration")?.type } };
}

module.exports = { ensureSqliteReleaseSchema, repairStaleForeignKeys, tableInfo, tableExists, AUTOMATION_RUN_COLUMNS, CONTENT_PROJECT_COLUMNS, STORYBOARD_SCENE_COLUMNS, REQUIRED_TABLES, INDEXES };
