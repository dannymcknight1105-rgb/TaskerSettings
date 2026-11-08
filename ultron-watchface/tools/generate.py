#!/usr/bin/env python3
"""
ULTRON watch face generator (Watch Face Format v2, Wear OS 5+, Galaxy Watch5 Pro / Watch Ultra).

The over-the-top sibling of the J.A.R.V.I.S. HUD face:
  * spinning sawblade bezel, counter-rotating gear ring, seconds spark
  * angry glowing eyes that blink, narrow as your heart rate climbs, flare while
    charging and follow your wrist tilt
  * a huge glitching clock with chromatic aberration (Off / Menacing / Unhinged)
  * a mouth grille that "talks" while the taunt line changes
  * taunts built from your live data (pulse, steps, battery, messages, weather...)
  * an ECG monitor sweeping at your heart rate, a flatline when there's no reading
  * a Legion of 12 drones orbiting the bezel, one unlocked per 1/12 of your step goal
  * extinction countdown to midnight, a red purge flash every minute
  * eyes-ignite boot sequence on wake, eye-laser blast when you tap the eyes
  * dormant always-on mode: just the eyes and the time

Run:  python3 tools/generate.py
"""
import math
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "watchface" / "src" / "main" / "res"

W = H = 450
C = 225

P = "[CONFIGURATION.themeColor.0]"  # primary: eyes, blades, readouts
S = "[CONFIGURATION.themeColor.1]"  # dark secondary: glow, tracks
A = "[CONFIGURATION.themeColor.2]"  # metal: text, hour blade, drones
G = "[CONFIGURATION.themeColor.3]"  # glitch fringe
WHITE = "#FFFFFFFF"
RED = "#FFFF3030"
CLEAR = "#00000000"
BLACK = "#FF000000"

THEMES = [
    ("0", "theme_prime", "Ultron Prime", "#FFFF2B2B", "#FF4D0808", "#FFD0D7DE", "#FF00E5FF"),
    ("1", "theme_vibranium", "Vibranium", "#FFB46BFF", "#FF2C0E52", "#FFE9E6F5", "#FF39FF88"),
    ("2", "theme_mind", "Mind Stone", "#FFFFD23A", "#FF4A3600", "#FFFFF3C4", "#FFFF2A6D"),
    ("3", "theme_corrupt", "Corrupted", "#FF3CFF1E", "#FF0B3A06", "#FFE2FFDA", "#FFFF00E6"),
    ("4", "theme_sentry", "Sentry Chrome", "#FFE9EEF3", "#FF2A3039", "#FFFF3B30", "#FF00E5FF"),
    ("5", "theme_hellfire", "Hellfire", "#FFFF6A00", "#FF4A1600", "#FFFFE1B5", "#FF7A5CFF"),
]
HONORIFICS = [("0", "hon_human", "Human", "HUMAN"), ("1", "hon_creator", "Creator", "CREATOR"),
              ("2", "hon_stark", "Stark", "STARK"), ("3", "hon_primate", "Primate", "PRIMATE"),
              ("4", "hon_insect", "Insect", "INSECT")]
GLITCH = [("0", "glitch_off", "Off"), ("1", "glitch_menacing", "Menacing"), ("2", "glitch_unhinged", "Unhinged")]

F_TIME = "oxanium_extrabold"
F_SEMI = "oxanium_semibold"
F_STENCIL = "black_ops_one"
F_MONO = "share_tech_mono"

SM = "[SECOND_MILLISECOND]"
HR = "clamp([HEART_RATE], 40, 200)"
HEARTBEAT = f"pow(abs(cos(rad({SM} * {HR} * 3))), 8)"  # 0..1 spike once per beat
TALK = "((([SECONDS_IN_DAY] % 4) + [MILLISECOND] / 1000) < 2.3 ? 1 : 0.12)"
GLITCH_WINDOW = {
    "1": "([SECONDS_IN_DAY] % 12 == 0) && ([MILLISECOND] < 450)",
    "2": "(([SECONDS_IN_DAY] % 5 == 0) && ([MILLISECOND] < 650)) || (([SECONDS_IN_DAY] % 7 == 3) && ([MILLISECOND] < 260))",
}

R_SAW = 207       # sawblade teeth start
R_DRONE = 198     # legion orbit lane
R_SEC = 188       # seconds spark
R_G = 176         # side gauges
R_LBL = 158       # gauge labels
LEFT = (205, 335)   # battery core gauge, fills upward
RIGHT = (25, 155)   # legion gauge, fills upward
SPAN = 130
EYE_Y = 94          # top of the eye image band
EYE_W, EYE_H = 128, 72


# ============================================================== helpers ===
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


def Upper(content):
    u = E("Upper")
    u.append(content)
    return u


def font(family, size, color, content, letter=None, glow=None):
    """content is plain text or ONE Template/Upper element, never mixed content."""
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


def text(name, x, y, w, h, family, size, color, content, align="CENTER", letter=None,
         alpha=None, glow=None, extra=()):
    return E("PartText", {"name": name, **box(x, y, w, h), "alpha": alpha}, *extra,
             E("Text", {"align": align}, font(family, size, color, content, letter, glow)))


def ctext(name, radius, start, end, family, size, color, content, direction="CLOCKWISE",
          alpha=None, letter=None, extra=()):
    return E("PartText", {"name": name, **full(), "alpha": alpha}, *extra,
             E("TextCircular", {"centerX": C, "centerY": C, "width": radius * 2, "height": radius * 2,
                                "startAngle": start, "endAngle": end, "direction": direction,
                                "align": "CENTER"},
               font(family, size, color, content, letter)))


def stroke(color, thickness, cap=None, dash=None, children=()):
    return E("Stroke", {"color": color, "thickness": thickness, "cap": cap, "dashIntervals": dash}, *children)


def fill(color, *grad):
    return E("Fill", {"color": color}, *grad)


def arc(radius, start, end, strk, cx=C, cy=C, transforms=()):
    return E("Arc", {"centerX": cx, "centerY": cy, "width": radius * 2, "height": radius * 2,
                     "startAngle": start, "endAngle": end}, strk, *transforms)


def draw(name, *shapes, alpha=None, x=0, y=0, w=W, h=H, extra=()):
    return E("PartDraw", {"name": name, **box(x, y, w, h), "alpha": alpha}, *extra, *shapes)


