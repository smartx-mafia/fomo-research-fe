import {
  useCreateWallet as useCreateEthereumWallet,
  usePrivy,
  useWallets as useEthereumWallets,
} from '@privy-io/react-auth';
import {
  useCreateWallet as useCreateSolanaWallet,
  useWallets as useSolanaWallets,
} from '@privy-io/react-auth/solana';
import {CheckCircle2, CircleDashed} from 'lucide-react';
import {useMemo, useRef, useState} from 'react';

import {CopyButton} from '@/components/CopyButton';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {
  embeddedWalletAddresses,
  signerHasAddress,
  type EmbeddedWalletAddress,
} from '@/lib/privy-wallets';

type EventSink = (level: 'info' | 'ok' | 'error', summary: string, detail?: string) => void;

export function WalletProvisionCard({onEvent}: {onEvent: EventSink}) {
  const {ready, authenticated, user} = usePrivy();
  const {createWallet: createEthereumWallet} = useCreateEthereumWallet();
  const {createWallet: createSolanaWallet} = useCreateSolanaWallet();
  const {wallets: ethereumSigners, ready: ethereumReady} = useEthereumWallets();
  const {wallets: solanaSigners, ready: solanaReady} = useSolanaWallets();
  const [busy, setBusy] = useState<'ethereum' | 'solana' | null>(null);
  const [justCreated, setJustCreated] = useState<EmbeddedWalletAddress[]>([]);
  const createLockRef = useRef(false);

  const embeddedWallets = useMemo(
    () => embeddedWalletAddresses([
      ...(user?.linkedAccounts ?? []),
      ...justCreated.map((wallet) => ({
        type: 'wallet',
        walletClientType: 'privy',
        chainType: wallet.chainType,
        address: wallet.address,
      })),
    ]),
    [justCreated, user?.linkedAccounts],
  );
  const ethereumWallets = embeddedWallets.filter((wallet) => wallet.chainType === 'ethereum');
  const solanaWallets = embeddedWallets.filter((wallet) => wallet.chainType === 'solana');
  const hasEthereum = ethereumWallets.length > 0;
  const hasSolana = solanaWallets.length > 0;
  const createdComplete = hasEthereum && hasSolana;
  const signerComplete = createdComplete && ethereumReady && solanaReady &&
    signerHasAddress(ethereumSigners.map((wallet) => wallet.address), ethereumWallets[0]!) &&
    signerHasAddress(solanaSigners.map((wallet) => wallet.address), solanaWallets[0]!);

  const create = async (chain: 'ethereum' | 'solana') => {
    if (!ready || !authenticated || !user || createLockRef.current) return;
    createLockRef.current = true;
    setBusy(chain);
    onEvent('info', `开始创建 ${chain} embedded wallet`);
    try {
      if (chain === 'ethereum') {
        const wallet = await createEthereumWallet();
        setJustCreated((items) => [...items, {chainType: 'ethereum', address: wallet.address}]);
        onEvent('ok', 'Ethereum embedded wallet 已创建', wallet.address);
      } else {
        const {wallet} = await createSolanaWallet();
        setJustCreated((items) => [...items, {chainType: 'solana', address: wallet.address}]);
        onEvent('ok', 'Solana embedded wallet 已创建', wallet.address);
      }
    } catch (error) {
      onEvent('error', `创建 ${chain} embedded wallet 失败`, String(error));
    } finally {
      createLockRef.current = false;
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {createdComplete ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <CircleDashed className="text-muted-foreground size-4" />
          )}
          2 · 创建资金钱包
          <Badge variant={createdComplete ? 'default' : 'secondary'}>
            {createdComplete ? '已创建' : '待创建'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground text-xs">
          当前页面使用邮箱验证码直连登录，Privy 不会自动创建钱包。EVM 钱包由
          BSC、Base、Ethereum 和 Robinhood 共用；Solana 使用独立钱包。
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          <WalletAddressList
            title="EVM"
            wallets={ethereumWallets}
            signerReady={ethereumReady}
            signerAddresses={ethereumSigners.map((wallet) => wallet.address)}
          />
          <WalletAddressList
            title="SVM (Solana)"
            wallets={solanaWallets}
            signerReady={solanaReady}
            signerAddresses={solanaSigners.map((wallet) => wallet.address)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={hasEthereum ? 'outline' : 'default'}
            disabled={!ready || !authenticated || !user || busy !== null || hasEthereum}
            onClick={() => void create('ethereum')}
          >
            {hasEthereum ? 'Ethereum 已创建' : busy === 'ethereum' ? '创建中…' : '创建 Ethereum'}
          </Button>
          <Button
            size="sm"
            variant={hasSolana ? 'outline' : 'default'}
            disabled={!ready || !authenticated || !user || busy !== null || hasSolana}
            onClick={() => void create('solana')}
          >
            {hasSolana ? 'Solana 已创建' : busy === 'solana' ? '创建中…' : '创建 Solana'}
          </Button>
        </div>
        {createdComplete && (
          <p className={`rounded-md border p-2 text-xs ${signerComplete ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
            {signerComplete ? '两个钱包已创建且签名器已加载。' : '两个钱包已登记，正在等待 Privy 签名器加载。'}
            请在下一步重新换取本站 token，让后端验签并写入钱包归属投影。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function WalletAddressList({
  title,
  wallets,
  signerReady,
  signerAddresses,
}: {
  title: string;
  wallets: EmbeddedWalletAddress[];
  signerReady: boolean;
  signerAddresses: string[];
}) {
  return (
    <section className="rounded-md border border-border bg-background p-3" aria-label={`${title} wallet addresses`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        <Badge variant={wallets.length ? 'outline' : 'secondary'}>{wallets.length ? `${wallets.length} embedded` : 'Not created'}</Badge>
      </div>
      {wallets.length === 0 ? (
        <p className="mt-3 text-xs text-muted">No Privy embedded wallet address.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {wallets.map((wallet, index) => {
            const signerLoaded = signerReady && signerHasAddress(signerAddresses, wallet);
            return (
              <div key={`${wallet.chainType}:${wallet.address}`} className="space-y-2 border-t border-border pt-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2 text-[10px]">
                  <Badge variant="outline">
                    {index === 0 && wallet.walletIndex !== undefined ? 'Primary' : 'Embedded'}
                    {wallet.walletIndex !== undefined ? ` · index ${wallet.walletIndex}` : ''}
                  </Badge>
                  <span className={signerLoaded ? 'text-up' : signerReady ? 'text-accent' : 'text-muted'}>
                    {signerLoaded ? 'Ready to sign' : signerReady ? 'Registered, signer not loaded' : 'Loading signer…'}
                  </span>
                </div>
                <code className="block break-all font-mono text-xs text-foreground">{wallet.address}</code>
                <CopyButton value={wallet.address} label={`Copy ${title} address`} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
