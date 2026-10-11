import proofMark from "../../assets/proof-mark.svg?raw";

/** One vector silhouette for the product identity, at every size and theme. */
export function BrandMark() {
  // This markup is a bundled, source-controlled vector; no user content enters it.
  return <div className="brand-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: proofMark }} />;
}
