// Node's decoder and the standalone Python verifier must agree independently.
// No network, third-party packages, generated expectation updates, or hardware.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode, parseProject, run } from "../src/core.mjs";
import { example, driftExample } from "../src/example.mjs";

const verifier = fileURLToPath(new URL("../python/verify.py", import.meta.url));
const python = process.env.PYTHON || "python3";
const seed = 0x4d4f4442;
let state = seed;
function random(n) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state % n;
}
const pick = (values) => values[random(values.length)];
const field = (overrides) => ({
  id: "value",
  label: "Test value",
  space: "holding",
  address: 0,
  convention: "pdu",
  type: "uint16",
  order: "AB",
  scale: "1",
  offset: "0",
  unit: "",
  note: "",
  ...overrides,
});
const spaces = ["holding", "input"];
const kinds = ["uint16", "int16", "uint32", "int32", "float32"];
const order16 = ["AB", "BA"];
const order32 = ["ABCD", "CDAB", "BADC", "DCBA"];

function callPython(payload) {
  const bridge = `import importlib.util,json,sys
s=importlib.util.spec_from_file_location('regdeck_verify',sys.argv[1])
v=importlib.util.module_from_spec(s)
s.loader.exec_module(v)
p=json.load(sys.stdin)
out={'decoded':[v.decode(x['field'],x['words']) for x in p['vectors']], 'reports':[v.run(x) for x in p['projects']], 'accepted':[]}
for source in p['sources']:
 try:
  v.load_project(source)
  out['accepted'].append(True)
 except v.ValidationError:
  out['accepted'].append(False)
print(json.dumps(out,ensure_ascii=True,allow_nan=False,separators=(',',':')))
`;
  const child = spawnSync(python, ["-c", bridge, verifier], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60000,
  });
  assert.equal(
    child.status,
    0,
    `Python bridge failed: ${child.error || child.stderr}`,
  );
  return JSON.parse(child.stdout);
}

// A tiny third oracle covers byte significance without using engine address/width helpers.
function integerOracle(f, words) {
  const captured = words.flatMap((w) => [Math.floor(w / 256), w % 256]);
  let result = 0n;
  for (const letter of f.order)
    result = result * 256n + BigInt(captured[letter.charCodeAt(0) - 65]);
  const count = f.type === "uint16" || f.type === "int16" ? 16n : 32n;
  if (f.type.startsWith("int") && result >= 2n ** (count - 1n))
    result -= 2n ** count;
  return result.toString();
}

function occupiedOracle(project) {
  const cells = new Map();
  for (const f of project.fields) {
    const address =
      f.address -
      (f.convention === "pdu"
        ? 0
        : f.convention === "one"
          ? 1
          : f.space === "holding"
            ? 40001
            : 30001);
    const size = f.type === "uint16" || f.type === "int16" ? 1 : 2;
    for (let word = address; word < address + size; word++) {
      const key = `${f.space}/${word}`;
      const existing = cells.get(key) || {
        space: f.space,
        address: word,
        fieldIds: [],
      };
      existing.fieldIds.push(f.id);
      cells.set(key, existing);
    }
  }
  return [...cells.values()]
    .filter((cell) => cell.fieldIds.length > 1)
    .sort(
      (a, b) =>
        (a.space < b.space ? -1 : a.space > b.space ? 1 : 0) ||
        a.address - b.address,
    );
}

const vectors = [];
for (let i = 0; i < 2048; i++) {
  const type = kinds[i % kinds.length];
  const wide = type.endsWith("32");
  const f = field({ type, order: pick(wide ? order32 : order16) });
  const words = Array.from({ length: wide ? 2 : 1 }, () => random(65536));
  vectors.push({ field: f, words });
}
// Explicit exceptional patterns preserve NaN payload bits and both zero signs.
for (const bits of [
  0, 0x80000000, 1, 0x007fffff, 0x00800000, 0x3dcccccd, 0x3f800000, 0x7f7fffff,
  0xff7fffff, 0x7f800000, 0xff800000, 0x7fc12345, 0x7f812345, 0xffc12345,
]) {
  const bytes = [
    (bits >>> 24) & 255,
    (bits >>> 16) & 255,
    (bits >>> 8) & 255,
    bits & 255,
  ];
  for (const order of order32) {
    const incoming = [...order].map(
      (letter) => bytes[letter.charCodeAt(0) - 65],
    );
    vectors.push({
      field: field({ type: "float32", order }),
      words: [incoming[0] * 256 + incoming[1], incoming[2] * 256 + incoming[3]],
    });
  }
}

