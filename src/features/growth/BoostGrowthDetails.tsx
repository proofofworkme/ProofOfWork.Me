import {
  boostProofsDisplay,
  boostWorkDisplay,
  type BoostGrowthAmount,
  type BoostGrowthObservation,
} from "./boostGrowth.mjs";

export default function BoostGrowthDetails({ observation }: {
  observation: BoostGrowthObservation;
}) {
  if (!observation.ready || !observation.counts) {
    return <p className="field-note" role="status">{observation.reason}</p>;
  }
  const counts = observation.counts;
  const amounts: Array<{ field: BoostGrowthAmount; label: string; work?: boolean }> = [
    { field: "directProofSignalSats", label: "Direct proof signal" },
    { field: "registryFeeSats", label: "Boost registry fees" },
    { field: "saleVolumeSats", label: "Seller sale volume" },
    { field: "attachedWorkSubatoms", label: "Companion WORK transfers", work: true },
    { field: "attributedMailSats", label: "Mail/Files companion payments" },
    { field: "attributedWorkSubatoms", label: "Already counted through WORK", work: true },
  ];
  return (
    <details className="growth-boost-details">
      <summary>Confirmed activity and payment attribution</summary>
      <p className="field-note">
        {counts.events.toLocaleString()} recognized confirmed records across{" "}
        {counts.transactions.toLocaleString()} transactions, including hidden posts.
        Record counts do not establish economic validity.
      </p>
      <dl className="growth-assumption-list">
        {([
          ["Posts", counts.posts], ["Replies", counts.replies],
          ["Likes", counts.likes], ["Reboosts", counts.reboosts],
          ["Follows", counts.follows], ["Unfollows", counts.unfollows],
          ["Profiles", counts.profiles], ["Hidden records", counts.hides],
          ["Transfers", counts.transfers], ["Listings", counts.listings],
          ["Seals", counts.seals], ["Delistings", counts.delistings],
          ["Purchase records", counts.sales],
        ] as const).map(([label, count]) => (
          <div key={label}><dt>{label}</dt><dd>{count.toLocaleString()}</dd></div>
        ))}
      </dl>
      <dl className="growth-assumption-list growth-boost-attribution">
        {amounts.map(({ field, label, work }) => (
          <div key={field}>
            <dt>{label}</dt>
            <dd>{work ? boostWorkDisplay(observation[field]) : boostProofsDisplay(observation[field])}</dd>
            {observation.metricReasons[field] ? <p>{observation.metricReasons[field]}</p> : null}
          </div>
        ))}
      </dl>
      <p className="field-note">
        These amounts describe Boost transactions. Overlapping Mail/Files payments and companion WORK
        transfers already contribute through their existing records and are not added
        again. A separate Boost contribution to canonical network value has not activated.
      </p>
    </details>
  );
}
