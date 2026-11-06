#!/usr/bin/env python3
"""
Bundles the interactive simulator into one self-contained HTML file:
the WFF renderer, the real watchface.xml, every PNG and the two watch fonts are inlined.

  python3 tools/build_preview.py                 -> preview/index.html (open in any browser)
  python3 tools/build_preview.py --fragment OUT  -> body-only variant (no <html>/<head> wrapper)
"""
import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "watchface" / "src" / "main" / "res"
PREVIEW = ROOT / "preview"


def b64(path):
    return base64.b64encode(path.read_bytes()).decode("ascii")


def build_fragment():
    images = {p.stem: "data:image/png;base64," + b64(p)
              for p in sorted((RES / "drawable-nodpi").glob("*.png")) if p.stem != "preview"}
    fonts = "\n".join(
        f"@font-face{{font-family:'{fam}';font-weight:{w};font-style:normal;font-display:block;"
        f"src:url(data:font/ttf;base64,{b64(RES / 'font' / f)}) format('truetype')}}"
        for fam, w, f in [("Orbitron", 700, "orbitron_bold.ttf"), ("Orbitron", 500, "orbitron_medium.ttf"),
                          ("Share Tech Mono", 400, "share_tech_mono.ttf")])
    strings = dict(re.findall(r'<string name="([^"]+)">([^<]*)</string>', (RES / "values" / "strings.xml").read_text()))
    strings = {k: v.replace("\\'", "'") for k, v in strings.items()}
    xml = (RES / "raw" / "watchface.xml").read_text(encoding="utf-8")
    renderer = (PREVIEW / "wff-renderer.js").read_text(encoding="utf-8")
    html = (PREVIEW / "simulator.template.html").read_text(encoding="utf-8")

    def js(v):  # JSON is valid JS; keep "</script>" from closing the tag early
        return json.dumps(v, ensure_ascii=False).replace("</", "<\\/")

    return (html.replace("__FONTS_CSS__", fonts)
            .replace("/*__RENDERER__*/", renderer)
            .replace("__XML__", js(xml))
            .replace("__IMAGES__", js(images))
            .replace("__STRINGS__", js(strings)))


def main():
    frag = build_fragment()
    if len(sys.argv) > 2 and sys.argv[1] == "--fragment":
        Path(sys.argv[2]).write_text(frag, encoding="utf-8")
        print("fragment ->", sys.argv[2], f"({len(frag) // 1024} KB)")
        return
    doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           '</head>\n<body>\n' + frag + '\n</body>\n</html>\n')
    out = PREVIEW / "index.html"
    out.write_text(doc, encoding="utf-8")
    print("simulator ->", out, f"({len(doc) // 1024} KB)")


if __name__ == "__main__":
    main()
