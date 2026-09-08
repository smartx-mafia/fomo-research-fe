import { SmartMoneyProfile } from "@/components/SmartMoneyProfile";

export default async function SmartMoneyDetailPage({
  params,
}: {
  params: Promise<{ chain: string; address: string }>;
}) {
  const { chain, address } = await params;
  return <SmartMoneyProfile chain={chain} address={address} />;
}