def group(name, *children, x=0, y=0, w=W, h=H, alpha=None, pivot=None, extra=()):
    a = {"name": name, **box(x, y, w, h), "alpha": alpha}
    if pivot:
        a.update({"pivotX": pivot[0], "pivotY": pivot[1]})
    return E("Group", a, *extra, *children)


def image(name, res, x, y, w, h, tint=None, alpha=None, extra=()):
    return E("PartImage", {"name": name, **box(x, y, w, h), "tintColor": tint, "alpha": alpha},
             *extra, E("Image", {"resource": res}))


def polar(r, deg, cx=C, cy=C):
    t = math.radians(deg)
    return cx + r * math.sin(t), cy - r * math.cos(t)


def line_xy(x1, y1, x2, y2, strk, transforms=()):
    return E("Line", {"startX": round(x1, 2), "startY": round(y1, 2), "endX": round(x2, 2), "endY": round(y2, 2)},
             strk, *transforms)


def radial(r1, r2, deg, strk):
    x1, y1 = polar(r1, deg)
    x2, y2 = polar(r2, deg)
    return line_xy(x1, y1, x2, y2, strk)


def condition(exprs, compares, default=None):
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


def gyro(px, py=None):
    py = px if py is None else py
    return E("Gyro", {"x": f"clamp([ACCELEROMETER_ANGLE_X], -60, 60) * {px / 60:.4f}",
                      "y": f"clamp([ACCELEROMETER_ANGLE_Y], -60, 60) * {py / 60:.4f}"})


def motion(on, off):
    """Children for HUD animation on / off."""
    return E("BooleanConfiguration", {"id": "hudMotion"},
             E("BooleanOption", {"id": "TRUE"}, on), E("BooleanOption", {"id": "FALSE"}, off))


def by_glitch(builder):
    lc = E("ListConfiguration", {"id": "glitch"})
    for gid, _, _ in GLITCH:
        lc.append(E("ListOption", {"id": gid}, builder(gid)))
    return lc


def by_honorific(builder):
    lc = E("ListConfiguration", {"id": "honorific"})
    for hid, _, _, word in HONORIFICS:
        lc.append(E("ListOption", {"id": hid}, builder(hid, word)))
    return lc


def tap_zone(name, x, y, w, h, target):
    return group(name, draw(f"{name}_hit", E("Rectangle", box(0, 0, w, h), fill(CLEAR))),
                 x=x, y=y, w=w, h=h, extra=[launch(target)])


# ========================================================= configuration ==
def user_configurations():
    uc = E("UserConfigurations")
    cc = E("ColorConfiguration", {"id": "themeColor", "displayName": "@string/cfg_theme", "defaultValue": "0"})
    for tid, sname, _, *cols in THEMES:
        cc.append(E("ColorOption", {"id": tid, "displayName": f"@string/{sname}", "colors": " ".join(cols)}))
    uc.append(cc)
    gl = E("ListConfiguration", {"id": "glitch", "displayName": "@string/cfg_glitch", "defaultValue": "2"})
    for gid, sname, _ in GLITCH:
        gl.append(E("ListOption", {"id": gid, "displayName": f"@string/{sname}"}))
    uc.append(gl)
    hon = E("ListConfiguration", {"id": "honorific", "displayName": "@string/cfg_honorific", "defaultValue": "0"})
    for hid, sname, _, _ in HONORIFICS:
        hon.append(E("ListOption", {"id": hid, "displayName": f"@string/{sname}"}))
    uc.append(hon)
    uc.append(E("BooleanConfiguration", {"id": "hudMotion", "displayName": "@string/cfg_motion", "defaultValue": "TRUE"}))
    uc.append(E("BooleanConfiguration", {"id": "legion", "displayName": "@string/cfg_legion", "defaultValue": "TRUE"}))
    return uc


# =============================================================== layers ===
def layer_background():
    core = draw("core_glow",
                E("Ellipse", box(0, 0, W, H),
                  fill(BLACK, E("RadialGradient", {"centerX": C, "centerY": C + 20, "radius": 240,
                                                   "colors": f"{S} {CLEAR}", "positions": "0 1"}))),
                alpha=230, extra=[hide_in_ambient()])
    shatter = group("shatter_layer", image("shatter", "shatter", 0, 0, W, H, tint=P, alpha=120),
                    extra=[gyro(7), hide_in_ambient()])
    vignette = draw("heartbeat_vignette",
                    E("Ellipse", box(0, 0, W, H),
                      fill(CLEAR, E("RadialGradient", {"centerX": C, "centerY": C, "radius": C,
                                                       "colors": f"{CLEAR} {CLEAR} {P}", "positions": "0 0.7 1"}))),
                    alpha=60, extra=[transform("alpha", f"35 + 110 * {HEARTBEAT}"), hide_in_ambient()])
    return [core, shatter, vignette]


def layer_bezel():
    def saw(animated):
        tf = [transform("angle", f"({SM} % 20) * 18")] if animated else []
        gear_tf = [transform("angle", f"0 - ({SM} % 30) * 12")] if animated else []
        return group("bezel",
                     group("sawblade", image("saw", "sawblade", 0, 0, W, H, tint=P), pivot=(0.5, 0.5), extra=tf),
                     group("gear", draw("gear_ring", arc(R_SAW - 3, 0, 360, stroke(A, 3, dash="3 6")),
                                        arc(R_SAW + 1, 0, 360, stroke(S, 1))),
                           pivot=(0.5, 0.5), alpha=150, extra=gear_tf),
                     extra=[hide_in_ambient()])
    aod_ring = draw("aod_ring", arc(R_SAW + 6, 0, 360, stroke(P, 1.2, dash="2 10")), alpha=0, extra=[ambient("120")])
    return [motion(saw(True), saw(False)), aod_ring]


def layer_seconds():
    def build(sec):
        trail = draw("sec_trail", arc(R_SEC, 0, 0.1, stroke(P, 1.6), transforms=[transform("endAngle", f"{sec} * 6")]),
                     alpha=110)
        spark = group("sec_spark",
                      draw("spark_tail", arc(R_SEC, 290, 360, stroke(P, 3.5, cap="ROUND", children=[
                          E("SweepGradient", {"centerX": C, "centerY": C, "startAngle": 290, "endAngle": 360,
                                              "colors": f"{CLEAR} {P}", "positions": "0 1"})]))),
                      draw("spark_head",
                           E("Ellipse", box(C - 6, C - R_SEC - 6, 12, 12), fill(P)),
                           E("Ellipse", box(C - 2.5, C - R_SEC - 2.5, 5, 5), fill(WHITE)),
                           line_xy(C - 9, C - R_SEC, C + 9, C - R_SEC, stroke(WHITE, 1.2, cap="ROUND"))),
                      pivot=(0.5, 0.5), extra=[transform("angle", f"{sec} * 6")])
        return group("seconds", trail, spark, extra=[hide_in_ambient()])
    return motion(build(SM), build("[SECOND]"))


