"use client";

import { useEffect, useRef, useState } from "react";

type OverlayCard = {
  id: string;
  body: string;
  emoji: string | null;
  author: { displayName: string; avatarUrl: string };
  communityName: string;
  previous: { body: string } | null;
};

export function OverlayClient({ communityId }: { communityId: string }) {
  const [card, setCard] = useState<OverlayCard | null>(null);
  const lastSuccess = useRef(0);
  const revision = useRef(-1);
  useEffect(() => {
    document.body.style.background = "transparent";
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (!token) return;
    let stopped = false;
    let pending = false;
    let controller: AbortController | null = null;
    async function poll() {
      if (pending || stopped) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 2500);
      try {
        const response = await fetch(`/api/overlay/${communityId}/state`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Overlay unavailable");
        const { data } = (await response.json()) as {
          data: { revision: number; card: OverlayCard | null };
        };
        if (!stopped && data.revision >= revision.current) {
          revision.current = data.revision;
          lastSuccess.current = Date.now();
          setCard(data.card);
        }
      } catch {
        if (!stopped) setCard(null);
      } finally {
        clearTimeout(timeout);
        pending = false;
      }
    }
    void poll();
    const polling = setInterval(() => void poll(), 1000);
    const freshness = setInterval(() => {
      if (Date.now() - lastSuccess.current > 3000) setCard(null);
    }, 250);
    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(polling);
      clearInterval(freshness);
    };
  }, [communityId]);
  if (!card) return null;
  return (
    <div className="overlay-card" key={card.id}>
      <div className="overlay-eyebrow">
        SINCE LAST TIME <span>✦</span> {card.communityName}
      </div>
      <div className="overlay-person">
        {card.author.avatarUrl ? (
          <img src={card.author.avatarUrl} alt="" />
        ) : (
          <span>{card.author.displayName.slice(0, 1)}</span>
        )}
        <strong>{card.author.displayName}</strong>
        <span className="overlay-emoji">{card.emoji}</span>
      </div>
      {card.previous && <p className="overlay-previous">Last time: {card.previous.body}</p>}
      <p className="overlay-body">{card.body}</p>
      <style>{`body{background:transparent!important}.overlay-card{position:fixed;left:64px;bottom:80px;width:700px;padding:30px 34px;background:#f3f3ed;border:1px solid #20231f;border-radius:2px;box-shadow:none;color:#20231f;font-family:"Gill Sans","Gill Sans MT","Avenir Next",sans-serif}.overlay-eyebrow{display:flex;gap:12px;align-items:center;font-size:11px;letter-spacing:1.5px;color:#a43f31;margin-bottom:24px}.overlay-eyebrow span{color:#20231f}.overlay-person{display:flex;align-items:center;gap:14px;font-size:22px}.overlay-person img,.overlay-person>span:first-child{width:48px;height:48px;border-radius:50%;background:#20231f;color:#f3f3ed;display:grid;place-items:center}.overlay-emoji{margin-left:auto;font-size:36px}.overlay-body{font-family:"Bodoni 72",Didot,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:29px;line-height:1.45;margin:22px 0 0;overflow-wrap:anywhere}.overlay-previous{padding:12px 16px;border-left:2px solid #a43f31;color:#646760;font-size:17px;line-height:1.5;margin:22px 0 0}`}</style>
    </div>
  );
}
