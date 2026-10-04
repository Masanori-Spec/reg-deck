# Usefulness and existing tools

Research checked 2026-10-04. These are primary product/project pages and the protocol documentation, not an exhaustive market or patent search. The comparison describes reviewed documentation, not independently exercised competitor behavior.

## Useful job

A developer integrating a documented register map can confuse source address notation, word order or signed/scaled interpretation. A plausible decoded number alone does not establish the interpretation. RegDeck keeps a recorded snapshot and a independently known expectation separate from the map, so later map edits encounter the same regression assertions.

The concrete artifact is a small folder containing project JSON, a standard-library-only Python verifier, and a printable review report. It can be code-reviewed or run without access to the source device.

## Existing coverage

- **IoT 01 Modbus Register Converter:** local conversion of one two-register value into unsigned/signed32 and float32; ABCD/CDAB, JSON/CSV/Markdown exports. Its page explicitly excludes address resolution, scaling and mixed byte permutations. RegDeck extends the workflow to whole maps, address spans and persistent independent assertions. Local processing and export alone are not differentiators. [Official tool page](https://iot01.com/tools/modbus-register-converter/)
- **ModbusViewer:** a cross-platform TCP/RTU master with CSV/JSON tag maps, live polling, address conventions and per-register byte order/scale/offset/unit formatting. Map import and editable decoding already exist. RegDeck's narrower focus is a static offline fixture/review artifact, rather than a live device-client session. [Official project README](https://github.com/projnikdroid/ModbusViewer)
- **TamidaS Modbus Simulator:** TCP/RTU slave simulation, spreadsheet maps, multiple data widths, byte orders and changing values. Testing without physical equipment already exists. RegDeck does not simulate a server; it asserts recorded word interpretation against independently entered expectations. [Official product page](https://www.tamidas.com/modbus-simulator)

The reviewed pages do not establish the exact combined browser-to-standalone-regression workflow used here. That observation is not proof of uniqueness. RegDeck makes no novelty, invention, patentability or exclusive-market claim.

## Technical grounding

The [Modbus Application Protocol V1.1b3](https://www.modbus.org/file/secure/modbusprotocolspecification.pdf), sections 4.2–4.4, defines big-endian bytes for data items, 16-bit register objects, zero-based PDU indices and device-specific application mapping. The separate input and holding spaces and explicit address normalizer follow those bounded concepts. The document does not give a universal encoding for every multi-register vendor value; the user selects the appropriate byte/word convention.

[Python struct documentation](https://docs.python.org/3/library/struct.html) specifies standard sizes and IEEE-754 binary32 for the `f` format. It provides an implementation-independent check against RegDeck's direct JavaScript bit/rational decoder.

## Portfolio / commercialization hypothesis

Potential users: embedded/IoT developers, test engineers and integrators who already have a map and recorded words. The hypothesis is that preserving independently justified assertions reduces repeated decoding regressions during map changes. No customers were contacted and no market demand, time savings or willingness to pay have been validated. A future validation step could ask authorized testers to reproduce a known map regression and assess the exported artifact; that is not performed by this release.
