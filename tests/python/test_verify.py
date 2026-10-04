"""Independent oracle tests; use: python -m unittest discover -s tests/python -v."""

import copy
from decimal import Decimal
import importlib.util
import json
from pathlib import Path
import random
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "python" / "verify.py"
spec = importlib.util.spec_from_file_location("regdeck_verify", SCRIPT)
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


def field(**changes):
    value = {"id": "temperature", "label": "Temperature", "space": "holding", "address": 0,
             "convention": "pdu", "type": "uint16", "order": "AB", "scale": "1", "offset": "0",
             "unit": "°C", "note": ""}
    value.update(changes)
    return value


def project(f=None, words=None, value="42", tolerance="0", **case_changes):
    f = f or field()
    case = {"id": "sample", "name": "Sample", "space": f["space"], "start": verify.pdu_address(f),
            "words": [42] if words is None else words, "expected": {f["id"]: {"value": value, "tolerance": tolerance}}}
    case.update(case_changes)
    return {"schema": "regdeck/v1", "name": "Independent fixture", "fields": [f], "cases": [case]}


class ValidationTests(unittest.TestCase):
    def invalid_field(self, **changes):
        with self.assertRaises(verify.ValidationError):
            verify.validate(project(field(**changes)))

    def test_basic_valid(self):
        p = project()
        self.assertIs(verify.validate(p), p)

    def test_keys_required_and_unknown_rejected_everywhere(self):
        for location in ((), ("fields", 0), ("cases", 0), ("cases", 0, "expected", "temperature")):
            p = project()
            target = p
            for key in location:
                target = target[key]
            target["injected"] = "bad"
            with self.subTest(location=location), self.assertRaises(verify.ValidationError):
                verify.validate(p)
            del target["injected"]
            target.pop(next(iter(target)))
            with self.subTest(missing=location), self.assertRaises(verify.ValidationError):
                verify.validate(p)

    def test_id_and_duplicate_validation(self):
        for invalid in ("", "_x", "1x", "x.y", "x y", "x\n", "é", "a" * 41):
            with self.subTest(invalid=invalid):
                self.invalid_field(id=invalid)
        p = project()
        p["fields"].append(copy.deepcopy(p["fields"][0]))
        with self.assertRaises(verify.ValidationError):
            verify.validate(p)
        p = project()
        p["cases"].append(copy.deepcopy(p["cases"][0]))
        with self.assertRaises(verify.ValidationError):
            verify.validate(p)

    def test_text_limits_and_controls(self):
        for changes in ({"label": ""}, {"label": " "}, {"label": " \ufeff \ufeff "}, {"label": "a" * 121}, {"unit": "u" * 41},
                        {"note": "a" * 1001}, {"label": "A\tB"}, {"note": "A\rB"}, {"note": "a\u0085b"},
                        {"unit": "\x7f"}, {"label": "\ud800"}):
            with self.subTest(changes=changes):
                self.invalid_field(**changes)
        verify.validate(project(field(label="😀" * 120, note="a\nb\tc")))

    def test_decimal_format_and_precision(self):
        for decimal in ("", ".1", "1.", "1e2", "NaN", "Infinity", " 1", "1 ", "--1", "0x10", "١", "1\n",
                        "1" * 41, "0." + "1" * 19):
            with self.subTest(decimal=decimal):
                self.invalid_field(scale=decimal)
        for decimal in ("+1", "-1", "000.001", "0." + "1" * 18, "1" * 40):
            verify.validate(project(field(scale=decimal)))

    def test_address_conventions_and_width(self):
        valid = [("pdu", "holding", 0, 0), ("pdu", "input", 65535, 65535),
                 ("one", "holding", 1, 0), ("one", "input", 65536, 65535),
                 ("reference", "holding", 40001, 0), ("reference", "input", 30001, 0),
                 ("reference", "holding", 49999, 9998)]
        for convention, space, address, expected in valid:
            f = field(convention=convention, space=space, address=address)
            verify.validate(project(f))
            self.assertEqual(verify.pdu_address(f), expected)
        for convention, space, address in [("pdu", "holding", -1), ("pdu", "input", 65536),
                                           ("one", "holding", 0), ("one", "input", 65537),
                                           ("reference", "holding", 30001), ("reference", "input", 40001),
                                           ("reference", "holding", 40000), ("reference", "holding", 50000)]:
            with self.subTest(convention=convention, address=address):
                self.invalid_field(convention=convention, space=space, address=address)
        self.invalid_field(address=65535, type="uint32", order="ABCD")
        verify.validate(project(field(address=65534, type="uint32", order="ABCD"), words=[0, 42]))

    def test_bools_not_integers(self):
        self.invalid_field(address=True)
        for word in (True, False, 1.0, "1", None, -1, 65536):
            with self.subTest(word=word), self.assertRaises(verify.ValidationError):
                verify.validate(project(words=[word]))
        with self.assertRaises(verify.ValidationError):
            verify.validate(project(start=True))

    def test_invalid_type_order_space(self):
        for changes in ({"space": "coil"}, {"type": "float64"}, {"order": "ABCD"},
                        {"type": "int32", "order": "AB"}, {"convention": "auto"}):
            self.invalid_field(**changes)

    def test_float_scale_is_numeric_identity(self):
        f = field(type="float32", order="ABCD", scale="+01.0", offset="-0.0")
        verify.validate(project(f, [0, 0], "0"))
        for changes in ({"scale": "2"}, {"offset": "0.1"}):
            f.update(changes)
            with self.assertRaises(verify.ValidationError):
                verify.validate(project(f, [0, 0], "0"))
            f.update(scale="1", offset="0")

    def test_expectations_must_be_known_and_same_space(self):
        for expected in ({"unknown": {"value": "1", "tolerance": "0"}},
                         {"temperature": {"value": "1", "tolerance": "-0.1"}},
                         {"temperature": {"value": 1, "tolerance": "0"}}):
            with self.subTest(expected=expected), self.assertRaises(verify.ValidationError):
                verify.validate(project(expected=expected))
        with self.assertRaises(verify.ValidationError):
            verify.validate(project(space="input"))

    def test_nonfinite_assertions_restrictions(self):
        for value in ("Infinity", "-Infinity", "NaN"):
            with self.assertRaises(verify.ValidationError):
                verify.validate(project(value=value))
            p = project(field(type="float32", order="ABCD"), [0, 0], value)
            verify.validate(p)
            p["cases"][0]["expected"]["temperature"]["tolerance"] = "1"
            with self.assertRaises(verify.ValidationError):
                verify.validate(p)

    def test_count_limits(self):
        p = project()
        p["fields"] = [field(id="f" + str(i)) for i in range(257)]
        with self.assertRaises(verify.ValidationError):
            verify.validate(p)
        p = project()
        p["cases"] = [dict(p["cases"][0], id="c" + str(i)) for i in range(65)]
        with self.assertRaises(verify.ValidationError):
            verify.validate(p)
        with self.assertRaises(verify.ValidationError):
            verify.validate(project(words=[0] * 4097))
        p = project(words=[0] * 4096)
        p["cases"] = [dict(p["cases"][0], id="c" + str(i)) for i in range(16)]
        verify.validate(p)
        p["cases"].append(dict(p["cases"][0], id="overflow"))
        with self.assertRaises(verify.ValidationError):
            verify.validate(p)

    def test_capture_boundary(self):
        with self.assertRaises(verify.ValidationError):
            verify.validate(project(start=65535, words=[1, 2]))

    def test_aggregate_compact_utf8_size_cap(self):
        # Every individual field, case, expectation, and count is within its
        # own limit. UTF-8 bytes, not Python character count, cause rejection.
        p = project()
        p["fields"] = [field(id=f"f{i}", note="😀" * 1000) for i in range(256)]
        assertions = {f["id"]: {"value": "9" * 40, "tolerance": "9" * 40} for f in p["fields"]}
        p["cases"] = [{"id": f"c{i}", "name": "Case", "space": "holding", "start": 0,
                       "words": [], "expected": copy.deepcopy(assertions)} for i in range(48)]
        compact = json.dumps(p, ensure_ascii=False, separators=(",", ":"))
        self.assertLess(len(compact), verify.MAX_BYTES)
        self.assertGreater(len(compact.encode("utf-8")), verify.MAX_BYTES)
        with self.assertRaisesRegex(verify.ValidationError, "compact UTF-8 JSON exceeds 2 MiB"):
            verify.validate(p)
        for f in p["fields"]:
            f["note"] = ""
        self.assertIs(verify.validate(p), p)

    def test_raw_import_size_limit_is_separate_and_inclusive(self):
        compact = json.dumps(project(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        exact_limit = compact + b" " * (verify.MAX_BYTES - len(compact))
        self.assertEqual(len(exact_limit), verify.MAX_BYTES)
        self.assertEqual(verify.load_project(exact_limit), project())
        with self.assertRaisesRegex(verify.ValidationError, "input exceeds 2 MiB"):
            verify.load_project(exact_limit + b" ")

    def test_hostile_json_and_size(self):
        valid = json.dumps(project())
        for bad in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', valid + " trailing", "[" * 2000,
                    "[" * 13 + "0" + "]" * 13, b"\xff", valid.encode() + b" " * verify.MAX_BYTES):
            with self.subTest(prefix=str(bad)[:30]), self.assertRaises(verify.ValidationError):
                verify.load_project(bad)
        self.assertEqual(verify.load_project(valid), project())


class DecodeTests(unittest.TestCase):
    def test_16_bit_endian_and_signed_boundaries(self):
        examples = [("uint16", "AB", [0x1234], "4660", "1234"),
                    ("uint16", "BA", [0x1234], "13330", "3412"),
                    ("int16", "AB", [0x8000], "-32768", "8000"),
                    ("int16", "BA", [0x0080], "-32768", "8000"),
                    ("int16", "AB", [0xFFFF], "-1", "FFFF"),
                    ("uint16", "AB", [0xFFFF], "65535", "FFFF")]
        for kind, order, words, number, bits in examples:
            actual = verify.decode(field(type=kind, order=order), words)
            self.assertEqual((actual["value"], actual["bits"]), (number, bits))

    def test_32_bit_orders_and_signed_boundaries(self):
        captures = {"ABCD": [0x1234, 0x5678], "CDAB": [0x5678, 0x1234],
                    "BADC": [0x3412, 0x7856], "DCBA": [0x7856, 0x3412]}
        for order, words in captures.items():
            with self.subTest(order=order):
                actual = verify.decode(field(type="uint32", order=order), words)
                self.assertEqual(actual["value"], "305419896")
                self.assertEqual(actual["bits"], "12345678")
        for kind, words, expected in (("int32", [0x8000, 0], "-2147483648"),
                                       ("int32", [0x7FFF, 0xFFFF], "2147483647"),
                                       ("int32", [0xFFFF, 0xFFFF], "-1"),
                                       ("uint32", [0xFFFF, 0xFFFF], "4294967295")):
            self.assertEqual(verify.decode(field(type=kind, order="ABCD"), words)["value"], expected)

    def test_integer_scaling_is_exact_and_context_independent(self):
        f = field(type="uint32", order="ABCD", scale="0.000000000000000001", offset="0.1")
        value = verify.decode(f, [0xFFFF, 0xFFFF])["value"]
        self.assertEqual(value, "0.100000004294967295")
        f.update(scale="9999999999999999999999999999999999999999", offset="-1")
        self.assertEqual(verify.decode(f, [0xFFFF, 0xFFFF])["value"], str(4294967295 * int(f["scale"]) - 1))
        self.assertEqual(verify.decode(field(scale="-1", offset="0"), [0])["value"], "0")

    def test_float_values_and_special_bits(self):
        f = field(type="float32", order="ABCD")
        examples = [(0x3F800000, "1"), (0x80000000, "-0"), (0, "0"),
                    (0x7F800000, "Infinity"), (0xFF800000, "-Infinity"), (0x7FC12345, "NaN"),
                    (0x7F812345, "NaN"), (0xFFC12345, "NaN"),
                    (0x3DCCCCCD, "0.100000001490116119384765625")]
        for bits, expected in examples:
            with self.subTest(bits=hex(bits)):
                actual = verify.decode(f, [bits >> 16, bits & 65535])
                self.assertEqual(actual["value"], expected)
                self.assertEqual(actual["bits"], f"{bits:08X}")

    def test_float_min_subnormal_and_max_finite(self):
        f = field(type="float32", order="ABCD")
        for bits in (1, 0x007FFFFF, 0x00800000, 0x7F7FFFFF, 0xFF7FFFFF):
            result = verify.decode(f, [bits >> 16, bits & 65535])
            oracle = Decimal.from_float(struct.unpack("!f", bits.to_bytes(4, "big"))[0])
            self.assertEqual(Decimal(result["value"]), oracle)
            self.assertNotIn("e", result["value"].lower())

    def test_random_binary_float_and_integer_vectors(self):
        rng = random.Random(9876543)
        for _ in range(1000):
            bits = rng.getrandbits(32)
            data = bits.to_bytes(4, "big")
            words = [int.from_bytes(data[:2], "big"), int.from_bytes(data[2:], "big")]
            f = field(type="int32", order="ABCD")
            self.assertEqual(verify.decode(f, words)["value"], str(struct.unpack("!i", data)[0]))
            f["type"] = "float32"
            actual = verify.decode(f, words)
            self.assertEqual(actual["bits"], f"{bits:08X}")
            if actual["value"] not in verify.SPECIALS:
                self.assertEqual(Decimal(actual["value"]), Decimal.from_float(struct.unpack("!f", data)[0]))

    def test_decode_requires_exact_word_count(self):
        for words in ([], [1, 2], [True]):
            with self.assertRaises(verify.ValidationError):
                verify.decode(field(), words)


class RunTests(unittest.TestCase):
    def test_pass_mismatch_missing_unasserted(self):
        for p, status in ((project(), "pass"), (project(value="43"), "mismatch"),
                          (project(words=[]), "missing"), (project(expected={}), "unasserted")):
            report = verify.run(p)
            self.assertEqual(report["results"][0]["status"], status)
            self.assertEqual(report["ok"], status == "pass")
            self.assertEqual(sum(report["counts"].values()), 1)

    def test_missing_takes_precedence_over_unasserted(self):
        self.assertEqual(verify.run(project(words=[], expected={}))["results"][0]["status"], "missing")

    def test_no_case_space_gap_is_incomplete(self):
        p = project()
        p["fields"].append(field(id="uncovered", space="input"))
        report = verify.run(p)
        self.assertFalse(report["ok"])
        self.assertEqual(report["results"][-1], {"caseId": None, "fieldId": "uncovered", "status": "unasserted", "reason": "No case in this register space"})

    def test_empty_project_and_no_assertions_incomplete(self):
        p = project()
        p["cases"] = []
        self.assertFalse(verify.run(p)["ok"])
        p["fields"] = []
        self.assertFalse(verify.run(p)["ok"])
        p = project(expected={})
        self.assertFalse(verify.run(p)["ok"])

    def test_case_start_and_address_conventions(self):
        for convention, address in (("pdu", 22), ("one", 23), ("reference", 40023)):
            p = project(field(convention=convention, address=address), [5, 42], start=21)
            self.assertTrue(verify.run(p)["ok"])
        p = project(field(address=21), [42], start=22)
        self.assertEqual(verify.run(p)["results"][0]["status"], "missing")

    def test_partial_two_word_field_is_missing(self):
        p = project(field(type="uint32", order="ABCD"), [1])
        self.assertEqual(verify.run(p)["results"][0]["status"], "missing")

    def test_overlap_is_visible_nonblocking_warning(self):
        p = project()
        p["fields"].append(field(id="alias", note="Intentional alias"))
        p["cases"][0]["expected"]["alias"] = {"value": "42", "tolerance": "0"}
        report = verify.run(p)
        self.assertTrue(report["ok"])
        self.assertEqual(report["warnings"], [{"space": "holding", "address": 0, "fieldIds": ["temperature", "alias"]}])

    def test_no_mutation_even_on_mismatch(self):
        p = project(value="1000")
        original = copy.deepcopy(p)
        verify.run(p)
        self.assertEqual(p, original)

    def test_property_names_are_plain_field_ids(self):
        for identifier in ("constructor", "toString", "valueOf", "hasOwnProperty"):
            with self.subTest(identifier=identifier):
                p = project(field(id=identifier), expected={})
                self.assertEqual(verify.run(p)["results"][0]["status"], "unasserted")
                p["cases"][0]["expected"][identifier] = {"value": "42", "tolerance": "0"}
                self.assertTrue(verify.run(p)["ok"])

    def test_exact_integer_tolerance_boundary(self):
        p = project(field(scale="0.1"), [3], "0.2", "0.1")
        self.assertTrue(verify.run(p)["ok"])
        p["cases"][0]["expected"]["temperature"]["tolerance"] = "0.099999999999999999"
        self.assertFalse(verify.run(p)["ok"])
        self.assertTrue(verify.run(project(words=[0], value="-0"))["ok"])

    def test_float_tolerance_and_signed_zero(self):
        f = field(type="float32", order="ABCD")
        for actual_words, expected, tolerance, passes in (([0x3DCC, 0xCCCD], "0.1", "0", False),
                                                        ([0x3DCC, 0xCCCD], "0.1", "0.000000002", True),
                                                        ([0x8000, 0], "-0", "0", True),
                                                        ([0x8000, 0], "-0.0", "0", True),
                                                        ([0x8000, 0], "0", "1", False),
                                                        ([0, 0], "-0", "1", False),
                                                        ([0, 0], "+0.0", "0", True)):
            with self.subTest(words=actual_words, expected=expected):
                self.assertEqual(verify.run(project(f, actual_words, expected, tolerance))["ok"], passes)

    def test_float_special_comparison(self):
        f = field(type="float32", order="ABCD")
        for words, expected, passes in (([0x7FC1, 0x2345], "NaN", True), ([0x7F80, 0], "Infinity", True),
                                       ([0xFF80, 0], "-Infinity", True), ([0x7F80, 0], "-Infinity", False),
                                       ([0x7FC1, 0x2345], "0", False), ([0, 0], "NaN", False)):
            self.assertEqual(verify.run(project(f, words, expected))["ok"], passes)


class CliTests(unittest.TestCase):
    def call_cli(self, content, *arguments):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.json"
            path.write_text(content, encoding="utf-8")
            return subprocess.run([sys.executable, str(SCRIPT), str(path), *arguments], capture_output=True, text=True, timeout=10)

    def test_exit_codes_and_json_reports(self):
        for p, code in ((project(), 0), (project(value="43"), 1), (project(expected={}), 1), (project(words=[]), 1)):
            result = self.call_cli(json.dumps(p), "--json")
            self.assertEqual(result.returncode, code, result.stderr)
            self.assertEqual(json.loads(result.stdout)["ok"], code == 0)
        result = self.call_cli('{"malicious": true}', "--json")
        self.assertEqual(result.returncode, 2)
        self.assertIn("error", json.loads(result.stdout))

    def test_cli_invalid_utf8_json_duplicates_and_trailing(self):
        for content in ('{"schema":"regdeck/v1","schema":"regdeck/v1"}', "not JSON", json.dumps(project()) + "x"):
            result = self.call_cli(content)
            self.assertEqual(result.returncode, 2)
            self.assertIn("INVALID:", result.stderr)
            self.assertNotIn("Traceback", result.stderr)

    def test_cli_missing_file_returns_two(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "/no/such/regdeck/project.json", "--json"], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2)
        self.assertIn("error", json.loads(result.stdout))

    def test_exported_single_file_runs_without_project_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / "verify.py"
            copied.write_bytes(SCRIPT.read_bytes())
            fixture = Path(directory) / "project.json"
            fixture.write_text(json.dumps(project()), encoding="utf-8")
            result = subprocess.run([sys.executable, str(copied), str(fixture)], cwd=directory, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("PASS: Independent fixture", result.stdout)


if __name__ == "__main__":
    unittest.main()
