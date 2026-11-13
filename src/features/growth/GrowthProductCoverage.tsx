import { APP_LINKS } from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import { GROWTH_PRODUCT_COVERAGE } from "./growthForecast.mjs";
import { CURRENT_GROWTH_PRODUCT_COVERAGE } from "./currentGrowthModel.mjs";

const roles: Record<string, string> = {
  economic: "Activity lane", shared: "Shared accounting", aggregate: "Aggregate",
  derived: "Derived metric", "read-only": "Read-only",
};

export default function GrowthProductCoverage({ current = true }: { current?: boolean }) {
  const coverageRows = current ? CURRENT_GROWTH_PRODUCT_COVERAGE : GROWTH_PRODUCT_COVERAGE;
  const products = APP_LINKS.map((link) => ({
    link,
    coverage: coverageRows.find((item) =>
      item.name === link.label || (link.label === "Credit" && item.product === "credit")),
  }));
  return (
    <section className="growth-coverage" aria-labelledby="growth-coverage-title">
      <header>
        <h3 id="growth-coverage-title">Every surface, accounted for</h3>
        <p>Products are not extra value buckets. Shared carriers count once; read-only views and aliases add no new payments.</p>
      </header>
      <ul className="growth-coverage-grid">
        {products.map(({ link, coverage }) => (
          <li key={link.href}>
            <div className="growth-coverage-heading">
              <a href={appHref(link.href, link.localHref)}>{link.label}</a>
              <span>{coverage ? roles[coverage.role] : "Coverage unavailable"}</span>
            </div>
            <p>{coverage?.activity ?? "No verified coverage mapping is available for this surface."}</p>
            {coverage ? <details>
              <summary>Accounting & model scope</summary>
              <p>{coverage.assumption}</p>
              <dl><div><dt>Accounted through</dt><dd>{coverage.owner}</dd></div>
                <div><dt>Scenario lane</dt><dd>{coverage.modeledLane}</dd></div>
                <div><dt>Source</dt><dd>{coverage.source}</dd></div></dl>
            </details> : null}
          </li>
        ))}
        {coverageRows.filter((item) => item.product === "mail" || item.product === "files").map((item) => (
          <li key={item.product}>
            <div className="growth-coverage-heading"><h4>{item.name}</h4><span>Computer workspace</span></div>
            <p>{item.activity}</p>
            <details><summary>Accounting & model scope</summary><p>{item.assumption}</p><p>Accounted through {item.owner}. Scenario lane: {item.modeledLane}.</p></details>
          </li>
        ))}
      </ul>
      <p className="field-note">Compatibility names are not additional products: Marketplace → AMO; token/tokens → Credit; domain/domains → DNS; Drive → Files; NFT → Computer. Availability is separate from accounting coverage.</p>
    </section>
  );
}
