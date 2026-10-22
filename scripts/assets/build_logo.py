#!/usr/bin/env python3
"""
Builds the GREEN PLUG EV logo set from one definition:
  public/brand/logo-on-light.svg, logo-on-dark.svg, mark.svg, mark-on-dark.svg, app-icon.svg
  public/favicon.svg
  src/brand/brandPaths.ts  (outlined path data used by the React logo and the intro animation)

The wordmark is outlined from Unbounded (SIL OFL 1.1) so the SVGs render identically everywhere.
Usage: python3 scripts/assets/build_logo.py /path/to/Unbounded[wght].ttf
"""
import io
import json
import os
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONT = sys.argv[1]
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')

PAL = {'forest': '#051F20', 'pine': '#0B2B26', 'spruce': '#163832', 'moss': '#235347', 'sage': '#8EB69B', 'mint': '#DAF1DE'}

# ---------------------------------------------------------------- mark (64 x 64 units)
# A charging cable that curls into a "G" and ends in a plug pointing into its centre,
# with a spark node where the cable starts.
MARK = {
    'arc': 'M45.5 15.9A21 21 0 1 0 53 32L44 32',  # cable: open G, then the stem into the plug
    'plug': 'M36 25h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3Z',
    'prongs': 'M26.5 27.6h6.5v3.2h-6.5a1.6 1.6 0 0 1 0-3.2ZM26.5 33.2h6.5v3.2h-6.5a1.6 1.6 0 0 1 0-3.2Z',
    'spark': 'M53.6 6.2l1.5 3.4 3.4 1.5-3.4 1.5-1.5 3.4-1.5-3.4-3.4-1.5 3.4-1.5Z',
}
ARC_WIDTH = 7.5


def mark_svg(arc, plug, spark, x=0, y=0, s=1.0):
    t = f' transform="translate({x} {y}) scale({s})"' if (x or y or s != 1) else ''
    return (f'<g{t}><path d="{MARK["arc"]}" fill="none" stroke="{arc}" stroke-width="{ARC_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{MARK["plug"]}" fill="{plug}"/><path d="{MARK["prongs"]}" fill="{plug}"/><path d="{MARK["spark"]}" fill="{spark}"/></g>')


# ---------------------------------------------------------------- wordmark glyphs
font = TTFont(FONT)
inst = instancer.instantiateVariableFont(font, {'wght': 640})
gs = inst.getGlyphSet()
cmap = inst.getBestCmap()
upm = inst['head'].unitsPerEm
cap = inst['OS/2'].sCapHeight
hmtx = inst['hmtx']


def glyph_paths(text, size, tracking=0.0):
    """Return [(char, d, x_advance)] with y-down coordinates, baseline at y=0, cap height = size."""
    scale = size / cap
    out = []
    x = 0.0
    for ch in text:
        g = cmap[ord(ch)]
        adv = hmtx[g][0] * scale
        if ch != ' ':
            pen = SVGPathPen(gs)
            tp = TransformPen(pen, (scale, 0, 0, -scale, x, 0))
            gs[g].draw(tp)
            out.append({'ch': ch, 'd': pen.getCommands(), 'x': round(x, 3), 'w': round(adv, 3)})
        x += adv + tracking * size
    return out, x - tracking * size


WORD_SIZE = 26  # cap height in logo units
word, word_w = glyph_paths('GREEN PLUG', WORD_SIZE, tracking=0.02)
ev, ev_w = glyph_paths('EV', WORD_SIZE * 0.62, tracking=0.04)

MARK_SIZE = 64
GAP = 16
word_x = MARK_SIZE + GAP
baseline = 32 + WORD_SIZE / 2
pill_pad_x = 9
pill_h = WORD_SIZE * 0.62 + 14
pill_x = word_x + word_w + 12
pill_w = ev_w + pill_pad_x * 2
pill_y = 32 - pill_h / 2
TOTAL_W = pill_x + pill_w + 2


