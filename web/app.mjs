import {
  validate,
  parseProject,
  decodeUTF8,
  serializeProject,
  run,
  address,
  width,
  parseWords,
  LIMITS,
} from "../src/core.mjs";
import { example, driftExample, blankField } from "../src/example.mjs";
import { mapCSV, parseMapCSV, reportHTML } from "../src/export.mjs";
import { VERIFIER_SOURCE } from "../src/verifier-source.mjs";
const $ = (id) => document.getElementById(id),
  el = (tag, text, cls) => {
    let e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
let lang = "ja",
  project = example(),
  selectedField = project.fields[0].id,
  selectedCase = project.cases[0].id,
  history = [],
  generation = 0,
  fieldDirty = false,
  caseDirty = false,
  expectDirty = false,
  tab = "map";
const choose = (ja, en) => (lang === "ja" ? ja : en),
  ja = {};
document
  .querySelectorAll("[data-t]")
  .forEach((e) => (ja[e.dataset.t] = e.innerText));
const en = {
  local: "Local processing only",
  guideLink: "Field guide ↗",
  headline: "Give register maps\na contract you can test.",
  lede: "Turn a map and recorded raw words into repeatable regression checks. Keep independent expectations fixed as addresses and byte order change.",
  example: "Open reference example",
  drift: "Find an address drift ↗",
  signal: "Expectations are never auto-generated",
  scope:
    "No device connection, communication, writes or safety certification. Verify against vendor documentation and independent reference values.",
  workspace: "WORKSPACE / SESSION ONLY",
  undo: "Undo",
  import: "Import",
  save: "Save JSON ↓",
  mapTab: "01 Register map",
  casesTab: "02 Words & assertions",
  reviewTab: "03 Review & export",
  mapHeading: "The interpretation map",
  addField: "+ Field",
  search: "Find a field",
  field: "Field",
  sourceAddress: "Source notation",
  interpretation: "Interpretation",
  legendScope: "Holding / Input are separate spaces",
  legendOverlap: "Overlap needs review",
  overlapHeading: "Overlap review",
  fieldDetail: "FIELD DETAIL / EDIT CONTRACT",
  label: "Display label",
  space: "Register space",
  addressConvention: "Address convention",
  address: "Source address",
  addressHint:
    "PDU means the zero-based address used in communication. Switching conventions does not convert the supplied number automatically.",
  type: "Value type",
  order: "Incoming byte order",
  scale: "Decimal scale",
  offset: "Decimal offset",
  unit: "Unit",
  note: "Source / alias justification",
  floatHint:
    "Integers: raw × scale + offset, with exact decimal arithmetic. Float32: scale 1 and offset 0 only.",
  apply: "Apply changes",
  cancel: "Cancel",
  deleteField: "Delete field",
  noFields: "Add a field to begin",
  casesHeading: "Fixed observations. Independent expectations.",
  casesDescription:
    "Expectations do not come from the map, so interpretation changes remain visible as mismatches.",
  addCase: "+ Snapshot",
  selectCase: "Recorded snapshot",
  caseName: "Snapshot name",
  start: "Start PDU address",
  words: "Raw 16-bit words (hexadecimal)",
  wordsHint:
    "Separate words with spaces or commas. Example: FFE7 0000 4148 0000. Each word is 0000–FFFF, up to 4096 words.",
  applySnapshot: "Apply snapshot",
  independent: "Independent expectations",
  manual: "MANUAL / REFERENCE",
  assertHint:
    "Save a value and absolute tolerance for each field. A blank expected value is unasserted. NaN / Infinity / -Infinity require tolerance 0.",
  zeroHint:
    "Float32 distinguishes positive and negative zero. Nonfinite assertions compare category; inspect canonical bits for NaN payloads.",
  reviewHeading: "A portable review record",
  reviewDescription:
    "Save the JSON and Python verifier together. Run the same checks without a browser.",
  exportMap: "Register map",
  exportMapSub: "Explicit notation and interpretation",
  exportFixture: "Regression fixture",
  exportFixtureSub: "Raw words + fixed expectations",
  exportPython: "Standalone verifier",
  exportPythonSub: "Python standard library only",
  exportReport: "Printable report",
  exportReportSub: "Assumptions, overlaps and results",
  command: "Run in the folder containing the downloaded files",
  exitCodes:
    "Exit codes: 0 = all pass / 1 = mismatch or incomplete / 2 = invalid input",
  caseField: "Snapshot / field",
  status: "Status",
  rawBits: "Raw value / canonical bits",
  actual: "Actual value",
  expectedTolerance: "Expected / tolerance",
  caveat:
    "A pass means agreement with saved expectations. It does not establish that expectations are correct, cover unrecorded states, or certify device conformance or safe operation.",
  guideTitle: "Make the ambiguous\nparts explicit.",
  g1title: "Never guess an address base",
  g1: "PDU: 0–65535. One-based register numbers subtract 1. Five-digit references: holding 40001–49999 / input 30001–39999 only. Snapshot starts always use PDU addresses.",
  g2title: "Keep byte order visible",
  g2: "Each standard word sends the high byte first. Check vendor documentation for combining words into 32-bit values. Select ABCD / CDAB / BADC / DCBA and retain canonical bits.",
  g3title: "Keep expectations independent",
  g3: "Enter expectations from an independent reference. Map edits never regenerate them. Examples use synthetic reference data. Save your own project as JSON.",
  g4title: "Bound the work",
  g4: "Up to 256 fields, 64 snapshots, 4096 words each, 65536 words total; imports up to 2 MiB. No data upload or automatic storage. Computation works offline after loading.",
  footer: "Read the specification. Expect independently. Verify repeatedly.",
  importTitle: "Import a project",
  importDescription:
    "Load project JSON or a map CSV. CSV keeps the current snapshots and expectations. Invalid input leaves the current project unchanged.",
  format: "Format",
  file: "File (up to 2 MiB)",
  paste: "Or paste text",
  load: "Load",
};
const statuses = {
  pass: ["一致", "PASS"],
  mismatch: ["不一致", "MISMATCH"],
  missing: ["ワード不足", "MISSING WORDS"],
  unasserted: ["未検証", "UNASSERTED"],
};
function status(message, error = false) {
  $("status").textContent = message;
  $("status").className = error ? "error" : "";
}
function dirty() {
  return fieldDirty || caseDirty || expectDirty;
}
function ensureClean() {
  if (dirty())
    throw Error(
      choose(
        "編集途中です。変更を適用するか、取り消してください。",
        "Unapplied edits remain. Apply or cancel them first.",
      ),
    );
}
function mutate(next, message) {
  validate(next);
  history.push(structuredClone(project));
  if (history.length > 20) history.shift();
  project = next;
  generation++;
  fieldDirty = false;
  caseDirty = false;
  expectDirty = false;
  selectedField = project.fields.some((f) => f.id === selectedField)
    ? selectedField
    : project.fields[0]?.id;
  selectedCase = project.cases.some((c) => c.id === selectedCase)
    ? selectedCase
    : project.cases[0]?.id;
  render();
  status(message);
}
function guard(fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (e) {
      status(choose("変更されていません: ", "No change: ") + e.message, true);
    }
  };
}
function setLanguage() {
  lang = $("language").value;
  document.documentElement.lang = lang;
  document
    .querySelectorAll("[data-t]")
    .forEach(
      (e) =>
        (e.textContent =
          (lang === "ja" ? ja : en)[e.dataset.t] ?? ja[e.dataset.t]),
    );
  render();
}
$("language").onchange = guard(() => {
  if (dirty()) {
    $("language").value = lang;
    ensureClean();
  }
  setLanguage();
});
function activateTab(next) {
  if (next !== tab) ensureClean();
  tab = next;
  for (const name of ["map", "cases", "review"]) {
    $(`tab-${name}`).setAttribute("aria-selected", String(name === tab));
    $(`tab-${name}`).tabIndex = name === tab ? 0 : -1;
    $(`panel-${name}`).hidden = name !== tab;
  }
  generation++;
}
for (const name of ["map", "cases", "review"])
  $(`tab-${name}`).onclick = guard(() => activateTab(name));