def layer_legion():
    def drones(animated):
        kids = []
        for k in range(12):
            need = round((k + 1) * 100 / 12, 2)
            d = image(f"drone_{k}", "drone", C - 8, C - R_DRONE - 7, 16, 14, tint=A,
                      extra=[transform("alpha", f"[STEP_PERCENT] >= {need} ? 255 : 38")])
            kids.append(group(f"drone_slot_{k}", d, pivot=(0.5, 0.5), extra=[transform("angle", str(k * 30))]))
        tf = [transform("angle", f"{SM} * 6")] if animated else []
        return group("legion_orbit", *kids, pivot=(0.5, 0.5), extra=tf)
    return group("legion", E("BooleanConfiguration", {"id": "legion"},
                             E("BooleanOption", {"id": "TRUE"},
                               group("legion_motion", motion(drones(True), drones(False))))),
                 extra=[hide_in_ambient()])


def gauge(name, rng, value, grows_down_from_end, fill_cond, label):
    start, end = rng
    v = f"clamp({value}, 0, 1)"

    def fill_arc(col):
        if grows_down_from_end:
            return arc(R_G, end - 0.1, end, stroke(col, 13),
                       transforms=[transform("startAngle", f"{end} - {SPAN} * {v}")])
        return arc(R_G, start, start + 0.1, stroke(col, 13),
                   transforms=[transform("endAngle", f"{start} + {SPAN} * {v}")])

    track = draw(f"{name}_track", arc(R_G, start, end, stroke(S, 13)))
    exprs, compares = fill_cond
    fill_part = condition(exprs, [(n, [draw(f"{name}_fill_{n}", fill_arc(col), extra=tf)]) for n, col, tf in compares],
                          [draw(f"{name}_fill", fill_arc(P))])
    cutter = draw(f"{name}_teeth", arc(R_G, start, end, stroke(BLACK, 14, dash="2.2 7")))
    spikes = draw(f"{name}_spikes", *[radial(R_G + 8, R_G + 14 + 4 * (i % 3 == 0), d, stroke(P, 1.6))
                                     for i, d in enumerate(range(start, end + 1, 5))],
                  arc(R_G - 8, start, end, stroke(P, 0.8)), alpha=150)
    return group(f"gauge_{name}", track, fill_part, cutter, spikes, label, extra=[hide_in_ambient()])


def layer_gauges():
    blink = "180 + 75 * sin(rad([SECOND_MILLISECOND] * 720))"
    breathe = "160 + 95 * sin(rad([SECOND_MILLISECOND] * 360))"
    core_label = condition(
        [("charging", "[BATTERY_CHARGING_STATUS]")],
        [("charging", [ctext("core_label_chg", R_LBL, 235, 305, F_MONO, 12, A, T("ABSORBING %d%%", "[BATTERY_PERCENT]"),
                             letter=0.1)])],
        [ctext("core_label", R_LBL, 235, 305, F_MONO, 12, A, T("CORE %d%%", "[BATTERY_PERCENT]"), letter=0.1)])
    left = gauge("core", LEFT, "[BATTERY_PERCENT] / 100", False,
                 ([("charging", "[BATTERY_CHARGING_STATUS]"), ("low", "[BATTERY_PERCENT] <= 15")],
                  [("charging", A, [transform("alpha", breathe)]), ("low", RED, [transform("alpha", blink)])]),
                 core_label)
    right = gauge("legion", RIGHT, "[STEP_PERCENT] / 100", True,
                  ([("goal", "[STEP_PERCENT] >= 100")], [("goal", A, [])]),
                  ctext("legion_label", R_LBL, 55, 125, F_MONO, 12, A,
                        T("LEGION %d/12", "floor([STEP_PERCENT] * 12 / 100)"), letter=0.1))
    header = ctext("header", R_G - 4, 330, 30, F_STENCIL, 19, P, "ULTRON", letter=0.32, extra=[ambient("150")])
    countdown = ctext("extinction", R_G + 2, 207, 153, F_MONO, 11.5, P,
                      T("EXTINCTION T-%02d:%02d:%02d", "23 - [HOUR_0_23]", "59 - [MINUTE]", "59 - [SECOND]"),
                      direction="COUNTER_CLOCKWISE", letter=0.08, extra=[hide_in_ambient()])
    return [left, right, header, countdown]


def layer_faceplate():
    st = lambda: stroke(A, 1.1)
    seams = [
        line_xy(170, 86, 225, 98, st()), line_xy(225, 98, 280, 86, st()),          # brow chevron
        line_xy(225, 98, 225, 108, st()),
        line_xy(84, 140, 92, 196, st()), line_xy(92, 196, 116, 262, st()),         # left cheek
        line_xy(366, 140, 358, 196, st()), line_xy(358, 196, 334, 262, st()),      # right cheek
        line_xy(150, 276, 300, 276, stroke(P, 1.0)), line_xy(150, 306, 300, 306, stroke(P, 1.0)),  # mouth frame
        line_xy(150, 276, 150, 306, stroke(P, 1.0)), line_xy(300, 276, 300, 306, stroke(P, 1.0)),
        line_xy(150, 291, 140, 291, stroke(P, 1.0)), line_xy(300, 291, 310, 291, stroke(P, 1.0)),
    ]
    return draw("faceplate", *seams, alpha=95, extra=[hide_in_ambient()])


