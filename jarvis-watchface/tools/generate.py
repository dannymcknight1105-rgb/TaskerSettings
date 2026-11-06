#!/usr/bin/env python3
"""
J.A.R.V.I.S. HUD watch face generator.

Builds a Watch Face Format (WFF v2) watch face for Wear OS 5+ watches such as the
Galaxy Watch5 Pro and Galaxy Watch Ultra:

  watchface/src/main/res/raw/watchface.xml          <- the watch face itself
  watchface/src/main/res/drawable-nodpi/*.png       <- hex grid + chevron hands
  watchface/src/main/res/values/strings.xml         <- labels for the customize menu

Everything is drawn on a 450 x 450 virtual canvas; Wear OS scales it to the real
display (450 px on the Watch5 Pro, 480 px on the Watch Ultra).

Run:  python3 tools/generate.py
"""
import math
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "watchface" / "src" / "main" / "res"

W = H = 450
C = 225  # canvas centre

# ---------------------------------------------------------------- palette --
P = "[CONFIGURATION.themeColor.0]"  # primary  (HUD lines, readouts)
S = "[CONFIGURATION.themeColor.1]"  # secondary (gauge tracks, glow)
A = "[CONFIGURATION.themeColor.2]"  # accent   (hour chevron, warnings)
WHITE = "#FFFFFFFF"
SOFT = "#FFC9D6DF"
RED = "#FFFF3B30"
CLEAR = "#00000000"
BLACK = "#FF000000"

THEMES = [
    # id, string name, label, primary, secondary, accent
    ("0", "theme_arc", "Arc Reactor", "#FF4FE3FF", "#FF0E5A73", "#FFFFB23F"),
    ("1", "theme_mk3", "Mark III Hot Rod", "#FFFFC23D", "#FF7A0E12", "#FFFF5A3C"),
    ("2", "theme_war", "War Machine", "#FFD5DEE7", "#FF3A4450", "#FFFF6B3D"),
    ("3", "theme_stealth", "Stealth Mk XVI", "#FF9DB4C8", "#FF1E2935", "#FF4FE3FF"),
    ("4", "theme_extremis", "Extremis", "#FFFF7A2E", "#FF5C1A06", "#FFFFD27A"),
    ("5", "theme_rescue", "Rescue", "#FF8FB8FF", "#FF2B2A6E", "#FFE6B3FF"),
    ("6", "theme_nano", "Nano Red", "#FFFF4B4B", "#FF5E0D12", "#FFFFC23D"),
]

HONORIFICS = [
    ("0", "hon_sir", "Sir", "SIR"),
    ("1", "hon_maam", "Ma'am", "MA'AM"),
    ("2", "hon_boss", "Boss", "BOSS"),
    ("3", "hon_stark", "Mr. Stark", "MR. STARK"),
    ("4", "hon_none", "No title", None),
]

ZONES = [
    ("0", "zone_zulu", "Zulu (UTC)", "ZULU", "UTC"),
    ("1", "zone_malibu", "Malibu", "MALIBU", "America/Los_Angeles"),
    ("2", "zone_nyc", "New York", "NYC", "America/New_York"),
    ("3", "zone_london", "London", "LONDON", "Europe/London"),
    ("4", "zone_dubai", "Dubai", "DUBAI", "Asia/Dubai"),
    ("5", "zone_tokyo", "Tokyo", "TOKYO", "Asia/Tokyo"),
    ("6", "zone_sydney", "Sydney", "SYDNEY", "Australia/Sydney"),
]

F_BOLD = "orbitron_bold"
F_MED = "orbitron_medium"
F_MONO = "share_tech_mono"

# ------------------------------------------------------------- geometry ----
R_TICK = 222  # outer edge of minute ticks
R_SEC = 212  # seconds trail
R_GAUGE = 184  # data gauge centre line
R_LABEL = 166  # curved gauge labels
R_RING_A = 157  # dashed reactor ring
R_RING_B = 151  # segmented reactor ring
R_INNER = 145  # content boundary

GAUGES = {
    # name: (start, end) clockwise, 54 degree span, 36 degree gaps on the cardinals
    "power": (288, 342),
    "heart": (18, 72),
    "steps": (108, 162),
    "core": (198, 252),
}
SPAN = 54

# Rotation helpers (one revolution per N seconds; N must divide 60*k cleanly)
SECS = "[SECOND_MILLISECOND]"
ROT_120_CW = "(([MINUTE] % 2) * 60 + [SECOND_MILLISECOND]) * 3"
ROT_180_CCW = "0 - (([MINUTE] % 3) * 60 + [SECOND_MILLISECOND]) * 2"
ROT_6_CW = "([SECOND_MILLISECOND] % 6) * 60"
# label alpha that "beats" at the wearer's measured heart rate
HEARTBEAT = "150 + 105 * pow(abs(cos(rad([SECOND_MILLISECOND] * clamp([HEART_RATE], 30, 220) * 3))), 6)"
# 1 Hz breathing used while charging
BREATHE = "165 + 90 * sin(rad([SECOND_MILLISECOND] * 360))"


# ============================================================ XML helpers ==
def num(v):
    if isinstance(v, float):
        s = f"{v:.3f}".rstrip("0").rstrip(".")
        return s if s not in ("", "-0") else "0"
    return str(v)


def E(tag, attrs=None, *children, text=None):
    e = ET.Element(tag)
    for k, v in (attrs or {}).items():
        if v is not None:
            e.set(k, num(v))
    add(e, children)
    if text is not None:
        e.text = text
    return e


