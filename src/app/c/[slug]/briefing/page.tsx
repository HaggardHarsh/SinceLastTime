import { Briefing } from "@/components/briefing";
export default async function BriefingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Briefing slug={slug} />;
}
