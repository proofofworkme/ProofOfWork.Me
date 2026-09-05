import {
  GROWTH_ASSUMPTIONS,
  GROWTH_MODEL_VERSION,
  GROWTH_PRODUCT_COVERAGE,
} from "./growthForecast.mjs";

export default function GrowthModelDetails({ historical }: { historical: boolean }) {
  return (
    <article className="growth-model-details">
      <h3>Every product, one allocation</h3>
      <p>
        Version {GROWTH_MODEL_VERSION} covers the complete product family. Usage,
        payment, elasticity, and size inputs are explicit scenario assumptions,
        anchored to the original May baseline. They are not current measurements
        or a simulation of canonical WORK revaluation.
      </p>
      {historical ? <p>The chart currently shows the historical comparison. The all-product assumptions below apply when All products is selected.</p> : null}
      <details>
        <summary>Usage, value, and blockspace assumptions</summary>
        <div className="growth-model-assumptions">
          {GROWTH_ASSUMPTIONS.map((item) => (
            <section key={item.product}>
              <h4>{item.product}</h4>
              <dl className="growth-assumption-list">
                <div><dt>Usage</dt><dd>{item.usage}</dd></div>
                <div><dt>Value</dt><dd>{item.value}</dd></div>
                <div><dt>Fee elasticity</dt><dd>{item.elasticity}</dd></div>
                <div><dt>Blockspace</dt><dd>{item.blockspace}</dd></div>
              </dl>
              <p>{item.attribution}</p>
            </section>
          ))}
        </div>
      </details>
      <details>
        <summary>Where each app enters the model</summary>
        <div className="growth-product-coverage">
          {GROWTH_PRODUCT_COVERAGE.map((item) => (
            <section key={item.product}>
              <h4>{item.name}</h4>
              <p>{item.activity}</p>
              <p>{item.assumption}</p>
              <small>{item.owner} · {item.role}</small>
            </section>
          ))}
        </div>
      </details>
      <p>
        Mail, Files, HTML publishing, bonds, and Boost share carriers. Each
        payment and transaction has one allocation. Viewing, balances, synthetic
        issuance, and derived floors create no second contribution.
      </p>
    </article>
  );
}