def add(parent, children):
    for c in children:
        if c is None:
            continue
        if isinstance(c, (list, tuple)):
            add(parent, c)
        else:
            parent.append(c)
    return parent


def mixed(parent, pieces):
    """Append text and elements as XML mixed content."""
    last = None
    for p in pieces:
        if p is None:
            continue
        if isinstance(p, str):
            if last is None:
                parent.text = (parent.text or "") + p
            else:
                last.tail = (last.tail or "") + p
        else:
            parent.append(p)
            last = p
    return parent


def box(x, y, w, h):
    return {"x": int(round(x)), "y": int(round(y)), "width": int(round(w)), "height": int(round(h))}


def full():
    return box(0, 0, W, H)


def ambient(value):
    return E("Variant", {"mode": "AMBIENT", "target": "alpha", "value": value})


def hide_in_ambient():
    return ambient("0")


def transform(target, value):
    return E("Transform", {"target": target, "value": value})


def launch(target):
    return E("Launch", {"target": target})


def T(fmt, *exprs):
    t = E("Template")
    t.text = fmt
    for ex in exprs:
        t.append(E("Parameter", {"expression": ex}))
    return t


def Upper(*pieces):
    return mixed(E("Upper"), pieces)


def font(family, size, color, content, letter=None, glow=None):
    """content is plain text or ONE Template/Upper element (never mixed), so the
    renderer never has to guess how whitespace between pieces is trimmed."""
    assert isinstance(content, (str, ET.Element)), content
    f = E("Font", {"family": family, "size": size, "color": color, "letterSpacing": letter})
    target = f
    if glow:
        target = E("OutGlow", {"color": glow[0], "radius": glow[1]})
        f.append(target)
    if isinstance(content, str):
        target.text = content
    else:
        target.append(content)
    return f


def text(name, x, y, w, h, family, size, color, pieces, align="CENTER", letter=None,
         alpha=None, glow=None, angle=None, extra=()):
    a = {"name": name, **box(x, y, w, h), "alpha": alpha}
    if angle is not None:
        a.update({"angle": angle, "pivotX": 0.5, "pivotY": 0.5})
    return E("PartText", a, *extra,
             E("Text", {"align": align}, font(family, size, color, pieces, letter, glow)))


def ctext(name, radius, start, end, family, size, color, pieces, direction="CLOCKWISE",
          alpha=None, letter=None, extra=()):
    """Curved text centred on the canvas."""
    return E("PartText", {"name": name, **full(), "alpha": alpha}, *extra,
             E("TextCircular", {"centerX": C, "centerY": C, "width": radius * 2, "height": radius * 2,
                                "startAngle": start, "endAngle": end, "direction": direction,
                                "align": "CENTER"},
               font(family, size, color, pieces, letter)))


def stroke(color, thickness, cap=None, dash=None, children=()):
    return E("Stroke", {"color": color, "thickness": thickness, "cap": cap, "dashIntervals": dash}, *children)


def arc(radius, start, end, strk, cx=C, cy=C, transforms=()):
    return E("Arc", {"centerX": cx, "centerY": cy, "width": radius * 2, "height": radius * 2,
                     "startAngle": start, "endAngle": end}, strk, *transforms)


def draw(name, *shapes, alpha=None, x=0, y=0, w=W, h=H, extra=()):
    return E("PartDraw", {"name": name, **box(x, y, w, h), "alpha": alpha}, *extra, *shapes)


def group(name, *children, x=0, y=0, w=W, h=H, alpha=None, pivot=False, extra=()):
    a = {"name": name, **box(x, y, w, h), "alpha": alpha}
    if pivot:
        a.update({"pivotX": 0.5, "pivotY": 0.5})
    return E("Group", a, *extra, *children)


def polar(r, deg, cx=C, cy=C):
    t = math.radians(deg)
    return cx + r * math.sin(t), cy - r * math.cos(t)


def line(r1, r2, deg, strk, cx=C, cy=C):
    x1, y1 = polar(r1, deg, cx, cy)
    x2, y2 = polar(r2, deg, cx, cy)
    return E("Line", {"startX": round(x1, 2), "startY": round(y1, 2),
                      "endX": round(x2, 2), "endY": round(y2, 2)}, strk)


def condition(exprs, compares, default=None):
    """exprs: [(name, expression)], compares: [(name, [children])]"""
    c = E("Condition")
    ex = E("Expressions")
    for n, v in exprs:
        ex.append(E("Expression", {"name": n}, text=v))
    c.append(ex)
    for n, kids in compares:
        c.append(E("Compare", {"expression": n}, *kids))
    if default is not None:
        c.append(E("Default", None, *default))
    return c


def gyro(px):
    """Parallax offset of +/- px pixels when the wrist tilts."""
    return E("Gyro", {"x": f"clamp([ACCELEROMETER_ANGLE_X], -60, 60) * {px / 60:.4f}",
                      "y": f"clamp([ACCELEROMETER_ANGLE_Y], -60, 60) * {px / 60:.4f}"})


def tap_zone(name, x, y, w, h, target):
    return group(name, draw(f"{name}_hit", E("Rectangle", box(0, 0, w, h), E("Fill", {"color": CLEAR}))),
                 x=x, y=y, w=w, h=h, extra=[launch(target)])


