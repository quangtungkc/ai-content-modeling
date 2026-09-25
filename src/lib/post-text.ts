/**
 * Caption text is kept separate from channel hashtags.
 * Remove hashtag tokens while preserving the actual sentence and punctuation.
 */
export function stripHashtagsFromPostText(value: string) {
  return value
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
