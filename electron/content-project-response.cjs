function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Mirror the fields the server requires before a browser response is considered complete.
// The server remains the final authority.
function validateContentProjectResponse(value) {
  if (!isRecord(value) || value.schemaVersion !== "1.0") return "CONTENT_PROJECT_SCHEMA_INVALID: schemaVersion must be 1.0";
  for (const field of ["deconstruction", "artDirection", "characterDesign", "backgroundDesign"]) {
    if (!isRecord(value[field])) return `CONTENT_PROJECT_SCHEMA_INVALID: ${field} must be an object`;
  }
  if (!isRecord(value.sourceModelingSpec)) return "CONTENT_PROJECT_SCHEMA_INVALID: sourceModelingSpec must be an object";
  if (!Array.isArray(value.storyboard)) return "CONTENT_PROJECT_SCHEMA_INVALID: storyboard must be an array";
  for (const [index, scene] of value.storyboard.entries()) {
    if (!isRecord(scene)) return `CONTENT_PROJECT_SCHEMA_INVALID: storyboard[${index}] must be an object`;
    if (!Number.isInteger(scene.sceneNumber) || scene.sceneNumber < 1) return `CONTENT_PROJECT_SCHEMA_INVALID: storyboard[${index}].sceneNumber must be a positive integer`;
    for (const field of ["visualBlock", "actionBlock", "audioBlock", "startFramePrompt", "englishPrompt"]) {
      if (typeof scene[field] !== "string") return `CONTENT_PROJECT_SCHEMA_INVALID: storyboard[${index}].${field} must be a string`;
    }
    if (scene.sourceSceneId !== undefined && (typeof scene.sourceSceneId !== "string" || !scene.sourceSceneId.trim())) return `CONTENT_PROJECT_SCHEMA_INVALID: storyboard[${index}].sourceSceneId must be a non-empty string`;
    if (scene.sourceBeat !== undefined && (typeof scene.sourceBeat !== "string" || !scene.sourceBeat.trim())) return `CONTENT_PROJECT_SCHEMA_INVALID: storyboard[${index}].sourceBeat must be a non-empty string`;
    if (scene.actionSequence !== undefined && (!Array.isArray(scene.actionSequence) || !scene.actionSequence.length || scene.actionSequence.some((item) => typeof item !== "string" || !item.trim()))) return `CONTENT_PROJECT_SCHEMA_INVALID: storyboard[${index}].actionSequence must be a non-empty string array`;
    for (const field of ["cameraSpec", "spatialSpec"]) {
      if (scene[field] !== undefined && !isRecord(scene[field])) return `CONTENT_PROJECT_SCHEMA_INVALID: storyboard[${index}].${field} must be an object`;
    }
    for (const field of ["startState", "endState"]) {
      if (scene[field] !== undefined && (typeof scene[field] !== "string" || !scene[field].trim())) return `CONTENT_PROJECT_SCHEMA_INVALID: storyboard[${index}].${field} must be a non-empty string`;
    }
    if (scene.targetDuration !== undefined && (typeof scene.targetDuration !== "number" || !Number.isFinite(scene.targetDuration) || scene.targetDuration <= 0)) return `CONTENT_PROJECT_SCHEMA_INVALID: storyboard[${index}].targetDuration must be a positive number`;
  }
  const review = value.safetyReview;
  if (!isRecord(review)) return "CONTENT_PROJECT_SCHEMA_INVALID: safetyReview must be an object";
  if (review.safetyStatus !== "PASS" && review.safetyStatus !== "BLOCKED") return "CONTENT_PROJECT_SCHEMA_INVALID: safetyReview.safetyStatus must be PASS or BLOCKED";
  if (typeof review.description !== "string") return "CONTENT_PROJECT_SCHEMA_INVALID: safetyReview.description must be a string";
  if (!Array.isArray(review.blockedReasons) || review.blockedReasons.some((reason) => typeof reason !== "string")) return "CONTENT_PROJECT_SCHEMA_INVALID: safetyReview.blockedReasons must be an array of strings";
  if (typeof review.safeAlternative !== "string") return "CONTENT_PROJECT_SCHEMA_INVALID: safetyReview.safeAlternative must be a string";
  return null;
}

module.exports = { validateContentProjectResponse };