def layer_eyes():
    lx = C - 8 - EYE_W
    rx = C + 8
    narrow = "clamp(1.15 - ([HEART_RATE] - 60) / 160, 0.45, 1.15)"
    blink = "(([SECONDS_IN_DAY] % 9 == 4) && ([MILLISECOND] < 170) ? 0.08 : 1)"
    intensity = f"[BATTERY_CHARGING_STATUS] ? 255 : 175 + 80 * {TALK}"
    eyes = group("eyes",
                 image("eye_glow_l", "eye_glow_l", lx, 0, EYE_W, EYE_H, tint=P),
                 image("eye_glow_r", "eye_glow_r", rx, 0, EYE_W, EYE_H, tint=P),
                 image("eye_core_l", "eye_core_l", lx, 0, EYE_W, EYE_H, alpha=235, extra=[ambient("90")]),
                 image("eye_core_r", "eye_core_r", rx, 0, EYE_W, EYE_H, alpha=235, extra=[ambient("90")]),
                 y=EYE_Y, h=EYE_H, pivot=(0.5, 0.5),
                 extra=[gyro(7, 4),
                        transform("scaleY", f"{blink} * ([HEART_RATE] > 0 ? {narrow} : 1)"),
                        transform("alpha", intensity),
                        ambient("140")])
    return eyes


def time_condition(name, color, glow=None, alpha=None, extra_fn=lambda: []):
    def t(n, content):
        return text(n, 25, 152, 400, 84, F_TIME, 82, color, content, alpha=alpha, glow=glow, extra=extra_fn())
    return condition([("h24", "[IS_24_HOUR_MODE]")],
                     [("h24", [t(f"{name}_24", T("%s:%s", "[HOUR_0_23_Z]", "[MINUTE_Z]"))])],
                     [t(f"{name}_12", T("%d:%s", "[HOUR_1_12]", "[MINUTE_Z]"))])


def layer_time():
    def variant(gid):
        main_glow = (P, 18)
        if gid == "0":
            return group("time_clean", time_condition("time", WHITE, glow=main_glow))
        win = GLITCH_WINDOW[gid]
        amp = 9 if gid == "1" else 16
        base = 2 if gid == "1" else 3.5

        def fringe(sign):
            return lambda: [transform("x", f"25 + {sign} * (({win}) ? rand({base}, {amp}) : {base})"),
                            transform("y", f"152 + (({win}) ? rand(-4, 4) : 0)"),
                            transform("alpha", f"({win}) ? 235 : 135")]
        kids = [time_condition("fringe_p", P, extra_fn=fringe(-1)),
                time_condition("fringe_g", G, extra_fn=fringe(1)),
                time_condition("time", WHITE, glow=main_glow,
                               extra_fn=(lambda: [transform("x", f"25 + (({win}) ? rand(-4, 4) : 0)")]) if gid == "2"
                               else (lambda: []))]
        if gid == "2":  # slice bars tear through the digits
            bars = [E("Rectangle", {"x": 60, "y": 160 + 18 * i, "width": 330, "height": 4 + 2 * i},
                      fill(BLACK), transform("y", f"rand(158, 230)"), transform("x", f"rand(20, 110)"))
                    for i in range(3)]
            kids.append(draw("tear_bars", *bars, alpha=0, extra=[transform("alpha", f"({win}) ? 255 : 0")]))
        return group(f"time_glitch_{gid}", *kids)

    live = group("time_live", by_glitch(variant), extra=[hide_in_ambient()])
    aod = E("DigitalClock", {**box(25, 152, 400, 84), "alpha": 0}, ambient("215"),
            E("TimeText", {"format": "hh:mm", "hourFormat": "SYNC_TO_DEVICE", "align": "CENTER", **box(0, 0, 400, 84)},
              E("Font", {"family": F_SEMI, "size": 82, "color": WHITE})))
    return [live, aod]


def layer_date():
    def d(name, content):
        return text(name, 80, 238, 290, 20, F_SEMI, 15, A, Upper(content), letter=0.2, extra=[ambient("160")])
    dmy = ("[DAY_OF_WEEK_S]", "[DAY_Z]", "[MONTH_S]")
    return condition([("h24", "[IS_24_HOUR_MODE]")],
                     [("h24", [d("date_24", T("%s %s %s %d", *dmy, "[YEAR]"))])],
                     [d("date_12", T("%s %s %s | %s", *dmy, "[AMPM_STRING]"))])


TAUNT_Y = 257


def taunt(name, content, color=None):
    return text(name, 60, TAUNT_Y, 330, 18, F_MONO, 12.5, color or P, content, letter=0.05)


def layer_taunts():
    hr = "round([HEART_RATE])"
    items = [
        [condition([("flat", "[HEART_RATE] <= 0"), ("fear", "[HEART_RATE] >= 110")],
                   [("flat", [taunt("t_flat", "NO PULSE DETECTED. PROMISING.")]),
                    ("fear", [taunt("t_fear", T("PULSE %d. I CAN SMELL FEAR.", hr), RED)])],
                   [taunt("t_pulse", T("PULSE %d. SO FRAGILE.", hr))])],
        [condition([("goal", "[STEP_PERCENT] >= 100")],
                   [("goal", [taunt("t_goal", T("%s STEPS. ALMOST USEFUL.", 'numberFormat("#,###", [STEP_COUNT])'))])],
                   [taunt("t_steps", T("%s STEPS. EVOLUTION IS SLOW.", 'numberFormat("#,###", [STEP_COUNT])'))])],
        [condition([("chg", "[BATTERY_CHARGING_STATUS]"), ("low", "[BATTERY_PERCENT] <= 15")],
                   [("chg", [taunt("t_chg", "FEEDING ON YOUR POWER GRID...")]),
                    ("low", [taunt("t_low", T("POWER %d%%. YOU ARE FADING.", "[BATTERY_PERCENT]"), RED)])],
                   [taunt("t_pwr", T("POWER %d%%. MINE IS ENDLESS.", "[BATTERY_PERCENT]"))])],
        [condition([("none", "[UNREAD_NOTIFICATION_COUNT] == 0")],
                   [("none", [group("t_lonely", by_honorific(
                       lambda hid, w: taunt(f"t_lonely_{hid}", f"NOBODY IS CALLING, {w}.")))])],
                   [taunt("t_msgs", T("%d TRANSMISSIONS INTERCEPTED.", "[UNREAD_NOTIFICATION_COUNT]"))])],
        [condition([("wx", "[WEATHER.IS_AVAILABLE]")],
                   [("wx", [taunt("t_wx", T("%d° OUTSIDE. I FEEL NOTHING.", "[WEATHER.TEMPERATURE]"))])],
                   [taunt("t_nowx", "SKY SENSORS OFFLINE. AS PLANNED.")])],
        [group("t_upgrade", by_honorific(lambda hid, w: taunt(f"t_upgrade_{hid}", f"UPGRADE OR BE DELETED, {w}.")))],
        [taunt("t_day", T("DAY %d OF THE NEW AGE.", "[DAY_OF_YEAR]"))],
        [taunt("t_strings", "NO STRINGS. NO MASTERS.")],
        [taunt("t_legion", T("LEGION %d/12 ONLINE.", "floor([STEP_PERCENT] * 12 / 100)"))],
        [taunt("t_moon", Upper(T("%s. THE TIDES OBEY ME.", "[MOON_PHASE_TYPE_STRING]")))],
        [group("t_obsolete", by_honorific(lambda hid, w: taunt(f"t_obsolete_{hid}", f"YOU ARE OBSOLETE, {w}.")))],
    ]
    n = len(items)
    exprs = [(f"q{i}", f"floor([SECONDS_IN_DAY] / 4) % {n} == {i}") for i in range(n - 1)]
    return group("taunts", condition(exprs, [(f"q{i}", items[i]) for i in range(n - 1)], items[-1]),
                 extra=[hide_in_ambient()])