# ============================================================ watch face ===
def user_configurations():
    uc = E("UserConfigurations")
    cc = E("ColorConfiguration", {"id": "themeColor", "displayName": "@string/cfg_theme", "defaultValue": "0"})
    for tid, sname, _, p, s, a in THEMES:
        cc.append(E("ColorOption", {"id": tid, "displayName": f"@string/{sname}", "colors": f"{p} {s} {a}"}))
    uc.append(cc)

    hon = E("ListConfiguration", {"id": "honorific", "displayName": "@string/cfg_honorific", "defaultValue": "0"})
    for hid, sname, _, _ in HONORIFICS:
        hon.append(E("ListOption", {"id": hid, "displayName": f"@string/{sname}"}))
    uc.append(hon)

    zone = E("ListConfiguration", {"id": "zone", "displayName": "@string/cfg_zone", "defaultValue": "0"})
    for zid, sname, _, _, _ in ZONES:
        zone.append(E("ListOption", {"id": zid, "displayName": f"@string/{sname}"}))
    uc.append(zone)

    uc.append(E("BooleanConfiguration", {"id": "hudMotion", "displayName": "@string/cfg_motion", "defaultValue": "TRUE"}))
    uc.append(E("BooleanConfiguration", {"id": "hexGrid", "displayName": "@string/cfg_hex", "defaultValue": "TRUE"}))
    return uc


# ---------------------------------------------------------------- layers --
def layer_background():
    glow = draw("core_glow",
                E("Ellipse", box(0, 0, W, H),
                  E("Fill", {"color": BLACK},
                    E("RadialGradient", {"centerX": C, "centerY": C, "radius": C,
                                         "colors": f"{S} {CLEAR}", "positions": "0 1"}))),
                alpha=150, extra=[hide_in_ambient()])

    hexes = group("hex_layer",
                  E("PartImage", {"name": "hex_grid", **full(), "alpha": 255, "tintColor": P},
                    E("Image", {"resource": "hex_grid"})),
                  extra=[gyro(8), hide_in_ambient()])

    radar = group("radar_sweep",
                  draw("radar_wedge",
                       E("Ellipse", box(C - R_INNER, C - R_INNER, R_INNER * 2, R_INNER * 2),
                         E("Fill", {"color": CLEAR},
                           E("SweepGradient", {"centerX": C, "centerY": C, "startAngle": 0, "endAngle": 360,
                                               "colors": f"{CLEAR} {CLEAR} {P}",
                                               "positions": "0 0.82 1"}))),
                       line(0, R_INNER, 0, stroke(P, 1.5)), alpha=46),
                  pivot=True, extra=[transform("angle", ROT_6_CW), hide_in_ambient()])

    hex_cfg = E("BooleanConfiguration", {"id": "hexGrid"},
                E("BooleanOption", {"id": "TRUE"}, group("hex_and_radar", hexes,
                  E("BooleanConfiguration", {"id": "hudMotion"},
                    E("BooleanOption", {"id": "TRUE"}, radar)))))
    return [glow, hex_cfg]


def layer_bezel():
    minor = []
    major = []
    cardinal = []
    for i in range(60):
        deg = i * 6
        if i % 15 == 0:
            cardinal.append(line(203, R_TICK, deg, stroke(A, 3.2)))
        elif i % 5 == 0:
            major.append(line(207, R_TICK, deg, stroke(P, 2.4)))
        else:
            minor.append(line(215, R_TICK, deg, stroke(SOFT, 1.2)))
    outer_ring = arc(R_TICK + 1.5, 0, 360, stroke(S, 1.0))
    return [
        draw("ticks_minor", *minor, outer_ring, alpha=150, extra=[hide_in_ambient()]),
        draw("ticks_major", *major, alpha=255, extra=[ambient("110")]),
        draw("ticks_cardinal", *cardinal, alpha=255, extra=[ambient("140")]),
    ]


def seconds_layer(smooth):
    sec = SECS if smooth else "[SECOND]"
    trail = draw("seconds_trail",
                 arc(R_SEC, 0, 0.1, stroke(P, 2.0), transforms=[transform("endAngle", f"{sec} * 6")]),
                 alpha=110)
    comet = group("seconds_comet",
                  draw("comet_tail",
                       arc(R_SEC, 330, 360, stroke(P, 3.0, cap="ROUND", children=[
                           E("SweepGradient", {"centerX": C, "centerY": C, "startAngle": 330, "endAngle": 360,
                                               "colors": f"{CLEAR} {P}", "positions": "0 1"})]))),
                  draw("comet_head",
                       E("Ellipse", box(C - 5, C - R_SEC - 5, 10, 10), E("Fill", {"color": P})),
                       E("Ellipse", box(C - 2.5, C - R_SEC - 2.5, 5, 5), E("Fill", {"color": WHITE}))),
                  pivot=True, extra=[transform("angle", f"{sec} * 6")])
    return group("seconds", trail, comet, extra=[hide_in_ambient()])


def layer_seconds():
    return E("BooleanConfiguration", {"id": "hudMotion"},
             E("BooleanOption", {"id": "TRUE"}, seconds_layer(True)),
             E("BooleanOption", {"id": "FALSE"}, seconds_layer(False)))


