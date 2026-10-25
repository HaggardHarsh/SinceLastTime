import { Profile } from "@/components/profile";
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ slug: string; userId: string }>;
}) {
  const { slug, userId } = await params;
  return <Profile slug={slug} userId={userId} />;
}
