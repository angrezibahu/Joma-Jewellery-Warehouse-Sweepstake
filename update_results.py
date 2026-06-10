#!/usr/bin/env python3
"""
World Cup 2026 Sweepstake - automatic results updater.

Runs on a schedule (GitHub Actions). For every match whose result is "due"
(kickoff + 4h, i.e. ~2h play + 2h buffer for extra time / penalties) it pulls
the final score from a live-scores API and writes it into results.json. It then
derives the full tournament state - group standings, who qualifies, and the
knockout bracket - into tracker-state.json, which the website reads to show
eliminations and how far each team (and therefore each sweepstake entrant) got.

Data source: football-data.org v4 (free tier). Set the FOOTBALL_DATA_API_TOKEN
secret. A committed manual-results.json ({"<matchNo>": "2-1", ...}) always wins
over the API, so results can be corrected or entered by hand if the feed is off.

The script is deliberately fail-soft: any network/parse problem is logged and the
run still exits 0 with whatever it could update, so a flaky feed never turns the
schedule red.
"""
import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEDULE = os.path.join(ROOT, "schedule.json")
RESULTS = os.path.join(ROOT, "results.json")
STATE = os.path.join(ROOT, "tracker-state.json")
MANUAL = os.path.join(ROOT, "manual-results.json")

API_TOKEN = os.environ.get("FOOTBALL_DATA_API_TOKEN", "").strip()
API_COMP = os.environ.get("FOOTBALL_DATA_COMPETITION", "WC").strip()
API_BASE = "https://api.football-data.org/v4"

# Map provider team names onto the canonical names used in data.js / schedule.json.
ALIASES = {
    "czech republic": "Czechia",
    "korea republic": "South Korea",
    "south korea": "South Korea",
    "republic of korea": "South Korea",
    "iran": "IR Iran",
    "ir iran": "IR Iran",
    "turkey": "Türkiye",
    "turkiye": "Türkiye",
    "united states": "United States",
    "usa": "United States",
    "united states of america": "United States",
    "bosnia & herzegovina": "Bosnia and Herzegovina",
    "bosnia and herzegovina": "Bosnia and Herzegovina",
    "ivory coast": "Ivory Coast",
    "cote d'ivoire": "Ivory Coast",
    "côte d'ivoire": "Ivory Coast",
    "cape verde": "Cape Verde",
    "cabo verde": "Cape Verde",
    "dr congo": "DR Congo",
    "congo dr": "DR Congo",
    "curacao": "Curaçao",
    "curaçao": "Curaçao",
}


def now_utc():
    # SWEEPSTAKE_NOW lets tests pin the clock (ISO8601, e.g. 2026-06-28T23:30:00Z).
    override = os.environ.get("SWEEPSTAKE_NOW", "").strip()
    if override:
        return parse_iso(override)
    return datetime.now(timezone.utc)


