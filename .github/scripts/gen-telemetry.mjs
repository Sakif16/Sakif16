#!/usr/bin/env node
// Regenerates the live panels from GitHub data:
//   assets/telemetry.svg          — counts + a fixed daily activity-pulse curve (BST)
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

  // ~26 weeks of daily counts for the contribution graph panel
  const graphStart = new Date(now.getTime() - 182 * 864e5);
  const graphData = await gql(
    `query($u:String!,$f:DateTime!,$t:DateTime!){user(login:$u){contributionsCollection(from:$f,to:$t){contributionCalendar{weeks{contributionDays{contributionCount date}}}}}}`,
    { u: USER, f: iso(graphStart), t: iso(now) }
  );
  const days = graphData.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ n: d.contributionCount, date: d.date }));

  // star counts for cards that show a star
  const stars = {};
  for (const p of PROJECTS)
    if (p.star) stars[p.key] = (await gh(`/repos/${p.star}`)).stargazers_count;

  return { contributions: totalContrib, repos: profile.public_repos, followers: profile.followers, since: created, days, stars };
}

// ── geometry helpers ────────────────────────────────────────────
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

// Fixed daily activity-pulse curve (BST, local to the author) — not derived
// from GitHub data, so it's a constant rather than computed per run.
//   00:01–04:00 100% · 04:00–13:00 0% · 13:00–15:00 40% · 15:00–18:00 60%
//   18:00–20:00 30% · 20:00–22:00 75% · 22:00–24:00 100%
const ACTIVITY_PULSE_POINTS =
  "540,98 593.3,98 593.3,150 713.3,150 713.3,129.2 740,129.2 740,118.8 " +
  "780,118.8 780,134.4 806.7,134.4 806.7,111 833.3,111 833.3,98 860,98";
const ACTIVITY_PULSE_END = { x: 860, y: 98 };

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
</style>`;

// Transparent ground: the panel background IS GitHub's page background, so the
// gaps between panels are indistinguishable from the panels themselves — in
// both themes. Orange accent carries the identity instead of a painted ground.
const THEME = {
  dark:  { fg: "#e6edf3", mut: "#8b949e", line: "#30363d", acc: "#C1121F" },
  light: { fg: "#0d1117", mut: "#57606a", line: "#d0d7de", acc: "#C1121F" },
};

const FONT = `font-family="ui-monospace,'SFMono-Regular','Cascadia Mono',Menlo,Consolas,'Liberation Mono',monospace"`;
const svgOpen = (h, c, w = 880) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ${FONT}>
<defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${c.acc}" stop-opacity="0.4"/><stop offset="1" stop-color="${c.acc}" stop-opacity="0"/></linearGradient></defs>
${STYLE}`;

const telemetrySVG = (t) => `${svgOpen(180, t)}
<text x="10" y="26" font-size="12" fill="${t.acc}" font-weight="600" text-anchor="start" letter-spacing="3" class="fade">04 — telemetry</text><line x1="150.8" y1="21" x2="870" y2="21" stroke="${t.line}" stroke-width="1"/>
<text x="30" y="92" font-size="11" fill="${t.mut}" font-weight="400" text-anchor="start" letter-spacing="2">contributions</text>
<text x="30" y="128" font-size="30" fill="${t.fg}" font-weight="700" text-anchor="start">${t.contrib}</text>
<text x="30" y="152" font-size="10" fill="${t.mut}" font-weight="400" text-anchor="start">${t.since}</text>
<text x="205" y="92" font-size="11" fill="${t.mut}" font-weight="400" text-anchor="start" letter-spacing="2">repositories</text>
<text x="205" y="128" font-size="30" fill="${t.fg}" font-weight="700" text-anchor="start">${t.repos}</text>
<text x="205" y="152" font-size="10" fill="${t.mut}" font-weight="400" text-anchor="start">public</text>
<text x="350" y="92" font-size="11" fill="${t.mut}" font-weight="400" text-anchor="start" letter-spacing="2">followers</text>
<text x="350" y="128" font-size="30" fill="${t.fg}" font-weight="700" text-anchor="start">${t.followers}</text>
<text x="350" y="152" font-size="10" fill="${t.mut}" font-weight="400" text-anchor="start">and counting</text>
<text x="540" y="92" font-size="11" fill="${t.mut}" font-weight="400" text-anchor="start" letter-spacing="2">activity pulse · bst</text>
<polyline class="draw" points="${ACTIVITY_PULSE_POINTS}" fill="none" stroke="${t.acc}" stroke-width="1.5"/>
<circle class="ping" cx="${ACTIVITY_PULSE_END.x}" cy="${ACTIVITY_PULSE_END.y}" r="6" fill="none" stroke="${t.acc}" stroke-width="1"/>
<circle cx="${ACTIVITY_PULSE_END.x}" cy="${ACTIVITY_PULSE_END.y}" r="2.5" fill="${t.acc}"/>
<text x="540" y="164" font-size="9" fill="${t.mut}" font-weight="400" text-anchor="start">00:01</text>
<text x="860" y="164" font-size="9" fill="${t.mut}" font-weight="400" text-anchor="end">24:00</text>
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
    telemetrySVG({ ...c, contrib, repos: data.repos, followers: data.followers, since }));
  writeFileSync(resolve(ASSETS, `activity-${theme}.svg`), activitySVG({ ...c, ...g }));
  writeFileSync(resolve(ASSETS, `projects-${theme}.svg`), projHeaderSVG(c));
  for (const p of PROJECTS) {
    const meta = p.star ? `${p.lang} · ★ ${data.stars[p.key]}` : p.meta;
    writeFileSync(resolve(ASSETS, `proj-${p.key}-${theme}.svg`), cardSVG({ ...c, title: p.title, meta, d1: p.d1, d2: p.d2 }));
  }
}

console.log(
  `updated: contributions=${contrib} repos=${data.repos} followers=${data.followers} ` +
    `stars=${JSON.stringify(data.stars)} cards=${PROJECTS.length} days=${data.days.length}`
);
