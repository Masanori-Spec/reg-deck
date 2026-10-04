#!/usr/bin/env python3
"""RegDeck v1: dependency-free, offline Modbus register fixture verifier.

Usage: python verify.py project.json [--json]
Exit status: 0 all checked; 1 mismatch or incomplete; 2 invalid input / I/O.
This file is intentionally self-contained so an exported copy can run unchanged.
It never contacts a device, executes project content, or rewrites expectations.
"""

import argparse
from decimal import Decimal, localcontext
import json
import math
from pathlib import Path
import re
import struct
import sys

MAX_BYTES = 2 * 1024 * 1024
MAX_FIELDS = 256
MAX_CASES = 64
MAX_WORDS = 4096
MAX_TOTAL_WORDS = 65536
ID_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,39}\Z", re.ASCII)
DECIMAL_RE = re.compile(r"[+-]?[0-9]+(?:\.[0-9]{1,18})?\Z", re.ASCII)
SPACES = ("holding", "input")
TYPES = ("uint16", "int16", "uint32", "int32", "float32")
SPECIALS = ("Infinity", "-Infinity", "NaN")
FIELD_KEYS = {"id", "label", "space", "address", "convention", "type", "order", "scale", "offset", "unit", "note"}
CASE_KEYS = {"id", "name", "space", "start", "words", "expected"}


class ValidationError(ValueError):
    """The input is not an unambiguous, bounded RegDeck v1 project."""


def _fail(path, message):
    raise ValidationError(f"{path}: {message}")


def _object(value, keys, path):
    if not isinstance(value, dict):
        _fail(path, "must be an object")
    if set(value) != keys:
        missing = sorted(keys - set(value))
        unknown = sorted(str(k) for k in set(value) - keys)
        details = []
        if missing:
            details.append("missing keys " + ", ".join(missing))
        if unknown:
            details.append("unknown keys " + ", ".join(unknown))
        _fail(path, "; ".join(details))


def _text(value, limit, path, nonempty=False, note=False):
    if not isinstance(value, str):
        _fail(path, "must be a string")
    # ECMAScript trim also treats U+FEFF as whitespace; use the same emptiness
    # rule as the browser without mutating the user's stored text.
    if len(value) > limit or (nonempty and not value.replace("\ufeff", "").strip()):
        _fail(path, f"must contain {'1' if nonempty else '0'}..{limit} characters")
    for char in value:
        number = ord(char)
        if (number < 32 or 127 <= number <= 159) and not (note and char in "\n\t"):
            _fail(path, "contains a forbidden control character")
        if 0xD800 <= number <= 0xDFFF:
            _fail(path, "contains an unpaired Unicode surrogate")


def _id(value, path):
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        _fail(path, "must match [A-Za-z][A-Za-z0-9_-]{0,39}")


def _integer(value, low, high, path):
    if type(value) is not int or not low <= value <= high:
        _fail(path, f"must be an integer from {low} to {high}")


def _decimal(value, path, nonnegative=False):
    if not isinstance(value, str) or len(value) > 40 or not DECIMAL_RE.fullmatch(value):
        _fail(path, "must be a plain decimal string of at most 40 characters and 18 fractional digits")
    number = Decimal(value)
    if nonnegative and number < 0:
        _fail(path, "must not be negative")
    return number


def width(field):
    return 1 if field["type"] in ("uint16", "int16") else 2


def pdu_address(field):
    """Return a field's zero-based register address after validation."""
    address = field["address"]
    if field["convention"] == "one":
        return address - 1
    if field["convention"] == "reference":
        return address - (40001 if field["space"] == "holding" else 30001)
    return address


def _validate_field(field, path):
    _object(field, FIELD_KEYS, path)
    _id(field["id"], path + ".id")
    _text(field["label"], 120, path + ".label", nonempty=True)
    _text(field["unit"], 40, path + ".unit")
    _text(field["note"], 1000, path + ".note", note=True)
    if field["space"] not in SPACES:
        _fail(path + ".space", "must be holding or input")
    if field["type"] not in TYPES:
        _fail(path + ".type", "unsupported register type")
    if field["convention"] not in ("pdu", "one", "reference"):
        _fail(path + ".convention", "must be pdu, one, or reference")
    if field["convention"] == "pdu":
        low, high = 0, 65535
    elif field["convention"] == "one":
        low, high = 1, 65536
    else:
        low, high = (40001, 49999) if field["space"] == "holding" else (30001, 39999)
    _integer(field["address"], low, high, path + ".address")
    if pdu_address(field) + width(field) > 65536:
        _fail(path + ".address", "field extends beyond the 16-bit PDU address space")
    orders = ("AB", "BA") if width(field) == 1 else ("ABCD", "CDAB", "BADC", "DCBA")
    if field["order"] not in orders:
        _fail(path + ".order", "order does not match the type width")
    scale = _decimal(field["scale"], path + ".scale")
    offset = _decimal(field["offset"], path + ".offset")
    if field["type"] == "float32" and (scale != 1 or offset != 0):
        _fail(path, "float32 requires scale 1 and offset 0")


