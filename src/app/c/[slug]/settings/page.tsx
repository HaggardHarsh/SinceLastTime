import { Settings } from "@/components/admin";
export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; return <Settings slug={slug} />; }
