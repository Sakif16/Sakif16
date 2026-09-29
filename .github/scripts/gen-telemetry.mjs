#!/usr/bin/env node
// Regenerates the live panels from GitHub data:
//   assets/telemetry.svg          — counts, contribution streak + activity-pulse curve (BST)
//   assets/activity.svg           — daily contribution graph (last 26 weeks)
//   assets/projects.svg           — "03 — projects" header strip
//   assets/proj-<key>.svg         — one clickable card per project
// Design is byte-identical to the hand-built originals — only data cells move.
//
// Requires env GITHUB_TOKEN (the workflow passes the built-in token). Zero deps.
// Run: GITHUB_TOKEN=xxx node .github/scripts/gen-telemetry.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USER = "Sakif16";

// Project cards, in display order. `star` = repo slug whose live star count is
// shown as "<lang> · ★ N". If `star` is null, `meta` is used verbatim.
const PROJECTS = [
  { key: "nobojatra", title: "nobojatra", lang: "typescript", star: "Sakif16/nobojatra",
    href: "https://github.com/Sakif16/nobojatra",
    d1: "smart travel planning platform",
    d2: "next.js · typescript · mongodb" },
  { key: "snitch", title: "snitch", lang: "typescript", star: "Sakif16/snitch",
    href: "https://github.com/Sakif16/snitch",
    // TODO: I couldn't verify this repo's details publicly — fill in the
    // real one-line description and tech stack below.
    d1: "TODO — one line describing snitch",
    d2: "TODO — tech · stack · used" },
  // more from sakif16.github.io/projects.html you could add:
  // { key: "study-buddy", title: "study buddy", lang: "typescript", star: "Sakif16/study-buddy",
  //   href: "https://github.com/Sakif16/study-buddy",
  //   d1: "study management & productivity platform",
  //   d2: "react · node.js · prisma" },
  // { key: "surveillance-ugv", title: "surveillance-ugv-type-0", lang: "c++", star: "Sakif16/Surveillance-UGV-Type-0",
  //   href: "https://github.com/Sakif16/Surveillance-UGV-Type-0",
  //   d1: "cost-effective autonomous surveillance ugv",
  //   d2: "arduino · embedded systems" },
];

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const ASSETS = resolve(ROOT, "assets");

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const gh = async (path) => {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": USER },
  });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
};

const gql = async (query, variables) => {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": USER },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(`graphql: ${JSON.stringify(j.errors)}`);
  return j.data;
};

const iso = (d) => d.toISOString();

// ── fetch live data ─────────────────────────────────────────────
async function collect() {
  const profile = await gh(`/users/${USER}`);
  const created = new Date(profile.created_at);

  // all-time contributions: sum each year's calendar (one <=1yr window at a time)
  let totalContrib = 0;
  const thisYear = new Date().getUTCFullYear();
  for (let y = created.getUTCFullYear(); y <= thisYear; y++) {
    const from = iso(new Date(Date.UTC(y, 0, 1)));
    const to = iso(new Date(Date.UTC(y, 11, 31, 23, 59, 59)));
    const d = await gql(
      `query($u:String!,$f:DateTime!,$t:DateTime!){user(login:$u){contributionsCollection(from:$f,to:$t){contributionCalendar{totalContributions}}}}`,
      { u: USER, f: from, t: to }
    );
    totalContrib += d.user.contributionsCollection.contributionCalendar.totalContributions;
  }

  const now = new Date();

  // One calendar query feeds two panels: the whole window is a year of daily
  // counts (a streak can't outrun it), and its last 26 weeks are the graph.
  // 364, not 365 — contributionsCollection rejects ranges over a year.
  const CALENDAR_DAYS = 364;
  const GRAPH_DAYS = 182;
  const calendarStart = new Date(now.getTime() - CALENDAR_DAYS * 864e5);
  const calendarData = await gql(
    `query($u:String!,$f:DateTime!,$t:DateTime!){user(login:$u){contributionsCollection(from:$f,to:$t){contributionCalendar{weeks{contributionDays{contributionCount date}}}}}}`,
    { u: USER, f: iso(calendarStart), t: iso(now) }
  );
  const calendar = calendarData.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ n: d.contributionCount, date: d.date }));
  const days = calendar.slice(-GRAPH_DAYS);

  // star counts for cards that show a star
  const stars = {};
  for (const p of PROJECTS)
    if (p.star) stars[p.key] = (await gh(`/repos/${p.star}`)).stargazers_count;

  return { contributions: totalContrib, repos: profile.public_repos, followers: profile.followers, since: created, days, streak: currentStreak(calendar), stars };
}

