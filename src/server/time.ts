export const DAY = 86_400_000;
export const ACTIVE_LIFETIME = 7 * DAY;
export const HISTORY_LIFETIME = 30 * DAY;
export const FOLLOW_CACHE_LIFETIME = 5 * 60_000;

export function retained(createdAt: Date, now = new Date()) {
  return createdAt.getTime() > now.getTime() - HISTORY_LIFETIME;
}
export function graphemeLength(value: string) {
  return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)].length;
}
