#!/usr/bin/env python3
"""
Validates watchface.xml:
  1. against the official Watch Face Format XSD 1.1 schema (github.com/google/watchface)
  2. with a lint pass over every arithmetic expression (data sources, functions,
     brackets, string literals) mirroring the rules of Google's dwf-validator.

Usage: python3 tools/validate.py <path/to/google-watchface-repo> [version]
       (pip install xmlschema)
"""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import xmlschema

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / "watchface" / "src" / "main" / "res" / "raw" / "watchface.xml"
RES = ROOT / "watchface" / "src" / "main" / "res"

FUNCS = {"round": 1, "floor": 1, "ceil": 1, "fract": 1, "sin": 1, "cos": 1, "tan": 1, "asin": 1,
         "acos": 1, "atan": 1, "abs": 1, "clamp": 3, "rand": 2, "log": 1, "log2": 1, "log10": 1,
         "sqrt": 1, "cbrt": 1, "exp": 1, "expm1": 1, "deg": 1, "rad": 1, "pow": 2, "numberFormat": 2,
         "icuText": (1, 2), "icuBestText": (1, 2), "subText": 3, "textLength": 1}

TOKEN = re.compile(r'\s*(?:(?P<num>\d+(?:\.\d+)?)|(?P<str>"[^"]*")|(?P<src>\[[A-Z0-9_.a-zA-Z]+\])|'
                   r'(?P<word>[a-zA-Z][a-zA-Z0-9_.]*)|(?P<op><=|>=|==|!=|&&|\|\||[-+*/%~!&|<>?:,()]))')

EXPR_ATTRS = {("Transform", "value"), ("Variant", "value"), ("Parameter", "expression"),
              ("Compare", "expression"), ("Gyro", "x"), ("Gyro", "y")}


def known_sources(xsd_dir):
    s = (xsd_dir / "common" / "attributes" / "sourceType.xsd").read_text()
    names = set(re.findall(r'<xs:enumeration value="([^"]+)"', s))
    # the XSD has two typos; the runtime names are documented without the double prefix
    names |= {"WEATHER.UV_INDEX", "WEATHER.LAST_UPDATED", "WEATHER.DAY_TEMPERATURE_LOW",
              "WEATHER.DAY_TEMPERATURE_HIGH"}
    return names


def lint_expression(expr, sources, errors, where):
    pos, depth, tokens = 0, 0, []
    expr = expr.strip()
    while pos < len(expr):
        m = TOKEN.match(expr, pos)
        if not m or m.end() == pos:
            errors.append(f"{where}: cannot tokenise at {expr[pos:pos + 15]!r} in {expr!r}")
            return
        pos = m.end()
        kind = m.lastgroup
        val = m.group(kind)
        tokens.append((kind, val))
        if kind == "src":
            name = val[1:-1]
            if name.startswith(("CONFIGURATION.", "COMPLICATION.")):
                continue
            base = re.sub(r"\.\d+\.", ".", name)
            if name not in sources and base not in sources and not re.match(r"WEATHER\.(HOURS|DAYS)\.\d+\.", name):
                errors.append(f"{where}: unknown data source [{name}]")
        elif kind == "op" and val == "(":
            depth += 1
        elif kind == "op" and val == ")":
            depth -= 1
            if depth < 0:
                errors.append(f"{where}: unbalanced ')' in {expr!r}")
    if depth != 0:
        errors.append(f"{where}: unbalanced parentheses in {expr!r}")
    # function names + arity
    for i, (kind, val) in enumerate(tokens):
        if kind == "word":
            if val in ("true", "false", "TRUE", "FALSE"):
                continue
            if i + 1 < len(tokens) and tokens[i + 1] == ("op", "("):
                if val not in FUNCS:
                    errors.append(f"{where}: unknown function {val}()")
                    continue
                d, args, j = 0, 1, i + 1
                while j < len(tokens):
                    k, v = tokens[j]
                    if v == "(":
                        d += 1
                    elif v == ")":
                        d -= 1
                        if d == 0:
                            break
                    elif v == "," and d == 1:
                        args += 1
                    j += 1
                want = FUNCS[val]
                ok = args in want if isinstance(want, tuple) else args == want
                if not ok:
                    errors.append(f"{where}: {val}() takes {want} args, got {args}")
            elif where.startswith("Compare"):
                pass
            else:
                errors.append(f"{where}: bare identifier {val!r} would be read as a string resource")


def lint(root, sources):
    errors, warnings = [], []
    count = 0
    for el in root.iter():
        for (tag, attr) in EXPR_ATTRS:
            if el.tag == tag and attr in el.attrib and tag != "Compare":
                count += 1
                lint_expression(el.attrib[attr], sources, errors, f"{tag}@{attr}")
        if el.tag == "Expression":
            count += 1
            lint_expression(el.text or "", sources, errors, f"Expression[{el.get('name')}]")
    # resources referenced by images / fonts must exist
    drawables = {p.stem for p in (RES / "drawable-nodpi").glob("*.png")}
    fonts = {p.stem for p in (RES / "font").glob("*.ttf")}
    strings = set(re.findall(r'<string name="([^"]+)"', (RES / "values" / "strings.xml").read_text()))
    for el in root.iter():
        r = el.get("resource")
        if r and not r.startswith("[") and r not in drawables:
            errors.append(f"missing drawable '{r}'")
        fam = el.get("family")
        if fam and fam != "SYNC_TO_DEVICE" and fam not in fonts:
            errors.append(f"missing font '{fam}'")
        for k in ("displayName",):
            v = el.get(k)
            if v and v.startswith("@string/") and v[8:] not in strings:
                errors.append(f"missing string '{v}'")
    # configuration references must point at declared configurations
    declared = {e.get("id") for e in root.find("UserConfigurations")}
    for el in root.iter():
        if el.tag in ("ListConfiguration", "BooleanConfiguration") and el.find("..") is None:
            pass
    for scene_cfg in root.find("Scene").iter():
        if scene_cfg.tag in ("ListConfiguration", "BooleanConfiguration") and scene_cfg.get("id") not in declared:
            errors.append(f"scene references undeclared configuration '{scene_cfg.get('id')}'")
    for el in root.iter():
        for v in el.attrib.values():
            for ref in re.findall(r"\[CONFIGURATION\.([A-Za-z0-9_]+)", v):
                if ref not in declared:
                    errors.append(f"undeclared configuration in color/expression: {ref}")
    slots = root.findall(".//ComplicationSlot")
    if len(slots) > 8:
        errors.append("more than 8 complication slots")
    return count, errors, warnings


def main():
    repo = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    version = sys.argv[2] if len(sys.argv) > 2 else "2"
    if repo is None:
        sys.exit(__doc__)
    xsd_dir = repo / "third_party" / "wff" / "specification" / "documents" / version
    schema = xmlschema.XMLSchema11(str(xsd_dir / "watchface.xsd"))
    errs = list(schema.iter_errors(str(WF)))
    for e in errs[:25]:
        print("XSD:", e.reason, "@", e.path)
    root = ET.parse(WF).getroot()
    count, lint_errors, _ = lint(root, known_sources(xsd_dir))
    for e in lint_errors:
        print("LINT:", e)
    print(f"WFF v{version} XSD: {'PASS' if not errs else f'{len(errs)} error(s)'}; "
          f"expressions checked: {count}; lint: {'PASS' if not lint_errors else f'{len(lint_errors)} issue(s)'}")
    sys.exit(1 if errs or lint_errors else 0)


if __name__ == "__main__":
    main()
