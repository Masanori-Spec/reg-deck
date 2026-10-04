import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validate,
  parseProject,
  decodeUTF8,
  serializeProject,
  run,
  decode,
  address,
  overlaps,
  parseWords,
  decimal,
  LIMITS,
} from "../src/core.mjs";
import { example, driftExample, blankField } from "../src/example.mjs";
import { mapCSV, parseMapCSV, reportHTML } from "../src/export.mjs";
const clone = (x) => structuredClone(x),
  mutate = (fn) => {
    let p = example();
    fn(p);
    return p;
  };
test("reference example is independently asserted, alias remains visible", () => {
  let r = run(example());
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, {
    pass: 5,
    mismatch: 0,
    missing: 0,
    unasserted: 0,
  });
  assert.deepEqual(r.warnings, [
    { space: "holding", address: 3, fieldIds: ["counter", "counter_low"] },
  ]);
});
test("address regression leaves expectations and raw snapshots unchanged", () => {
  let p = example(),
    d = driftExample();
  assert.deepEqual(d.cases, p.cases);
  assert.equal(run(d).counts.mismatch, 1);
  assert.equal(run(d).results[0].value, "0");
});
test("project roundtrip retains independent values, tolerance and raw words", () => {
  let p = mutate(
    (p) =>
      (p.cases[0].expected.temperature = {
        value: "-2.5000",
        tolerance: "0.0001",
      }),
  );
  assert.deepEqual(
    JSON.parse(serializeProject(parseProject(serializeProject(p)))),
    p,
  );
});
test("all four 32bit permutations decode12.5 and maintainbits", () => {
  for (const [order, words] of [
    ["ABCD", [0x4148, 0]],
    ["CDAB", [0, 0x4148]],
    ["BADC", [0x4841, 0]],
    ["DCBA", [0, 0x4841]],
  ]) {
    let f = { ...blankField(), type: "float32", order };
    assert.deepEqual(decode(f, words), {
      raw: "12.5",
      value: "12.5",
      bits: "41480000",
      words,
    });
  }
});
test("byte16 swapping is explicit", () =>
  assert.equal(
    decode({ ...blankField(), type: "int16", order: "BA" }, [0xe7ff]).raw,
    "-25",
  ));
test("uint32 maximum exact scale and offset", () =>
  assert.equal(
    decode(
      {
        ...blankField(),
        type: "uint32",
        order: "ABCD",
        scale: "0.000000000000000001",
        offset: "-0.000000000000000001",
      },
      [65535, 65535],
    ).value,
    "0.000000004294967294",
  ));
test("float32 0.1 requires explicit tolerance; actual is not ideal decimal0.1", () => {
  let p = {
    schema: "regdeck/v1",
    name: "Float",
    fields: [{ ...blankField(), type: "float32", order: "ABCD" }],
    cases: [
      {
        id: "c",
        name: "Float",
        space: "holding",
        start: 0,
        words: [0x3dcc, 0xcccd],
        expected: { field1: { value: "0.1", tolerance: "0" } },
      },
    ],
  };
  assert.equal(run(p).counts.mismatch, 1);
  p.cases[0].expected.field1.tolerance = "0.00000001";
  assert.equal(run(p).ok, true);
});
test("signed zero float assertions distinguish zero sign even with tolerance", () => {
  let p = {
    schema: "regdeck/v1",
    name: "Zero",
    fields: [{ ...blankField(), type: "float32", order: "ABCD" }],
    cases: [
      {
        id: "c",
        name: "zero",
        space: "holding",
        start: 0,
        words: [32768, 0],
        expected: { field1: { value: "0", tolerance: "1" } },
      },
    ],
  };
  assert.equal(run(p).counts.mismatch, 1);
  p.cases[0].expected.field1.value = "-0.0";
  assert.equal(run(p).ok, true);
});
test("NaN category match retains payload bits", () => {
  let f = { ...blankField(), type: "float32", order: "ABCD" };
  assert.deepEqual(decode(f, [0x7fc1, 0x2345]), {
    raw: "NaN",
    value: "NaN",
    bits: "7FC12345",
    words: [0x7fc1, 0x2345],
  });
});
test("all address convention edges and two-word overflow", () => {
  for (let [convention, space, addressValue, want] of [
    ["pdu", "holding", 0, 0],
    ["pdu", "input", 65535, 65535],
    ["one", "holding", 65536, 65535],
    ["reference", "holding", 40001, 0],
    ["reference", "input", 39999, 9998],
  ]) {
    let f = { ...blankField(), convention, space, address: addressValue };
    validate({ schema: "regdeck/v1", name: "Address", fields: [f], cases: [] });
    assert.equal(address(f), want);
  }
  assert.throws(
    () =>
      validate(
        mutate((p) =>
          Object.assign(p.fields[1], {
            address: 65535,
            type: "uint32",
            convention: "pdu",
          }),
        ),
      ),
    /span/,
  );
});
test("spaces independent; threeway aliases visible percell", () => {
  let fields = [
    { ...blankField("a"), type: "uint32", order: "ABCD" },
    { ...blankField("b"), address: 1 },
    { ...blankField("c"), address: 1 },
    { ...blankField("d"), space: "input", address: 1 },
  ];
  assert.deepEqual(overlaps({ fields }), [
    { space: "holding", address: 1, fieldIds: ["a", "b", "c"] },
  ]);
});
test("absence never becomes zero and uncovered spaces incomplete", () => {
  let p = example();
  p.cases[0].words = [];
  p.cases = p.cases.slice(0, 1);
  let r = run(p);
  assert.equal(r.counts.missing, 4);
  assert.equal(r.counts.unasserted, 1);
  assert.equal(r.ok, false);
});
test("allzero words are genuine values, unasserted remainsincomplete", () => {
  let p = example();
  p.cases[0].words.fill(0);
  delete p.cases[0].expected.temperature;
  assert.equal(run(p).results[0].value, "0");
  assert.equal(run(p).results[0].status, "unasserted");
});
test("empty project is valid but never claims pass", () =>
  assert.equal(
    run({ schema: "regdeck/v1", name: "Empty", fields: [], cases: [] }).ok,
    false,
  ));