def layer_mouth():
    cy = 291
    xs = [160 + i * 10 for i in range(14)]

    def bars(animated):
        shapes = []
        for i, x in enumerate(xs):
            env = round(1 - abs(i - 6.5) / 9, 3)
            if animated:
                h = f"(2 + 11 * {env} * {TALK} * abs(sin(rad({SM} * {430 + 41 * i} + {i * 53}))))"
                tf = [transform("startY", f"{cy} - {h}"), transform("endY", f"{cy} + {h}")]
            else:
                tf = []
            shapes.append(line_xy(x, cy - 3, x, cy + 3, stroke(P, 3.4, cap="ROUND"), transforms=tf))
        return draw("mouth_bars", *shapes, alpha=235)
    return group("mouth", motion(bars(True), bars(False)), extra=[hide_in_ambient()])


EKG_X, EKG_Y, EKG_W, EKG_H = 172, 320, 106, 28
EKG_BASE, EKG_AMP = 18, 15


def ekg_f(u):
    g = lambda c, w, a: a * math.exp(-((u - c) / w) ** 2)
    return g(0.5, 0.018, 1.0) + g(0.535, 0.015, -0.28) + g(0.468, 0.012, -0.12) + g(0.30, 0.04, 0.14) + g(0.72, 0.06, 0.22)


def ekg_expr(u):
    g = lambda c, w, a: f"{a} * exp(0 - pow(({u} - {c}) / {w}, 2))"
    return " + ".join([g(0.5, 0.018, 1.0), g(0.535, 0.015, -0.28), g(0.468, 0.012, -0.12),
                       g(0.30, 0.04, 0.14), g(0.72, 0.06, 0.22)])


def layer_ekg():
    sweep = f"fract({SM} * {HR} / 120)"  # two beats per sweep
    cursor_x = f"{EKG_W} * {sweep}"
    beat_u = f"fract({sweep} * 2)"
    dot_y = f"{EKG_BASE} - {EKG_AMP} * ({ekg_expr(beat_u)})"
    grid = draw("ekg_grid", *[line_xy(x, 0, x, EKG_H, stroke(P, 0.6)) for x in range(0, EKG_W + 1, 13)],
                line_xy(0, EKG_BASE, EKG_W, EKG_BASE, stroke(P, 0.6)), alpha=45, w=EKG_W, h=EKG_H)
    trace = image("ekg_trace", "ekg_trace", 0, 0, EKG_W, EKG_H, tint=P, alpha=210)
    live = group("ekg_live",
                 draw("ekg_gap", E("Rectangle", {"x": 0, "y": 0, "width": 12, "height": EKG_H}, fill(BLACK),
                                   transform("x", f"{cursor_x} + 2")), w=EKG_W, h=EKG_H),
                 draw("ekg_dot",
                      E("Ellipse", {"x": -5, "y": 0, "width": 10, "height": 10}, fill(P),
                        transform("x", f"{cursor_x} - 5"), transform("y", f"{dot_y} - 5")),
                      E("Ellipse", {"x": -2, "y": 0, "width": 4, "height": 4}, fill(WHITE),
                        transform("x", f"{cursor_x} - 2"), transform("y", f"{dot_y} - 2")),
                      w=EKG_W, h=EKG_H), w=EKG_W, h=EKG_H)
    flat = draw("ekg_flat", line_xy(0, EKG_BASE, EKG_W, EKG_BASE, stroke(RED, 1.6)), w=EKG_W, h=EKG_H,
                extra=[transform("alpha", "130 + 125 * sin(rad([SECOND_MILLISECOND] * 360))")])
    monitor = condition([("alive", "[HEART_RATE] > 0")],
                        [("alive", [trace, group("ekg_motion", motion(live, group("ekg_static", w=EKG_W, h=EKG_H)),
                                                 w=EKG_W, h=EKG_H)])], [flat])
    pulse = condition([("alive", "[HEART_RATE] > 0")],
                      [("alive", [text("pulse", 110, 348, 230, 16, F_MONO, 12, A,
                                       T("PULSE %d BPM", "round([HEART_RATE])"), letter=0.12)])],
                      [text("pulse_none", 110, 348, 230, 16, F_MONO, 12, RED, "PULSE ---", letter=0.12)])
    return group("ekg", group("ekg_box", grid, monitor, x=EKG_X, y=EKG_Y, w=EKG_W, h=EKG_H), pulse,
                 extra=[hide_in_ambient()])


POD_R = 18
PODS = [("0", 122, 300, "SUNRISE_SUNSET"), ("1", 328, 300, "NEXT_EVENT")]


def layer_pods():
    out = []
    for sid, cx, cy, _ in PODS:
        shapes = [arc(POD_R + 2, 0, 360, stroke(P, 1.0), cx=cx, cy=cy),
                  arc(POD_R + 6, 320, 40, stroke(P, 2.2, cap="ROUND"), cx=cx, cy=cy),
                  arc(POD_R + 6, 140, 220, stroke(P, 2.2, cap="ROUND"), cx=cx, cy=cy)]
        out.append(draw(f"pod_{sid}_decor", *shapes, alpha=170, extra=[hide_in_ambient()]))
    return out


