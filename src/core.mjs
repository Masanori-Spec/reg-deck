export const LIMITS = Object.freeze({
  bytes: 2097152,
  fields: 256,
  cases: 64,
  words: 4096,
  totalWords: 65536,
});
export const TYPES = ["uint16", "int16", "uint32", "int32", "float32"];
export const FIELD_KEYS = [
  "id",
  "label",
  "space",
  "address",
  "convention",
  "type",
  "order",
  "scale",
  "offset",
  "unit",
  "note",
];
export const ORDERS = Object.freeze({
  AB: [0, 1],
  BA: [1, 0],
  ABCD: [0, 1, 2, 3],
  CDAB: [2, 3, 0, 1],
  BADC: [1, 0, 3, 2],
  DCBA: [3, 2, 1, 0],
});
const fail = (m) => {
  throw new Error(m);
};
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function keys(v, required, path) {
  if (!obj(v)) fail(`${path}: object required`);
  if (
    Object.keys(v).length !== required.length ||
    required.some((k) => !Object.hasOwn(v, k))
  )
    fail(`${path}: expected keys ${required.join(", ")}`);
}
function text(v, max, path, multiline = false) {
  if (
    typeof v !== "string" ||
    Array.from(v).length > max ||
    /[\uD800-\uDFFF]/u.test(v) ||
    /\p{Cc}/u.test(multiline ? v.replace(/[\n\t]/g, "") : v)
  )
    fail(`${path}: text up to ${max} characters, without control characters`);
}
function id(v, path) {
  if (
    typeof v !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,39}$(?![\s\S])/.test(v)
  )
    fail(
      `${path}: ID must begin with a letter, then letters, digits, _ or - (max 40)`,
    );
}
function integer(v, min, max, path) {
  if (!Number.isSafeInteger(v) || v < min || v > max)
    fail(`${path}: integer ${min}..${max} required`);
}
export function decimal(s) {
  if (
    typeof s !== "string" ||
    s.length > 40 ||
    !/^[+-]?\d+(?:\.\d{1,18})?$(?![\s\S])/.test(s)
  )
    fail(
      "Decimal: use plain decimal text, max 40 characters and 18 fractional digits",
    );
  let sign = s[0] === "-" ? -1n : 1n,
    safe = s.replace(/^[+-]/, "");
  let [a, b = ""] = safe.split(".");
  return {
    n: sign * BigInt(a + b),
    d: 10n ** BigInt(b.length),
    negative: sign < 0n,
  };
}
function equalDecimal(a, b) {
  return a.n * b.d === b.n * a.d;
}
function decimalString(n, d) {
  if (n === 0n) return "0";
  let neg = n < 0n;
  n = neg ? -n : n;
  let whole = n / d,
    r = n % d;
  if (!r) return `${neg ? "-" : ""}${whole}`;
  let fraction = "";
  while (r) {
    r *= 10n;
    fraction += r / d;
    r %= d;
    if (fraction.length > 200) fail("Internal decimal expansion limit");
  }
  return `${neg ? "-" : ""}${whole}.${fraction}`;
}
export function width(field) {
  return field.type.endsWith("16") ? 1 : 2;
}
export function address(field) {
  let a = field.address;
  if (field.convention === "one") a -= 1;
  else if (field.convention === "reference")
    a -= field.space === "holding" ? 40001 : 30001;
  return a;
}
export function validate(p) {
  keys(p, ["schema", "name", "fields", "cases"], "project");
  if (p.schema !== "regdeck/v1") fail("Unsupported project schema");
  text(p.name, 120, "name");
  if (!p.name.trim()) fail("name: nonempty text required");
  if (!Array.isArray(p.fields) || p.fields.length > LIMITS.fields)
    fail("fields: max 256");
  if (!Array.isArray(p.cases) || p.cases.length > LIMITS.cases)
    fail("cases: max 64");
  let ids = new Map();
  for (const f of p.fields) {
    keys(f, FIELD_KEYS, "field");
    id(f.id, "field.id");
    if (ids.has(f.id)) fail(`Duplicate field ID: ${f.id}`);
    ids.set(f.id, f);
    text(f.label, 120, "label");
    if (!f.label.trim()) fail("label: nonempty text required");
    text(f.unit, 40, "unit");
    text(f.note, 1000, "note", true);
    if (!["holding", "input"].includes(f.space))
      fail("space: holding or input");
    if (!["pdu", "one", "reference"].includes(f.convention))
      fail("convention: pdu, one or reference");
    if (!TYPES.includes(f.type)) fail("Unsupported field type");
    let min =
        f.convention === "pdu"
          ? 0
          : f.convention === "one"
            ? 1
            : f.space === "holding"
              ? 40001
              : 30001,
      max =
        f.convention === "pdu"
          ? 65535
          : f.convention === "one"
            ? 65536
            : f.space === "holding"
              ? 49999
              : 39999;
    integer(f.address, min, max, "address");
    if (address(f) + width(f) > 65536)
      fail(`Field ${f.id}: span exceeds PDU 65535`);
    if (
      !(
        width(f) === 1 ? ["AB", "BA"] : ["ABCD", "CDAB", "BADC", "DCBA"]
      ).includes(f.order)
    )
      fail(`Field ${f.id}: explicit ${width(f) * 16}-bit byte order required`);
    let scale = decimal(f.scale),
      offset = decimal(f.offset);
    if (
      f.type === "float32" &&
      (!equalDecimal(scale, { n: 1n, d: 1n }) || offset.n !== 0n)
    )
      fail("float32: scale must be 1 and offset 0; compare raw binary32 value");
  }
  let caseIds = new Set(),
    total = 0;
  for (const c of p.cases) {
    keys(c, ["id", "name", "space", "start", "words", "expected"], "case");
    id(c.id, "case.id");
    if (caseIds.has(c.id)) fail(`Duplicate case ID: ${c.id}`);
    caseIds.add(c.id);
    text(c.name, 120, "case.name");
    if (!c.name.trim()) fail("case.name: nonempty text required");
    if (!["holding", "input"].includes(c.space))
      fail("case.space: holding or input");
    integer(c.start, 0, 65535, "case.start");
    if (
      !Array.isArray(c.words) ||
      c.words.length > LIMITS.words ||
      c.start + c.words.length > 65536
    )
      fail("case.words: max 4096, within PDU space");
    validateWords(c.words);
    total += c.words.length;
    if (total > LIMITS.totalWords) fail("Total snapshot words: max 65536");
    if (!obj(c.expected)) fail("expected: object required");
    for (const [fid, e] of Object.entries(c.expected)) {
      const f = ids.get(fid);
      if (!f || f.space !== c.space)
        fail(`Expectation ${fid}: unknown field or different space`);
      keys(e, ["value", "tolerance"], `expectation ${fid}`);
      const tolerance = decimal(e.tolerance);
      if (tolerance.n < 0n) fail("Tolerance cannot be negative");
      if (["NaN", "Infinity", "-Infinity"].includes(e.value)) {
        if (f.type !== "float32" || tolerance.n !== 0n)
          fail("Special expectations: float32 only, tolerance zero");
      } else decimal(e.value);
    }
  }
  if (new TextEncoder().encode(JSON.stringify(p)).length > LIMITS.bytes)
    fail("Project exceeds 2 MiB compact data limit");
  return p;
}
// File imports must reject malformed UTF-8, never substitute U+FFFD silently.
export function decodeUTF8(bytes) {
  if (!(bytes instanceof Uint8Array)) fail("UTF-8 input must be a byte array");
  if (bytes.byteLength > LIMITS.bytes) fail("File exceeds 2 MiB");
  try {
    // Preserve BOM so the strict JSON reader can reject it consistently with Python.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    fail("Invalid UTF-8 file");
  }
}
function validateWords(words) {
  if (!Array.isArray(words)) fail("Words must be an array");
  for (let index = 0; index < words.length; index++) {
    if (!Object.hasOwn(words, index))
      fail("Words must be a dense array of own elements");
    integer(words[index], 0, 65535, "word");
  }
}
// Small strict JSON reader: native JSON semantics, duplicate keys rejected, bounded nesting.
export function parseProject(source) {
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).length > LIMITS.bytes
  )
    fail("Project exceeds 2 MiB");
  let i = 0;
  function ws() {
    while (/[ \r\n\t]/.test(source[i] ?? "!")) i++;
  }
  function string() {
    let start = i++;
    while (i < source.length) {
      if (source[i] === '"') {
        i++;
        return JSON.parse(source.slice(start, i));
      }
      if (source[i] === "\\") i++;
      i++;
    }
    fail("Unterminated JSON string");
  }
  function value(depth) {
    if (depth > 12) fail("JSON nesting exceeds 12");
    ws();
    let c = source[i];
    if (c === '"') return string();
    if (c === "{") {
      i++;
      let out = Object.create(null);
      ws();
      if (source[i] === "}") {
        i++;
        return out;
      }
      while (true) {
        ws();
        if (source[i] !== '"') fail("JSON object key required");
        let k = string();
        if (Object.hasOwn(out, k)) fail(`Duplicate JSON key: ${k}`);
        ws();
        if (source[i++] !== ":") fail("JSON colon required");
        out[k] = value(depth + 1);
        ws();
        let end = source[i++];
        if (end === "}") return out;
        if (end !== ",") fail("JSON object delimiter required");
      }
    }
    if (c === "[") {
      i++;
      let out = [];
      ws();
      if (source[i] === "]") {
        i++;
        return out;
      }
      while (true) {
        if (out.length > 65536) fail("JSON array limit");
        out.push(value(depth + 1));
        ws();
        let end = source[i++];
        if (end === "]") return out;
        if (end !== ",") fail("JSON array delimiter required");
      }
    }
    let m =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        source.slice(i),
      );
    if (!m) fail("Invalid JSON value");
    if (/[.eE]/.test(m[0]) && !["true", "false", "null"].includes(m[0]))
      fail("JSON numbers must use integer literals");
    i += m[0].length;
    return JSON.parse(m[0]);
  }
  let p = value(0);
  ws();
  if (i !== source.length) fail("Unexpected JSON suffix");
  return validate(p);
}
export function serializeProject(p) {
  validate(p);
  const pretty = JSON.stringify(p, null, 2);
  return new TextEncoder().encode(pretty).length <= LIMITS.bytes
    ? pretty
    : JSON.stringify(p);
}
export function decode(f, words) {
  validateWords(words);
  if (words.length !== width(f)) fail("Exact field word count required");
  let bytes = words.flatMap((w) => [w >> 8, w & 255]),
    ordered = ORDERS[f.order].map((i) => bytes[i]);
  let bits = ordered
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase(),
    n = BigInt("0x" + bits),
    raw,
    value;
  if (f.type === "float32") {
    let sign = n >> 31n ? -1n : 1n,
      exp = Number((n >> 23n) & 255n),
      mant = n & 0x7fffffn;
    if (exp === 255) {
      raw = mant ? "NaN" : sign < 0n ? "-Infinity" : "Infinity";
    } else if (exp === 0 && mant === 0n) {
      raw = sign < 0n ? "-0" : "0";
    } else {
      let sig = exp === 0 ? mant : mant + (1n << 23n),
        power = exp === 0 ? -149 : exp - 150;
      raw =
        power >= 0
          ? String(sign * sig * 2n ** BigInt(power))
          : decimalString(sign * sig, 2n ** BigInt(-power));
    }
    value = raw;
  } else {
    let size = BigInt(width(f) * 16);
    if (f.type.startsWith("int") && n >= 1n << (size - 1n)) n -= 1n << size;
    raw = String(n);
    let s = decimal(f.scale),
      o = decimal(f.offset);
    value = decimalString(n * s.n * o.d + o.n * s.d, s.d * o.d);
  }
  return { raw, value, bits, words: [...words] };
}
// Decode float actual may have more fractional digits than accepted human input.
function exactActual(s) {
  let negative = s.startsWith("-"),
    [a, b = ""] = s.replace("-", "").split(".");
  return {
    n: (negative ? -1n : 1n) * BigInt(a + b),
    d: 10n ** BigInt(b.length),
    negative,
  };
}
export function matches(f, actual, expected) {
  if (
    ["NaN", "Infinity", "-Infinity"].includes(actual) ||
    ["NaN", "Infinity", "-Infinity"].includes(expected.value)
  )
    return actual === expected.value;
  let a = exactActual(actual),
    e = decimal(expected.value),
    t = decimal(expected.tolerance);
  if (
    f.type === "float32" &&
    a.n === 0n &&
    e.n === 0n &&
    a.negative !== e.negative
  )
    return false;
  let diff = a.n * e.d - e.n * a.d;
  return (diff < 0n ? -diff : diff) * t.d <= t.n * a.d * e.d;
}
export function overlaps(p) {
  let cells = new Map();
  for (const f of p.fields)
    for (let i = 0; i < width(f); i++) {
      let key = `${f.space}:${address(f) + i}`,
        ids = cells.get(key) ?? [];
      ids.push(f.id);
      cells.set(key, ids);
    }
  return [...cells]
    .filter(([, v]) => v.length > 1)
    .map(([k, fieldIds]) => ({
      space: k.split(":")[0],
      address: Number(k.split(":")[1]),
      fieldIds,
    }))
    .sort((a, b) => a.space.localeCompare(b.space) || a.address - b.address);
}
export function run(p) {
  validate(p);
  let results = [],
    counts = { pass: 0, mismatch: 0, missing: 0, unasserted: 0 };
  for (const c of p.cases)
    for (const f of p.fields.filter((f) => f.space === c.space)) {
      let offset = address(f) - c.start,
        expect = Object.hasOwn(c.expected, f.id) ? c.expected[f.id] : undefined,
        r = { caseId: c.id, fieldId: f.id };
      if (offset < 0 || offset + width(f) > c.words.length)
        r.status = "missing";
      else {
        Object.assign(r, decode(f, c.words.slice(offset, offset + width(f))));
        r.status = expect
          ? matches(f, r.value, expect)
            ? "pass"
            : "mismatch"
          : "unasserted";
      }
      if (expect) {
        r.expected = expect.value;
        r.tolerance = expect.tolerance;
      }
      results.push(r);
      counts[r.status]++;
    }
  for (const f of p.fields)
    if (!p.cases.some((c) => c.space === f.space)) {
      results.push({
        caseId: null,
        fieldId: f.id,
        status: "unasserted",
        reason: "No case in this register space",
      });
      counts.unasserted++;
    }
  return {
    schema: "regdeck-report/v1",
    name: p.name,
    ok: results.length > 0 && counts.pass === results.length,
    counts,
    warnings: overlaps(p),
    results,
  };
}
export function parseWords(source, base = "hex") {
  if (typeof source !== "string" || source.length > 30000)
    fail("Word input too long");
  let tokens = source.trim() ? source.trim().split(/[\s,]+/) : [];
  if (tokens.length > LIMITS.words) fail("Snapshot: max 4096 words");
  return tokens.map((t) => {
    if (!(base === "hex" ? /^(?:0x)?[0-9a-fA-F]{1,4}$/ : /^\d{1,5}$/).test(t))
      fail(`Invalid ${base} word: ${t.slice(0, 30)}`);
    let n = parseInt(t, base === "hex" ? 16 : 10);
    integer(n, 0, 65535, "word");
    return n;
  });
}
