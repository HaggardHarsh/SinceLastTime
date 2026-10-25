export class ClientError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors?: Record<string, string[]>) { super(message); }
}
export async function api<T>(path: string, options?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: options?.method ?? "GET", credentials: "same-origin", cache: "no-store", signal: options?.signal,
    headers: { "Content-Type": "application/json" }, ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new ClientError(response.status, payload.error?.code ?? "REQUEST_FAILED", payload.error?.message ?? "Please try again.", payload.error?.fieldErrors);
  return payload.data as T;
}
export function timeAgo(value: string) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
export const characterCount = (value: string) => [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)].length;
