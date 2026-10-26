/** Accept a community name, Twitch handle, channel URL, or shared board URL. */
export function communitySearchTerm(value: string): string {
  const text = value.trim();
  if (/^(?:https?:\/\/|(?:www\.)?twitch\.tv\/|\/c\/)/i.test(text)) {
    try {
      const url = new URL(
        text.startsWith("/c/") ? text : /^https?:\/\//i.test(text) ? text : `https://${text}`,
        "https://sincelasttime.local",
      );
      const parts = url.pathname.split("/").filter(Boolean);
      if (/^(?:www\.)?twitch\.tv$/i.test(url.hostname)) return parts[0] ?? "";
      if (parts[0] === "c") return parts[1] ?? "";
      return "";
    } catch {
      return "";
    }
  }
  return text.replace(/^@/, "").trim();
}
