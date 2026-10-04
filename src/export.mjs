import { validate, run, address, width, FIELD_KEYS, LIMITS } from "./core.mjs";
const textual = new Set([
  "id",
  "label",
  "space",
  "convention",
  "type",
  "order",
  "unit",
  "note",
]);
function safeText(s) {
  return /^(?:'|\s*[=+\-@])/.test(s) ? "'" + s : s;
}
function cell(s) {
  return '"' + String(s).replaceAll('"', '""') + '"';
}
export function mapCSV(p) {
  validate(p);
  return (
    [...FIELD_KEYS, "pdu_start", "pdu_end"].join(",") +
    "\r\n" +
    p.fields
      .map((f) =>
        [
          ...FIELD_KEYS.map((k) =>
            cell(textual.has(k) ? safeText(String(f[k])) : f[k]),
          ),
          cell(address(f)),
          cell(address(f) + width(f) - 1),
        ].join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
export function parseMapCSV(source, p) {
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).length > LIMITS.bytes
  )
    throw Error("CSV exceeds 2 MiB");
  let rows = [],
    row = [],
    field = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < source.length; i++) {
    let c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === '"') {
      if (field || closed) throw Error("Malformed CSV quotes");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && source[i + 1] === "\n") i++;
        rows.push(row);
        row = [];
        if (rows.length > 257) throw Error("CSV: max 256 fields");
      }
    } else {
      if (closed) throw Error("Unexpected text after CSV quote");
      field += c;
    }
    if (field.length > 4000) throw Error("CSV cell too long");
  }
  if (quoted) throw Error("Unterminated CSV quote");
  if (field || row.length || closed) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length && rows.at(-1).length === 1 && rows.at(-1)[0] === "")
    rows.pop();
  let headers = rows.shift();
  if (
    !headers ||
    ![FIELD_KEYS, [...FIELD_KEYS, "pdu_start", "pdu_end"]].some(
      (allowed) =>
        headers.length === allowed.length &&
        allowed.every((key, index) => headers[index] === key),
    )
  )
    throw Error(
      "CSV header must match documented 11 columns, optionally followed by pdu_start,pdu_end",
    );
  let fields = rows.map((r, i) => {
    if (r.length !== headers.length)
      throw Error(`CSV row ${i + 2}: wrong column count`);
    let f = {};
    FIELD_KEYS.forEach((k, j) => {
      let v = r[j];
      if (textual.has(k) && /^'(?:'|\s*[=+\-@])/.test(v)) v = v.slice(1);
      if (k === "address") {
        if (!/^\d+$(?![\s\S])/.test(v))
          throw Error(`CSV row ${i + 2}: decimal integer address required`);
        v = Number(v);
      }
      f[k] = v;
    });
    if (
      headers.length === 13 &&
      (r[11] !== String(address(f)) ||
        r[12] !== String(address(f) + width(f) - 1))
    )
      throw Error(
        `CSV row ${i + 2}: normalized PDU columns do not match the source address`,
      );
    return f;
  });
  return validate({ ...p, fields });
}
export function escapeHTML(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function reportHTML(p) {
  let report = run(p),
    h = escapeHTML;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>RegDeck · ${h(p.name)}</title><style>body{font:15px system-ui;line-height:1.6;max-width:1100px;margin:40px auto;padding:0 20px;color:#163b36}h1{font-size:36px}table{border-collapse:collapse;width:100%;margin:20px 0;font-size:12px;table-layout:fixed}td,th{border:1px solid #a9c2b9;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#eaf1eb}code{overflow-wrap:anywhere}small{color:#526c64}.warn{padding:16px;background:#fff3d2}@page{size:A4;margin:12mm}@media print{body{margin:0;padding:0;font-size:10pt;line-height:1.45}h1{font-size:28px}table{font-size:11px}td,th{padding:6px}tr{break-inside:avoid}h2,h3{break-after:avoid}h3+p{break-after:avoid}}</style><body><small>REGDECK / OFFLINE DECODING CONTRACT · regdeck/v1</small><h1>${h(p.name)}</h1><p><strong>${report.ok ? "All recorded assertions passed" : "Review required"}</strong> · ${h(JSON.stringify(report.counts))}</p><p class="warn">Synthetic/manual expectations are independent of this decoder. Passing assertions do not establish device conformance or safe equipment operation. No hardware connection, network access, register writes or certification. Missing and unasserted fields are incomplete coverage. Float32 uses exact binary values; integer scaling uses exact decimal arithmetic.</p><h2>Address and interpretation contract</h2><table><thead><tr><th>Field / source note</th><th>Space / source address</th><th>PDU range</th><th>Type / order</th><th>Scale / offset / unit</th></tr></thead><tbody>${p.fields.map((f) => `<tr><td>${h(f.id)} · ${h(f.label)}<br><small>${h(f.note)}</small></td><td>${h(f.space)} / ${h(f.address)} (${h(f.convention)})</td><td>${address(f)}–${address(f) + width(f) - 1}</td><td>${h(f.type)} / ${h(f.order)}</td><td>${h(f.scale)} / ${h(f.offset)} / ${h(f.unit)}</td></tr>`).join("")}</tbody></table><h2>Overlap review</h2><p>${report.warnings.length ? report.warnings.map((w) => `${h(w.space)} PDU ${w.address}: ${w.fieldIds.map(h).join(", ")}`).join("<br>") : "No same-space overlaps in this map."}</p><p>Aliases remain visible. An overlap is not automatically invalid; consult the source map.</p><h2>Recorded snapshots and independent expectations</h2>${p.cases.map((c) => `<h3>${h(c.name)} (${h(c.id)})</h3><p>${h(c.space)} · start PDU ${c.start} · ${c.words.length} words</p><code>${c.words.map((w) => w.toString(16).padStart(4, "0").toUpperCase()).join(" ")}</code>`).join("")}<table><thead><tr><th>Case / field</th><th>Status</th><th>Raw / canonical bits</th><th>Actual engineering value</th><th>Independent expected / absolute tolerance</th></tr></thead><tbody>${report.results.map((r) => `<tr><td>${h(r.caseId ?? "No case")} / ${h(r.fieldId)}</td><td>${h(r.status)}</td><td>${h(r.raw ?? "—")}<br>${h(r.bits ?? "—")}</td><td>${h(r.value ?? "—")}</td><td>${h(r.expected ?? "unasserted")} / ${h(r.tolerance ?? "—")}</td></tr>`).join("")}</tbody></table><h2>Address conventions</h2><p>PDU: 0–65535. One-based: 1–65536, subtract 1. Five-digit references: holding 40001–49999, input 30001–39999; subtract 40001 / 30001. Reference notation is a selected convention, never inferred. Snapshot starts are always PDU addresses.</p><h2>Byte order</h2><p>Each recorded word is stored high byte first. For canonical bytes A B C D, map order describes the incoming bytes: ABCD, CDAB, BADC or DCBA. For 16-bit values, AB or BA. Float NaN payloads are preserved in canonical bits; assertions compare NaN category, not payload.</p><small>RegDeck is a bounded software portfolio utility. Review with vendor documentation and independent reference readings. The report is static, carries no executable user content, and makes no novelty claim.</small></body></html>`;
}
