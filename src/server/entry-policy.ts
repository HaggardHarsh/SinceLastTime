import { retained } from "./time";

type ReadableEntry = {
  body: string | null;
  visibility: string;
  createdAt: Date;
  author: { memberships: { state: string }[] };
};

export function unavailableReason(entry: ReadableEntry, now = new Date()) {
  if (!retained(entry.createdAt, now)) return "EXPIRED";
  if (!entry.body || entry.visibility === "DELETED") return "DELETED";
  if (entry.author.memberships[0]?.state !== "ACTIVE") return "MEMBER_INACTIVE";
  if (entry.visibility !== "VISIBLE") return "HIDDEN";
  return null;
}