// Current streak = consecutive days with at least one contribution, counting
// back from today. Today is still in progress, so a run that reaches yesterday
// still counts as live — same rule github-readme-stats uses.
function currentStreak(calendar) {
  const byDate = new Map(calendar.map((d) => [d.date, d.n]));
  const t = new Date();
  const day = (back) =>
    new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - back))
      .toISOString()
      .slice(0, 10);
  let back = byDate.get(day(0)) > 0 ? 0 : 1;
  let n = 0;
  while (byDate.get(day(back + n)) > 0) n++;
  return n;
}

// ── geometry helpers ────────────────────────────────────────────
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

// Fixed daily activity-pulse curve (BST, local to the author) — not derived
// from GitHub data, so it's a constant rather than computed per run.
// Plateaus hold each level; short 1hr ramps (not vertical jumps) carry the
// curve between them so the rises/falls read as gradual, not stepped:
//   00:01–04:00 100% · 04:00–13:00 0% · 13:00–15:00 40% · 15:00–18:00 60%
//   18:00–20:00 30% · 20:00–22:00 75% · 22:00–24:00 100%
const ACTIVITY_PULSE_POINTS =
  "540,98 586.7,98 600,150 706.7,150 720,129.2 733.3,129.2 746.7,118.8 " +
  "773.3,118.8 786.7,134.4 800,134.4 813.3,111 826.7,111 840,98 860,98";
const ACTIVITY_PULSE_END = { x: 860, y: 98 };
// x-axis tick labels, every 3 hours, small so 9 labels don't crowd the row.
const ACTIVITY_PULSE_TICKS = [
  { x: 540, label: "00:01", anchor: "start" },
  { x: 580, label: "03:00", anchor: "middle" },
  { x: 620, label: "06:00", anchor: "middle" },
  { x: 660, label: "09:00", anchor: "middle" },
  { x: 700, label: "12:00", anchor: "middle" },
  { x: 740, label: "15:00", anchor: "middle" },
  { x: 780, label: "18:00", anchor: "middle" },
  { x: 820, label: "21:00", anchor: "middle" },
  { x: 860, label: "24:00", anchor: "end" },
];

// Streak flame — 16 × 24 box drawn around the origin, so it drops straight
// onto a text baseline. Outer body in the accent, inner core in the theme's
// ember tone; the flicker is CSS so the whole file stays self-contained.
const FLAME_W = 16;
const FLAME_H = 24;
const FLAME_OUTER = "M8 0C12.4 4.4 15 8 15 13C15 18.4 11.9 24 8 24C4.1 24 1 18.4 1 13C1 9.6 2.6 7.2 4.2 5.2C4.4 7.6 5.4 9 7.4 9.6C6.9 6.4 7 2.8 8 0Z";
const FLAME_CORE = "M8 11.4C10.4 14.4 11.2 16.2 11.2 18C11.2 20.6 9.8 22.2 8 22.2C6.2 22.2 4.8 20.6 4.8 18C4.8 15.8 6.2 13.4 8 11.4Z";

