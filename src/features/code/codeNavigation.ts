import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { validateCodePath } from "../../shared/protocol/codeRepository.mjs";
import type { CodeFile } from "./codeApi";

export type CodeLocation = { network: BitcoinNetwork; repo?: string; version?: string; path?: string };
export type CodeSourceReference = {
  network: BitcoinNetwork;
  repo: string;
  version: string;
  path: string;
  sha256: string;
  size: number;
};

// A navigation reference carries a commitment, never source or signing authority.
// Pages must independently read the complete version and verify its source bytes.
export function assertCodeSourceReference(reference: CodeSourceReference, network: BitcoinNetwork, file?: CodeFile) {
  if (reference.network !== network) throw new Error("The Code source belongs to a different network. Open Pages on that network to continue.");
  if (![reference.repo, reference.version, reference.sha256].every(value => /^[a-f0-9]{64}$/u.test(value)) ||
      !validateCodePath(reference.path) || !/\.(?:html?|xhtml)$/iu.test(reference.path) ||
      !Number.isSafeInteger(reference.size) || reference.size < 0 || reference.size > 60_000) {
    throw new Error("The Code source reference is incomplete. Open the verified HTML source in Code again.");
  }
  if (file && (file.path !== reference.path || file.sha256 !== reference.sha256 || file.size !== reference.size)) {
    throw new Error("The confirmed Code source differs from the selected source. Return to Code and inspect it again.");
  }
}
