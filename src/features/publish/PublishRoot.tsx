import BoostRoot from "../boost/BoostRoot";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import "./publish.css";

export default function PublishRoot(props: { embedded?: boolean; initialAddress?: string; initialNetwork?: BitcoinNetwork } = {}) {
  return <BoostRoot {...props} surface="publish" />;
}
