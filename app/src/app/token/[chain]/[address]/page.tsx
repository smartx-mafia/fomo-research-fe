import TokenDetailClient from "@/components/TokenDetailClient";

export default async function TokenDetailPage({
  params,
}: {
  params: Promise<{ chain: string; address: string }>;
}) {
  const { chain, address } = await params;

  return <TokenDetailClient chain={chain} address={address} />;
}
