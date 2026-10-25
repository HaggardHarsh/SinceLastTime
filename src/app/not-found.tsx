import Link from "next/link";
import { Brand } from "@/components/ui";
export default function NotFound() { return <main className="not-found-page"><Brand /><span>✧</span><h1>This little corner<br />isn’t here.</h1><p>Try another community, or head back to your people.</p><Link className="button button-primary" href="/communities">Back to your communities ↗</Link></main>; }