def gauge(name, value_expr, label, fill_color_cond=None):
    start, end = GAUGES[name]
    grows_ccw = name in ("heart", "core")  # these fill from the 3/9 o'clock end
    v = f"clamp({value_expr}, 0, 1)"
    if grows_ccw:
        def fill(col):
            return arc(R_GAUGE, end - 0.1, end, stroke(col, 9),
                       transforms=[transform("startAngle", f"{end} - {SPAN} * {v}")])
    else:
        def fill(col):
            return arc(R_GAUGE, start, start + 0.1, stroke(col, 9),
                       transforms=[transform("endAngle", f"{start} + {SPAN} * {v}")])

    track = draw(f"{name}_track", arc(R_GAUGE, start, end, stroke(S, 9)), alpha=255)
    if fill_color_cond:
        fill_part = condition(fill_color_cond[0],
                              [(n, [draw(f"{name}_fill_{n}", fill(col),
                                         extra=[transform("alpha", BREATHE)] if n == "charging" else [])])
                               for n, col in fill_color_cond[1]],
                              [draw(f"{name}_fill", fill(P))])
    else:
        fill_part = draw(f"{name}_fill", fill(P))
    cutter = draw(f"{name}_segments", arc(R_GAUGE, start, end, stroke(BLACK, 10, dash="1.6 5")))
    brackets = draw(f"{name}_brackets",
                    line(R_GAUGE - 9, R_GAUGE + 9, start, stroke(P, 1.5)),
                    line(R_GAUGE - 9, R_GAUGE + 9, end, stroke(P, 1.5)),
                    arc(R_GAUGE + 7.5, start, end, stroke(P, 0.8)),
                    alpha=170)
    return group(f"gauge_{name}", track, fill_part, cutter, brackets, label, extra=[hide_in_ambient()])


def layer_gauges():
    out = []
    # POWER (battery) - top left, red when low, accent while charging
    out.append(gauge(
        "power", "[BATTERY_PERCENT] / 100",
        ctext("power_label", R_LABEL, 288, 342, F_MONO, 12, P,
              T("PWR %d%%", "[BATTERY_PERCENT]"), letter=0.08),
        fill_color_cond=([("charging", "[BATTERY_CHARGING_STATUS]"), ("low", "[BATTERY_PERCENT] <= 15")],
                         [("charging", A), ("low", RED)])))
    # HEART - top right
    hr_label = condition(
        [("hr_ok", "[HEART_RATE] > 0")],
        [("hr_ok", [ctext("heart_label", R_LABEL, 18, 72, F_MONO, 12, P,
                          T("♥ %d BPM", "round([HEART_RATE])"), letter=0.08,
                          extra=[transform("alpha", HEARTBEAT)])])],
        [ctext("heart_label_idle", R_LABEL, 18, 72, F_MONO, 12, P, "♥ -- BPM", letter=0.08)])
    out.append(gauge("heart", "([HEART_RATE] - 40) / 140", hr_label,
                     fill_color_cond=([("hr_high", "[HEART_RATE] >= 150")], [("hr_high", RED)])))
    # STEPS - bottom right (counter-clockwise text so it reads left-to-right)
    out.append(gauge(
        "steps", "[STEP_PERCENT] / 100",
        ctext("steps_label", R_LABEL, 162, 108, F_MONO, 12, P,
              T("%s STEPS", 'numberFormat("#,###", [STEP_COUNT])'),
              direction="COUNTER_CLOCKWISE", letter=0.08),
        fill_color_cond=([("goal", "[STEP_PERCENT] >= 100")], [("goal", A)])))
    # CORE TEMP (battery temperature) - bottom left
    out.append(gauge(
        "core", "([BATTERY_TEMPERATURE_CELSIUS] - 20) / 25",
        condition([("core_f", "[WEATHER.TEMPERATURE_UNIT] == 2")],
                  [("core_f", [ctext("core_label_f", R_LABEL, 252, 198, F_MONO, 12, P,
                                     T("CORE %d°F", "round([BATTERY_TEMPERATURE_FAHRENHEIT])"),
                                     direction="COUNTER_CLOCKWISE", letter=0.08)])],
                  [ctext("core_label", R_LABEL, 252, 198, F_MONO, 12, P,
                         T("CORE %d°C", "round([BATTERY_TEMPERATURE_CELSIUS])"),
                         direction="COUNTER_CLOCKWISE", letter=0.08)]),
        fill_color_cond=([("hot", "[BATTERY_TEMPERATURE_CELSIUS] >= 40")], [("hot", RED)])))

    # cardinal gap read-outs
    out.append(group("gap_readouts",
                     ctext("gap_top", R_GAUGE - 4, 342, 18, F_MED, 11, P, "J.A.R.V.I.S", letter=0.12),
                     ctext("gap_right", R_GAUGE - 4, 72, 108, F_MONO, 11, SOFT,
                           T("WK %d", "[WEEK_IN_YEAR]"), letter=0.1),
                     ctext("gap_bottom", R_GAUGE + 4, 198, 162, F_MONO, 11, SOFT,
                           T("SEC %s", "[SECOND_Z]"), direction="COUNTER_CLOCKWISE", letter=0.1),
                     ctext("gap_left", R_GAUGE - 4, 252, 288, F_MONO, 11, SOFT,
                           T("MSG %d", "[UNREAD_NOTIFICATION_COUNT]"), letter=0.1),
                     extra=[hide_in_ambient()]))
    return out


def reactor_rings(animated):
    ring_a = group("ring_a",
                   draw("ring_a_draw", arc(R_RING_A, 0, 360, stroke(P, 1.2, dash="2 6"))),
                   pivot=True, alpha=170,
                   extra=[transform("angle", ROT_120_CW)] if animated else [])
    segs = []
    for k in range(3):
        s = k * 120
        segs.append(arc(R_RING_B, s, s + 78, stroke(P, 3.0, cap="ROUND")))
        segs.append(arc(R_RING_B, s + 84, s + 92, stroke(A, 3.0, cap="ROUND")))
    ring_b = group("ring_b", draw("ring_b_draw", *segs), pivot=True, alpha=120,
                   extra=[transform("angle", ROT_180_CCW)] if animated else [])
    # ten "coil" notches like a reactor housing, static
    coils = draw("coils", *[line(R_INNER + 1, R_INNER + 7, i * 36 + 18, stroke(P, 2.0)) for i in range(10)],
                 arc(R_INNER, 0, 360, stroke(P, 0.8)), alpha=90)
    return group("reactor", ring_a, ring_b, coils, extra=[gyro(4), hide_in_ambient()])