document.querySelector(".tabbar").onkeydown = guard((e) => {
  let keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  let names = ["map", "cases", "review"],
    i = names.indexOf(tab),
    next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? 2
          : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
  activateTab(names[next]);
  $(`tab-${names[next]}`).focus();
});
function render() {
  let r = run(project);
  $("project-title").textContent = project.name;
  $("undo").disabled = !history.length;
  $("summary").replaceChildren();
  let metrics = [
    [project.fields.length, choose("フィールド", "Fields"), "REGISTER MAP"],
    [
      r.counts.pass,
      choose("一致した照合", "Passing assertions"),
      "SAVED EXPECTATIONS",
    ],
    [
      r.counts.mismatch + r.counts.missing + r.counts.unasserted,
      choose("未解決の照合", "Checks to resolve"),
      "COVERAGE & REGRESSION",
    ],
    [
      r.warnings.length,
      choose("重複アドレス", "Overlapping addresses"),
      "ALIASES NEED REVIEW",
    ],
  ];
  for (let i = 0; i < metrics.length; i++) {
    let [n, label, sub] = metrics[i],
      d = el("div", undefined, "metric" + (i >= 2 && n ? " warning" : "")),
      s = el("span", label);
    s.append(el("small", sub));
    d.append(s, el("strong", n));
    $("summary").append(d);
  }
  renderMap(r);
  renderField();
  renderCases(r);
  renderReview(r);
}
function renderMap(r) {
  let filter = $("search-field").value.toLowerCase();
  $("map-rows").replaceChildren();
  for (const f of project.fields) {
    if (!(f.id + " " + f.label).toLowerCase().includes(filter)) continue;
    let tr = el("tr", undefined, f.id === selectedField ? "selected" : ""),
      td = el("td"),
      b = el("button", f.label);
    b.dataset.id = f.id;
    b.append(el("small", f.id + " · " + f.space));
    b.onclick = guard(() => {
      ensureClean();
      selectedField = f.id;
      generation++;
      renderMap(run(project));
      renderField();
    });
    td.append(b);
    let source = el("td", f.address);
    source.append(el("small", f.convention));
    let pdu = el(
      "td",
      `${address(f)}${width(f) > 1 ? "–" + (address(f) + 1) : ""}`,
    );
    if (
      r.warnings.some((w) => w.space === f.space && w.fieldIds.includes(f.id))
    )
      pdu.append(el("small", choose("重複", "overlap"), "overlap-tag"));
    let interpretation = el("td", f.type);
    interpretation.append(
      el("small", f.order + " · ×" + f.scale + " + " + f.offset),
    );
    tr.append(td, source, pdu, interpretation);
    $("map-rows").append(tr);
  }
  $("overlaps").replaceChildren();
  if (!r.warnings.length)
    $("overlaps").append(
      el(
        "p",
        choose(
          "同じ空間のアドレス重複はありません。",
          "No same-space address overlaps.",
        ),
      ),
    );
  else {
    for (const w of r.warnings)
      $("overlaps").append(
        el("p", `${w.space} / PDU ${w.address} → ${w.fieldIds.join(" + ")}`),
      );
    $("overlaps").append(
      el(
        "p",
        choose(
          "別名として意図的に重ねた場合も表示します。自動的に無効とは判断しません。",
          "Intentional aliases remain visible. Overlap does not automatically invalidate a map.",
        ),
      ),
    );
  }
}
const ff = $("field-form"),
  cf = $("case-form");
