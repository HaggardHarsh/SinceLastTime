"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown, Smile } from "lucide-react";
import { api, characterCount } from "@/lib/api";
import { CATEGORIES, EMOJIS, type EntryCard } from "@/shared/types";
import { useAction, useSession } from "./providers";
import { Avatar } from "./ui";

export function Composer({ communityId, storyId, editing, consentOnly = false, onDone }: { communityId: string; storyId?: string; editing?: EntryCard; consentOnly?: boolean; onDone?: (entry: EntryCard) => void }) {
  const user = useSession().data?.user;
  const [body, setBody] = useState(editing?.body ?? "");
  const [emoji, setEmoji] = useState(editing?.emoji ?? "✨");
  const [category, setCategory] = useState<string>(editing?.category ?? "Life update");
  const [allowOnStream, setAllowOnStream] = useState(editing?.allowOnStream ?? false);
  const [allowFollowUp, setAllowFollowUp] = useState(editing?.allowFollowUp ?? false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [preferences, setPreferences] = useState(Boolean(editing));
  const { run, pending } = useAction();
  const count = characterCount(body);
  return <form className={`composer ${editing || storyId ? "composer-in-dialog" : ""}`} onSubmit={(event) => {
    event.preventDefault();
    const payload = { ...(!consentOnly ? { body, emoji, category } : {}), allowOnStream, allowFollowUp, ...(editing ? { expectedVersion: editing.version } : {}) };
    const path = editing ? `communities/${communityId}/statuses/${editing.id}` : storyId ? `communities/${communityId}/stories/${storyId}/updates` : `communities/${communityId}/statuses`;
    void run(async () => { const entry = await api<EntryCard>(path, { method: editing ? "PATCH" : "POST", body: payload }); setBody(""); setAllowOnStream(false); setAllowFollowUp(false); onDone?.(entry); return entry; }, consentOnly ? "Sharing preferences updated." : editing ? "Your update is saved." : "A little update, shared. 💜");
  }}>
    {!consentOnly && <><div className="composer-main"><Avatar name={user?.displayName ?? "You"} url={user?.avatarUrl} /><div className="composer-input"><label htmlFor={`status-body-${editing?.id ?? storyId ?? "new"}`}>{storyId ? "What happened next?" : editing ? "Edit your update" : `What’s new, ${user?.displayName ?? "friend"}?`}</label><textarea id={`status-body-${editing?.id ?? storyId ?? "new"}`} aria-label="Your update" placeholder={storyId ? "Pick up where you left off…" : "A little win, a life update, or just something on your mind…"} value={body} onChange={(e) => setBody(e.target.value)} rows={3} required maxLength={4000} /></div></div>
    <div className="composer-tools"><div className="emoji-control"><button className="button-subtle" type="button" aria-label="Choose status emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(!emojiOpen)}>{emoji ? <span>{emoji}</span> : <Smile size={17} />}<ChevronDown size={12} /></button>{emojiOpen && <div className="emoji-picker">{EMOJIS.map((item) => <button type="button" key={item} aria-label={`Use ${item}`} onClick={() => { setEmoji(item); setEmojiOpen(false); }}>{item}</button>)}</div>}</div><select aria-label="Update category" value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select><span className={`character-count ${count > 280 ? "over-limit" : ""}`}>{count}/280</span></div></>}
    <div className="composer-options"><button type="button" className="text-button" onClick={() => setPreferences(!preferences)} aria-expanded={preferences}>{allowOnStream ? "Sharing on stream is okay" : "Community only"}<ChevronDown size={13} /></button><span className="fine-print">Active for 7 days · history for 30 days</span></div>
    {(preferences || consentOnly) && <div className="consent-options"><label><input type="checkbox" checked={allowOnStream} onChange={(event) => setAllowOnStream(event.target.checked)} /><span><strong>Okay to share on stream</strong><small>May appear in the public broadcast and recordings.</small></span></label><label><input type="checkbox" checked={allowFollowUp} onChange={(event) => setAllowFollowUp(event.target.checked)} /><span><strong>A follow-up is welcome</strong><small>The streamer can send one in-app reminder about this update.</small></span></label></div>}
    <div className="composer-footer"><span><span className="tiny-star">✦</span>{storyId ? "Every story deserves a next chapter." : "The little things count, too."}</span><button className="button button-primary" disabled={pending || (!consentOnly && (!body.trim() || count > 280))}>{pending ? "Sharing…" : consentOnly ? "Save preferences" : editing ? "Save update" : storyId ? "Share what happened" : "Share an update"}<ArrowUpRight size={16} /></button></div>
  </form>;
}