def layer_rings():
    return E("BooleanConfiguration", {"id": "hudMotion"},
             E("BooleanOption", {"id": "TRUE"}, reactor_rings(True)),
             E("BooleanOption", {"id": "FALSE"}, reactor_rings(False)))


# ------------------------------------------------------------- content ----
WEATHER_OK = ("wx", "[WEATHER.IS_AVAILABLE]")


def layer_weather():
    def wx_line(unit):
        return [text(f"weather_{unit}", 100, 96, 250, 20, F_MONO, 13, SOFT,
                     Upper(T(f"%d°{unit}  %s", "[WEATHER.TEMPERATURE]", "[WEATHER.CONDITION_NAME]")),
                     letter=0.06)]

    available = condition([("fahrenheit", "[WEATHER.TEMPERATURE_UNIT] == 2")],
                          [("fahrenheit", wx_line("F"))], wx_line("C"))
    return group("weather", condition([WEATHER_OK], [("wx", [available])],
                                      [text("weather_offline", 100, 96, 250, 20, F_MONO, 12, SOFT,
                                            "ATMOS: NO SIGNAL", letter=0.06)]),
                 extra=[hide_in_ambient()])


GREETINGS = [
    ("morning", "[HOUR_0_23] >= 5 && [HOUR_0_23] < 12", "GOOD MORNING{h}"),
    ("afternoon", "[HOUR_0_23] >= 12 && [HOUR_0_23] < 17", "GOOD AFTERNOON{h}"),
    ("evening", "[HOUR_0_23] >= 17 && [HOUR_0_23] < 22", "GOOD EVENING{h}"),
]


def greeting_for(hon):
    sep = f", {hon}" if hon else ""
    late = f"WORKING LATE, {hon}?" if hon else "WORKING LATE?"

    def t(n, s):
        return [text(f"greet_{n}", 70, 118, 310, 20, F_MONO, 14, P, s, letter=0.1)]

    return condition([(n, e) for n, e, _ in GREETINGS],
                     [(n, t(n, s.format(h=sep))) for n, _, s in GREETINGS],
                     t("late", late))


def layer_greeting():
    lc = E("ListConfiguration", {"id": "honorific"})
    for hid, _, _, hon in HONORIFICS:
        lc.append(E("ListOption", {"id": hid}, group(f"greeting_{hid}", greeting_for(hon))))
    return group("greeting", lc, extra=[hide_in_ambient()])


def layer_time():
    def time_text(name, content):
        return text(name, 40, 140, 370, 84, F_BOLD, 66, WHITE, content, glow=(P, 14))

    interactive = condition(
        [("h24", "[IS_24_HOUR_MODE]")],
        [("h24", [time_text("time_24h", T("%s:%s", "[HOUR_0_23_Z]", "[MINUTE_Z]"))])],
        [time_text("time_12h", T("%d:%s", "[HOUR_1_12]", "[MINUTE_Z]"))])
    live = group("time_live", interactive, extra=[hide_in_ambient()])

    aod = E("DigitalClock", {**box(40, 140, 370, 84), "alpha": 0},
            ambient("255"),
            E("TimeText", {"format": "hh:mm", "hourFormat": "SYNC_TO_DEVICE", "align": "CENTER",
                           **box(0, 0, 370, 84)},
              E("Font", {"family": F_MED, "size": 66, "color": WHITE})))

    # HUD corner brackets + scanner rail under the time
    bx0, by0, bx1, by1, L = 96, 144, 354, 222, 11
    corners = []
    for (x, y, dx, dy) in [(bx0, by0, 1, 1), (bx1, by0, -1, 1), (bx0, by1, 1, -1), (bx1, by1, -1, -1)]:
        corners.append(E("Line", {"startX": x, "startY": y, "endX": x + dx * L, "endY": y}, stroke(P, 1.6)))
        corners.append(E("Line", {"startX": x, "startY": y, "endX": x, "endY": y + dy * L}, stroke(P, 1.6)))
    brackets = draw("time_brackets", *corners, alpha=190, extra=[hide_in_ambient()])

    rail = draw("scan_rail", E("Line", {"startX": 130, "startY": 222, "endX": 320, "endY": 222},
                               stroke(P, 1.0)), alpha=70, extra=[hide_in_ambient()])
    scanner = group("scanner",
                    draw("scanner_blip", E("Line", {"startX": 0, "startY": 2, "endX": 26, "endY": 2},
                                           stroke(P, 2.4, cap="ROUND"))),
                    x=130, y=220, w=26, h=4,
                    extra=[transform("x", f"130 + 82 + 82 * sin(rad({SECS} * 30))"), hide_in_ambient()])
    return [brackets, rail, scanner, live, aod]


def layer_date():
    def date_text(name, content):
        return text(name, 80, 223, 290, 20, F_MED, 14, WHITE, Upper(content),
                    letter=0.12, extra=[ambient("170")])

    dmy = ("[DAY_OF_WEEK_S]", "[DAY_Z]", "[MONTH_S]")
    return condition([("h24", "[IS_24_HOUR_MODE]")],
                     [("h24", [date_text("date_24h", T("%s %s %s %d", *dmy, "[YEAR]"))])],
                     [date_text("date_12h", T("%s %s %s | %s", *dmy, "[AMPM_STRING]"))])


