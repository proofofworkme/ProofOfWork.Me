import {
  bondHardPriceDeclarationOnChainDraft,
} from "../server/bond-hard-price-declaration.mjs";

process.stdout.write(
  `${JSON.stringify(bondHardPriceDeclarationOnChainDraft(), null, 2)}\n`,
);