def validate(project):
    """Validate schema and compact UTF-8 size without mutation.

    The logical compact project must fit 2 MiB, even when constructed through
    the API. ``load_project`` additionally limits the raw imported byte count.
    Return the same project, or raise ValidationError.
    """
    _object(project, {"schema", "name", "fields", "cases"}, "project")
    if project["schema"] != "regdeck/v1":
        _fail("project.schema", "must be regdeck/v1")
    _text(project["name"], 120, "project.name", nonempty=True)
    if not isinstance(project["fields"], list) or len(project["fields"]) > MAX_FIELDS:
        _fail("project.fields", f"must be an array of at most {MAX_FIELDS} fields")
    if not isinstance(project["cases"], list) or len(project["cases"]) > MAX_CASES:
        _fail("project.cases", f"must be an array of at most {MAX_CASES} cases")
    fields = {}
    for index, field in enumerate(project["fields"]):
        path = f"project.fields[{index}]"
        _validate_field(field, path)
        if field["id"] in fields:
            _fail(path + ".id", "duplicate field ID")
        fields[field["id"]] = field
    case_ids = set()
    total_words = 0
    for index, case in enumerate(project["cases"]):
        path = f"project.cases[{index}]"
        _object(case, CASE_KEYS, path)
        _id(case["id"], path + ".id")
        if case["id"] in case_ids:
            _fail(path + ".id", "duplicate case ID")
        case_ids.add(case["id"])
        _text(case["name"], 120, path + ".name", nonempty=True)
        if case["space"] not in SPACES:
            _fail(path + ".space", "must be holding or input")
        _integer(case["start"], 0, 65535, path + ".start")
        words = case["words"]
        if not isinstance(words, list) or len(words) > MAX_WORDS:
            _fail(path + ".words", f"must be an array of at most {MAX_WORDS} words")
        total_words += len(words)
        if total_words > MAX_TOTAL_WORDS:
            _fail("project.cases", f"total word count exceeds {MAX_TOTAL_WORDS}")
        if case["start"] + len(words) > 65536:
            _fail(path + ".words", "capture extends beyond the 16-bit PDU address space")
        for word_index, word in enumerate(words):
            _integer(word, 0, 65535, f"{path}.words[{word_index}]")
        expected = case["expected"]
        if not isinstance(expected, dict) or len(expected) > len(fields):
            _fail(path + ".expected", "must be an object with at most one expectation per field")
        for field_id, assertion in expected.items():
            assertion_path = f"{path}.expected.{field_id}"
            if field_id not in fields:
                _fail(assertion_path, "unknown field ID")
            field = fields[field_id]
            if field["space"] != case["space"]:
                _fail(assertion_path, "expectation field belongs to another register space")
            _object(assertion, {"value", "tolerance"}, assertion_path)
            tolerance = _decimal(assertion["tolerance"], assertion_path + ".tolerance", nonnegative=True)
            if assertion["value"] in SPECIALS:
                if field["type"] != "float32" or tolerance != 0:
                    _fail(assertion_path, "nonfinite expectations require float32 and zero tolerance")
            else:
                _decimal(assertion["value"], assertion_path + ".value")
    compact = json.dumps(project, ensure_ascii=False, separators=(",", ":"))
    if len(compact.encode("utf-8")) > MAX_BYTES:
        _fail("project", "compact UTF-8 JSON exceeds 2 MiB")
    return project


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError("JSON contains duplicate object key: " + key)
        result[key] = value
    return result


def _invalid_constant(value):
    raise ValidationError("JSON contains a nonstandard numeric literal: " + value)


