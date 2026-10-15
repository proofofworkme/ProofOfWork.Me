import { APP_MENU_GROUPS } from "../../app/appLinks";
import { appHref, detectAppSurface } from "../../app/routeRegistry";
import { getSurfaceSeo } from "../../app/seoMetadata.mjs";

/** Public product copy also used by the JavaScript-free document. Never reads account state. */
export function PublicProductOverview() {
  const product = getSurfaceSeo(detectAppSurface());
  if (!product) return null;
  return (
    <details className="product-overview">
      <summary>About {product.label}</summary>
      <div className="product-overview-content">
        <h2>{product.heading}</h2>
        <p>{product.intro}</p>
        <nav className="product-directory" aria-label="Explore ProofOfWork apps">
          {APP_MENU_GROUPS.map((group) => (
            <section key={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a href={appHref(link.href, link.localHref)}>{link.displayLabel}</a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </div>
    </details>
  );
}
