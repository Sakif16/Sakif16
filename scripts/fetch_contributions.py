#!/usr/bin/env python3
"""
Fetch the GitHub contribution calendar through GraphQL.

Environment:
  GH_TOKEN  GitHub token stored in the repository as PROFILE_GH_TOKEN
  USERNAME  defaults to Sakif16
"""
import datetime, json, os
from pathlib import Path
import requests

token = os.environ["GH_TOKEN"]
username = os.environ.get("USERNAME", "Sakif16")

query = """
query($login:String!) {
  user(login:$login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { contributionCount date }
        }
      }
    }
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC) {
      totalCount
    }
  }
}
"""

r = requests.post(
    "https://api.github.com/graphql",
    headers={"Authorization": f"bearer {token}"},
    json={"query": query, "variables": {"login": username}},
    timeout=30,
)
r.raise_for_status()
payload = r.json()
if "errors" in payload:
    raise SystemExit(payload["errors"])

user = payload["data"]["user"]
cal = user["contributionsCollection"]["contributionCalendar"]
weeks, active_days = [], 0
for week in cal["weeks"]:
    values = []
    for day in week["contributionDays"]:
        n = int(day["contributionCount"])
        values.append(n)
        active_days += 1 if n > 0 else 0
    weeks.append(values)

out = {
    "updated": datetime.date.today().isoformat(),
    "weeks": weeks,
    "stats": {
        "commits": cal["totalContributions"],
        "repos": user["repositories"]["totalCount"],
        "active_days": active_days,
    },
}
path = Path("data/contributions.json")
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(out, indent=2))
