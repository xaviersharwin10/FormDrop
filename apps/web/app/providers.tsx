"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { hederaTestnet } from "viem/chains";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is not set");
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme: "light" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        // Lets the creator's own embedded wallet sign a real fundPot() call
        // against Hedera testnet directly (over its JSON-RPC relay), instead
        // of every funding path going through a server-provisioned wallet.
        defaultChain: hederaTestnet,
        supportedChains: [hederaTestnet],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
