import { Setup } from "@/components/setup";
export default async function SetupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Setup slug={slug} />;
}
