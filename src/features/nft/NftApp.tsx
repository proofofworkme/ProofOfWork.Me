import type { FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, RefreshCw, Send, X } from "lucide-react";
import { AppHeader } from "../../shared/components/AppHeader";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { FeeRateControl } from "../../shared/components/FeeRateControl";
import {
  DataList,
  ProgressMeter,
  PublicPage,
  PublicPageHeader,
  ResponsiveGrid,
} from "../../shared/components/PublicLayout";
import { SocialFooter } from "../../shared/components/SocialFooter";
import { shortAddress } from "../../functions";
import {
  NFT_COLLECTIONS,
  NFT_DEPLOY_FEE_ADDRESS,
  NFT_DEPLOY_MIN_FEE_SATS,
  NFT_MINT_ASSISTANT_DEFAULT_COUNT,
  NFT_MINT_ASSISTANT_DEFAULT_DELAY_MS,
  NFT_MINT_ASSISTANT_MAX_COUNT,
  NFT_MINT_ASSISTANT_MAX_DELAY_MS,
  nftCollectionUrl,
  type AkMintRecord,
  type AkTraits,
  type NftCollectionDefinition,
  type NftCollectionRecord,
} from "./nftProtocol";
import { NftAkGenerator } from "./components/NftAkGenerator";
import { NftCollectionGallery } from "./components/NftCollectionGallery";
type ThemeMode = "light" | "dark";
type StatusTone = "idle" | "good" | "bad";
export type NftWorkspaceProps = {
  address: string;
  busy: boolean;
  canMint: boolean;
  compact?: boolean;
  collectionPage: boolean;
  collectionUrl: string;
  collections: NftCollectionRecord[];
  canDeployCollection: boolean;
  deployBytes: number;
  deployCollection: (event: FormEvent<HTMLFormElement>) => void;
  deployGenesisTag: string;
  deployImagePayload: string;
  deployMaxSupply: number;
  deployName: string;
  feeRate: number;
  genesisTag: string;
  imageDataUrl: string;
  incompleteCollectionRoute: boolean;
  mintBytes: number;
  mintAk: (
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<string | undefined>;
  mintAssistantCompleted: number;
  mintAssistantDelayMs: number;
  mintAssistantRemaining: number;
  mintAssistantRunning: boolean;
  mintAssistantTarget: number;
  mints: AkMintRecord[];
  operatorAddress: string;
  selectedCollection: NftCollectionDefinition;
  setFeeRate: (value: number) => void;
  setGenesisTag: (value: string) => void;
  setImageBase64: (value: string) => void;
  setImageDataUrl: (value: string) => void;
  setMintAssistantDelayMs: (value: number) => void;
  setMintAssistantTarget: (value: number) => void;
  setOperatorAddress: (value: string) => void;
  setDeployGenesisTag: (value: string) => void;
  setDeployImagePayload: (value: string) => void;
  setDeployMaxSupply: (value: number) => void;
  setDeployName: (value: string) => void;
  setSelectedCollectionId: (value: string) => void;
  setTraits: (value: AkTraits | ((current: AkTraits) => AkTraits)) => void;
  startMintAssistant: () => void;
  stopMintAssistant: () => void;
  traits: AkTraits;
  onRefresh: () => void;
};

export function NftApp({
  address,
  busy,
  connectWallet,
  disconnectWallet,
  hasUnisat,
  network,
  onNetworkChange,
  setTheme,
  status,
  theme,
  ...workspaceProps
}: NftWorkspaceProps & {
  connectWallet: () => void;
  disconnectWallet: () => void;
  hasUnisat: boolean;
  network: BitcoinNetwork;
  onNetworkChange: (network: BitcoinNetwork) => void;
  setTheme: (value: ThemeMode | ((current: ThemeMode) => ThemeMode)) => void;
  status: { tone: StatusTone; text: string };
  theme: ThemeMode;
}) {
  return (
    <main className="id-launch-app">
      <AppHeader
        address={address}
        busy={busy}
        connectWallet={connectWallet}
        disconnectWallet={disconnectWallet}
        hasUnisat={hasUnisat}
        mark="NFT"
        network={network}
        onNetworkChange={onNetworkChange}
        setTheme={setTheme}
        subtitle="Collections on Bitcoin"
        theme={theme}
        title="NFT"
      />

      {status.tone !== "idle" ? (
        <div className={`status ${status.tone}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{status.text}</span>
        </div>
      ) : null}

      <NftWorkspace address={address} busy={busy} {...workspaceProps} />
      <SocialFooter />
    </main>
  );
}

export function NftWorkspace({
  address,
  busy,
  canDeployCollection,
  canMint,
  compact = false,
  collectionPage,
  collectionUrl,
  collections,
  deployBytes,
  deployCollection,
  deployGenesisTag,
  deployImagePayload,
  deployMaxSupply,
  deployName,
  feeRate,
  genesisTag,
  imageDataUrl,
  incompleteCollectionRoute,
  mintBytes,
  mintAk,
  mintAssistantCompleted,
  mintAssistantDelayMs,
  mintAssistantRemaining,
  mintAssistantRunning,
  mintAssistantTarget,
  mints,
  operatorAddress,
  selectedCollection,
  setFeeRate,
  setGenesisTag,
  setImageBase64,
  setImageDataUrl,
  setMintAssistantDelayMs,
  setMintAssistantTarget,
  setOperatorAddress,
  setDeployGenesisTag,
  setDeployImagePayload,
  setDeployMaxSupply,
  setDeployName,
  setSelectedCollectionId,
  setTraits,
  startMintAssistant,
  stopMintAssistant,
  traits,
  onRefresh,
}: NftWorkspaceProps) {
  const confirmedMints = mints.filter((mint) => mint.confirmed).length;
  const mintProgress = selectedCollection.maxSupply
    ? Math.min(100, (confirmedMints / selectedCollection.maxSupply) * 100)
    : 0;
  const canMintSelectedCollection =
    selectedCollection.maxSupply > 0 &&
    operatorAddress === selectedCollection.defaultOperatorAddress;
  const normalizedNftMintAssistantTarget = Number.isFinite(
    mintAssistantTarget,
  )
    ? Math.min(
        NFT_MINT_ASSISTANT_MAX_COUNT,
        Math.max(1, Math.floor(mintAssistantTarget)),
      )
    : NFT_MINT_ASSISTANT_DEFAULT_COUNT;
  const normalizedNftMintAssistantDelayMs = Number.isFinite(
    mintAssistantDelayMs,
  )
    ? Math.min(
        NFT_MINT_ASSISTANT_MAX_DELAY_MS,
        Math.max(0, Math.floor(mintAssistantDelayMs)),
      )
    : NFT_MINT_ASSISTANT_DEFAULT_DELAY_MS;
  const nftMintAssistantDelaySeconds = Number(
    (normalizedNftMintAssistantDelayMs / 1000).toFixed(2),
  );
  const nftMintAssistantCanStart = canMint && !mintAssistantRunning;
  const renderNftMintAssistant = () => (
    <div className="token-mint-assistant">
      <div className="token-assistant-head">
        <div>
          <strong>Mint assistant</strong>
          <span>
            {mintAssistantRunning
              ? `${mintAssistantCompleted.toLocaleString()} broadcast, ${mintAssistantRemaining.toLocaleString()} queued`
              : `Queues ${selectedCollection.displayName} mints to ${shortAddress(operatorAddress)}`}
          </span>
        </div>
        <div className="token-assistant-status" aria-label="NFT mint assistant progress">
          <span>{mintAssistantCompleted.toLocaleString()} done</span>
          <span>{mintAssistantRemaining.toLocaleString()} left</span>
        </div>
      </div>
      <div className="token-form-grid token-assistant-grid">
        <label>
          Mints
          <input
            disabled={mintAssistantRunning}
            max={NFT_MINT_ASSISTANT_MAX_COUNT}
            min={1}
            onChange={(event) =>
              setMintAssistantTarget(Number(event.target.value))
            }
            type="number"
            value={mintAssistantTarget || ""}
          />
        </label>
        <label>
          Delay seconds
          <input
            disabled={mintAssistantRunning}
            max={NFT_MINT_ASSISTANT_MAX_DELAY_MS / 1000}
            min={0}
            onChange={(event) =>
              setMintAssistantDelayMs(Number(event.target.value) * 1000)
            }
            step={0.1}
            type="number"
            value={nftMintAssistantDelaySeconds}
          />
        </label>
      </div>
      <div className="token-assistant-actions">
        <button
          className="secondary"
          disabled={!nftMintAssistantCanStart}
          onClick={startMintAssistant}
          type="button"
        >
          <span className="button-content">
            <Send size={16} />
            <span>
              {mintAssistantRunning
                ? "Assistant running"
                : `Start ${normalizedNftMintAssistantTarget.toLocaleString()} mints`}
            </span>
          </span>
        </button>
        <button
          className="secondary"
          disabled={!mintAssistantRunning}
          onClick={() => stopMintAssistant()}
          type="button"
        >
          <span className="button-content">
            <X size={16} />
            <span>Stop</span>
          </span>
        </button>
      </div>
      <p className="field-note">
        Opens the next NFT mint after the previous broadcast. You still click
        Sign in UniSat. Each mint pays this collection operator registry.
      </p>
    </div>
  );
  if (!collectionPage) {
    return (
      <PublicPage
        className={`nft-workspace${compact ? " nft-workspace-compact" : ""}`}
        compact={compact}
      >
        <PublicPageHeader align={compact ? "start" : "center"}>
          <p className="eyebrow">NFT</p>
          <h2>Collections</h2>
          <p>
            Browse Bitcoin-native NFT collections indexed by ProofOfWork.Me.
            Each collection is defined by a name, an operator address, and
            deterministic decoding rules.
          </p>
        </PublicPageHeader>

        <section className="id-launch-card product-card">
          <div className="product-card-row">
            <div>
              <p className="eyebrow">Available</p>
              <h3>
                {collections.length.toLocaleString()} collection
              </h3>
            </div>
            <strong>{confirmedMints.toLocaleString()} indexed mints</strong>
          </div>

          {incompleteCollectionRoute ? (
            <a className="primary small link-button" href={nftCollectionUrl(selectedCollection)}>
              <span className="button-content">
                <ArrowUpRight size={14} />
                <span>Open canonical collection page</span>
              </span>
            </a>
          ) : null}
        </section>

        <form
          className="id-launch-card id-form product-card"
          onSubmit={deployCollection}
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Deploy</p>
              <h3>Create NFT collection</h3>
            </div>
            <strong>{NFT_DEPLOY_MIN_FEE_SATS.toLocaleString()} sats</strong>
          </div>

          <label>
            Collection name
            <input
              maxLength={32}
              onChange={(event) => setDeployName(event.target.value)}
              placeholder="AK21"
              value={deployName}
            />
          </label>

          <label>
            Max supply
            <input
              min={1}
              onChange={(event) => setDeployMaxSupply(Number(event.target.value))}
              step={1}
              type="number"
              value={deployMaxSupply}
            />
          </label>

          <label>
            Genesis Tag
            <input
              maxLength={120}
              onChange={(event) => setDeployGenesisTag(event.target.value)}
              placeholder="I made it to protect Bitcoin"
              value={deployGenesisTag}
            />
          </label>

          <label>
            Collection image payload
            <textarea
              onChange={(event) => setDeployImagePayload(event.target.value)}
              placeholder="data:image/png;base64,..."
              rows={4}
              value={deployImagePayload}
            />
          </label>

          <DataList
            items={[
              {
                label: "Deploy fee",
                value: `${NFT_DEPLOY_MIN_FEE_SATS.toLocaleString()} sats`,
              },
              {
                label: "Fee address",
                value: shortAddress(NFT_DEPLOY_FEE_ADDRESS),
              },
              {
                label: "OP_RETURN data",
                value: `${deployBytes.toLocaleString()} bytes`,
              },
            ]}
          />

          <button className="primary" disabled={!canDeployCollection} type="submit">
            <span className="button-content">
              <Send size={16} />
              <span>{address ? "Deploy collection" : "Connect wallet"}</span>
            </span>
          </button>
        </form>

        <ResponsiveGrid variant="cards">
          {collections.map((collection) => {
            const collectionMints = mints.filter(
              (mint) => mint.collectionId === collection.id,
            );
            const confirmed = collectionMints.filter(
              (mint) => mint.confirmed,
            ).length;
            const previewMint = collectionMints.find((mint) => mint.imageDataUrl);
            const previewImage = collection.imageDataUrl || previewMint?.imageDataUrl;

            return (
              <a
                className="id-launch-card product-card product-card-link"
                href={nftCollectionUrl(collection)}
                key={collection.id}
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Collection</p>
                    <h3>{collection.displayName}</h3>
                  </div>
                  <ArrowUpRight size={18} />
                </div>

                <div
                  aria-hidden="true"
                  className="nft-pixel-stage nft-collection-preview"
                >
                  {previewImage ? (
                    <img
                      alt=""
                      src={previewImage}
                    />
                  ) : (
                    <span>{collection.id}</span>
                  )}
                </div>

                <p>{collection.description}</p>

                <DataList
                  items={[
                    { label: "Name", value: collection.name },
                    {
                      label: "Operator",
                      value: shortAddress(collection.defaultOperatorAddress),
                    },
                    {
                      label: "Indexed",
                      value: `${confirmed.toLocaleString()} confirmed`,
                    },
                    ...(collection.txid
                      ? [
                          {
                            label: "Deploy tx",
                            value: shortAddress(collection.txid),
                          },
                        ]
                      : []),
                  ]}
                />
              </a>
            );
          })}
        </ResponsiveGrid>
      </PublicPage>
    );
  }

  return (
    <PublicPage
      className={`nft-workspace${compact ? " nft-workspace-compact" : ""}`}
      compact={compact}
    >
      <PublicPageHeader
        align={compact ? "start" : "center"}
        actions={
          <a className="secondary small link-button" href="/?nft=1">
            <span className="button-content">
              <ArrowLeft size={14} />
              <span>Collections</span>
            </span>
          </a>
        }
      >
        <p className="eyebrow">NFT collection</p>
        <h2>ASSEMBLE YOUR {selectedCollection.displayName}-21</h2>
        <p>
          Generate a visual AK, forge a Genesis Tag, then inspect every valid
          mint decoded from the collection operator.
        </p>
      </PublicPageHeader>

      <section className="id-launch-card product-card">
        <div className="product-card-row">
          <strong>
            NFTs Minted: {confirmedMints.toLocaleString()} /{" "}
              {selectedCollection.maxSupply.toLocaleString()}
          </strong>
          <span className="mono-muted">
            Operator {shortAddress(operatorAddress)}
          </span>
        </div>
        <ProgressMeter label="Mint progress" progress={mintProgress} />
      </section>

      <ResponsiveGrid variant="cards">
        <NftAkGenerator
          busy={busy}
          imageDataUrl={imageDataUrl}
          setImageBase64={setImageBase64}
          setImageDataUrl={setImageDataUrl}
          setTraits={setTraits}
          traits={traits}
        />

        <form
          className="id-launch-card id-form product-card"
          onSubmit={mintAk}
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Mint</p>
              <h3>{selectedCollection.displayName} mint transaction</h3>
            </div>
            <button
              className="secondary small"
              disabled={busy}
              onClick={onRefresh}
              type="button"
            >
              <span className="button-content">
                <RefreshCw size={15} />
                <span>Refresh</span>
              </span>
            </button>
          </div>

          <div aria-label="Selected AK" className="nft-pixel-stage nft-selected-stage">
            {imageDataUrl ? (
              <img
                alt="Selected AK"
                src={imageDataUrl}
              />
            ) : (
              <span>No AK selected</span>
            )}
          </div>

          <label>
            Genesis Tag
            <input
              maxLength={80}
              onChange={(event) => setGenesisTag(event.target.value)}
              placeholder="Optional"
              value={genesisTag}
            />
          </label>

          <label>
            Fee rate
            <input
              min={0.1}
              onChange={(event) => setFeeRate(Number(event.target.value))}
              step={0.1}
              type="number"
              value={feeRate}
            />
          </label>

          <DataList
            items={[
              {
                label: "Owner anchor",
                value: `${selectedCollection.ownerAnchorSats.toLocaleString()} sats`,
              },
              {
                label: "Operator payment",
                value: `${selectedCollection.operatorMinSats.toLocaleString()} sats`,
              },
              {
                label: "OP_RETURN data",
                value: `${mintBytes.toLocaleString()} bytes`,
              },
            ]}
          />

          <button className="primary" disabled={!canMint} type="submit">
            <span className="button-content">
              <Send size={16} />
              <span>
                {address
                  ? canMintSelectedCollection
                    ? `Mint ${selectedCollection.displayName}`
                    : "Use collection registry"
                  : "Connect wallet"}
              </span>
            </span>
          </button>
          {renderNftMintAssistant()}
        </form>
      </ResponsiveGrid>

      <NftCollectionGallery
        collection={selectedCollection}
        confirmedCount={confirmedMints}
        mints={mints}
        operatorAddress={operatorAddress}
      />
    </PublicPage>
  );
}