test("unknown keys and wrongspace expectations rejected", () => {
  assert.throws(() => validate(mutate((p) => (p.extra = 1))));
  assert.throws(() => validate(mutate((p) => (p.fields[0].unknown = ""))));
  assert.throws(
    () =>
      validate(
        mutate(
          (p) => (p.cases[0].expected.status = { value: "7", tolerance: "0" }),
        ),
      ),
    /different space/,
  );
});
test("IDs named Object inherited properties stay ordinary fields", () => {
  for (let id of ["constructor", "toString", "valueOf"]) {
    let p = {
      schema: "regdeck/v1",
      name: "Safe",
      fields: [blankField(id)],
      cases: [
        {
          id: "c",
          name: "c",
          space: "holding",
          start: 0,
          words: [0],
          expected: {},
        },
      ],
    };
    assert.equal(run(p).counts.unasserted, 1);
  }
});
for (const [s, why] of [
  ["1e2", "exponent"],
  ["1\n", "newline"],
  [" 1", "whitespace"],
  ["0.1234567890123456789", "precision"],
  ["١", "nonascii"],
  ["NaN", "NaN"],
  ["Infinity", "infinite"],
])
  test("decimal rejects " + why, () => assert.throws(() => decimal(s)));
test("strict parser duplicatekeys nested and integer lexicalform", () => {
  assert.throws(
    () => parseProject('{"schema":"regdeck/v1","schema":"regdeck/v1"}'),
    /Duplicate/,
  );
  let s = serializeProject(example());
  assert.throws(
    () => parseProject(s.replace("40001", "40001.0")),
    /integer literals/,
  );
  assert.throws(
    () => parseProject(s.replace("40001", "4.0001e4")),
    /integer literals/,
  );
  assert.throws(
    () => parseProject('{"x":' + "[".repeat(14) + "0" + "]".repeat(14) + "}"),
    /nesting/,
  );
});
test("strict parser null boolean and control rejected", () => {
  assert.throws(() => parseProject("null"));
  assert.throws(() =>
    parseProject(serializeProject(mutate((p) => (p.cases[0].words[0] = true)))),
  );
});
test("2MiB import cap enforced before parsing", () =>
  assert.throws(() => parseProject(" ".repeat(LIMITS.bytes + 1)), /2 MiB/));