const projects = [example(), driftExample()];
for (let i = 0; i < 1000; i++) {
  const fields = [];
  for (let j = 0, length = 1 + random(8); j < length; j++) {
    const type = pick(kinds),
      space = pick(spaces),
      pdu = random(12);
    const convention = pick(["pdu", "one", "reference"]);
    const address =
      pdu +
      (convention === "pdu"
        ? 0
        : convention === "one"
          ? 1
          : space === "holding"
            ? 40001
            : 30001);
    fields.push(
      field({
        id: `f${j}`,
        type,
        space,
        convention,
        address,
        order: pick(type.endsWith("32") ? order32 : order16),
        scale:
          type === "float32"
            ? "1"
            : pick([
                "1",
                "0",
                "-0.001",
                "99999999999999999999.999999999999999999",
              ]),
        offset:
          type === "float32"
            ? "0"
            : pick(["0", "0.000000000000000001", "-123.45"]),
      }),
    );
  }
  const cases = [];
  for (let j = 0, length = random(4); j < length; j++) {
    const space = pick(spaces),
      expected = {};
    for (const f of fields)
      if (f.space === space && random(5)) {
        // Deliberately independent arbitrary expectations; never copy decoded values.
        expected[f.id] = {
          value: pick(["0", "-0", "42", "-5.2"]),
          tolerance: pick(["0", "1", "1000000000000000000"]),
        };
      }
    cases.push({
      id: `c${j}`,
      name: `Capture ${j}`,
      space,
      start: random(4),
      words: Array.from({ length: random(15) }, () => random(65536)),
      expected,
    });
  }
  projects.push({
    schema: "regdeck/v1",
    name: `Generated differential ${i}`,
    fields,
    cases,
  });
}
for (const id of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
  projects.push({
    schema: "regdeck/v1",
    name: "Plain field ID",
    fields: [field({ id })],
    cases: [
      {
        id: "capture",
        name: "Capture",
        space: "holding",
        start: 0,
        words: [42],
        expected: {},
      },
    ],
  });
}

const basicSource = JSON.stringify(example());
const sources = [
  basicSource,
  JSON.stringify(driftExample()),
  "{}",
  "[]",
  "null",
  '{"schema":"regdeck/v1","schema":"regdeck/v1"}',
  basicSource + " trailing",
  basicSource.replace('"start":0', '"start":0.0'),
  basicSource.replace('"start":0', '"start":0e0'),
  basicSource.replace('"start":0', '"start":false'),
  basicSource.replace('"start":0', '"start":-0'),
  basicSource.replace('"scale":"0.1"', '"scale":"1e-1"'),
  basicSource.replace('"scale":"0.1"', '"scale":"٠.١"'),
  basicSource.replace('"scale":"0.1"', '"scale":"1\\n"'),
  basicSource.replace('"id":"steady"', '"id":"steady\\n"'),
  basicSource.replace('"id":"steady"', '"id":"steady\\r"'),
  JSON.stringify({ ...example(), name: " \uFEFF \uFEFF " }),
  basicSource.replace('"name":', '"unknown":true,"name":'),
  "[".repeat(13) + "0" + "]".repeat(13),
  '{"a":NaN}',
  '{"a":Infinity}',
];
const pythonResult = callPython({ vectors, projects, sources });
for (let i = 0; i < vectors.length; i++) {
  const vector = vectors[i],
    actual = decode(vector.field, vector.words);
  assert.deepEqual(
    actual,
    pythonResult.decoded[i],
    `Decode differential vector ${i}`,
  );
  if (vector.field.type !== "float32")
    assert.equal(
      actual.raw,
      integerOracle(vector.field, vector.words),
      `Integer oracle ${i}`,
    );
}
for (let i = 0; i < projects.length; i++) {
  const before = JSON.stringify(projects[i]);
  const actual = run(projects[i]);
  assert.deepEqual(
    actual,
    pythonResult.reports[i],
    `Full report differential project ${i}`,
  );
  assert.deepEqual(
    actual.warnings,
    occupiedOracle(projects[i]),
    `Occupied-cell oracle ${i}`,
  );
  assert.equal(
    JSON.stringify(projects[i]),
    before,
    `Project/expectations mutated ${i}`,
  );
}
for (let i = 0; i < sources.length; i++) {
  let accepted = true;
  try {
    parseProject(sources[i]);
  } catch {
    accepted = false;
  }
  assert.equal(
    accepted,
    pythonResult.accepted[i],
    `Strict import differential ${i}`,
  );
}

const temporary = mkdtempSync(join(tmpdir(), "regdeck-verifier-"));
try {
  const exported = join(temporary, "verify.py");
  copyFileSync(verifier, exported);
  assert.deepEqual(
    readFileSync(exported),
    readFileSync(verifier),
    "Exported verifier must be the same bytes",
  );
  const incomplete = example();
  incomplete.cases[0].expected = {};
  for (const [name, fixture, status] of [
    ["pass", example(), 0],
    ["mismatch", driftExample(), 1],
    ["incomplete", incomplete, 1],
    ["invalid", { schema: "other" }, 2],
  ]) {
    const path = join(temporary, `${name}.json`);
    writeFileSync(path, JSON.stringify(fixture));
    const result = spawnSync(python, [exported, path, "--json"], {
      cwd: temporary,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(
      result.status,
      status,
      `Exported CLI ${name}: ${result.error || result.stderr}`,
    );
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, status === 0, `Exported CLI report ${name}`);
    if (status !== 2)
      assert.deepEqual(
        report,
        run(fixture),
        `Exported CLI differential ${name}`,
      );
    else assert.equal(typeof report.error, "string");
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const evidence = {
  ok: true,
  seed,
  decodeVectors: vectors.length,
  completeProjects: projects.length,
  strictImportCases: sources.length,
  independentOracles: ["integer bytes", "occupied cells"],
  exportedCliCases: 4,
};
mkdirSync("tests/artifacts", { recursive: true });
writeFileSync(
  "tests/artifacts/differential.json",
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence));