// ── templates ───────────────────────────────────────────────────
// ── black / red palette ──────────────────────────────────────
const STYLE = `<style>
.fade{animation:fade .9s ease both}
@keyframes fade{from{opacity:0}}
.blink{animation:blink 1.1s steps(2,start) infinite}
@keyframes blink{50%{opacity:0}}
.ping{transform-box:fill-box;transform-origin:center;animation:ping 2.2s ease-out infinite}
@keyframes ping{0%{transform:scale(.55);opacity:.8}100%{transform:scale(1.7);opacity:0}}
.draw{stroke-dasharray:700;animation:draw 2.4s ease both .3s}
@keyframes draw{from{stroke-dashoffset:700}to{stroke-dashoffset:0}}
.grow{transform-box:fill-box;transform-origin:left;animation:grow 1.4s ease both .4s}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.flame{transform-box:fill-box;transform-origin:50% 100%;animation:flicker 1.5s ease-in-out infinite}
@keyframes flicker{0%,100%{transform:scale(1)}30%{transform:scale(.93,1.07)}62%{transform:scale(1.05,.96)}}
.flame-core{transform-box:fill-box;transform-origin:50% 100%;animation:ember 1.5s ease-in-out infinite}
@keyframes ember{0%,100%{opacity:.75;transform:scale(.9)}45%{opacity:1;transform:scale(1.08)}}
</style>`;

// Transparent ground: the panel background IS GitHub's page background, so the
// gaps between panels are indistinguishable from the panels themselves — in
// both themes. Orange accent carries the identity instead of a painted ground.
const THEME = {
  dark:  { fg: "#e6edf3", mut: "#8b949e", line: "#30363d", acc: "#C1121F", ember: "#FFA94D" },
  light: { fg: "#0d1117", mut: "#57606a", line: "#d0d7de", acc: "#C1121F", ember: "#F76707" },
};

