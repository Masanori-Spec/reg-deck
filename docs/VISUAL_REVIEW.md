# Visual and download inspection

Inspected on 2026-10-04 using actual artifacts from [GitHub Actions run 37172852245](https://github.com/Masanori-Spec/reg-deck/actions/runs/37172852245), functional commit `70ecb0e45dc6a1e46ae63c522e4ea5880444a813`. Chromium ran with its sandbox enabled. This was release UI/print QA; the previously interrupted independent review remains incomplete.

## Screens inspected

- [English desktop map](evidence/browser/desktop-map-en.png) and [Japanese desktop map](evidence/browser/desktop-map-ja.png): readable two-column map/editor layout, visible address overlap, complete form controls and keyboard focus indicator
- [English desktop review](evidence/browser/desktop-review-en.png): all export choices, five passing assertions, distinct actual/expected columns and interpretation caveat
- [Japanese mobile map](evidence/browser/mobile-map-ja.png), [mobile records](evidence/browser/mobile-cases-ja.png) and [mobile review](evidence/browser/mobile-review-ja.png), at 390 × 844: stacked panels, visible controls and no page-level horizontal overflow. Wide tables deliberately scroll within their own containers
- [Downloaded HTML report](evidence/browser/downloaded-report.png): complete map, overlap notes, recorded words, actual and independent expected values, and scope limitations

All seven screenshots were inspected. Images unchanged across functional reruns were also compared byte-for-byte with the inspected images. The synthetic sample names stay in English when interface labels switch to Japanese. These are fictional reference data, not device or customer measurements.

## Print inspected

- [UI review PDF](evidence/browser/print-review.pdf): one A4 page with 12mm margins, complete five-row review table and caveat
- [Downloaded report PDF](evidence/browser/downloaded-report.pdf): two A4 pages, both rendered to PNG and visually inspected. The map and overlap review occupy the first page; snapshots, assertions and interpretation notes occupy the second. No clipped text or orphaned headings were found in this reference output

An earlier print capture exposed missing margins and an orphaned heading. After margins were added, spacing was refined to remove a nearly empty third page. The linked PDFs are the corrected output. Arbitrary user data and maximum-sized report pagination are not visually certified.

## Actual downloaded files checked

[Project JSON](evidence/browser/regdeck-project.json), [map CSV](evidence/browser/regdeck-map.csv), [report HTML](evidence/browser/regdeck-report.html) and [standalone verifier](evidence/browser/verify.py) came from real browser download actions. The CSV has five fields and the documented normalized PDU columns. The downloaded verifier bytes match `python/verify.py`; it returns 0 for the reference fixture and 1 for the retained [intentional mismatch](evidence/browser/regdeck-failing.json). Repeated JSON export is deterministic in the browser scenario.

[All 15 browser results](evidence/browser/results.json) and [CI provenance](evidence/hosted-ci.json) are retained. This does not establish Safari/Firefox compatibility, a complete accessibility audit, a public web deployment, live-device correctness or the correctness of a user's reference expectations.