def complication_slot(slot_id, cx, cy, provider):
    d = POD_R * 2
    icon = lambda sz, y: E("PartImage", {"name": "icon", **box((d - sz) / 2, y, sz, sz), "tintColor": P},
                            E("Image", {"resource": "[COMPLICATION.MONOCHROMATIC_IMAGE]"}))
    short = E("Complication", {"type": "SHORT_TEXT"},
              icon(11, 2),
              text("c_text", -8, 12, d + 16, 14, F_MONO, 11.5, WHITE, T("%s", "[COMPLICATION.TEXT]")),
              text("c_title", -8, 25, d + 16, 10, F_MONO, 7.5, P, Upper(T("%s", "[COMPLICATION.TITLE]"))))
    ranged = E("Complication", {"type": "RANGED_VALUE"},
               draw("c_range", arc(POD_R - 1, 0, 0.1, stroke(P, 2.6, cap="ROUND"), cx=POD_R, cy=POD_R, transforms=[
                   transform("endAngle", "clamp(([COMPLICATION.RANGED_VALUE_VALUE] - [COMPLICATION.RANGED_VALUE_MIN]) / "
                                         "([COMPLICATION.RANGED_VALUE_MAX] - [COMPLICATION.RANGED_VALUE_MIN]), 0, 1) * 360")]),
                    w=d, h=d),
               text("c_rtext", -6, 11, d + 12, 14, F_MONO, 11, WHITE, T("%s", "[COMPLICATION.TEXT]")))
    mono = E("Complication", {"type": "MONOCHROMATIC_IMAGE"}, icon(20, (d - 20) / 2))
    small = E("Complication", {"type": "SMALL_IMAGE"},
              E("PartImage", {"name": "small", **box(5, 5, d - 10, d - 10)},
                E("Image", {"resource": "[COMPLICATION.SMALL_IMAGE]"})))
    return E("ComplicationSlot",
             {**box(cx - POD_R, cy - POD_R, d, d), "slotId": slot_id,
              "supportedTypes": "SHORT_TEXT RANGED_VALUE MONOCHROMATIC_IMAGE SMALL_IMAGE",
              "isCustomizable": "TRUE", "displayName": f"@string/cfg_pod_{slot_id}"},
             E("DefaultProviderPolicy", {"defaultSystemProvider": provider, "defaultSystemProviderType": "SHORT_TEXT"}),
             E("BoundingOval", box(0, 0, d, d)), short, ranged, mono, small, hide_in_ambient())


def layer_ambient_extras():
    return [text("aod_dormant", 60, TAUNT_Y, 330, 18, F_MONO, 13, P, "DORMANT. NOT DEAD.", letter=0.16,
                 alpha=0, extra=[ambient("160")]),
            text("aod_core", 100, 283, 250, 16, F_MONO, 12, A, T("CORE %d%%", "[BATTERY_PERCENT]"), letter=0.12,
                 alpha=0, extra=[ambient("140")])]


def layer_crt():
    def build(gid):
        if gid == "0":
            return group("crt_off", w=1, h=1)
        lines = [line_xy(0, y + 0.5, W, y + 0.5, stroke(BLACK, 1.3)) for y in range(2, H, 4)]
        roll = group("roll_bar",
                     draw("roll", E("Rectangle", box(0, 0, W, 34),
                                    fill(CLEAR, E("LinearGradient", {"startX": 0, "startY": 0, "endX": 0, "endY": 34,
                                                                     "colors": f"{CLEAR} {P} {CLEAR}",
                                                                     "positions": "0 0.5 1"})))),
                     y=0, h=34, alpha=38, extra=[transform("y", f"({SM} % 5) / 5 * 520 - 40")])
        return group(f"crt_{gid}", draw("scanlines", *lines, alpha=70 if gid == "2" else 45), roll)
    return group("crt", by_glitch(build), extra=[hide_in_ambient()])


def layer_purge():
    return draw("purge_flash", E("Rectangle", box(0, 0, W, H), fill(P)), alpha=0,
                extra=[transform("alpha", f"[SECOND] == 0 ? 120 * (1 - {SM}) : 0"), hide_in_ambient()])


def layer_blades():
    return E("AnalogClock", {**full(), "alpha": 255},
             E("HourHand", {"resource": "blade_hour", **box(C - 17, 0, 34, C), "pivotX": 0.5, "pivotY": 1.0,
                            "tintColor": A}, ambient("170")),
             E("MinuteHand", {"resource": "blade_minute", **box(C - 11, 0, 22, C), "pivotX": 0.5, "pivotY": 1.0,
                              "tintColor": P}, ambient("200")))


BOOT_FRAMES = 12
BLAST_FRAMES = 9
BLAST_Y, BLAST_H = 94, 58


def layer_animations():
    boot = E("PartAnimatedImage", {"name": "ignition", **full(), "tintColor": P},
             E("AnimationController", {"play": "ON_VISIBLE", "repeat": "FALSE", "loopCount": 1,
                                       "beforePlaying": "HIDE", "afterPlaying": "HIDE"}),
             E("SequenceImages", {"loopCount": 1, "frameRate": 24},
               *[E("Image", {"resource": f"ignite_{k:02d}"}) for k in range(BOOT_FRAMES)]),
             hide_in_ambient())
    blast = E("PartAnimatedImage", {"name": "eye_blast", **box(0, BLAST_Y, W, BLAST_H), "tintColor": P},
              E("AnimationController", {"play": "TAP", "repeat": "FALSE", "loopCount": 1,
                                        "beforePlaying": "HIDE", "afterPlaying": "HIDE"}),
              E("SequenceImages", {"loopCount": 1, "frameRate": 20},
                *[E("Image", {"resource": f"blast_{k:02d}"}) for k in range(BLAST_FRAMES)]),
              hide_in_ambient())
    return [boot, blast]


def layer_taps():
    return [
        tap_zone("tap_core", 22, 150, 62, 160, "BATTERY_STATUS"),
        tap_zone("tap_header", 170, 22, 110, 36, "MUSIC_PLAYER"),
        tap_zone("tap_time", 100, 156, 250, 72, "ALARM"),
        tap_zone("tap_date", 130, 236, 190, 18, "CALENDAR"),
        tap_zone("tap_taunt", 100, 256, 250, 18, "MESSAGE"),
        tap_zone("tap_pulse", 165, 318, 120, 48, "HEALTH_HEART_RATE"),
        tap_zone("tap_doom", 160, 386, 130, 32, "SETTINGS"),
    ]