def logo_svg(c):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {TOTAL_W:.1f} 64" role="img" aria-labelledby="t"><title id="t">GREEN PLUG EV</title>']
    parts.append(mark_svg(c['arc'], c['plug'], c['spark']))
    parts.append(f'<g transform="translate({word_x} {baseline})" fill="{c["word"]}">' + ''.join(f'<path d="{g["d"]}"/>' for g in word) + '</g>')
    parts.append(f'<rect x="{pill_x:.2f}" y="{pill_y:.2f}" width="{pill_w:.2f}" height="{pill_h:.2f}" rx="{pill_h / 2:.2f}" fill="{c["pill"]}"/>')
    parts.append(f'<g transform="translate({pill_x + pill_pad_x:.2f} {32 + WORD_SIZE * 0.31:.2f})" fill="{c["pillText"]}">' + ''.join(f'<path d="{g["d"]}"/>' for g in ev) + '</g>')
    parts.append('</svg>')
    return ''.join(parts)


ON_LIGHT = {'arc': PAL['spruce'], 'plug': PAL['moss'], 'spark': PAL['sage'], 'word': PAL['pine'], 'pill': PAL['moss'], 'pillText': PAL['mint']}
ON_DARK = {'arc': PAL['mint'], 'plug': PAL['sage'], 'spark': PAL['sage'], 'word': PAL['mint'], 'pill': PAL['sage'], 'pillText': PAL['forest']}

brand_dir = os.path.join(ROOT, 'public', 'brand')
os.makedirs(brand_dir, exist_ok=True)
open(os.path.join(brand_dir, 'logo-on-light.svg'), 'w').write(logo_svg(ON_LIGHT))
open(os.path.join(brand_dir, 'logo-on-dark.svg'), 'w').write(logo_svg(ON_DARK))
open(os.path.join(brand_dir, 'mark.svg'), 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">{mark_svg(PAL["spruce"], PAL["moss"], PAL["sage"])}</svg>')
open(os.path.join(brand_dir, 'mark-on-dark.svg'), 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">{mark_svg(PAL["mint"], PAL["sage"], PAL["sage"])}</svg>')
icon = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{PAL["moss"]}"/><stop offset=".55" stop-color="{PAL["pine"]}"/><stop offset="1" stop-color="{PAL["forest"]}"/></linearGradient></defs>'
        '<rect width="64" height="64" rx="15" fill="url(#g)"/>' + mark_svg(PAL['mint'], PAL['sage'], PAL['sage'], 8.5, 8.5, 0.73) + '</svg>')
open(os.path.join(brand_dir, 'app-icon.svg'), 'w').write(icon)
open(os.path.join(ROOT, 'public', 'favicon.svg'), 'w').write(icon)

ts = ('// Generated by scripts/assets/build_logo.py. Do not edit by hand.\n'
      '// Wordmark outlined from Unbounded (SIL OFL 1.1).\n'
      f'export const MARK = {json.dumps(MARK, indent=2)} as const;\n'
      f'export const ARC_WIDTH = {ARC_WIDTH};\n'
      f'export const WORD = {json.dumps(word)};\n'
      f'export const EV = {json.dumps(ev)};\n'
      f'export const LAYOUT = {json.dumps({"total": round(TOTAL_W, 2), "wordX": word_x, "baseline": baseline, "pill": {"x": round(pill_x, 2), "y": round(pill_y, 2), "w": round(pill_w, 2), "h": round(pill_h, 2)}, "evX": round(pill_x + pill_pad_x, 2), "evBaseline": round(32 + WORD_SIZE * 0.31, 2), "wordW": round(word_w, 2)})};\n')
os.makedirs(os.path.join(ROOT, 'src', 'brand'), exist_ok=True)
open(os.path.join(ROOT, 'src', 'brand', 'brandPaths.ts'), 'w').write(ts)
print('logo width', round(TOTAL_W, 1))
