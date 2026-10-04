# Verification record

Verified release evidence: 2026-10-04. The public repository is [Masanori-Spec/reg-deck](https://github.com/Masanori-Spec/reg-deck). Functional commit `70ecb0e45dc6a1e46ae63c522e4ea5880444a813` passed [run 37172852245](https://github.com/Masanori-Spec/reg-deck/actions/runs/37172852245). Subsequent documentation/evidence commits are checked separately; the embedded evidence below identifies the exact functional source that generated it.

## Executed locally

- `npm run check`: passed
- JavaScript syntax checks: passed
- Node unit tests: **41/41 passed**
- Independent standalone Python tests: **39/39 passed**
- Deterministic JS/Python differential checks: **2,104 decoding vectors, 1,006 complete project reports, 21 strict import cases passed**
- Additional independent oracles: integer byte significance and an occupied-cell address/overlap model
- Exported verifier copy: **four CLI cases passed** (reference success, intentional address mismatch, incomplete coverage, invalid schema)
- Exported verifier bytes equal tested `python/verify.py`
- Source JSON/CSV roundtrip, preserved independent expectations, malformed/hostile input handling, generated HTML escaping and spreadsheet-safe text prefix: passed unit checks
- Maximum modeled data run: 256 fields, 64 cases, 65,536 raw words, 16,384 result rows; all asserted zero fixtures passed. Engine run was about 56 ms in Node24 on this build environment; this is a one-run observation, not a browser/performance guarantee
- Source and static bundles are generated with deterministic ZIP metadata and SHA-256 manifests

The Node and Python suites use synthetic data only. Randomized complete-project expectations are arbitrary independent numbers, not values copied from the decoder. Cross-implementation agreement does not prove an external map or human expectation is correct.

## Executed in hosted CI

All four Node 22/24 × Python 3.10/3.12 jobs passed the aggregate check, with the same engine counts listed above. `tests/browser/browser-test.mjs` passed all 15 sandboxed Chromium scenarios:

1. Japanese/English, keyboard skip link and roving tabs
2. Reference pass counts and visible intentional overlap
3. Address regression, preserved words/expectations and Undo
4. Interrupted field edits block export/navigation and preserve selected locale
5. Atomic invalid edits and explicit byte-order changes
6. Independently saved expected values and blank/unasserted state
7. Missing snapshot words versus zero; cancellation isolation
8. Atomic JSON errors, hostile labels, CSV and HTML escaping in downloads
9. CSV normalized-column checks and preserved expectations
10. Oversized, cancelled and superseded file reads
11. Download creation failure and deterministic repeated export
12. Downloaded Python verification against passing and failing fixtures
13. Loaded-app offline workflow, 390px mobile overflow checks and screenshots
14. Desktop screenshots, print PDF capture and reload behavior
15. No external runtime requests or browser exceptions

The runner uses `chromiumSandbox:true` and serves the app under `/reg-deck/` to exercise non-root deployment. The GitHub Actions definition targets Ubuntu22.04 and does not disable sandboxing or alter security settings. Its engine matrix covers Node22/24 and Python3.10/3.12. The run succeeded with all five jobs. [Machine-readable evidence](evidence/hosted-ci.json) records the commit, jobs and artifact digest.

Actual EN/JA desktop rendering, the three Japanese mobile tabs, downloaded HTML, one-page UI print and two-page downloaded-report print were visually inspected. Downloaded JSON/CSV content and verifier bytes were checked; the actual downloaded Python file exits 0 for the passing fixture and 1 for the intentional mismatch. Screenshots and actual downloads are retained in [evidence/browser](evidence/browser/). Safari/Firefox, a full accessibility audit, deployed-public-host behavior and live devices remain unverified. Hosted tests serve the static build on loopback under `/reg-deck/`; this does not claim a public web deployment. The page renders the first 200 review rows with an explicit truncation notice; machine/report exports contain all results.

## Interpretation limits

These are synthetic software checks. A matching fixture does not establish device conformance, live measurement, safe operation, market validation or novelty. The independently implemented Python verifier and differential comparisons do not replace a completed independent review. Re-run affected checks after edits and verify the exact remote commit before relying on a CI result.

## Received review findings and repairs

Four already-received functional findings were corrected, with regression tests:

- Sparse or inherited array entries could bypass word validation. Both schema validation and direct decoding now require dense own word elements
- File.text() could silently replace malformed UTF-8. File imports now decode arrayBuffer bytes with a bounded fatal UTF-8 decoder, before atomic application
- Joined CSV header comparison could accept merged header cells. Import now requires exact header length and exact cells for either documented header variant
- Build rewriting missed double-quoted parent-relative imports after formatting. Both quote styles are rewritten; emitted modules are checked against root and nested deployment URLs

Independent review was interrupted and was not resumed. The received findings are repaired, but a full independent review is not claimed. Subsequent ordinary release and functional checks do not complete or resume that independent review.

## Release preparation

A clean `npm ci --ignore-scripts` initially failed because the optional fsevents lock entry lacked version metadata. The lockfile was regenerated from the official npm registry without changing the pinned Playwright 1.56.0 versions. Clean installation then passed. This is an ordinary release check and does not complete or resume the interrupted independent review.

## Release fixes verified in CI

- The mobile one-column grid previously inherited the wide table minimum. `minmax(0, 1fr)` now keeps tables inside their horizontal scrollers; all three 390px tabs pass the no-page-overflow assertion
- Printed pages now have 12mm A4 margins and headings stay with their content. Print-specific type and cell spacing keep the reference exported report on two balanced pages
- Actual CSV/HTML/JSON/Python downloads, screenshots and print PDFs are captured as CI evidence. The visual record documents which outputs were inspected
