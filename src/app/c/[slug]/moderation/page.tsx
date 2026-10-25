import { Moderation } from "@/components/admin";
export default async function ModerationPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; return <Moderation slug={slug} />; }
