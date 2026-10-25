export type Candidate = {
  id: string;
  authorId: string;
  createdAt: Date;
  discussionCount: number;
  lastDiscussedAt: Date | null;
  votes: number;
  followUpDue: Date | null;
};
export type Selection = {
  entryId: string;
  reason: "FIRST_TIME" | "ROTATION" | "COMMUNITY" | "FOLLOW_UP";
};

const tie = (a: Candidate, b: Candidate) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
export function fairOrder(a: Candidate, b: Candidate) {
  const aTime = a.lastDiscussedAt?.getTime() ?? -Infinity;
  const bTime = b.lastDiscussedAt?.getTime() ?? -Infinity;
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  return a.discussionCount - b.discussionCount || tie(a, b);
}

export function selectShortlist(
  input: Candidate[],
  excludedAuthors = new Set<string>(),
): Selection[] {
  const candidates = input.filter((c) => !excludedAuthors.has(c.authorId));
  const used = new Set<string>();
  const take = (
    candidate: Candidate | undefined,
    reason: Selection["reason"],
  ): Selection | undefined => {
    if (!candidate) return;
    used.add(candidate.authorId);
    return { entryId: candidate.id, reason };
  };
  const follow = take(
    candidates
      .filter((c) => c.followUpDue)
      .sort((a, b) => a.followUpDue!.getTime() - b.followUpDue!.getTime() || tie(a, b))[0],
    "FOLLOW_UP",
  );
  const community = take(
    candidates
      .filter((c) => !used.has(c.authorId) && c.votes > 0)
      .sort((a, b) => b.votes - a.votes || tie(a, b))[0],
    "COMMUNITY",
  );
  const rotation: Selection[] = [];
  const target = 5 - Number(Boolean(follow)) - Number(Boolean(community));
  for (const candidate of [...candidates].sort(fairOrder)) {
    if (rotation.length === target) break;
    if (used.has(candidate.authorId)) continue;
    rotation.push(take(candidate, candidate.lastDiscussedAt ? "ROTATION" : "FIRST_TIME")!);
  }
  return [...rotation, ...(community ? [community] : []), ...(follow ? [follow] : [])];
}
