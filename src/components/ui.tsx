"use client";

import { useEffect, useId, useRef } from "react";
import { X, MessageCircleHeart, ArrowUpRight } from "lucide-react";
import Link from "next/link";

export function Avatar({ name, url, size = "md" }: { name: string; url?: string; size?: "xs" | "sm" | "md" | "lg" }) {
  const hue = [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360;
  return <span className={`avatar avatar-${size}`} style={{ background: `hsl(${hue} 24% 29%)`, color: `hsl(${hue} 60% 86%)` }}>{url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : name.slice(0, 1).toUpperCase()}</span>;
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand" aria-label="SinceLastTime home"><span className="brand-mark"><MessageCircleHeart size={23} strokeWidth={1.7} /></span>{!compact && <span>Since<span className="brand-last">Last</span>Time<span className="brand-dot">.</span></span>}</Link>;
}
export function Dialog({ open, title, children, onClose }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { if (open && !ref.current?.open) ref.current?.showModal(); if (!open && ref.current?.open) ref.current.close(); }, [open]);
  return <dialog ref={ref} className="dialog" aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === ref.current) onClose(); }}>
    <div className="dialog-heading"><h2 id={id}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>{open && children}
  </dialog>;
}
export function EmptyState({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><MessageCircleHeart size={28} strokeWidth={1.4} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function LoadingState() { return <div className="loading-stack" aria-label="Loading" role="status">{[1, 2, 3].map((n) => <div className="loading-card" key={n} />)}</div>; }
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) { return <div className="notice notice-error" role="alert"><p>{message}</p>{retry && <button className="button button-secondary" onClick={retry}>Try again <ArrowUpRight size={15} /></button>}</div>; }