const FONT = `font-family="ui-monospace,'SFMono-Regular','Cascadia Mono',Menlo,Consolas,'Liberation Mono',monospace"`;
const svgOpen = (h, c, w = 880) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ${FONT}>
<defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${c.acc}" stop-opacity="0.4"/><stop offset="1" stop-color="${c.acc}" stop-opacity="0"/></linearGradient></defs>
${STYLE}`;

// ── telemetry stat block ────────────────────────────────────────
// Four stats share the run from x=30 to the activity chart at x=540. The
// monospace stack advances a flat 0.6em per glyph (plus letter-spacing), so
// every row's right edge is computable up front — the guard below throws on a
// value that would ever grow into its neighbour or into the chart, instead of
// quietly shipping an overlap.
const STAT_X0 = 30;
const STAT_PITCH = 125;
const CHART_X = 540;
const STAT_MIN_GAP = 14;      // whitespace each stat must leave its neighbour
const STAT_FLAME_GAP = 5;     // gap between the flame and the value beside it
const STAT_ROWS = {
  label: { y: 92, size: 10, ls: 1.2, weight: 400 },
  value: { y: 128, size: 27, ls: 0, weight: 700 },
  cap: { y: 152, size: 10, ls: 0, weight: 400 },
};
const statWidth = (text, r) => [...String(text)].length * (0.6 * r.size + r.ls);

const statText = (x, r, text, fill) =>
  `<text x="${x}" y="${r.y}" font-size="${r.size}" fill="${fill}" font-weight="${r.weight}" text-anchor="start"` +
  `${r.ls ? ` letter-spacing="${r.ls}"` : ""}>${text}</text>`;

// Flame sits in the gutter left of its column, standing on the value baseline.
// The outer <g> only positions — the inner one carries the flicker, so no CSS
// transform ever overwrites the translate.
const statFlame = (t, x) =>
  `<g transform="translate(${x} ${STAT_ROWS.value.y - FLAME_H})"><g class="flame">` +
  `<path d="${FLAME_OUTER}" fill="${t.acc}"/><path class="flame-core" d="${FLAME_CORE}" fill="${t.ember}"/>` +
  `</g></g>`;

const statBlock = (t) => {
  const stats = [
    { label: "contributions", value: t.contrib, cap: t.since },
    { label: "repositories", value: t.repos, cap: "public" },
    { label: "followers", value: t.followers, cap: "and counting" },
    { label: "streak", value: t.streak, cap: "days in a row", flame: true },
  ];
  let prevRight = -Infinity;
  return stats
    .map((s, i) => {
      const x = STAT_X0 + i * STAT_PITCH;
      const w = Math.max(...["label", "value", "cap"].map((k) => statWidth(s[k], STAT_ROWS[k])));
      const left = s.flame ? x - STAT_FLAME_GAP - FLAME_W : x;
      // last column is bounded by the chart, the rest by the next column's edge
      const room = i === stats.length - 1 ? CHART_X - STAT_MIN_GAP - x : STAT_PITCH - STAT_MIN_GAP;
      if (w > room)
        throw new Error(`telemetry stat "${s.label}" is ${w.toFixed(1)}px wide, only ${room}px fit — shrink STAT_ROWS or widen STAT_PITCH`);
      if (left - prevRight < STAT_MIN_GAP)
        throw new Error(`telemetry stat "${s.label}" icon starts at ${left.toFixed(1)}, only ${(left - prevRight).toFixed(1)}px after the previous stat (need ${STAT_MIN_GAP})`);
      prevRight = x + w;
      return [
        statText(x, STAT_ROWS.label, s.label, t.mut),
        s.flame ? statFlame(t, left) : "",
        statText(x, STAT_ROWS.value, s.value, t.fg),
        statText(x, STAT_ROWS.cap, s.cap, t.mut),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
};

const telemetrySVG = (t) => `${svgOpen(180, t)}
<text x="10" y="26" font-size="12" fill="${t.acc}" font-weight="600" text-anchor="start" letter-spacing="3" class="fade">04 — telemetry</text><line x1="150.8" y1="21" x2="870" y2="21" stroke="${t.line}" stroke-width="1"/>
${statBlock(t)}
<text x="540" y="92" font-size="11" fill="${t.mut}" font-weight="400" text-anchor="start" letter-spacing="2">activity pulse · bst</text>
<polyline class="draw" points="${ACTIVITY_PULSE_POINTS}" fill="none" stroke="${t.acc}" stroke-width="1.5"/>
<circle class="ping" cx="${ACTIVITY_PULSE_END.x}" cy="${ACTIVITY_PULSE_END.y}" r="6" fill="none" stroke="${t.acc}" stroke-width="1"/>
<circle cx="${ACTIVITY_PULSE_END.x}" cy="${ACTIVITY_PULSE_END.y}" r="2.5" fill="${t.acc}"/>
${ACTIVITY_PULSE_TICKS.map((tk) => `<text x="${tk.x}" y="164" font-size="7" fill="${t.mut}" font-weight="400" text-anchor="${tk.anchor}">${tk.label}</text>`).join("\n")}
</svg>
`;

// Daily contribution graph — replaces the dead third-party activity-graph widget.
const activitySVG = (t) => `${svgOpen(210, t)}
<text x="10" y="26" font-size="12" fill="${t.acc}" font-weight="600" text-anchor="start" letter-spacing="3" class="fade">contribution telemetry</text><line x1="208.4" y1="21" x2="870" y2="21" stroke="${t.line}" stroke-width="1"/>
${t.gridlines}
<path d="${t.area}" fill="url(#area)"/>
<polyline class="draw" points="${t.points}" fill="none" stroke="${t.acc}" stroke-width="1.5"/>
<circle class="ping" cx="${t.px}" cy="${t.py}" r="6" fill="none" stroke="${t.acc}" stroke-width="1"/>
<circle cx="${t.px}" cy="${t.py}" r="2.5" fill="${t.acc}"/>
${t.months}
<text x="30" y="52" font-size="10" fill="${t.mut}" font-weight="400" text-anchor="start">peak ${t.peak}/day · ${t.total} in the last 26 weeks</text>
</svg>
`;

const projHeaderSVG = (c) => `${svgOpen(40, c)}
<text x="10" y="26" font-size="12" fill="${c.acc}" font-weight="600" text-anchor="start" letter-spacing="3" class="fade">03 — projects</text><line x1="143.60000000000002" y1="21" x2="870" y2="21" stroke="${c.line}" stroke-width="1"/>
</svg>
`;

const cardSVG = (t) => `${svgOpen(96, t, 410)}
<rect x="1" y="1" width="408" height="94" rx="8" fill="none" stroke="${t.line}" stroke-width="1"/>
<rect x="1" y="1" width="3" height="94" fill="${t.acc}" opacity="0.7"/>
<text x="18" y="32" font-size="15" fill="${t.fg}" font-weight="700" text-anchor="start">${esc(t.title)}</text>
<text x="392" y="32" font-size="11" fill="${t.acc}" font-weight="400" text-anchor="end">${esc(t.meta)}</text>
<text x="18" y="58" font-size="12" fill="${t.mut}" font-weight="400" text-anchor="start">${esc(t.d1)}</text>
<text x="18" y="78" font-size="12" fill="${t.mut}" font-weight="400" text-anchor="start">${esc(t.d2)}</text>
</svg>
`;

// ── contribution graph geometry ─────────────────────────────────
function graph(days, c) {
  const X0 = 30, X1 = 850, Y0 = 80, Y1 = 165;
  const vals = days.length ? days : [{ n: 0, date: new Date().toISOString().slice(0, 10) }];
  const max = Math.max(...vals.map((d) => d.n), 1);
  const pts = vals.map((d, i) => ({
    x: Math.round((X0 + ((X1 - X0) * i) / Math.max(1, vals.length - 1)) * 10) / 10,
    y: Math.round((Y1 - (d.n / max) * (Y1 - Y0)) * 10) / 10,
  }));
  const points = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `M${pts[0].x} ${Y1} L` + points.replace(/ /g, " L") + ` L${pts[pts.length - 1].x} ${Y1} Z`;
  const gridlines = [0, 0.5, 1]
    .map((f) => `<line x1="${X0}" y1="${Y1 - f * (Y1 - Y0)}" x2="${X1}" y2="${Y1 - f * (Y1 - Y0)}" stroke="${c.line}" stroke-width="1" stroke-dasharray="2 6"/>`)
    .join("\n");
  const months = vals.reduce((acc, d, i) => {
    const dt = new Date(d.date + "T00:00:00Z");
    if (dt.getUTCDate() <= 7 && !acc.seen.has(dt.getUTCMonth())) {
      acc.seen.add(dt.getUTCMonth());
      acc.out.push(`<text x="${pts[i].x}" y="188" font-size="10" fill="${c.mut}" font-weight="400" text-anchor="middle">${MONTHS[dt.getUTCMonth()]}</text>`);
    }
    return acc;
  }, { seen: new Set(), out: [] }).out.join("\n");
  const last = pts[pts.length - 1];
  return { points, area, gridlines, months, px: last.x, py: last.y, peak: max, total: vals.reduce((s, d) => s + d.n, 0).toLocaleString("en-US") };
}

// ── main ────────────────────────────────────────────────────────
const data = await collect();
const contrib = `${data.contributions.toLocaleString("en-US")}+`;
const since = `since ${MONTHS[data.since.getUTCMonth()]} ${data.since.getUTCFullYear()}`;

mkdirSync(ASSETS, { recursive: true });

for (const theme of ["dark", "light"]) {
  const c = THEME[theme];
  const g = graph(data.days, c);
  writeFileSync(resolve(ASSETS, `telemetry-${theme}.svg`),
    telemetrySVG({ ...c, contrib, repos: data.repos, followers: data.followers, streak: data.streak, since }));
  writeFileSync(resolve(ASSETS, `activity-${theme}.svg`), activitySVG({ ...c, ...g }));
  writeFileSync(resolve(ASSETS, `projects-${theme}.svg`), projHeaderSVG(c));
  for (const p of PROJECTS) {
    const meta = p.star ? `${p.lang} · ★ ${data.stars[p.key]}` : p.meta;
    writeFileSync(resolve(ASSETS, `proj-${p.key}-${theme}.svg`), cardSVG({ ...c, title: p.title, meta, d1: p.d1, d2: p.d2 }));
  }
}

console.log(
  `updated: contributions=${contrib} repos=${data.repos} followers=${data.followers} ` +
    `streak=${data.streak} stars=${JSON.stringify(data.stars)} cards=${PROJECTS.length} days=${data.days.length}`
);
