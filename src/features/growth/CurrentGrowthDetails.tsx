import { CURRENT_GROWTH_MODEL_VERSION, CURRENT_GROWTH_PRODUCT_COVERAGE, growthPublicationFootprint } from "./currentGrowthModel.mjs";
import { GROWTH_ASSUMPTIONS } from "./growthForecast.mjs";

const assumptions = [
  ["Boost", "The inherited demand is four text originals, 12 standalone social actions and 0.02 sales per projected ID/year before elasticity. Originals share Mail; their extra metadata is 250 vB. Standalone social owner-payment estimates use 546 proofs / 500 vB; sale lifecycles use three registry writes and a 1,000-proof seller-price assumption. No attached WORK value is added."],
  ["Code", "The inherited four source puts and 0.3 controls per projected ID/year are capped by Files/Mail demand. Only 350 metadata vB per record is incremental; original file bytes and payments count once."],
  ["DNS", "Per projected ID/year: 0.1 registrations, 0.1 resolver/direct-transfer mutations and 0.2 owner subdomain/page-link actions. Registration: 1,000 proofs; mutation: 546. Owner self-payments add no new value. Assumed sizes: 350 / 350 / 1,000 vB."],
  ["DNS in AMO", "0.02 sales and 0.005 canceled listings per projected ID/year; 1,000-proof assumed seller price. Three writes per sale, two per cancellation, 546-proof registry fee and 500 vB per write. Ticket principal and refunds are excluded."],
  ["Permission", "0.1 grant/replacement/revocation records per projected ID/year, at 1,200 vB each. Allocated within existing Mail demand after Boost and Code controls; not extra Mail value or a new registry fee."],
  ["Jobs", "0.1 illustrative lifecycles per projected ID/year: four Mail records and one file delivery, capped separately by available carrier demand, plus 350 metadata vB per record. Counts are activity, not completed-job promises. No forecast reward is invented or counted twice."],
  ["Publish", "One article per projected ID/year, allocated within remaining Mail demand after Permission and Jobs. Inline bodies are assumed to be 16,000 bytes; 1% use a 4,000,000-byte linked body. Inline delivery belongs to Mail; linked delivery moves to Files with the same assumed payment counted once."],
  ["Pages", "The existing Browser-authoring basket explicitly owns Pages: one HTML publication per projected ID/year, 15,000 vB each before capacity allocation. Preview, rendering and repeated page views add nothing."],
  ["Files and Boost media", "0.5 Boost media publications per projected ID/year share Files demand after Code and Jobs allocations. 1% of remaining general Files and Boost media are assumed to be 4,000,000 bytes. Code and job files retain the existing file-size average."],
  ["Linked publication", "At the default 96,000-byte part size, a 4 MB item uses 42 parts, one linker and one paid delivery: 44 transactions, not one 4 MB transaction. Publication parts/linker add no content payment. All transaction bytes share one capacity limit; a reused existing file does not require republishing."],
];
export default function CurrentGrowthDetails({ feeRate }: { feeRate: number }) {
  const large = growthPublicationFootprint(4_000_000, true);
  return <article className="growth-model-details">
    <h3>Current products, explicit assumptions</h3>
    <p>Version {CURRENT_GROWTH_MODEL_VERSION}. Product scope is current; calibration is not. New workload rates and sizes are illustrative assumptions, not measurements or predictions. The May 11 origin, node adoption, fee elasticities and modeled USD path remain historical inputs; the selected fee-rate scenario is {feeRate} proofs/vB.</p>
    <p>The default 0.1 and alternatives 0.5, 1 and 2 mirror existing app fee-editor presets, not observed fees. The historical 0.00001 option is sensitivity analysis only. The inherited elasticity curve uses a 0.01 reference; this assumption can dominate differences from the October model.</p>
    <p>Per-ID rates below are multiplied by the inherited lane fee elasticity, then physical activity shares one blockspace cap. Shared subsets cannot exceed their carrier demand. Read-only surfaces add zero transactions or value.</p>
    <details><summary>Usage, value, and blockspace assumptions</summary>
      <div className="growth-model-assumptions">{assumptions.map(([name, detail]) => <section key={name}><h4>{name}</h4><p>{detail}</p></section>)}</div>
      <p>The 4 MB case budgets {large.vbytes.toLocaleString()} vB including assumed one-input/change envelopes, manifest name/MIME and paid delivery. This is a capacity scenario, not a signing quote. Funding inputs, metadata, retries and fee rates can change actual costs. Linked capability is not enabled by this model.</p>
      <h4>Inherited lanes</h4>
      <p>These October 6 assumptions remain except where the explicit allocations above replace their content-byte averages. DNS sales join the AMO basket. Standalone social payment estimates represent direct owner payments; no new Boost registry fee is invented. Exact WORK revaluation, batch recipient distributions and endogenous feedback are not simulated.</p>
      <div className="growth-model-assumptions">{GROWTH_ASSUMPTIONS.filter(item => !["Jobs", "Code", "Browser authoring", "Files / Drive", "Boost"].includes(item.product)).map(item => <section key={item.product}><h4>{item.product}</h4><p>{item.usage} {item.value} {item.blockspace}</p></section>)}</div>
    </details>
    <details><summary>Where each app enters the model</summary><div className="growth-product-coverage">{CURRENT_GROWTH_PRODUCT_COVERAGE.map(item => <section key={item.product}><h4>{item.name}</h4><p>{item.activity}</p><p>{item.assumption}</p><small>{item.owner} · {item.modeledLane}</small></section>)}</div></details>
    <p>Scenario values do not change confirmed balances, network value, Q16 WORK arithmetic or historical records. Search, Home, Desktop views, Log and Growth add no second economic event.</p>
  </article>;
}