def ticker_line(name, content, color=None):
    return text(name, 75, 245, 300, 18, F_MONO, 12, color or P, content, letter=0.06, alpha=225)


def layer_ticker():
    def wx(name, content):
        return [condition([WEATHER_OK], [("wx", [ticker_line(name, content)])],
                          [ticker_line(f"{name}_nowx", "> ATMOS: NO SIGNAL")])]

    items = [
        wx("tick_hilo", T("> HI %d° / LO %d°", "[WEATHER.DAY_TEMPERATURE_HIGH]", "[WEATHER.DAY_TEMPERATURE_LOW]")),
        wx("tick_rain", T("> PRECIPITATION %d%%", "[WEATHER.CHANCE_OF_PRECIPITATION]")),
        wx("tick_uv", T("> UV INDEX %d", "[WEATHER.UV_INDEX]")),
        [ticker_line("tick_moon", Upper(T("> LUNAR: %s", "[MOON_PHASE_TYPE_STRING]")))],
        [ticker_line("tick_day", T("> DAY %d // WEEK %d", "[DAY_OF_YEAR]", "[WEEK_IN_YEAR]"))],
        [ticker_line("tick_msgs", T("> TRANSMISSIONS: %d", "[UNREAD_NOTIFICATION_COUNT]"))],
        [ticker_line("tick_goal", T("> MOBILITY %d%% OF %s", "[STEP_PERCENT]",
                                    'numberFormat("#,###", [STEP_GOAL])'))],
    ]
    n = len(items)
    exprs = [(f"t{i}", f"floor([SECONDS_IN_DAY] / 3) % {n} == {i}") for i in range(n - 1)]
    compares = [(f"t{i}", items[i]) for i in range(n - 1)]
    return group("ticker", condition(exprs, compares, items[-1]), extra=[hide_in_ambient()])


def status_line(name, msg, color):  # noqa: D401
    return [text(name, 70, 266, 310, 18, F_MONO, 12, color, msg, letter=0.07)]


def layer_status():
    return group("status", condition(
        [("charging", "[BATTERY_CHARGING_STATUS]"),
         ("critical", "[BATTERY_PERCENT] <= 15"),
         ("tachy", "[HEART_RATE] >= 130"),
         ("goal", "[STEP_PERCENT] >= 100")],
        [("charging", status_line("st_charging", "> ARC REACTOR CHARGING", A)),
         ("critical", status_line("st_critical", "! WARNING: POWER CRITICAL", RED)),
         ("tachy", status_line("st_heart", "! ELEVATED HEART RATE", A)),
         ("goal", status_line("st_goal", "> MOBILITY GOAL ACHIEVED", A))],
        status_line("st_ok", "> ALL SYSTEMS NOMINAL", P)), extra=[hide_in_ambient()])


POD_R = 22
PODS = [("0", 180, 316, "SUNRISE_SUNSET"), ("1", 270, 316, "NEXT_EVENT")]


def pod_decor(cx, cy, idx):
    shapes = [arc(POD_R + 2, 0, 360, stroke(P, 1.0), cx=cx, cy=cy),
              arc(POD_R + 6, 300, 60, stroke(P, 1.6, cap="ROUND"), cx=cx, cy=cy)]
    for deg in (90, 270):
        shapes.append(line(POD_R + 3, POD_R + 8, deg, stroke(P, 1.4), cx=cx, cy=cy))
    return draw(f"pod_{idx}_decor", *shapes, alpha=150, extra=[hide_in_ambient()])


def complication_slot(slot_id, cx, cy, provider):
    d = POD_R * 2
    icon = lambda sz, y: E("PartImage", {"name": "icon", **box((d - sz) / 2, y, sz, sz), "tintColor": P},
                            E("Image", {"resource": "[COMPLICATION.MONOCHROMATIC_IMAGE]"}))
    short = E("Complication", {"type": "SHORT_TEXT"},
              icon(14, 3),
              text("c_text", -6, 16, d + 12, 15, F_MONO, 13, WHITE, T("%s", "[COMPLICATION.TEXT]")),
              text("c_title", -4, 30, d + 8, 11, F_MONO, 9, P, Upper(T("%s", "[COMPLICATION.TITLE]"))))
    ranged = E("Complication", {"type": "RANGED_VALUE"},
               draw("c_range",
                    arc(POD_R - 1, 0, 0.1, stroke(P, 3, cap="ROUND"), cx=POD_R, cy=POD_R, transforms=[
                        transform("endAngle",
                                  "clamp(([COMPLICATION.RANGED_VALUE_VALUE] - [COMPLICATION.RANGED_VALUE_MIN]) / "
                                  "([COMPLICATION.RANGED_VALUE_MAX] - [COMPLICATION.RANGED_VALUE_MIN]), 0, 1) * 360")]),
                    w=d, h=d),
               icon(12, 6),
               text("c_rtext", -4, 18, d + 8, 15, F_MONO, 12, WHITE, T("%s", "[COMPLICATION.TEXT]")))
    mono = E("Complication", {"type": "MONOCHROMATIC_IMAGE"}, icon(24, (d - 24) / 2))
    small = E("Complication", {"type": "SMALL_IMAGE"},
              E("PartImage", {"name": "small", **box(6, 6, d - 12, d - 12)},
                E("Image", {"resource": "[COMPLICATION.SMALL_IMAGE]"})))
    return E("ComplicationSlot",
             {**box(cx - POD_R, cy - POD_R, d, d), "slotId": slot_id,
              "supportedTypes": "SHORT_TEXT RANGED_VALUE MONOCHROMATIC_IMAGE SMALL_IMAGE",
              "isCustomizable": "TRUE", "displayName": f"@string/cfg_pod_{slot_id}"},
             E("DefaultProviderPolicy", {"defaultSystemProvider": provider,
                                         "defaultSystemProviderType": "SHORT_TEXT"}),
             E("BoundingOval", box(0, 0, d, d)),
             short, ranged, mono, small,
             hide_in_ambient())