def parse_iso(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def load(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def dump(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def canon(name, valid):
    """Best-effort map an external team name to a canonical schedule name."""
    if not name:
        return None
    key = name.strip().lower()
    if key in ALIASES:
        return ALIASES[key]
    for v in valid:
        if v.lower() == key:
            return v
    # last resort: substring either direction
    for v in valid:
        vl = v.lower()
        if vl in key or key in vl:
            return v
    return None


# --------------------------------------------------------------------------
# Fetching final scores
# --------------------------------------------------------------------------
def fetch_api_matches():
    """Return list of finished matches from football-data.org, or [] on failure."""
    if not API_TOKEN:
        print("No FOOTBALL_DATA_API_TOKEN set - skipping API fetch.")
        return []
    url = f"{API_BASE}/competitions/{API_COMP}/matches?status=FINISHED"
    req = urllib.request.Request(url, headers={"X-Auth-Token": API_TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as e:
        print(f"API fetch failed ({e}); continuing with existing data.")
        return []
    out = []
    for m in data.get("matches", []):
        ft = (m.get("score") or {}).get("fullTime") or {}
        if ft.get("home") is None or ft.get("away") is None:
            continue
        out.append({
            "home": (m.get("homeTeam") or {}).get("name"),
            "away": (m.get("awayTeam") or {}).get("name"),
            "homeScore": ft["home"],
            "awayScore": ft["away"],
            "winner": (m.get("score") or {}).get("winner"),  # HOME_TEAM/AWAY_TEAM/DRAW
            "utcDate": m.get("utcDate"),
        })
    print(f"API returned {len(out)} finished matches.")
    return out


def apply_results(schedule, results):
    """Fill results.json for any match now due, from manual file then the API."""
    valid = {m["home"] for m in schedule if not m["homePlaceholder"]}
    valid |= {m["away"] for m in schedule if not m["awayPlaceholder"]}

    api = fetch_api_matches()
    # index API matches by frozenset of the two canonical team names
    api_idx = {}
    for a in api:
        h, w = canon(a["home"], valid), canon(a["away"], valid)
        if h and w:
            api_idx[frozenset((h, w))] = a

    manual = load(MANUAL, {}) or {}
    now = now_utc()
    changed = 0

    for m in schedule:
        no = str(m["match"])
        rec = results["results"][no]
        if rec.get("status") == "FINISHED":
            continue
        due = parse_iso(m["resultsDueUTC"])
        if now < due:
            continue  # not enough time has passed since this match finished

        home = rec.get("home")
        away = rec.get("away")

        # 1) manual override wins, e.g. "2-1" (orientation = home-away of this match)
        if no in manual and isinstance(manual[no], str) and "-" in manual[no]:
            try:
                hs, as_ = (int(x) for x in manual[no].split("-", 1))
                _set_result(rec, hs, as_)
                changed += 1
                continue
            except ValueError:
                print(f"Bad manual result for match {no}: {manual[no]!r}")

        # 2) API (only once both teams are known, i.e. not still a placeholder)
        if home and away:
            a = api_idx.get(frozenset((home, away)))
            if a:
                if canon(a["home"], valid) == home:
                    _set_result(rec, a["homeScore"], a["awayScore"], a.get("winner"))
                else:
                    _set_result(rec, a["awayScore"], a["homeScore"], a.get("winner"), flip=True)
                changed += 1

    print(f"Updated {changed} match result(s).")
    return changed


def _set_result(rec, home_score, away_score, api_winner=None, flip=False):
    rec["homeScore"] = home_score
    rec["awayScore"] = away_score
    rec["status"] = "FINISHED"
    rec["finishedAt"] = now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")
    if home_score > away_score:
        rec["winner"] = rec.get("home")
    elif away_score > home_score:
        rec["winner"] = rec.get("away")
    else:
        # draw on the day -> knockout decided by ET/pens; trust the API's winner flag
        if api_winner in ("HOME_TEAM", "AWAY_TEAM"):
            home_is = (api_winner == "HOME_TEAM") ^ flip
            rec["winner"] = rec.get("home") if home_is else rec.get("away")
        else:
            rec["winner"] = None  # genuine group-stage draw


# --------------------------------------------------------------------------
# Deriving the tournament state
# --------------------------------------------------------------------------
def group_table(schedule, results, group):
    rows = {}
    teams = set()
    for m in schedule:
        if m.get("group") == group:
            teams.add(m["home"])
            teams.add(m["away"])
    for t in teams:
        rows[t] = {"team": t, "played": 0, "won": 0, "drawn": 0, "lost": 0,
                   "gf": 0, "ga": 0, "gd": 0, "pts": 0}
    for m in schedule:
        if m.get("group") != group:
            continue
        rec = results["results"][str(m["match"])]
        if rec["status"] != "FINISHED":
            continue
        h, a = rec["home"], rec["away"]
        hs, as_ = rec["homeScore"], rec["awayScore"]
        for t, gf, ga in ((h, hs, as_), (a, as_, hs)):
            r = rows[t]
            r["played"] += 1
            r["gf"] += gf
            r["ga"] += ga
            r["gd"] = r["gf"] - r["ga"]
            if gf > ga:
                r["won"] += 1
                r["pts"] += 3
            elif gf == ga:
                r["drawn"] += 1
                r["pts"] += 1
            else:
                r["lost"] += 1
    # FIFA primary ranking: points, goal difference, goals for.
    # (Finer tiebreakers - head-to-head, fair play, drawing of lots - are rare
    # and not reproduced here; the website lets the admin override if needed.)
    order = sorted(rows.values(), key=lambda r: (r["pts"], r["gd"], r["gf"], r["team"]),
                   reverse=True)
    for i, r in enumerate(order):
        r["rank"] = i + 1
    return order


def assign_thirds(third_slots, qualified_thirds):
    """Backtracking match: assign each R32 third-place slot a qualifying team
    whose group is in that slot's allowed set. Returns {matchNo: team} or {}."""
    by_group = {t["group"]: t["team"] for t in qualified_thirds}
    slots = sorted(third_slots, key=lambda s: len(s["allowed"]))  # most-constrained first

    result = {}
    used = set()

    def bt(i):
        if i == len(slots):
            return True
        s = slots[i]
        for g in s["allowed"]:
            if g in by_group and g not in used:
                used.add(g)
                result[s["match"]] = by_group[g]
                if bt(i + 1):
                    return True
                used.discard(g)
                del result[s["match"]]
        return False

    return result if bt(0) else {}


def derive_state(schedule, results, prev):
    by_no = {m["match"]: m for m in schedule}
    teams = sorted({m["home"] for m in schedule if not m["homePlaceholder"]} |
                   {m["away"] for m in schedule if not m["awayPlaceholder"]})

    stages = {t: "groups" for t in teams}
    eliminated = set()
    standings = {}

    # ---- Group stage ----
    groups = sorted({m["group"] for m in schedule if m.get("group")})
    thirds = []
    qualifiers = {}  # "1A" / "2A" -> team
    for g in groups:
        table = group_table(schedule, results, g)
        standings[g] = table
        complete = all(results["results"][str(m["match"])]["status"] == "FINISHED"
                       for m in schedule if m.get("group") == g)
        if complete:
            qualifiers[f"1{g}"] = table[0]["team"]
            qualifiers[f"2{g}"] = table[1]["team"]
            for t in (table[0]["team"], table[1]["team"]):
                stages[t] = "r32"
            eliminated.add(table[3]["team"])  # 4th is always out
            thirds.append({"group": g, **table[2]})

    # ---- Best third-placed teams (top 8 of 12 advance) ----
    third_team = {}  # matchNo -> team (resolves "3A/B/..." slots)
    all_groups_done = len(thirds) == len(groups) and len(groups) == 12
    if all_groups_done:
        ranked = sorted(thirds, key=lambda r: (r["pts"], r["gd"], r["gf"], r["team"]),
                        reverse=True)
        qualified_thirds = ranked[:8]
        for t in ranked[8:]:
            eliminated.add(t["team"])
        for t in qualified_thirds:
            stages[t["team"]] = "r32"
        slots = []
        for m in schedule:
            if m["stage"] == "r32" and m["awayPlaceholder"] and m["away"].startswith("3"):
                allowed = m["away"][1:].split("/")
                slots.append({"match": m["match"], "allowed": allowed})
            if m["stage"] == "r32" and m["homePlaceholder"] and m["home"].startswith("3"):
                allowed = m["home"][1:].split("/")
                slots.append({"match": m["match"], "allowed": allowed, "side": "home"})
        third_team = assign_thirds(slots, qualified_thirds)

    # ---- Knockout propagation (iterate to a fixed point) ----
    KO_NEXT_STAGE = {"r32": "r16", "r16": "qf", "qf": "sf", "sf": "final", "final": "winner"}

    def resolve(ref, match):
        if ref in qualifiers:
            return qualifiers[ref]
        if re.match(r"^3[A-L/]+$", ref):
            return third_team.get(match)
        m = re.match(r"^([WL])(\d+)$", ref)
        if m:
            kind, src = m.group(1), int(m.group(2))
            rec = results["results"].get(str(src))
            if not rec or rec["status"] != "FINISHED" or not rec.get("winner"):
                return None
            win = rec["winner"]
            loser = rec["home"] if win == rec["away"] else rec["away"]
            return win if kind == "W" else loser
        return None  # already a literal team name handled elsewhere

    for _ in range(8):  # depth of the bracket; converges well before this
        progressed = False
        for m in schedule:
            if m["stage"] == "group":
                continue
            rec = results["results"][str(m["match"])]
            # fill in concrete teams as they become known
            for side, ph in (("home", m["homePlaceholder"]), ("away", m["awayPlaceholder"])):
                if rec.get(side) is None:
                    ref = m[side]
                    t = resolve(ref, m["match"]) if ph else ref
                    if t:
                        rec[side] = t
                        progressed = True
            # a knockout score applied before its teams were known can't have a
            # winner yet; recompute it now that both teams are resolved
            if (rec["status"] == "FINISHED" and not rec.get("winner")
                    and rec.get("home") and rec.get("away")
                    and rec.get("homeScore") is not None):
                if rec["homeScore"] > rec["awayScore"]:
                    rec["winner"] = rec["home"]
                    progressed = True
                elif rec["awayScore"] > rec["homeScore"]:
                    rec["winner"] = rec["away"]
                    progressed = True
            # mark stage reached + eliminate the loser of a finished tie
            if rec["status"] == "FINISHED" and rec.get("winner"):
                win = rec["winner"]
                loser = rec["home"] if win == rec["away"] else rec["away"]
                if m["stage"] != "third":
                    nxt = KO_NEXT_STAGE.get(m["stage"])
                    if nxt and stages.get(win) != nxt:
                        stages[win] = nxt
                        progressed = True
                if loser:
                    eliminated.add(loser)
        if not progressed:
            break

    # a team that reached a round but lost is eliminated; champions are not
    eliminated.discard(_champion(schedule, results))

    return {
        "updatedAt": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "auto",
        "eliminated": sorted(eliminated),
        "stages": stages,
        "standings": standings,
    }


def _champion(schedule, results):
    for m in schedule:
        if m["stage"] == "final":
            rec = results["results"][str(m["match"])]
            if rec["status"] == "FINISHED":
                return rec.get("winner")
    return None


def main():
    schedule = load(SCHEDULE)["matches"]
    results = load(RESULTS)
    prev_state = load(STATE, {})

    changed = apply_results(schedule, results)
    results["updatedAt"] = now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")

    # derive_state also fills concrete teams into knockout fixtures as earlier
    # rounds finish, so persist results.json after deriving to keep them.
    state = derive_state(schedule, results, prev_state)
    dump(RESULTS, results)
    dump(STATE, state)

    print(f"Done. {changed} new result(s); "
          f"{len(state['eliminated'])} team(s) eliminated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
