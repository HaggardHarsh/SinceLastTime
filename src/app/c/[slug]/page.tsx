import { Board } from "@/components/board";
export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Board slug={slug} />;
}
