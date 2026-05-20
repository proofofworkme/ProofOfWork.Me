type BitcoinNetwork = "livenet" | "testnet" | "testnet4";

export function BrowserNetworkTabs({
  network,
  onChange,
}: {
  network: BitcoinNetwork;
  onChange: (network: BitcoinNetwork) => void;
}) {
  return (
    <div className="browser-network-control">
      <span>Network</span>
      <div
        className="network-tabs browser-network-tabs"
        aria-label="Browser Bitcoin network"
      >
        <button
          aria-pressed={network === "livenet"}
          onClick={() => onChange("livenet")}
          type="button"
        >
          Mainnet
        </button>
        <button
          aria-pressed={network === "testnet4"}
          onClick={() => onChange("testnet4")}
          type="button"
        >
          Testnet4
        </button>
        <button
          aria-pressed={network === "testnet"}
          onClick={() => onChange("testnet")}
          type="button"
        >
          Testnet3
        </button>
      </div>
    </div>
  );
}
