#!/usr/bin/env python3
from pathlib import Path
import json, random
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "contributions.json"
OUT = ROOT / "assets" / "telemetry.gif"

W, H = 1000, 430
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 15)
TITLE = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 22)
levels = " .:-=+*#%@"
random.seed(260827)

payload = json.loads(DATA.read_text())
weeks = payload.get("weeks", []) or [[0]*7 for _ in range(53)]
updated = payload.get("updated", "unknown")
maxv = max(1, max(max(w) if w else 0 for w in weeks))

chars = []
for w in weeks[:53]:
    row = []
    for v in w[:7]:
        idx = min(len(levels)-1, int(round((v/maxv)*(len(levels)-1))))
        row.append(levels[idx])
    chars.append(row)

frames = []
cols = len(chars)
for phase in range(2):
    for t in range(18):
        im = Image.new("RGB", (W,H), (6,8,10))
        d = ImageDraw.Draw(im)
        d.rectangle((18,18,W-18,H-18), outline=(70,75,78), width=2)
        d.text((34,34), "$ github --telemetry", font=TITLE, fill=(220,235,220))
        d.text((34,72), f"contributions / {updated}", font=FONT, fill=(145,165,145))
        d.text((34,104), "legend: . low   :   +   *   #   @ high", font=FONT, fill=(120,140,120))
        for c in range(cols):
            for r in range(7):
                x, y = 40 + c*17, 150 + r*28
                val = chars[c][r] if r < len(chars[c]) else " "
                if phase == 0 and c > t + 1:
                    val = random.choice(" .:+*#@")
                d.text((x,y), val, font=FONT, fill=(195,220,195))
        stats = payload.get("stats", {})
        line = f"commits={stats.get('commits','?')}  repos={stats.get('repos','?')}  active_days={stats.get('active_days','?')}"
        d.text((34,365), line, font=FONT, fill=(170,190,170))
        d.text((34,390), "[ telemetry channel nominal ]", font=FONT, fill=(215,230,215))
        frames.append(im)

frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=90, loop=0, disposal=2, optimize=False)