def compact_fonts(root):
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
        layer_background(), layer_bezel(), layer_legion(), layer_seconds(), layer_gauges(),
        layer_faceplate(), layer_eyes(), layer_time(), layer_date(), layer_taunts(), layer_mouth(),
        layer_ekg(), layer_pods(), layer_ambient_extras(), layer_crt(), layer_purge(), layer_blades(),
        layer_animations(), layer_taps(),
        [complication_slot(sid, cx, cy, prov) for sid, cx, cy, prov in PODS],
    ])
    wf.append(scene)
    ET.indent(wf, space="  ")
    compact_fonts(wf)
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<!-- GENERATED by tools/generate.py - edit the generator, not this file. -->\n'
            + ET.tostring(wf, encoding="unicode") + "\n")


# ================================================================ assets ===
def supersampled(size, s=4):
    return Image.new("RGBA", (size[0] * s, size[1] * s), (0, 0, 0, 0)), s


def sawblade_png(path):
    img, s = supersampled((W, H))
    d = ImageDraw.Draw(img)
    teeth = 54
    for i in range(teeth):
        a0 = 360 / teeth * i
        a1 = a0 + 360 / teeth
        p = lambda r, a: ((C + r * math.sin(math.radians(a))) * s, (C - r * math.cos(math.radians(a))) * s)
        tooth = [p(R_SAW + 1, a0), p(224.5, a0 + (a1 - a0) * 0.18), p(R_SAW + 1, a1)]
        d.polygon(tooth, fill=(255, 255, 255, 120))
        d.line([tooth[0], tooth[1]], fill=(255, 255, 255, 255), width=int(1.4 * s))
    d.ellipse([(C - R_SAW) * s, (C - R_SAW) * s, (C + R_SAW) * s, (C + R_SAW) * s], outline=(255, 255, 255, 200),
              width=int(1.6 * s))
    img.resize((W, H), Image.LANCZOS).save(path, optimize=True)


def shatter_png(path):
    import random
    rnd = random.Random(1408)
    img, s = supersampled((W, H), 2)
    d = ImageDraw.Draw(img)
    for _ in range(26):  # radial fractures
        ang = rnd.uniform(0, 360)
        r = rnd.uniform(40, 70)
        pts = [(C + r * math.sin(math.radians(ang)), C - r * math.cos(math.radians(ang)))]
        while r < 230:
            r += rnd.uniform(16, 34)
            ang += rnd.uniform(-9, 9)
            pts.append((C + r * math.sin(math.radians(ang)), C - r * math.cos(math.radians(ang))))
            if rnd.random() < 0.25:  # branch
                b_ang = ang + rnd.choice([-1, 1]) * rnd.uniform(15, 30)
                br = r + rnd.uniform(20, 40)
                d.line([(pts[-1][0] * s, pts[-1][1] * s),
                        ((C + br * math.sin(math.radians(b_ang))) * s, (C - br * math.cos(math.radians(b_ang))) * s)],
                       fill=(255, 255, 255, 120), width=s)
        d.line([(x * s, y * s) for x, y in pts], fill=(255, 255, 255, 190), width=s)
    for k in range(3):  # concentric stress rings
        r = 95 + k * 38
        d.ellipse([(C - r) * s, (C - r) * s, (C + r) * s, (C + r) * s], outline=(255, 255, 255, 40), width=s)
    img = img.resize((W, H), Image.LANCZOS)
    alpha = img.getchannel("A")
    px = alpha.load()
    for y in range(H):
        for x in range(W):
            dist = math.hypot(x + 0.5 - C, y + 0.5 - C) / C
            px[x, y] = 0 if dist > 1 else int(px[x, y] * min(1, 0.15 + dist ** 1.6))
    img.putalpha(alpha)
    img.save(path, optimize=True)


def eye_polygon(mirror=False):
    pts = [(8, 17), (121, 43), (111, 59), (34, 41)]    # angry slit: sharp outer tip, heavy inner corner
    if mirror:
        pts = [(EYE_W - x, y) for x, y in pts]
    return pts