def _check_depth(value, depth=0):
    if depth > 12:
        raise ValidationError("JSON nesting exceeds 12 levels")
    if isinstance(value, dict):
        for item in value.values():
            _check_depth(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _check_depth(item, depth + 1)


def load_project(content):
    """Strict UTF-8 JSON loader, including duplicate-key and 2 MiB checks."""
    if isinstance(content, bytes):
        if len(content) > MAX_BYTES:
            raise ValidationError("input exceeds 2 MiB")
        try:
            content = content.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValidationError("input must be valid UTF-8") from error
    elif isinstance(content, str):
        try:
            if len(content.encode("utf-8")) > MAX_BYTES:
                raise ValidationError("input exceeds 2 MiB")
        except UnicodeEncodeError as error:
            raise ValidationError("input contains an unpaired Unicode surrogate") from error
    else:
        raise ValidationError("input must be UTF-8 bytes or JSON text")
    try:
        project = json.loads(content, object_pairs_hook=_pairs, parse_constant=_invalid_constant)
    except (ValueError, RecursionError) as error:
        raise ValidationError("invalid JSON: " + str(error)) from error
    _check_depth(project)
    return validate(project)


def decimal_text(number, signed_zero=False):
    """Canonical non-exponent decimal text without rounding."""
    if number == 0:
        return "-0" if signed_zero and number.is_signed() else "0"
    text = format(number, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def decode(field, words):
    """Decode exactly the field's 1 or 2 words, supplied in captured word order.

    Field address is not an index into ``words``. The caller must slice the case.
    Returns JSON-safe raw/value strings, canonical uppercase bits, and input words.
    Float value is the exact IEEE-754 binary32 decimal expansion, including -0.
    """
    _validate_field(field, "field")
    if not isinstance(words, (list, tuple)) or len(words) != width(field):
        raise ValidationError("decode.words: must contain exactly the field width")
    for index, word in enumerate(words):
        _integer(word, 0, 65535, f"decode.words[{index}]")
    captured = b"".join(word.to_bytes(2, "big") for word in words)
    order = field["order"]
    canonical = bytes(captured[ord(letter) - ord("A")] for letter in order)
    bits = canonical.hex().upper()
    if field["type"] == "float32":
        number = struct.unpack(">f", canonical)[0]
        if math.isnan(number):
            value = "NaN"
        elif math.isinf(number):
            value = "Infinity" if number > 0 else "-Infinity"
        else:
            value = decimal_text(Decimal.from_float(number), signed_zero=True)
        raw = value
    else:
        number = int.from_bytes(canonical, "big", signed=field["type"].startswith("int"))
        raw = str(number)
        with localcontext() as context:
            context.prec = 200
            scaled = Decimal(number) * Decimal(field["scale"]) + Decimal(field["offset"])
        value = decimal_text(scaled)
    return {"raw": raw, "value": value, "bits": bits, "words": list(words)}


def compare(field, decoded, expectation):
    """Compare a validated decode and independent expectation without mutation."""
    actual = decoded["value"]
    expected = expectation["value"]
    if actual in SPECIALS or expected in SPECIALS:
        return actual == expected
    with localcontext() as context:
        context.prec = 200
        actual_number = Decimal(actual)
        expected_number = Decimal(expected)
        if field["type"] == "float32" and actual_number == expected_number == 0:
            if actual_number.is_signed() != expected_number.is_signed():
                return False
        return abs(actual_number - expected_number) <= Decimal(expectation["tolerance"])


def overlap_warnings(fields):
    occupied = {}
    for field in fields:
        for address in range(pdu_address(field), pdu_address(field) + width(field)):
            occupied.setdefault((field["space"], address), []).append(field["id"])
    return [
        {"space": space, "address": address, "fieldIds": ids}
        for (space, address), ids in sorted(occupied.items())
        if len(ids) > 1
    ]


def run(project):
    """Validate and verify every same-space field/case pair, without mutation."""
    validate(project)
    results = []
    counts = {"pass": 0, "mismatch": 0, "missing": 0, "unasserted": 0}
    visited = set()
    for case in project["cases"]:
        for field in project["fields"]:
            if field["space"] != case["space"]:
                continue
            visited.add(field["id"])
            result = {"caseId": case["id"], "fieldId": field["id"]}
            expectation = case["expected"].get(field["id"])
            if expectation is not None:
                result.update(expected=expectation["value"], tolerance=expectation["tolerance"])
            start = pdu_address(field) - case["start"]
            if start < 0 or start + width(field) > len(case["words"]):
                result["status"] = "missing"
            else:
                decoded = decode(field, case["words"][start:start + width(field)])
                result.update(decoded)
                result["status"] = "unasserted" if expectation is None else (
                    "pass" if compare(field, decoded, expectation) else "mismatch"
                )
            counts[result["status"]] += 1
            results.append(result)
    for field in project["fields"]:
        if field["id"] not in visited:
            results.append({"caseId": None, "fieldId": field["id"], "status": "unasserted", "reason": "No case in this register space"})
            counts["unasserted"] += 1
    ok = counts["pass"] > 0 and not any(counts[status] for status in ("mismatch", "missing", "unasserted"))
    return {"schema": "regdeck-report/v1", "name": project["name"], "ok": ok,
            "counts": counts, "warnings": overlap_warnings(project["fields"]), "results": results}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", help="path to a RegDeck v1 JSON project")
    parser.add_argument("--json", action="store_true", help="emit a machine-readable report")
    arguments = parser.parse_args(argv)
    try:
        with Path(arguments.project).open("rb") as source:
            content = source.read(MAX_BYTES + 1)
        report = run(load_project(content))
    except (OSError, ValidationError) as error:
        if arguments.json:
            print(json.dumps({"schema": "regdeck-report/v1", "ok": False, "error": str(error)}, ensure_ascii=True))
        else:
            print("INVALID: " + str(error), file=sys.stderr)
        return 2
    if arguments.json:
        print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
    else:
        print(f"{'PASS' if report['ok'] else 'FAIL / INCOMPLETE'}: {report['name']}")
        print(" | ".join(f"{status}: {count}" for status, count in report["counts"].items()))
        for warning in report["warnings"]:
            print(f"WARNING overlap {warning['space']} PDU {warning['address']}: " + ", ".join(warning["fieldIds"]))
        for result in report["results"]:
            line = f"{result['status'].upper()} {result['caseId'] or '(no case)'}/{result['fieldId']}"
            if "value" in result:
                line += f" = {result['value']} [bits {result['bits']}]"
            if "expected" in result:
                line += f"; expected {result['expected']} ± {result['tolerance']}"
            print(line)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
