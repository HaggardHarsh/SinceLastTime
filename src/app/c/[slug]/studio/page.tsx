import { Studio } from "@/components/studio";
export default async function StudioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Studio slug={slug} />;
}
