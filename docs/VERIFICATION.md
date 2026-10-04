# Verification record

Repaired review freeze: 2026-10-04. No remote publication or shared-browser use has been performed by this build task.

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

## Authored, NOT executed at this freeze

`tests/browser/browser-test.mjs` contains 15 sandboxed Chromium scenarios:

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

The runner uses `chromiumSandbox:true` and serves the app under `/reg-deck/` to exercise non-root deployment. The GitHub Actions definition targets Ubuntu22.04 and does not disable sandboxing or alter security settings. Its engine matrix covers Node22/24 and Python3.10/3.12. **No CI run is claimed yet.**

Consequently: actual desktop/mobile rendering, focus behavior in a browser, downloaded-file behavior, print pagination, Safari/Firefox behavior and deployed-host behavior remain unverified. Authored browser assertions and screenshot code are not substitutes for executing them and inspecting the resulting pixels. The page renders the first200 review rows with an explicit truncation notice; machine/report exports contain all results.

## Review handoff

Inspect the bounded numerical scope, strict validation and preserved-expectation contract first. Then run the designated sandboxed CI/browser route, inspect both locales on desktop and390px mobile, inspect print output, and verify the expected commit and static host only when publication is separately authorized. Re-run affected checks after any edits. Avoid presenting a matching fixture as device conformance, live measurement, safety approval, market validation or novelty.

## Received review findings and repairs

Four already-received functional findings were corrected, with regression tests:

- Sparse or inherited array entries could bypass word validation. Both schema validation and direct decoding now require dense own word elements
- File.text() could silently replace malformed UTF-8. File imports now decode arrayBuffer bytes with a bounded fatal UTF-8 decoder, before atomic application
- Joined CSV header comparison could accept merged header cells. Import now requires exact header length and exact cells for either documented header variant
- Build rewriting missed double-quoted parent-relative imports after formatting. Both quote styles are rewritten; emitted modules are checked against root and nested deployment URLs

Independent review was interrupted and was not resumed. The received findings are repaired, but a full independent review is not claimed. Browser and visual checks remain unexecuted.

## Release preparation

A clean `npm ci --ignore-scripts` initially failed because the optional fsevents lock entry lacked version metadata. The lockfile was regenerated from the official npm registry without changing the pinned Playwright 1.56.0 versions. Clean installation then passed. This is an ordinary release check and does not complete or resume the interrupted independent review.
