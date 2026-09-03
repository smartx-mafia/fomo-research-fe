import {useCreateWallet as useCreateEthereumWallet, usePrivy} from '@privy-io/react-auth';
import {useCreateWallet as useCreateSolanaWallet} from '@privy-io/react-auth/solana';
import {CheckCircle2, CircleDashed} from 'lucide-react';
import {useState} from 'react';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';

type EventSink = (level: 'info' | 'ok' | 'error', summary: string, detail?: string) => void;

export function WalletProvisionCard({onEvent}: {onEvent: EventSink}) {
  const {authenticated, user} = usePrivy();
  const {createWallet: createEthereumWallet} = useCreateEthereumWallet();
  const {createWallet: createSolanaWallet} = useCreateSolanaWallet();
  const [busy, setBusy] = useState<'ethereum' | 'solana' | null>(null);

  const embeddedChains = new Set(
    (user?.linkedAccounts ?? []).flatMap((account) => {
      if (
        account.type !== 'wallet' ||
        !('walletClientType' in account) ||
        account.walletClientType !== 'privy' ||
        !('chainType' in account)
      ) {
        return [];
      }
      return [account.chainType];
    }),
  );
  const hasEthereum = embeddedChains.has('ethereum');
  const hasSolana = embeddedChains.has('solana');
  const complete = hasEthereum && hasSolana;

  const create = async (chain: 'ethereum' | 'solana') => {
    setBusy(chain);
    onEvent('info', `开始创建 ${chain} embedded wallet`);
    try {
      if (chain === 'ethereum') {
        const wallet = await createEthereumWallet();
        onEvent('ok', 'Ethereum embedded wallet 已创建', wallet.address);
      } else {
        const {wallet} = await createSolanaWallet();
        onEvent('ok', 'Solana embedded wallet 已创建', wallet.address);
      }
    } catch (error) {
      onEvent('error', `创建 ${chain} embedded wallet 失败`, String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {complete ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <CircleDashed className="text-muted-foreground size-4" />
          )}
          2 · 创建资金钱包
          <Badge variant={complete ? 'default' : 'secondary'}>
            {complete ? '已完成' : '待创建'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground text-xs">
          当前页面使用邮箱验证码直连登录，Privy 不会自动创建钱包。EVM 钱包由
          BSC、Base、Ethereum 和 Robinhood 共用；Solana 使用独立钱包。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={hasEthereum ? 'outline' : 'default'}
            disabled={!authenticated || busy !== null || hasEthereum}
            onClick={() => void create('ethereum')}
          >
            {hasEthereum ? 'Ethereum 已创建' : busy === 'ethereum' ? '创建中…' : '创建 Ethereum'}
          </Button>
          <Button
            size="sm"
            variant={hasSolana ? 'outline' : 'default'}
            disabled={!authenticated || busy !== null || hasSolana}
            onClick={() => void create('solana')}
          >
            {hasSolana ? 'Solana 已创建' : busy === 'solana' ? '创建中…' : '创建 Solana'}
          </Button>
        </div>
        {complete && (
          <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs">
            两个钱包已就绪。请在下一步重新换取本站 token，让后端验签并写入钱包归属投影。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