test("unicode text controls, surrogates and length cap", () => {
  assert.throws(() => validate(mutate((p) => (p.name = "a\u0085b"))));
  assert.throws(() => validate(mutate((p) => (p.name = "\ud800"))));
  let p = mutate((p) => (p.name = "🐈".repeat(120)));
  assert.equal(validate(p).name.length, 240);
  assert.throws(() => validate(mutate((p) => (p.name = "🐈".repeat(121)))));
});
test("caps and numeric bounds reject all oversized work", () => {
  assert.throws(() =>
    validate(
      mutate(
        (p) =>
          (p.fields = Array.from({ length: 257 }, (_, i) =>
            blankField("f" + i),
          )),
      ),
    ),
  );
  assert.throws(() =>
    validate(mutate((p) => (p.cases[0].words = Array(4097).fill(0)))),
  );
  assert.throws(() => validate(mutate((p) => (p.cases[0].words[0] = -1))));
  assert.throws(() => validate(mutate((p) => (p.cases[0].start = 65535))));
  assert.throws(() =>
    validate(mutate((p) => (p.cases[0].expected.temperature.tolerance = "-1"))),
  );
});
test("float scaling is rejected rather than silently approximated", () =>
  assert.throws(
    () => validate(mutate((p) => (p.fields[3].scale = "0.1"))),
    /float32/,
  ));
test("CSV normalized output roundtrips all fields and preserves cases", () => {
  let p = example(),
    text = mapCSV(p);
  assert.ok(
    text.startsWith(
      "id,label,space,address,convention,type,order,scale,offset,unit,note,pdu_start,pdu_end",
    ),
  );
  assert.deepEqual(parseMapCSV(text, p), p);
});
test("CSV hostile text spreadsheet guard is reversible, HTML escaped", () => {
  let p = mutate((p) => {
    p.name = "<script>alert(1)</script>";
    p.fields[0].label = ' =HYPERLINK("https://evil")';
    p.fields[0].note = '\'formula\n<svg onload="x">';
    p.fields[0].unit = "@cmd";
  });
  let csv = mapCSV(p);
  assert.ok(csv.includes("' =HYPERLINK"));
  assert.deepEqual(parseMapCSV(csv, p), p);
  let html = reportHTML(p);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<svg onload"));
  assert.ok(html.includes("&lt;script&gt;"));
});
test("CSV malformed, trailingquotes and PDU mismatch fail atomically", () => {
  let p = example(),
    before = serializeProject(p);
  assert.throws(() => parseMapCSV("x,y\n1,2", p));
  assert.throws(() =>
    parseMapCSV(
      mapCSV(p).replace('"Return temperature"', '"Return temperature"x'),
      p,
    ),
  );
  assert.throws(() => parseMapCSV(mapCSV(p).replace('"40001"', '"40002"'), p));
  assert.equal(serializeProject(p), before);
});
test("CSV supports source columns and embedded newline notes", () => {
  let p = mutate((p) => (p.fields[0].note = "first\nsecond")),
    csv = mapCSV(p);
  assert.equal(parseMapCSV(csv, p).fields[0].note, "first\nsecond");
});
test("word input distinguisheshex anddecimal and caps", () => {
  assert.deepEqual(parseWords("0xFFFF 0000, 12ab"), [65535, 0, 0x12ab]);
  assert.deepEqual(parseWords("65535,0", "decimal"), [65535, 0]);
  for (let s of ["fffff", "-1", "1.5", "NaN", "<img>"])
    assert.throws(() => parseWords(s));
  assert.throws(() => parseWords(Array(4097).fill("0").join(" ")));
});
test("standalone verifier exported byteidentical to Pythonsource", async () => {
  let module = await import("../src/verifier-source.mjs");
  assert.equal(
    module.VERIFIER_SOURCE,
    await readFile("python/verify.py", "utf8"),
  );
});
test("compact logical data limit covers cumulative unicode content", () => {
  let fields = Array.from({ length: 256 }, (_, i) => ({
      ...blankField("f" + i),
      note: "🐈".repeat(1000),
    })),
    expected = Object.fromEntries(
      fields.map((f) => [
        f.id,
        { value: "1".repeat(40), tolerance: "1".repeat(40) },
      ]),
    ),
    cases = Array.from({ length: 64 }, (_, i) => ({
      id: "c" + i,
      name: "c",
      space: "holding",
      start: 0,
      words: [0],
      expected: structuredClone(expected),
    }));
  assert.throws(
    () => validate({ schema: "regdeck/v1", name: "Large", fields, cases }),
    /compact data limit/,
  );
});
test("pretty overflow falls back to importable compact JSON", () => {
  let fields = Array.from({ length: 256 }, (_, i) => ({
      ...blankField("f" + i),
      note: "x".repeat(500),
    })),
    expected = Object.fromEntries(
      fields.map((f) => [f.id, { value: "1".repeat(40), tolerance: "0" }]),
    ),
    cases = Array.from({ length: 64 }, (_, i) => ({
      id: "c" + i,
      name: "c",
      space: "holding",
      start: 0,
      words: [0],
      expected: structuredClone(expected),
    })),
    p = { schema: "regdeck/v1", name: "Compact export", fields, cases };
  let s = serializeProject(p);
  assert.ok(Buffer.byteLength(s) <= LIMITS.bytes);
  assert.equal(parseProject(s).cases.length, 64);
  assert.ok(Buffer.byteLength(JSON.stringify(p, null, 2)) > LIMITS.bytes);
  assert.equal(s, JSON.stringify(p));
});

