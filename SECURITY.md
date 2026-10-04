# Security and scope

RegDeck has no runtime external packages, device APIs, network requests, telemetry, remote fonts or automatic persistence. Its content-security policy restricts code/assets to the same origin and denies connections, objects and form submission. Downloaded reports are escaped, script-free and deny all external content.

Imported data is bounded and validated before atomically replacing a project. Unknown keys, duplicate JSON keys, malformed CSV, incompatible references, invalid byte orders and over-limit values are errors. User strings are rendered with textContent; exports escape HTML and apply a documented CSV text prefix. The verifier is fixed source and never interpolates user strings into executable code. No eval, Function constructor, shell command generation or formulas are accepted.

Session undo retains up to20 prior project states in memory. Reloading resets the session; data is not automatically stored. Save deliberate exports locally. Treat register maps and snapshots as potentially confidential; do not commit real industrial/customer data to a public repository. The included examples are synthetic.

No protocol packets, safety logic, live observations or operational authorization are tested. Passing fixtures cannot be relied upon to commission or control equipment. Preserve independent expected values and consult authoritative device documentation.

Development browser tests require Chromium's sandbox. They do not disable the sandbox, change host security settings, access a local user browser, or bypass denied browser routes. The repository's CI needs no credentials beyond read-only checkout and normal artifact upload.
