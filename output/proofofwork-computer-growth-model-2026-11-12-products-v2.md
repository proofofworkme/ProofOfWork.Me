# ProofOfWork Computer Growth: current-product scenario

Version: `2026-11-12-products-v2`. Revised 2026-11-12. Origin: 2026-05-11.

This version updates product workload coverage, not current chain calibration. Every new rate and size mix is an illustrative assumption. It is not a prediction, treasury valuation, canonical WORK floor or signing quote. October 6 and May scenarios remain preserved.

## New explicit assumptions

| Input | Illustrative value |
| --- | ---: |
| feeRate | 0.1 |
| dnsRegistrationsPerIdPerYear | 0.1 |
| dnsMutationsPerIdPerYear | 0.1 |
| dnsOwnerActionsPerIdPerYear | 0.2 |
| dnsSalesPerIdPerYear | 0.02 |
| dnsCancelledListingsPerIdPerYear | 0.005 |
| dnsAverageSaleSats | 1000 |
| dnsRegistrationVbytes | 350 |
| dnsMutationVbytes | 350 |
| dnsOwnerActionVbytes | 1000 |
| permissionActionsPerIdPerYear | 0.1 |
| permissionVbytes | 1200 |
| jobsPerIdPerYear | 0.1 |
| jobMailRecords | 4 |
| jobFiles | 1 |
| jobMetadataVbytes | 350 |
| publishArticlesPerIdPerYear | 1 |
| publishInlineBytes | 16000 |
| boostMediaPerIdPerYear | 0.5 |
| linkedPublicationShare | 0.01 |
| linkedBytes | 4000000 |

Rates are per projected ID per year before inherited lane elasticity. Fee-rate sensitivity uses 0.1 proof/vB in this scenario rather than the historical 0.00001. Mail allocations follow Boost originals, Code controls, Permission, Jobs controls, then Publish; Files allocate Code, Jobs delivery, Boost media, then other files. Shared allocations are capped by remaining carrier demand. Linked Publish delivery moves from Mail to Files with its same assumed payment once. Pages owns the existing HTML basket. DNS is an explicit additional registry/market workload. DNS subdomains/page links consume blockspace but owner self-payments do not add value.

At 96,000 bytes per part, 4 MB requires 42 parts, a linker and a paid delivery: 44 transactions. Only 43 are additional to the already-counted delivery. Parts/linker add bytes and writes, not a second file payment. The illustrative 1% large-content tail applies to general Files, Boost media and Publish, not Code/Jobs/HTML. Existing file reuse and reading do not republish bytes. All physical activity shares one annual cap. Higher payload demand can reduce other executed activity; it does not create free capacity.

## Horizon results

Counts are annual executed scenario rates at horizons measured from May 11, not cumulative counts or months from today. Values are display estimates; published numeric serialization is rounded to 12 significant digits.

| Horizon | Scenario total (proofs) | Transactions | DNS registrations | Permission | Jobs records | Articles | Linked publications | Capacity executed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 months | 416,561,329.87 | 38,954.03 | 76.9 | 43.25 | 197.3 | 432.46 | 8.95 | 100% |
| 12 months | 1,986,162,557.23 | 167,578.24 | 171.96 | 96.7 | 441.18 | 967.01 | 20 | 100% |
| 24 months | 12,120,315,809.2 | 964,868.72 | 429.9 | 241.75 | 1,102.96 | 2,417.53 | 50.01 | 100% |
| 5 years | 102,924,456,784 | 7,970,616.5 | 1,259.49 | 708.26 | 3,231.33 | 7,082.61 | 146.5 | 100% |
| 10 years | 1,591,670,793,420 | 99,003,912.27 | 3,904.25 | 2,195.52 | 10,016.71 | 21,955.2 | 454.13 | 76.18% |
| 25 years | 1,283,336,200,590,000 | 104,916,300.84 | 130.03 | 73.12 | 333.61 | 731.23 | 15.13 | 0.08% |
| 50 years | 110,977,597,933,000,000,000 | 105,119,305.95 | 0.44 | 0.25 | 1.14 | 2.49 | 0.05 | 0% |

## Scope and limits

- WORK revaluation, exact Q16 settlements, batch recipient distributions and endogenous feedback are not simulated.
- Linked-publication envelopes, size mix and all new usage rates are assumptions, not measured costs or wallet quotes.
- A model row does not enable capability, prove transaction admission or change any confirmed balance or record.
- Jobs offered rewards add nothing; accepted payment behavior is covered only by existing shared carrier assumptions.
- DNS owner self-payments and linked parts/linkers have no added scenario payment value. DNS trades appear only in AMO.
- Standalone social payment estimates use direct owner payments; historical Boost registry wording is not current policy.

The JSON contains complete inherited/new assumptions, 23 product allocations, baseline and rows, plus 0%, 1%, 10% and 100% large-content sensitivity cases. The shared pure model source is `src/features/growth/currentGrowthModel.mjs`; run `npm run model:growth:current` to reproduce both files.