test("snapshot and decode APIs reject sparse or inherited words before arithmetic", () => {
  let p = example();
  delete p.cases[0].words[0];
  assert.throws(() => validate(p), /dense array/);
  assert.throws(() => run(p), /dense array/);
  assert.throws(() => serializeProject(p), /dense array/);
  assert.throws(() => decode(blankField(), Array(1)), /dense array/);
  let words = Array(1),
    prototype = Object.create(Array.prototype);
  prototype[0] = 0;
  Object.setPrototypeOf(words, prototype);
  assert.throws(() => decode(blankField(), words), /dense array/);
  assert.throws(() => decode(blankField(), { length: 1, 0: 0 }), /array/);
});
test("file byte decoding rejects malformed UTF-8 and preserves valid Unicode", () => {
  const valid = new TextEncoder().encode(serializeProject(example()));
  assert.equal(parseProject(decodeUTF8(valid)).name, example().name);
  for (const bytes of [[255], [195], [128], [192, 175], [237, 160, 128]])
    assert.throws(() => decodeUTF8(Uint8Array.from(bytes)), /Invalid UTF-8/);
  const corrupt = Buffer.from(valid);
  corrupt[corrupt.indexOf(Buffer.from(example().name))] = 255;
  assert.throws(() => decodeUTF8(corrupt), /Invalid UTF-8/);
  assert.throws(() =>
    parseProject(
      decodeUTF8(
        Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(valid)]),
      ),
    ),
  );
  assert.throws(() => decodeUTF8(new Uint8Array(LIMITS.bytes + 1)), /2 MiB/);
});

test("CSV requires exact header cells, rejecting merged or extra columns", () => {
  const p = example(),
    csv = mapCSV(p),
    lines = csv.trimEnd().split("\r\n");
  const merged = lines
    .map((line, index) =>
      index === 0
        ? line.replace("pdu_start,pdu_end", '"pdu_start,pdu_end"')
        : line.replace(/,"[0-9]+","[0-9]+"$/, ',"not-a-normalized-address"'),
    )
    .join("\r\n");
  assert.throws(() => parseMapCSV(merged, p), /CSV header/);
  for (const header of [
    lines[0].replace("id,label", '"id,label"'),
    lines[0] + ",extra",
    lines[0].replace("pdu_end", "wrong"),
  ])
    assert.throws(
      () => parseMapCSV(header + "\r\n" + lines.slice(1).join("\r\n"), p),
      /CSV header/,
    );
  let quotedHeader = lines[0]
    .split(",")
    .map((x) => '"' + x + '"')
    .join(",");
  assert.deepEqual(
    parseMapCSV(quotedHeader + "\r\n" + lines.slice(1).join("\r\n"), p),
    p,
  );
  const sourceOnly = lines
    .map((line, index) =>
      index === 0
        ? line.split(",").slice(0, 11).join(",")
        : line.replace(/,"[0-9]+","[0-9]+"$/, ""),
    )
    .join("\r\n");
  assert.deepEqual(parseMapCSV(sourceOnly, p), p);
});
test("emitted modules resolve within the deployment root and nested subpaths", async () => {
  for (const base of [
    "https://regdeck.invalid/",
    "https://regdeck.invalid/review/reg-deck/",
  ]) {
    for (const file of [
      "app.mjs",
      "src/core.mjs",
      "src/example.mjs",
      "src/export.mjs",
    ]) {
      const source = await readFile("dist/" + file, "utf8");
      for (const match of source.matchAll(
        /^import[\s\S]*?\bfrom\s+["']([^"']+)["']/gm,
      )) {
        const url = new URL(match[1], new URL(file, base));
        assert.ok(url.href.startsWith(base), url.href);
        const local = "dist/" + url.href.slice(base.length);
        await readFile(local);
      }
    }
  }
  const app = await readFile("dist/app.mjs", "utf8");
  assert.equal((app.match(/from ["']\.\/src\//g) ?? []).length, 4);
});
