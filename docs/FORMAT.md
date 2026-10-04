# RegDeck v1 data contract

## Project JSON

All keys are required and unknown keys are rejected. Word arrays must contain dense own elements; sparse arrays are rejected before decoding. Browser file imports use fatal UTF-8 decoding and never silently replace malformed bytes. JSON duplicate keys are rejected, as are invalid UTF-8, unsupported schema, nesting beyond 12 and imported bytes over 2 MiB. Numerical JSON positions must be integer literals, not `1.0` or `1e0`; scale, offset and expected/tolerance are decimal strings.

```json
{
  "schema": "regdeck/v1",
  "name": "Recorded bench",
  "fields": [
    {
      "id": "temperature",
      "label": "Return temperature",
      "space": "holding",
      "address": 40001,
      "convention": "reference",
      "type": "int16",
      "order": "AB",
      "scale": "0.1",
      "offset": "0",
      "unit": "°C",
      "note": "Independent reference reading"
    }
  ],
  "cases": [
    {
      "id": "steady",
      "name": "Steady reference",
      "space": "holding",
      "start": 0,
      "words": [65511],
      "expected": { "temperature": { "value": "-2.5", "tolerance": "0" } }
    }
  ]
}
```

The browser and Python reject semantic data that would exceed 2 MiB in compact UTF-8 JSON. The browser exports pretty JSON if it fits, otherwise compact JSON; exports remain importable under the same limit. Key order is not significant. Project/case IDs stay stable; UI-generated IDs can be replaced by editing the JSON before import, with all expectations updated deliberately.

## Address contract

| Convention         | Accepted source start | Normalized PDU |
| ------------------ | --------------------- | -------------- |
| pdu                | 0…65535               | unchanged      |
| one                | 1…65536               | source − 1     |
| reference, holding | 40001…49999           | source − 40001 |
| reference, input   | 30001…39999           | source − 30001 |

A 32-bit field consumes two consecutive words; its full PDU span must stay within 0…65535. Five-digit reference validation applies to the supplied start: a two-word field starting at reference 49999 is accepted as PDU 9998–9999. Reference modes deliberately exclude six-digit extensions. Snapshot `start` is always PDU. Holding and input are separate spaces even when their numeric addresses match.

Overlap warnings enumerate each occupied cell with multiple fields. Aliases are allowed, and their `note` can record intent, but the warning never disappears automatically.

## Bytes and values

The snapshot contains unsigned words 0…65535. Each word first yields a high byte and low byte. Order describes how canonical bytes appear in that incoming sequence:

| Type   | Order   | Incoming representation of canonical A B C D |
| ------ | ------- | -------------------------------------------- |
| 16-bit | AB / BA | A B / B A                                    |
| 32-bit | ABCD    | A B C D                                      |
| 32-bit | CDAB    | C D A B                                      |
| 32-bit | BADC    | B A D C                                      |
| 32-bit | DCBA    | D C B A                                      |

For canonical 41480000 (12.5 binary32), snapshots are 4148 0000, 0000 4148, 4841 0000 or 0000 4841 respectively. The four permutations are self-inverse. `bits` is uppercase canonical hex without 0x, preserving NaN payloads and zero sign. Raw snapshot words are never rewritten.

Integer decoding uses two's-complement signedness. Engineering value = raw × decimal scale + decimal offset, calculated exactly with BigInt rational arithmetic in JavaScript and Decimal in Python. Integer zero is normalized to 0; negative-zero expectations compare numerically for integers.

Float32 has scale=1 and offset=0 (numerically equivalent decimal strings are accepted). JavaScript reconstructs the binary32 rational directly from sign/exponent/mantissa; Python uses `struct.unpack('>f', bytes)` and `Decimal.from_float`. The displayed result is the exact decimal expansion of the binary value, not a rounded engineering decimal. For example, nominal 0.1 binary32 is 0.100000001490116119384765625. An expected `0.1` requires a suitable explicit absolute tolerance; tolerance zero intentionally fails.

For finite values, comparison is `abs(actual - expected) <= tolerance`, using exact arithmetic. Float zero sign is compared whenever actual and expected are zero, even if tolerance is positive. `-0` and `-0.0` assert negative zero. Special strings `NaN`, `Infinity`, `-Infinity` are float-only and require tolerance zero. NaN comparisons match category, not payload; inspect bits for payload equality. All finite expected and tolerance inputs use ordinary decimal text up to 40 characters and 18 fractional places. This intentionally limits very small subnormal reference assertions; their exact actual values/bits remain visible, and zero with a nonzero tolerance may be used deliberately. There is no raw-bit assertion mode in v1.

## Coverage and independent expectations

Each case evaluates every field in the same space. Missing span → missing. Present words without an expectation → unasserted. Present words with an expectation → pass or mismatch. Fields never visited by a same-space case produce a null-case unasserted row. No cases/fields never pass vacuously. All incomplete/mismatching results produce Python exit 1. Invalid input produces exit 2; all passing results produce exit 0. Overlap warnings do not change exit status.

Changing a map never updates any expectation. Changing space/type may be rejected if saved expectations become incompatible. Clearing those expectations must be deliberate. The interface blocks deleting an asserted field; clear its expectations first. CSV map replacement preserves all cases and fails atomically if it would orphan or cross-space an expectation.

## Map CSV

The required 11 source columns, in order:

`id,label,space,address,convention,type,order,scale,offset,unit,note`

Exports add `pdu_start,pdu_end`, giving 13 columns. Import accepts either exact header. When normalized columns are present, their values must exactly match the normalized source address and span. CSV follows quoted-cell/doubled-quote rules; LF and CRLF records are accepted; a quoted note may contain LF. Unexpected columns, ragged rows, malformed quotes, out-of-range values and unsupported rows fail the whole import.

Textual CSV columns that start with apostrophe, or whitespace followed by `=`, `+`, `-` or `@`, are prefixed by an apostrophe to limit spreadsheet formula interpretation. The importer reverses that documented prefix. Numeric scale/offset columns remain strict validated decimal strings, never expressions. This is RegDeck's round-trip convention; a foreign CSV's initial apostrophe may have special meaning under it. Review external CSV before importing.

## Reports and verifier

The HTML report is escaped, static and printable. It contains all map assumptions, overlaps, snapshots and expectation results. It has no script, external asset or executable user string. The report's content is English even when exported from the Japanese interface.

The verifier is a constant source file, not generated code interpolating any user field. Downloaded JSON remains data. It needs only Python's standard library and performs no network or device operations. `--json` prints `regdeck-report/v1` with result counts, warnings and exact value/bit data.