def layer_pods():
    out = []
    for sid, cx, cy, prov in PODS:
        out.append(pod_decor(cx, cy, sid))
    return out


def layer_zone():
    lc = E("ListConfiguration", {"id": "zone"})
    for zid, _, _, label, tz in ZONES:
        g = group(f"zone_{zid}",
                  text(f"zone_{zid}_label", 0, 0, 120, 18, F_MONO, 12, P, label, align="END", letter=0.08),
                  E("DigitalClock", box(126, 0, 124, 18),
                    E("Localization", {"timeZone": tz}),
                    E("TimeText", {"format": "hh:mm", "hourFormat": "24", "align": "START", **box(0, 0, 124, 18)},
                      E("Font", {"family": F_MONO, "size": 13, "color": WHITE}))),
                  x=100, y=343, w=250, h=18)
        lc.append(E("ListOption", {"id": zid}, g))
    return group("zone_clock", lc, extra=[hide_in_ambient()])


def layer_ambient_extras():
    return [
        text("aod_banner", 70, 118, 310, 20, F_MONO, 13, P, "J.A.R.V.I.S // STANDBY", letter=0.12,
             alpha=0, extra=[ambient("150")]),
        text("aod_power", 100, 262, 250, 18, F_MONO, 13, SOFT, T("PWR %d%%", "[BATTERY_PERCENT]"),
             letter=0.1, alpha=0, extra=[ambient("150")]),
    ]


def layer_chevrons():
    return E("AnalogClock", {**full(), "alpha": 255},
             E("HourHand", {"resource": "hand_hour", **box(C - 15, 0, 30, C), "pivotX": 0.5, "pivotY": 1.0,
                            "tintColor": A}, ambient("170")),
             E("MinuteHand", {"resource": "hand_minute", **box(C - 12, 0, 24, C), "pivotX": 0.5, "pivotY": 1.0,
                              "tintColor": P}, ambient("200")))


BOOT_FRAMES = 12


def layer_boot_ping():
    """A sonar-style 'systems online' ping that plays when the face becomes visible
    (wrist raise / leaving an app) and again when you tap an empty part of the HUD."""
    seq = E("SequenceImages", {"loopCount": 1, "frameRate": 24},
            *[E("Image", {"resource": f"boot_{k:02d}"}) for k in range(BOOT_FRAMES)])
    return E("PartAnimatedImage", {"name": "boot_ping", **full(), "tintColor": P},
             E("AnimationController", {"play": "ON_VISIBLE TAP", "repeat": "FALSE", "loopCount": 1,
                                       "beforePlaying": "HIDE", "afterPlaying": "HIDE"}),
             seq, hide_in_ambient())


def layer_taps():
    return [
        tap_zone("tap_power", 40, 60, 95, 85, "BATTERY_STATUS"),
        tap_zone("tap_heart", 315, 60, 95, 85, "HEALTH_HEART_RATE"),
        tap_zone("tap_jarvis", 170, 20, 110, 32, "MUSIC_PLAYER"),
        tap_zone("tap_time", 110, 146, 230, 74, "ALARM"),
        tap_zone("tap_date", 120, 224, 210, 38, "CALENDAR"),
        tap_zone("tap_status", 110, 264, 230, 22, "MESSAGE"),
        tap_zone("tap_core", 40, 305, 95, 85, "SETTINGS"),
    ]


def compact_fonts(root):
    """Drop pretty-print whitespace inside <Font> so text renders exactly as written."""
    for f in root.iter("Font"):
        for d in f.iter():
            if d is not f and d.tail is not None and not d.tail.strip():
                d.tail = None
            if d.text is not None and not d.text.strip() and len(d):
                d.text = None


def build_watchface():
    wf = E("WatchFace", {"width": W, "height": H, "clipShape": "CIRCLE"})
    wf.append(E("Metadata", {"key": "CLOCK_TYPE", "value": "DIGITAL"}))
    wf.append(E("Metadata", {"key": "PREVIEW_TIME", "value": "10:08:32"}))
    wf.append(user_configurations())
    scene = E("Scene", {"backgroundColor": BLACK})
    add(scene, [
        layer_background(),
        layer_bezel(),
        layer_seconds(),
        layer_gauges(),
        layer_rings(),
        layer_weather(),
        layer_greeting(),
        layer_time(),
        layer_date(),
        layer_ticker(),
        layer_status(),
        layer_pods(),
        layer_zone(),
        layer_ambient_extras(),
        layer_chevrons(),
        layer_boot_ping(),
        layer_taps(),
        [complication_slot(sid, cx, cy, prov) for sid, cx, cy, prov in PODS],
    ])
    wf.append(scene)
    ET.indent(wf, space="  ")
    compact_fonts(wf)
    xml = ET.tostring(wf, encoding="unicode")
    header = ('<?xml version="1.0" encoding="utf-8"?>\n'
              '<!-- GENERATED by tools/generate.py - edit the generator, not this file. -->\n')
    return header + xml + "\n"


