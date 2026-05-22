type BitcoinNetwork = "livenet" | "testnet" | "testnet4";

const NETWORK_OPTIONS = [
  { label: "Mainnet", network: "livenet" as const },
  { label: "Testnet4", network: "testnet4" as const },
  { label: "Testnet3", network: "testnet" as const },
];

export function BrowserNetworkTabs({
  network,
  onChange,
}: {
  network: BitcoinNetwork;
  onChange: (network: BitcoinNetwork) => void;
}) {
  return (
    <label className="browser-network-control browser-network-select-field">
      <span>Network</span>
      <select
        aria-label="Browser Bitcoin network"
        className="network-select browser-network-select"
        onChange={(event) => onChange(event.target.value as BitcoinNetwork)}
        value={network}
      >
        {NETWORK_OPTIONS.map((option) => (
          <option key={option.network} value={option.network}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