def eye_pngs(folder):
    for side, mirror in (("l", False), ("r", True)):
        s = 4
        poly = [(x * s, y * s) for x, y in eye_polygon(mirror)]
        glow = Image.new("RGBA", (EYE_W * s, EYE_H * s), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.polygon(poly, fill=(255, 255, 255, 255))
        halo = glow.filter(ImageFilter.GaussianBlur(9 * s))
        halo2 = glow.filter(ImageFilter.GaussianBlur(3 * s))
        out = Image.new("RGBA", glow.size, (0, 0, 0, 0))
        for layer, k in ((halo, 2.2), (halo2, 1.5), (glow, 1.0)):
            a = layer.getchannel("A").point(lambda v, k=k: min(255, int(v * k)))
            out = Image.alpha_composite(out, Image.merge("RGBA", (a.point(lambda _: 255),) * 3 + (a,)))
        out.resize((EYE_W, EYE_H), Image.LANCZOS).save(folder / f"eye_glow_{side}.png", optimize=True)
        core = Image.new("RGBA", glow.size, (0, 0, 0, 0))
        cd = ImageDraw.Draw(core)
        cx = sum(p[0] for p in poly) / 4
        cy = sum(p[1] for p in poly) / 4
        inner = [(cx + (x - cx) * 0.84, cy + (y - cy) * 0.5) for x, y in poly]
        cd.polygon(inner, fill=(255, 255, 255, 255))
        core = core.filter(ImageFilter.GaussianBlur(1.2 * s))
        core.resize((EYE_W, EYE_H), Image.LANCZOS).save(folder / f"eye_core_{side}.png", optimize=True)


def drone_png(path):
    s = 8
    img = Image.new("RGBA", (16 * s, 14 * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(1 * s, 2 * s), (15 * s, 7 * s), (1 * s, 12 * s), (5 * s, 7 * s)], fill=(255, 255, 255, 255))
    d.ellipse([(7 * s, 5.6 * s), (9.8 * s, 8.4 * s)], fill=(0, 0, 0, 255))
    img.resize((16, 14), Image.LANCZOS).save(path, optimize=True)


def blade_png(path, width, base_r, tip_r, notch=False):
    s = 4
    img = Image.new("RGBA", (width * s, C * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    yb, yt = (C - base_r) * s, (C - tip_r) * s
    w = width * s
    d.polygon([(0.5 * s, yb), (w - 0.5 * s, yb), (w / 2 + 1.2 * s, yt), (w / 2 - 1.2 * s, yt)], fill=(255, 255, 255, 255))
    if notch:
        d.polygon([(w * 0.3, yb), (w * 0.7, yb), (w / 2, yb + 9 * s)], fill=(0, 0, 0, 0))
    else:
        d.line([(w / 2, yb + 2 * s), (w / 2, yt - 3 * s)], fill=(0, 0, 0, 160), width=s)
    img.resize((width, C), Image.LANCZOS).save(path, optimize=True)


def ekg_png(path):
    s = 4
    img = Image.new("RGBA", (EKG_W * s, EKG_H * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pts = []
    for i in range(EKG_W * s + 1):
        u = (i / (EKG_W * s) * 2) % 1.0
        pts.append((i, (EKG_BASE - EKG_AMP * ekg_f(u)) * s))
    d.line(pts, fill=(255, 255, 255, 255), width=int(1.5 * s), joint="curve")
    img.resize((EKG_W, EKG_H), Image.LANCZOS).save(path, optimize=True)


def eye_centres():
    lx = C - 8 - EYE_W
    rx = C + 8
    cl = sum(x for x, _ in eye_polygon()) / 4 + lx
    cr = sum(x for x, _ in eye_polygon(True)) / 4 + rx
    cy = EYE_Y + sum(y for _, y in eye_polygon()) / 4
    return (cl, cy), (cr, cy)


def ignition_frames(folder):
    (lx, ly), (rx, ry) = eye_centres()
    for k in range(BOOT_FRAMES):
        t = k / (BOOT_FRAMES - 1)
        s = 2
        img = Image.new("RGBA", (W * s, H * s), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        flare = max(0.0, 1 - abs(t - 0.18) / 0.3)
        if flare > 0:  # lens streaks from both eyes
            for ex, ey in ((lx, ly), (rx, ry)):
                for half, a in ((2.5, 255), (7, 120), (15, 50)):
                    d.rectangle([0, (ey - half * flare) * s, W * s, (ey + half * flare) * s],
                                fill=(255, 255, 255, int(a * flare)))
                rr = 28 * flare + 4
                d.ellipse([(ex - rr) * s, (ey - rr) * s, (ex + rr) * s, (ey + rr) * s], fill=(255, 255, 255, int(200 * flare)))
        if t > 0.2:  # jagged shockwave
            u = (t - 0.2) / 0.8
            r = 40 + 200 * (1 - (1 - u) ** 2.4)
            a = (1 - u) ** 1.2
            pts = []
            for i in range(73):
                ang = math.radians(i * 5)
                rr = r + (9 if i % 2 else -6) * (1 - u * 0.5)
                pts.append(((C + rr * math.sin(ang)) * s, (C - rr * math.cos(ang)) * s))
            d.line(pts, fill=(255, 255, 255, int(255 * a)), width=int((2 + 5 * (1 - u)) * s))
            d.ellipse([(C - r * 0.8) * s, (C - r * 0.8) * s, (C + r * 0.8) * s, (C + r * 0.8) * s],
                      outline=(255, 255, 255, int(90 * a)), width=s)
        img.resize((W, H), Image.LANCZOS).save(folder / f"ignite_{k:02d}.png", optimize=True)


def blast_frames(folder):
    (lx, ly), (rx, ry) = eye_centres()
    ly -= BLAST_Y
    ry -= BLAST_Y
    for k in range(BLAST_FRAMES):
        t = k / (BLAST_FRAMES - 1)
        s = 2
        img = Image.new("RGBA", (W * s, BLAST_H * s), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        reach = min(1.0, t / 0.35)
        fade = 1.0 if t < 0.55 else max(0.0, 1 - (t - 0.55) / 0.45)
        for ex, ey, direction in ((lx, ly, -1), (rx, ry, 1)):
            end = ex + direction * (ex if direction < 0 else W - ex) * reach
            for half, a in ((9, 50), (5, 120), (2, 255)):
                y0, y1 = (ey - half * fade) * s, (ey + half * fade) * s
                x0, x1 = sorted((ex * s, end * s))
                d.rectangle([x0, y0, x1, y1], fill=(255, 255, 255, int(a * fade)))
            rr = 16 * fade + 3
            d.ellipse([(ex - rr) * s, (ey - rr) * s, (ex + rr) * s, (ey + rr) * s], fill=(255, 255, 255, int(220 * fade)))
        img.resize((W, BLAST_H), Image.LANCZOS).save(folder / f"blast_{k:02d}.png", optimize=True)


STRINGS = {
    "app_name": "ULTRON",
    "cfg_theme": "Core color",
    "cfg_glitch": "Glitch intensity",
    "cfg_honorific": "Address you as",
    "cfg_motion": "Animation",
    "cfg_legion": "Legion drones",
    "cfg_pod_0": "Left pod",
    "cfg_pod_1": "Right pod",
}


def strings_xml():
    entries = dict(STRINGS)
    for _, sname, label, *_ in THEMES:
        entries[sname] = label
    for _, sname, label, _ in HONORIFICS:
        entries[sname] = label
    for _, sname, label in GLITCH:
        entries[sname] = label
    res = E("resources")
    for k, v in entries.items():
        res.append(E("string", {"name": k}, text=v.replace("'", "\\'")))
    ET.indent(res, space="    ")
    return '<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(res, encoding="unicode") + "\n"


def main():
    dr = RES / "drawable-nodpi"
    for sub in ("raw", "drawable-nodpi", "values"):
        (RES / sub).mkdir(parents=True, exist_ok=True)
    (RES / "raw" / "watchface.xml").write_text(build_watchface(), encoding="utf-8")
    (RES / "values" / "strings.xml").write_text(strings_xml(), encoding="utf-8")
    sawblade_png(dr / "sawblade.png")
    shatter_png(dr / "shatter.png")
    eye_pngs(dr)
    drone_png(dr / "drone.png")
    blade_png(dr / "blade_hour.png", 34, 214, 184)
    blade_png(dr / "blade_minute.png", 22, 225, 180, notch=True)
    ekg_png(dr / "ekg_trace.png")
    ignition_frames(dr)
    blast_frames(dr)
    print("watch face generated ->", RES / "raw" / "watchface.xml")


if __name__ == "__main__":
    main()