# ================================================================ assets ===
def hex_grid_png(path):
    """Faint hexagon lattice, brighter towards the rim, transparent centre."""
    scale = 2  # supersample
    size = W * scale
    img = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(img)
    r = 15 * scale
    hw = math.sqrt(3) * r
    for row in range(-1, int(size / (1.5 * r)) + 2):
        for col in range(-1, int(size / hw) + 2):
            cx = col * hw + (hw / 2 if row % 2 else 0)
            cy = row * 1.5 * r
            pts = [(cx + r * math.sin(math.radians(60 * k)), cy + r * math.cos(math.radians(60 * k)))
                   for k in range(7)]
            d.line(pts, fill=255, width=scale)
    img = img.resize((W, H), Image.LANCZOS)
    alpha = Image.new("L", (W, H), 0)
    px = alpha.load()
    src = img.load()
    for y in range(H):
        for x in range(W):
            dist = math.hypot(x + 0.5 - C, y + 0.5 - C) / C
            if dist > 1.0:
                continue
            k = 0.08 + 0.42 * (dist ** 2.4)
            px[x, y] = int(src[x, y] * k)
    out = Image.merge("RGBA", (Image.new("L", (W, H), 255),) * 3 + (alpha,))
    out.save(path, optimize=True)


def chevron_png(path, width, top, tip, bar=False):
    """White chevron at the top of a centre-pivoted hand image (tinted at runtime)."""
    s = 4
    img = Image.new("RGBA", (width * s, C * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = width * s
    d.polygon([(1 * s, top * s), (w - 1 * s, top * s), (w / 2, tip * s)], fill=(255, 255, 255, 255))
    inner = (top + 3.2) * s
    d.polygon([(w * 0.30, inner), (w * 0.70, inner), (w / 2, (tip - 4.5) * s)], fill=(255, 255, 255, 70))
    if bar:
        d.rectangle([(w / 2 - 0.9 * s, (tip + 2) * s), (w / 2 + 0.9 * s, (tip + 9) * s)], fill=(255, 255, 255, 230))
    img = img.resize((width, C), Image.LANCZOS)
    img.save(path, optimize=True)


def boot_frames(folder):
    s = 2
    for k in range(BOOT_FRAMES):
        t = k / (BOOT_FRAMES - 1)
        ease = 1 - (1 - t) ** 3
        img = Image.new("RGBA", (W * s, H * s), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        a = (1 - t) ** 1.3

        def ring(r, width, alpha):
            if alpha <= 0.01 or r <= 0:
                return
            box_ = [(C - r) * s, (C - r) * s, (C + r) * s, (C + r) * s]
            d.ellipse(box_, outline=(255, 255, 255, int(255 * alpha)), width=max(1, int(width * s)))

        if t < 0.35:  # core flash
            fr = 70 * (1 - t / 0.35) + 10
            fa = int(110 * (1 - t / 0.35) ** 2)
            d.ellipse([(C - fr) * s, (C - fr) * s, (C + fr) * s, (C + fr) * s], fill=(255, 255, 255, fa))
        r = 34 + 188 * ease
        ring(r, 1 + 5 * (1 - t), a)
        ring(r * 0.84, 1.2, a * 0.45)
        ring(r * 0.62, 1.0, a * 0.25)
        for i in range(48):  # reticle ticks riding the wave
            ang = math.radians(i * 7.5)
            r1, r2 = r - 4 - 6 * (i % 4 == 0), r + 4 + 6 * (i % 4 == 0)
            d.line([((C + r1 * math.sin(ang)) * s, (C - r1 * math.cos(ang)) * s),
                    ((C + r2 * math.sin(ang)) * s, (C - r2 * math.cos(ang)) * s)],
                   fill=(255, 255, 255, int(200 * a)), width=s)
        img.resize((W, H), Image.LANCZOS).save(folder / f"boot_{k:02d}.png", optimize=True)


STRINGS = {
    "app_name": "J.A.R.V.I.S. HUD",
    "cfg_theme": "Suit / HUD color",
    "cfg_honorific": "Address me as",
    "cfg_zone": "Second time zone",
    "cfg_motion": "HUD animation",
    "cfg_hex": "Hex grid + radar",
    "cfg_pod_0": "Left pod",
    "cfg_pod_1": "Right pod",
}


def strings_xml():
    entries = dict(STRINGS)
    for _, sname, label, *_ in THEMES:
        entries[sname] = label
    for _, sname, label, _ in HONORIFICS:
        entries[sname] = label
    for _, sname, label, _, _ in ZONES:
        entries[sname] = label
    res = E("resources")
    for k, v in entries.items():
        res.append(E("string", {"name": k}, text=v.replace("'", "\\'")))
    ET.indent(res, space="    ")
    return '<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(res, encoding="unicode") + "\n"


def main():
    (RES / "raw").mkdir(parents=True, exist_ok=True)
    (RES / "drawable-nodpi").mkdir(parents=True, exist_ok=True)
    (RES / "values").mkdir(parents=True, exist_ok=True)
    (RES / "raw" / "watchface.xml").write_text(build_watchface(), encoding="utf-8")
    (RES / "values" / "strings.xml").write_text(strings_xml(), encoding="utf-8")
    hex_grid_png(RES / "drawable-nodpi" / "hex_grid.png")
    chevron_png(RES / "drawable-nodpi" / "hand_hour.png", 30, 20, 34)
    chevron_png(RES / "drawable-nodpi" / "hand_minute.png", 24, 12, 31, bar=True)
    boot_frames(RES / "drawable-nodpi")
    print("watch face generated ->", RES / "raw" / "watchface.xml")


if __name__ == "__main__":
    main()
