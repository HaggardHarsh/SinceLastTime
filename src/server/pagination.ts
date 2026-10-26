import { z } from "zod";
import { fail } from "./errors";

const valueCursor = z.object({ id: z.uuid(), at: z.iso.datetime(), scope: z.string() });
export function encodeCursor(entry: { id: string; createdAt: Date }, scope: string) {
  return Buffer.from(
    JSON.stringify({ id: entry.id, at: entry.createdAt.toISOString(), scope }),
  ).toString("base64url");
}
export function decodeCursor(value: string | null, scope: string) {
  if (!value) return null;
  try {
    if (value.length > 4096 || !/^[\w-]+$/.test(value)) throw new Error();
    const cursor = valueCursor.parse(JSON.parse(Buffer.from(value, "base64url").toString()));
    if (cursor.scope !== scope) throw new Error();
    return { id: cursor.id, createdAt: new Date(cursor.at) };
  } catch {
    fail(400, "INVALID_CURSOR", "Please start from the first page.");
  }
}
export function olderThan(cursor: ReturnType<typeof decodeCursor>) {
  return cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }
    : {};
}
export const searchInput = z
  .string()
  .trim()
  .max(120)
  .refine((value) => !value.includes("\0"), "Please remove invalid characters.")
  .default("");
export function literalSearch(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