function field() {
  return project.fields.find((f) => f.id === selectedField);
}
function caseItem() {
  return project.cases.find((c) => c.id === selectedCase);
}
function renderField() {
  const f = field();
  ff.hidden = !f;
  $("empty-field").hidden = !!f;
  $("field-id").textContent = f?.id ?? "—";
  if (!f) return;
  for (const k of [
    "label",
    "space",
    "address",
    "convention",
    "type",
    "scale",
    "offset",
    "unit",
    "note",
  ])
    ff.elements[k].value = f[k];
  orderOptions(f.order);
  diagram();
  fieldDirty = false;
}
function orderOptions(order) {
  let wide = ff.elements.type.value.endsWith("16") ? false : true,
    options = wide ? ["ABCD", "CDAB", "BADC", "DCBA"] : ["AB", "BA"];
  ff.elements.order.replaceChildren(
    ...options.map((v) => {
      let o = el("option", v);
      o.value = v;
      return o;
    }),
  );
  ff.elements.order.value = options.includes(order) ? order : options[0];
}
function diagram() {
  let order = ff.elements.order.value;
  $("byte-diagram").replaceChildren(el("span", choose("入力: ", "Incoming: ")));
  for (const c of order) $("byte-diagram").append(el("b", c));
  $("byte-diagram").append(
    el(
      "div",
      choose("正規化 → ", "Canonical → ") +
        (order.length === 2 ? "A B" : "A B C D"),
    ),
  );
}
ff.oninput = () => {
  fieldDirty = true;
  generation++;
};
ff.onchange = () => {
  fieldDirty = true;
  generation++;
  diagram();
};
ff.elements.type.onchange = () => {
  orderOptions(ff.elements.order.value);
  diagram();
  fieldDirty = true;
  generation++;
};
ff.onsubmit = guard((e) => {
  e.preventDefault();
  let next = structuredClone(project),
    f = next.fields.find((f) => f.id === selectedField);
  for (const k of [
    "label",
    "space",
    "convention",
    "type",
    "order",
    "scale",
    "offset",
    "unit",
    "note",
  ])
    f[k] = ff.elements[k].value;
  if (!/^\d+$/.test(ff.elements.address.value))
    throw Error(
      choose(
        "アドレスは10進整数で入力してください。",
        "Address must be a decimal integer.",
      ),
    );
  f.address = Number(ff.elements.address.value);
  mutate(
    next,
    choose(
      "マップを更新しました。記録と期待値は保持されています。",
      "Map updated. Raw snapshots and independent expectations are unchanged.",
    ),
  );
});
$("cancel-field").onclick = () => {
  generation++;
  renderField();
  status(
    choose(
      "編集中の変更を取り消しました。",
      "Unapplied field edits cancelled.",
    ),
  );
};
$("delete-field").onclick = guard(() => {
  ensureClean();
  if (project.cases.some((c) => Object.hasOwn(c.expected, selectedField)))
    throw Error(
      choose(
        "期待値が残っています。「記録と期待値」で該当する期待値を空欄にして保存してください。",
        "This field has saved expectations. Clear and save those expectations before deleting the field.",
      ),
    );
  let next = structuredClone(project);
  next.fields = next.fields.filter((f) => f.id !== selectedField);
  mutate(next, choose("フィールドを削除しました。", "Field deleted."));
});
function newId(prefix, list) {
  let n = 1;
  while (list.some((x) => x.id === prefix + n)) n++;
  return prefix + n;
}
$("add-field").onclick = guard(() => {
  ensureClean();
  let next = structuredClone(project),
    f = blankField(newId("field", next.fields));
  next.fields.push(f);
  selectedField = f.id;
  mutate(next, choose("フィールドを追加しました。", "Field added."));
});
$("search-field").oninput = () => renderMap(run(project));
function renderCases(r) {
  let c = caseItem();
  $("case-select").replaceChildren(
    ...project.cases.map((c) => {
      let o = el("option", c.name);
      o.value = c.id;
      return o;
    }),
  );
  $("case-select").value = c?.id ?? "";
  cf.hidden = !c;
  $("assertion-rows").replaceChildren();
  $("word-strip").replaceChildren();
  if (!c) {
    $("assertion-rows").append(
      el("p", choose("記録を追加してください。", "Add a snapshot to begin.")),
    );
    return;
  }
  cf.elements.name.value = c.name;
  cf.elements.space.value = c.space;
  cf.elements.start.value = c.start;
  cf.elements.words.value = c.words
    .map((w) => w.toString(16).padStart(4, "0").toUpperCase())
    .join(" ");
  caseDirty = false;
  expectDirty = false;
  for (let i = 0; i < Math.min(64, c.words.length); i++) {
    let alias = r.warnings.some(
        (w) => w.space === c.space && w.address === c.start + i,
      ),
      d = el("div", undefined, "word-cell" + (alias ? " alias" : ""));
    d.append(
      el("small", "PDU " + (c.start + i)),
      el("span", c.words[i].toString(16).padStart(4, "0").toUpperCase()),
    );
    $("word-strip").append(d);
  }
  if (c.words.length > 64)
    $("word-strip").append(
      el("p", choose("先頭64ワードを表示。", "Showing first 64 words.")),
    );
  for (const f of project.fields.filter((f) => f.space === c.space)) {
    let rr = r.results.find((x) => x.caseId === c.id && x.fieldId === f.id),
      box = el("div", undefined, "assertion");
    box.dataset.field = f.id;
    let top = el("div", undefined, "assertion-top");
    top.append(
      el("strong", f.label),
      el(
        "span",
        statuses[rr.status][lang === "ja" ? 0 : 1],
        "badge " + rr.status,
      ),
    );
    let line = el(
      "p",
      `PDU ${address(f)} · ${rr.words?.map((w) => w.toString(16).padStart(4, "0").toUpperCase()).join(" ") ?? "—"} → ${rr.value ?? "—"} ${f.unit}`,
      "actual-line",
    );
    line.title = rr.value ?? "";
    let bits = el(
      "p",
      `${f.type} / ${f.order} · bits ${rr.bits ?? "—"}`,
      "actual-line",
    );
    let controls = el("div", undefined, "assertion-controls"),
      expected = Object.hasOwn(c.expected, f.id) ? c.expected[f.id] : undefined;
    let lv = el("label"),
      lt = el("label"),
      iv = el("input"),
      it = el("input");
    lv.append(el("span", choose("期待値", "Expected")));
    lt.append(el("span", choose("絶対許容差", "Absolute tolerance")));
    iv.value = expected?.value ?? "";
    it.value = expected?.tolerance ?? "0";
    iv.maxLength = 40;
    it.maxLength = 40;
    iv.dataset.expected = f.id;
    it.dataset.tolerance = f.id;
    iv.setAttribute(
      "aria-label",
      f.id + " " + choose("期待値", "expected value"),
    );
    it.setAttribute("aria-label", f.id + " " + choose("許容差", "tolerance"));
    for (const input of [iv, it])
      input.oninput = () => {
        expectDirty = true;
        generation++;
      };
    lv.append(iv);
    lt.append(it);
    let save = el("button", choose("保存", "Save"));
    save.onclick = guard(() => {
      if (fieldDirty || caseDirty)
        throw Error(
          choose(
            "先にマップまたは記録の編集を適用・取消してください。",
            "Apply or cancel map or snapshot edits first.",
          ),
        );
      let next = structuredClone(project),
        nextCase = next.cases.find((x) => x.id === c.id);
      for (const row of $("assertion-rows").querySelectorAll(".assertion")) {
        let fid = row.dataset.field,
          v = row.querySelector("[data-expected]").value,
          t = row.querySelector("[data-tolerance]").value;
        if (v === "") delete nextCase.expected[fid];
        else nextCase.expected[fid] = { value: v, tolerance: t };
      }
      mutate(
        next,
        choose("入力した期待値を保存しました。", "Entered expectations saved."),
      );
    });
    controls.append(lv, lt, save);
    box.append(top, line, bits, controls);
    $("assertion-rows").append(box);
  }
  if (!project.fields.some((f) => f.space === c.space))
    $("assertion-rows").append(
      el(
        "p",
        choose(
          "この空間にフィールドがありません。",
          "No fields in this register space.",
        ),
      ),
    );
  let cancel = el(
    "button",
    choose("期待値の編集を取り消す", "Cancel expectation edits"),
    "small",
  );
  cancel.onclick = () => {
    generation++;
    let draft = Object.fromEntries(
        ["name", "space", "start", "words"].map((k) => [
          k,
          cf.elements[k].value,
        ]),
      ),
      wasDirty = caseDirty;
    renderCases(run(project));
    if (wasDirty) {
      for (const [k, v] of Object.entries(draft)) cf.elements[k].value = v;
      caseDirty = true;
    }
    status(
      choose(
        "編集中の期待値を取り消しました。",
        "Unapplied expectation edits cancelled.",
      ),
    );
  };
  $("assertion-rows").append(cancel);
}
$("case-select").onchange = guard(() => {
  if (caseDirty || expectDirty) {
    $("case-select").value = selectedCase;
    throw Error(
      choose(
        "先に編集中の記録と期待値を適用・取消してください。",
        "Apply or cancel snapshot and expectation edits first.",
      ),
    );
  }
  selectedCase = $("case-select").value;
  generation++;
  renderCases(run(project));
});
cf.oninput = () => {
  caseDirty = true;
  generation++;
};
cf.onchange = () => {
  caseDirty = true;
  generation++;
};
cf.onsubmit = guard((e) => {
  e.preventDefault();
  if (expectDirty)
    throw Error(
      choose(
        "先に期待値の編集を保存・取消してください。",
        "Save or cancel expectation edits first.",
      ),
    );
  if (!/^\d+$/.test(cf.elements.start.value))
    throw Error("Start PDU: decimal integer required");
  let next = structuredClone(project),
    c = next.cases.find((c) => c.id === selectedCase);
  c.name = cf.elements.name.value;
  c.space = cf.elements.space.value;
  c.start = Number(cf.elements.start.value);
  c.words = parseWords(cf.elements.words.value);
  mutate(
    next,
    choose(
      "記録を更新しました。期待値は保持されています。",
      "Snapshot updated. Independent expectations are unchanged.",
    ),
  );
});
$("cancel-case").onclick = () => {
  generation++;
  renderCases(run(project));
  status(
    choose(
      "編集中の記録と期待値を取り消しました。",
      "Unapplied snapshot and expectation edits cancelled.",
    ),
  );
};
$("add-case").onclick = guard(() => {
  ensureClean();
  let next = structuredClone(project),
    id = newId("case", next.cases);
  next.cases.push({
    id,
    name: "New snapshot " + id,
    space: "holding",
    start: 0,
    words: [],
    expected: {},
  });
  selectedCase = id;
  mutate(next, choose("空の記録を追加しました。", "Empty snapshot added."));
});
function renderReview(r) {
  $("review-verdict").textContent = r.ok
    ? choose("全照合が一致", "ALL ASSERTIONS PASS")
    : choose("未解決の項目があります", "REVIEW REQUIRED");
  $("review-rows").replaceChildren();
  $("review-limit").textContent =
    r.results.length > 200
      ? choose(
          `画面は先頭200件 / 全${r.results.length}件。JSON・Python・HTMLレポートは全件を含みます。`,
          `Showing first 200 of ${r.results.length} results. JSON, Python and HTML report include every result.`,
        )
      : "";
  for (const rr of r.results.slice(0, 200)) {
    let tr = el("tr"),
      a = el("td", rr.caseId ?? choose("記録なし", "No case"));
    a.append(el("small", rr.fieldId));
    let b = el("td");
    b.append(
      el(
        "span",
        statuses[rr.status][lang === "ja" ? 0 : 1],
        "badge " + rr.status,
      ),
    );
    let c = el("td", rr.raw ?? "—");
    c.append(el("small", rr.bits ?? "—"));
    let d = el("td", rr.value ?? "—"),
      e = el("td", rr.expected ?? choose("未検証", "unasserted"));
    e.append(el("small", rr.tolerance ?? "—"));
    tr.append(a, b, c, d, e);
    $("review-rows").append(tr);
  }
}
$("undo").onclick = guard(() => {
  ensureClean();
  if (!history.length) return;
  project = history.pop();
  generation++;
  selectedField = project.fields[0]?.id;
  selectedCase = project.cases[0]?.id;
  render();
  status(
    choose("前の作業状態に戻しました。", "Previous project state restored."),
  );
});
$("load-example").onclick = guard(() => {
  ensureClean();
  mutate(
    example(),
    choose(
      "架空の参照サンプルを読み込みました。",
      "Synthetic reference example loaded.",
    ),
  );
});
$("load-drift").onclick = guard(() => {
  ensureClean();
  mutate(
    driftExample(),
    choose(
      "アドレスだけを変更した例です。temperatureの期待値−2.5は保持され、不一致になります。",
      "Only the temperature address changed. Its fixed expectation −2.5 now exposes the mismatch.",
    ),
  );
  activateTab("cases");
});
function download(name, text, type) {
  ensureClean();
  let url;
  try {
    url = URL.createObjectURL(new Blob([text], { type }));
    let a = el("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(choose("ファイルを作成しました: ", "File prepared: ") + name);
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    throw Error(
      choose(
        "ダウンロードを作成できませんでした。",
        "The download could not be created.",
      ),
    );
  }
}
$("save-project").onclick = guard(() =>
  download(
    "regdeck-project.json",
    serializeProject(project),
    "application/json",
  ),
);
$("export-fixture").onclick = $("save-project").onclick;
$("export-map").onclick = guard(() =>
  download("regdeck-map.csv", mapCSV(project), "text/csv;charset=utf-8"),
);
$("export-python").onclick = guard(() =>
  download("verify.py", VERIFIER_SOURCE, "text/x-python;charset=utf-8"),
);
$("export-report").onclick = guard(() =>
  download(
    "regdeck-report.html",
    reportHTML(project),
    "text/html;charset=utf-8",
  ),
);
const dialog = $("import-dialog");
$("open-import").onclick = guard(() => {
  ensureClean();
  generation++;
  $("import-error").textContent = "";
  dialog.showModal();
});
function closeImport() {
  generation++;
  dialog.close();
  $("import-file").value = "";
}
for (const id of ["close-import", "cancel-import"]) $(id).onclick = closeImport;
dialog.addEventListener("cancel", () => {
  generation++;
  $("import-file").value = "";
});
$("import-text").oninput = () => generation++;
$("import-format").onchange = () => {
  generation++;
  $("import-error").textContent = "";
};
function importText(text, format) {
  const next =
    format === "csv" ? parseMapCSV(text, project) : parseProject(text);
  mutate(
    next,
    choose(
      "読み込みました。前の状態には「元に戻す」で戻れます。",
      "Imported. Undo restores the previous project state.",
    ),
  );
  closeImport();
}
$("apply-import").onclick = () => {
  try {
    importText($("import-text").value, $("import-format").value);
  } catch (e) {
    $("import-error").textContent =
      choose("変更されていません: ", "No change: ") + e.message;
  }
};
$("import-file").onchange = async () => {
  const file = $("import-file").files[0];
  if (!file) return;
  let ticket = ++generation,
    format = $("import-format").value;
  try {
    if (file.size > LIMITS.bytes)
      throw Error(
        choose(
          "ファイルは2MiB以下にしてください。",
          "File must be at most 2 MiB.",
        ),
      );
    const bytes = await file.arrayBuffer();
    if (ticket !== generation || !dialog.open) return;
    const source = decodeUTF8(new Uint8Array(bytes));
    if (ticket !== generation || !dialog.open) return;
    importText(source, format);
  } catch (e) {
    if (ticket === generation && dialog.open)
      $("import-error").textContent =
        choose("変更されていません: ", "No change: ") + e.message;
  } finally {
    if (ticket === generation) $("import-file").value = "";
  }
};
render();
