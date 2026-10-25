import { OverlayClient } from "@/components/overlay-client";

export const metadata = { title: "Stream overlay", robots: { index: false, follow: false } };
export default async function OverlayPage({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const { communityId } = await params;
  return <OverlayClient communityId={communityId} />;
}
