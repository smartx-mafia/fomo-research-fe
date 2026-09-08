'use client';

import {CrossmintEmbeddedCheckout, CrossmintProvider} from '@crossmint/client-sdk-react-ui';

import {CROSSMINT_CLIENT_API_KEY} from '@/config';

export default function CrossmintCheckout({orderID, clientSecret, receiptEmail}: {orderID: string; clientSecret: string; receiptEmail: string}) {
  if (!CROSSMINT_CLIENT_API_KEY) {
    return (
      <div role="alert" className="rounded-md border border-accent/40 bg-accent/5 p-3 text-sm text-accent">
        Checkout is ready, but NEXT_PUBLIC_CROSSMINT_CLIENT_SIDE_API_KEY is not configured. Keep this order and configure the public browser key; do not create another order.
      </div>
    );
  }
  return (
    <CrossmintProvider apiKey={CROSSMINT_CLIENT_API_KEY} consoleLogLevel="silent">
      <CrossmintEmbeddedCheckout
        orderId={orderID}
        clientSecret={clientSecret}
        payment={{receiptEmail, crypto: {enabled: false}, fiat: {enabled: true, allowedMethods: {card: true, applePay: true, googlePay: true}}, defaultMethod: 'fiat'}}
        appearance={{rules: {DestinationInput: {display: 'hidden'}, ReceiptEmailInput: {display: 'hidden'}}}}
      />
    </CrossmintProvider>
  );
}
