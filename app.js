// ============================================
// Joma Jewellery World Cup Sweepstake
// Curated by Megg
// ============================================

let state = loadState();
if (!state.overrides) state.overrides = {};   // migrate older saved state
const isAdmin = new URLSearchParams(window.location.search).get("admin") === "true";

const TOTAL_SPOTS = 48;

// The day the Fixtures list should land on (today, or the next day with
// matches). Set by renderFixtures, used to anchor the scroll position.
let fixturesAnchorDate = null;

// Today's date in UK local time as "YYYY-MM-DD", to match schedule ukDate.
function todayUKDate() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

// Jump the Fixtures list to today's matches so you don't scroll from June 11th.
function scrollFixturesToToday(smooth) {
    if (!fixturesAnchorDate) return;
    const el = document.getElementById("fx-day-" + fixturesAnchorDate);
    if (el) el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

// ---- Init ----
document.addEventListener("DOMContentLoaded", async () => {
    setupTabs();
    renderSpotsBadge();
    updateDrawStatus();
    updateBankDetails();

    await loadLiveData();          // pull committed schedule + auto-updated results
    renderGroups();
    renderBracket();
    renderFixtures();
    setupAdmin();
    setupTeamClicks();

    // Fixtures is the default tab — land on today's matches rather than the
    // opening fixtures back in June.
    requestAnimationFrame(() => scrollFixturesToToday(false));
});

// Delegated click: anywhere a team name is rendered with [data-team-click],
// tapping it opens that team's detail card (results so far + how far they've
// gone), with a button to replay the celebration/commiseration animation.
function setupTeamClicks() {
    const handler = (e) => {
        const el = e.target.closest("[data-team-click]");
        if (!el) return;
        if (document.querySelector(".anim-overlay")) return;  // one at a time
        e.preventDefault();
        showTeamDetail(el.dataset.teamClick);
    };
    document.addEventListener("click", handler);
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const el = e.target.closest("[data-team-click]");
        if (!el) return;
        e.preventDefault();
        if (document.querySelector(".anim-overlay")) return;
        showTeamDetail(el.dataset.teamClick);
    });
}

function playTeamStatus(name) {
    const team = findTeam(name);
    if (!team) return;
    if (isEliminated(name)) {
        playEliminationAnimation(team);
        return;
    }
    const stage = getStage(name);
    playAdvanceAnimation(team, "groups", stage, { review: true });
}

// Long, friendly names for a team's tournament stage (the value stored by the
// tracker: groups / r32 / r16 / qf / sf / final / winner).
const STAGE_NAME_LONG = {
    groups: "Group Stage",
    r32: "Round of 32",
    r16: "Round of 16",
    qf: "Quarter-finals",
    sf: "Semi-finals",
    final: "Final",
    winner: "Champions",
};

function stageNameLong(stage) {
    return Object.prototype.hasOwnProperty.call(STAGE_NAME_LONG, stage)
        ? STAGE_NAME_LONG[stage] : "the tournament";
}

// Resolve the actual team name on one side of a scheduled match. Group matches
// carry real names; knockout fixtures start as placeholders and get filled in
// by the results engine as earlier rounds finish. Mirrors fixtureSide().
function resolvedName(m, side) {
    const rec = RESULTS[String(m.match)] || {};
    const resolved = rec[side];
    const placeholder = side === "home" ? m.homePlaceholder : m.awayPlaceholder;
    const ref = side === "home" ? m.home : m.away;
    return resolved || (placeholder ? null : ref);
}

// Every scheduled match this team appears in, oldest first, with the result
// worked out from their point of view.
function teamMatches(name) {
    const out = [];
    for (const m of SCHEDULE) {
        const home = resolvedName(m, "home");
        const away = resolvedName(m, "away");
        if (home !== name && away !== name) continue;

        const isHome = home === name;
        const opponent = isHome ? away : home;
        const rec = RESULTS[String(m.match)] || {};
        const finished = rec.status === "FINISHED";

        const ts = isHome ? Number(rec.homeScore) : Number(rec.awayScore);
        const os = isHome ? Number(rec.awayScore) : Number(rec.homeScore);
        const hasScore = finished && Number.isFinite(ts) && Number.isFinite(os);
        const outcome = hasScore ? (ts > os ? "W" : ts < os ? "L" : "D") : null;

        out.push({ m, isHome, opponent, rec, finished, ts, os, hasScore, outcome });
    }
    return out.sort((a, b) => a.m.match - b.m.match);
}

// Detail card: a team's results so far and where they are in the tournament,
// with a button to replay the celebration / commiseration moment.
function showTeamDetail(name) {
    const team = findTeam(name);
    if (!team) return;

    const owner = state.assignments[name];
    const eliminated = isEliminated(name);
    const stage = getStage(name);
    const matches = teamMatches(name);
    const now = Date.now();

    // Played record (finished matches only).
    let p = 0, w = 0, d = 0, l = 0, gf = 0, ga = 0;
    for (const mt of matches) {
        if (!mt.hasScore) continue;
        p++; gf += mt.ts; ga += mt.os;
        if (mt.outcome === "W") w++;
        else if (mt.outcome === "L") l++;
        else d++;
    }
    const recordLine = p > 0
        ? `Played ${p} · ${w}W ${d}D ${l}L · ${gf}–${ga} goals`
        : "No matches played yet";

    let statusText, statusCls;
    if (stage === "winner") {
        statusText = "\u{1F3C6} Champions!"; statusCls = "in";
    } else if (eliminated) {
        statusText = `Eliminated — went out in the ${stageNameLong(stage)}`; statusCls = "out";
    } else if (stage === "groups") {
        statusText = "Still in it — currently in the Group Stage"; statusCls = "in";
    } else {
        statusText = `Still in it — through to the ${stageNameLong(stage)}`; statusCls = "in";
    }

    // The football carries a halo coloured by the result (gold win / red loss /
    // grey draw, none if unplayed). When the team is eliminated, the last match
    // they actually played is the one they went out on — cross that ball out.
    let lastPlayedIdx = -1;
    matches.forEach((mt, i) => { if (mt.hasScore) lastPlayedIdx = i; });

    const rowsHtml = matches.map((mt, i) => {
        const m = mt.m;
        const day = new Date(m.ukDate + "T12:00:00Z")
            .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
        const stageTag = m.stage === "group" ? `Group ${m.group}` : (STAGE_LABEL_LONG[m.stage] || m.stage);
        const oppFlag = mt.opponent ? teamFlag(mt.opponent) : "";
        const oppName = mt.opponent ? escapeHtml(mt.opponent) : "TBC";

        let resHtml, rowCls;
        if (mt.hasScore) {
            const cls = mt.outcome === "W" ? "win" : mt.outcome === "L" ? "loss" : "draw";
            const label = mt.outcome === "W" ? "Won" : mt.outcome === "L" ? "Lost" : "Drew";
            const knockedOut = eliminated && i === lastPlayedIdx;
            const ballCls = `td-ball ${cls}${knockedOut ? " knocked-out" : ""}`;
            const ballTitle = knockedOut ? `${label} — knocked out` : label;
            resHtml = `<span class="${ballCls}" role="img" aria-label="${ballTitle}" title="${ballTitle}">⚽</span><span class="td-mscore">${mt.ts}–${mt.os}</span>`;
            rowCls = "played";
        } else {
            const due = now >= Date.parse(m.resultsDueUTC);
            resHtml = `<span class="td-ball none" role="img" aria-label="Not played yet">⚽</span><span class="td-mko">${due ? "Awaiting" : escapeHtml(m.ukTime)}</span>`;
            rowCls = "upcoming";
        }

        return `
            <div class="td-match ${rowCls}">
                <div class="td-mdate">${day}<span class="td-mstage">${stageTag}</span></div>
                <div class="td-mopp"><span class="td-vs">v</span><span class="td-mflag">${oppFlag}</span><span class="td-mname">${oppName}</span></div>
                <div class="td-mres">${resHtml}</div>
            </div>`;
    }).join("");

    const btnLabel = stage === "winner" ? "\u{1F3C6} Celebrate"
        : eliminated ? "\u{1F3F4} Lower the flag"
        : "\u{1F389} Cheer them on";

    const overlay = document.createElement("div");
    overlay.className = "anim-overlay team-detail";
    overlay.innerHTML = `
        <div class="td-card">
            <button class="anim-close" aria-label="Close">&times;</button>
            <div class="td-head">
                <span class="td-flag">${team.flag}</span>
                <div class="td-headinfo">
                    <div class="td-name">${escapeHtml(team.name)}</div>
                    ${owner ? `<div class="td-owner">${escapeHtml(owner)}</div>` : ""}
                </div>
            </div>
            <div class="td-status ${statusCls}">${statusText}</div>
            <div class="td-record">${recordLine}</div>
            <div class="td-matches">${rowsHtml || '<div class="td-empty">No fixtures yet.</div>'}</div>
            <button class="td-celebrate">${btnLabel}</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector(".anim-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".td-celebrate").addEventListener("click", () => {
        close();
        playTeamStatus(name);
    });
    requestAnimationFrame(() => overlay.classList.add("show"));
}

// ---- Effective team state: auto results (LIVE), with admin overrides on top ----
function isEliminated(name) {
    const o = state.overrides[name];
    if (o && typeof o.eliminated === "boolean") return o.eliminated;
    return (LIVE.eliminated || []).includes(name);
}

function getStage(name) {
    const o = state.overrides[name];
    if (o && o.stage) return o.stage;
    return (LIVE.stages || {})[name] || "groups";
}

// ---- Spots badge ----
function renderSpotsBadge() {
    const taken = Math.max(0, Math.min(SPOTS_TAKEN, TOTAL_SPOTS));
    document.getElementById("spots-taken").textContent = taken;
    document.getElementById("spots-total").textContent = TOTAL_SPOTS;
}

// ---- Tabs ----
function setupTabs() {
    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById(tab.dataset.tab).classList.add("active");
            if (tab.dataset.tab === "fixtures") scrollFixturesToToday(true);
        });
    });
}

// ---- Render Groups ----
function renderGroups() {
    const grid = document.getElementById("groups-grid");
    grid.innerHTML = "";

    for (const [groupName, teams] of Object.entries(WORLD_CUP_DATA.groups)) {
        const card = document.createElement("div");
        card.className = "group-card";

        let teamsHTML = "";
        for (const team of teams) {
            const owner = state.assignments[team.name];
            const eliminated = isEliminated(team.name);
            const ownerDisplay = owner
                ? `<span class="team-owner">${escapeHtml(owner)}</span>`
                : `<span class="team-owner unassigned">Available</span>`;

            teamsHTML += `
                <div class="team-row${eliminated ? ' eliminated' : ''}">
                    <span class="team-flag">${team.flag}</span>
                    <span class="team-name">${team.name}</span>
                    ${state.drawComplete ? ownerDisplay : ''}
                </div>`;
        }

        card.innerHTML = `
            <div class="group-header">Group ${groupName}</div>
            ${teamsHTML}`;
        grid.appendChild(card);
    }
}

// ---- Render Bracket ----
function renderBracket() {
    const view = document.getElementById("bracket-view");
    view.innerHTML = "";

    const activeStage = document.querySelector(".stage-btn.active")?.dataset.stage || "groups";

    const allTeams = getAllTeams();
    const filteredTeams = filterTeamsByStage(allTeams, activeStage);

    if (filteredTeams.length === 0) {
        view.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 2rem;">
            No teams at this stage yet. The tournament hasn't reached here!
        </div>`;
        return;
    }

    for (const team of filteredTeams) {
        const eliminated = isEliminated(team.name);
        const owner = state.assignments[team.name];
        const stage = getStage(team.name);

        const card = document.createElement("div");
        card.className = `bracket-team ${eliminated ? 'eliminated' : 'alive'} is-clickable`;
        card.dataset.teamClick = team.name;
        card.innerHTML = `
            <span class="team-flag">${team.flag}</span>
            <div class="bracket-team-info">
                <div class="bracket-team-name">${team.name}</div>
                ${owner ? `<div class="bracket-team-owner">${escapeHtml(owner)}</div>` : ''}
            </div>
            <span class="bracket-team-stage">${getStageName(stage)}</span>`;
        view.appendChild(card);
    }

    // Stage button listeners
    document.querySelectorAll(".stage-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".stage-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderBracket();
        };
    });
}

function filterTeamsByStage(teams, viewStage) {
    const stageOrder = ["groups", "r32", "r16", "qf", "sf", "final", "winner"];
    const viewIdx = stageOrder.indexOf(viewStage);

    if (viewStage === "groups") return teams;

    // A team's stage is the furthest round it reached, so this also keeps
    // teams knocked out at this round visible (greyed) — but not teams that
    // never got this far.
    return teams.filter(t => {
        const teamStage = getStage(t.name);
        const teamIdx = stageOrder.indexOf(teamStage);
        return teamIdx >= viewIdx;
    });
}

function getAllTeams() {
    const teams = [];
    for (const group of Object.values(WORLD_CUP_DATA.groups)) {
        teams.push(...group);
    }
    return teams;
}

function getStageName(stage) {
    const names = {
        groups: "Groups",
        r32: "R32",
        r16: "R16",
        qf: "QF",
        sf: "Semi",
        final: "Final",
        winner: "WINNER!"
    };
    return Object.prototype.hasOwnProperty.call(names, stage) ? names[stage] : "Unknown stage";
}

// ---- Fixtures / internal calendar ----
function teamFlag(name) {
    for (const team of getAllTeams()) {
        if (team.name === name) return team.flag;
    }
    return "";
}

// Friendly label for an unresolved placeholder like "2A", "3A/B/C/D/F", "W73", "L101".
function placeholderLabel(ref) {
    let m;
    if ((m = /^1([A-L])$/.exec(ref))) return `Winner Group ${m[1]}`;
    if ((m = /^2([A-L])$/.exec(ref))) return `Runner-up Group ${m[1]}`;
    if (/^3[A-L/]+$/.test(ref)) return "3rd place";
    if ((m = /^W(\d+)$/.exec(ref))) return `Winner of #${m[1]}`;
    if ((m = /^L(\d+)$/.exec(ref))) return `Loser of #${m[1]}`;
    return ref;
}

function fixtureSide(match, side) {
    const rec = RESULTS[String(match.match)] || {};
    const resolved = rec[side];                    // filled in by the engine as rounds finish
    const ref = side === "home" ? match.home : match.away;
    const placeholder = side === "home" ? match.homePlaceholder : match.awayPlaceholder;
    const name = resolved || (placeholder ? null : ref);
    if (name) {
        const owner = state.assignments[name];
        return {
            name,
            html: `<span class="fx-flag">${teamFlag(name)}</span>
                   <span class="fx-team-name${isEliminated(name) ? ' eliminated' : ''}">${escapeHtml(name)}</span>
                   ${owner ? `<span class="fx-owner">${escapeHtml(owner)}</span>` : ""}`,
        };
    }
    return { name: null, html: `<span class="fx-team-name tbd">${escapeHtml(placeholderLabel(ref))}</span>` };
}

const STAGE_LABEL_LONG = {
    group: "Group Stage", r32: "Round of 32", r16: "Round of 16",
    qf: "Quarter-final", sf: "Semi-final", third: "Third-place play-off", final: "Final",
};

function renderFixtures() {
    const view = document.getElementById("fixtures-view");
    if (!view) return;

    if (!SCHEDULE.length) {
        view.innerHTML = `<div class="fx-empty">Fixture calendar unavailable.</div>`;
        return;
    }

    if (LIVE.updatedAt) {
        const updated = new Date(LIVE.updatedAt);
        document.getElementById("fixtures-updated").textContent =
            `Results auto-update ~2 hours after each match finishes. Last update: ${updated.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;
    }

    const now = Date.now();
    const byDate = {};
    for (const m of SCHEDULE) {
        (byDate[m.ukDate] = byDate[m.ukDate] || []).push(m);
    }

    // Anchor the list on today's matches (or the next day with fixtures if
    // there's nothing on today) so the user lands on what's current.
    const dates = Object.keys(byDate).sort();
    const today = todayUKDate();
    fixturesAnchorDate = dates.find(date => date >= today) || dates[dates.length - 1] || null;

    let html = "";
    for (const date of dates) {
        const d = new Date(date + "T12:00:00Z");
        const dateText = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
        const isToday = date === today;
        const isAnchor = date === fixturesAnchorDate;
        const dayCls = isToday ? " today" : (isAnchor ? " next-up" : "");
        const badge = isToday ? '<span class="fx-day-tag">Today</span>'
            : isAnchor ? '<span class="fx-day-tag">Next up</span>' : "";
        html += `<div class="fx-day${dayCls}" id="fx-day-${date}">${dateText}${badge}</div>`;
        for (const m of byDate[date].sort((a, b) => a.match - b.match)) {
            const rec = RESULTS[String(m.match)] || {};
            const finished = rec.status === "FINISHED";
            const due = now >= Date.parse(m.resultsDueUTC);
            const home = fixtureSide(m, "home");
            const away = fixtureSide(m, "away");

            // Coerce scores to numbers so nothing from results.json can ever
            // reach innerHTML as markup.
            const hs = rec.homeScore != null ? Number(rec.homeScore) : NaN;
            const as = rec.awayScore != null ? Number(rec.awayScore) : NaN;
            let middle, statusClass;
            if (finished && Number.isFinite(hs) && Number.isFinite(as)) {
                middle = `<span class="fx-score">${hs} – ${as}</span>`;
                statusClass = "done";
            } else if (due) {
                middle = `<span class="fx-vs">v</span>`;
                statusClass = "due";
            } else {
                middle = `<span class="fx-ko">${m.ukTime}</span>`;
                statusClass = "upcoming";
            }

            const tag = m.stage === "group" ? `Group ${m.group}` : STAGE_LABEL_LONG[m.stage];
            const note = finished ? "Full time"
                : due ? "Awaiting result"
                : `${m.ukTime} BST`;

            const sideAttrs = (s, sideName) => {
                const cls = `fx-side ${sideName}${s.name ? ' is-clickable' : ''}`;
                const extra = s.name
                    ? ` data-team-click="${escapeHtml(s.name)}" role="button" tabindex="0"`
                    : '';
                return `class="${cls}"${extra}`;
            };
            html += `
                <div class="fx-match ${statusClass}">
                    <div class="fx-meta"><span class="fx-tag">${tag}</span><span class="fx-num">#${m.match}</span></div>
                    <div class="fx-teams">
                        <div ${sideAttrs(home, "home")}>${home.html}</div>
                        <div class="fx-mid">${middle}</div>
                        <div ${sideAttrs(away, "away")}>${away.html}</div>
                    </div>
                    <div class="fx-foot"><span class="fx-venue">${escapeHtml(m.venue)}</span><span class="fx-status">${note}</span></div>
                </div>`;
        }
    }
    view.innerHTML = html;
}

// ---- Draw Status ----
function updateDrawStatus() {
    const el = document.getElementById("draw-status");
    if (state.drawComplete) {
        el.innerHTML = `<span class="status-badge complete">Draw complete! Good luck everyone!</span>`;
    } else {
        el.innerHTML = `<span class="status-badge pending">Draw not yet made - watch this space!</span>`;
    }
}

// ---- Bank details ----
function updateBankDetails() {
    const sortEl = document.getElementById("sort-code");
    const accEl = document.getElementById("account-no");
    if (sortEl && state.bankSortCode) sortEl.textContent = state.bankSortCode;
    if (accEl && state.bankAccountNo) accEl.textContent = state.bankAccountNo;
}

// ---- Admin ----
function setupAdmin() {
    if (!isAdmin) return;

    document.getElementById("admin-panel").classList.remove("hidden");
    document.getElementById("bracket-admin").classList.remove("hidden");

    // Draw button
    document.getElementById("run-draw-btn").addEventListener("click", runDraw);
    document.getElementById("clear-draw-btn").addEventListener("click", clearDraw);
    document.getElementById("export-btn").addEventListener("click", exportData);
    document.getElementById("import-btn").addEventListener("click", () => {
        document.getElementById("import-file").click();
    });
    document.getElementById("import-file").addEventListener("change", importData);

    // Bracket admin
    populateTeamSelects();
    document.getElementById("eliminate-btn").addEventListener("click", eliminateTeam);
    document.getElementById("reinstate-btn").addEventListener("click", reinstateTeam);
    document.getElementById("advance-btn").addEventListener("click", advanceTeam);
}

function runDraw() {
    const input = document.getElementById("participants-input").value.trim();
    if (!input) {
        alert("Enter some names first!");
        return;
    }

    const names = input.split("\n").map(n => n.trim()).filter(n => n.length > 0);
    const teams = getAllTeams();

    if (names.length > teams.length) {
        alert(`Too many names! You have ${names.length} names but only ${teams.length} teams.`);
        return;
    }

    // Shuffle teams
    const shuffled = [...teams];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Assign
    state.assignments = {};
    for (let i = 0; i < names.length; i++) {
        state.assignments[shuffled[i].name] = names[i];
    }
    state.drawComplete = true;

    // Initialize stages
    state.stages = {};
    for (const team of teams) {
        state.stages[team.name] = "groups";
    }

    saveState(state);

    // Animate
    animateDraw(names, shuffled).then(() => {
        renderGroups();
        renderBracket();
        updateDrawStatus();
        populateTeamSelects();
        launchConfetti();
    });
}

async function animateDraw(names, shuffledTeams) {
    const animDiv = document.getElementById("draw-animation");
    const slotName = document.getElementById("slot-name");
    const slotTeam = document.getElementById("slot-team");
    animDiv.classList.remove("hidden");

    for (let i = 0; i < names.length; i++) {
        slotName.classList.add("spinning");
        slotTeam.classList.add("spinning");

        // Spin for a bit
        const spinTime = 600 + Math.random() * 400;
        const spinInterval = setInterval(() => {
            slotName.textContent = names[Math.floor(Math.random() * names.length)];
            slotTeam.textContent = shuffledTeams[Math.floor(Math.random() * shuffledTeams.length)].name;
        }, 50);

        await sleep(spinTime);
        clearInterval(spinInterval);

        slotName.classList.remove("spinning");
        slotTeam.classList.remove("spinning");
        slotName.textContent = names[i];
        slotTeam.textContent = shuffledTeams[i].name;

        await sleep(800);
    }
}

function clearDraw() {
    if (!confirm("Clear the entire draw? This cannot be undone!")) return;
    state = getDefaultState();
    saveState(state);
    renderGroups();
    renderBracket();
    updateDrawStatus();
    populateTeamSelects();
}

function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sweepstake-data.json";
    a.click();
    URL.revokeObjectURL(url);
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            state = { ...getDefaultState(), ...data };
            saveState(state);
            renderGroups();
            renderBracket();
            updateDrawStatus();
            updateBankDetails();
            populateTeamSelects();
            alert("Data imported!");
        } catch {
            alert("Invalid JSON file!");
        }
    };
    reader.readAsText(file);
}

function populateTeamSelects() {
    const teams = getAllTeams();
    const eliminateSelect = document.getElementById("eliminate-team");
    const advanceSelect = document.getElementById("set-stage-team");

    [eliminateSelect, advanceSelect].forEach(sel => {
        const firstOpt = sel.options[0];
        sel.innerHTML = "";
        sel.appendChild(firstOpt);
        for (const team of teams) {
            const opt = document.createElement("option");
            opt.value = team.name;
            const owner = state.assignments[team.name];
            opt.textContent = `${team.flag} ${team.name}${owner ? ` (${owner})` : ''}`;
            sel.appendChild(opt);
        }
    });
}

// Admin actions write to the overrides layer, which takes precedence over the
// auto-updated results (so the organiser can correct a wrong/late feed by hand).
function setOverride(name, patch) {
    state.overrides[name] = { ...(state.overrides[name] || {}), ...patch };
    saveState(state);
}

function eliminateTeam() {
    const name = document.getElementById("eliminate-team").value;
    if (!name) return;
    if (!isEliminated(name)) {
        setOverride(name, { eliminated: true });
        const team = findTeam(name);
        playEliminationAnimation(team).then(() => {
            renderGroups();
            renderBracket();
            renderFixtures();
        });
    }
}

function reinstateTeam() {
    const name = document.getElementById("eliminate-team").value;
    if (!name) return;
    setOverride(name, { eliminated: false });
    renderGroups();
    renderBracket();
    renderFixtures();
}

function advanceTeam() {
    const name = document.getElementById("set-stage-team").value;
    const stage = document.getElementById("set-stage-to").value;
    if (!name) return;
    const previousStage = getStage(name);
    setOverride(name, { stage, eliminated: false });
    const team = findTeam(name);
    playAdvanceAnimation(team, previousStage, stage).then(() => {
        renderBracket();
        renderFixtures();
    });
}

function findTeam(name) {
    return getAllTeams().find(t => t.name === name);
}

// ---- Confetti ----
function launchConfetti() {
    const canvas = document.getElementById("confetti-canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = [];
    const colors = ["#ffffff", "#e0e0e0", "#b0b0b0", "#808080", "#555555", "#333333", "#cccccc"];

    for (let i = 0; i < 150; i++) {
        pieces.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            w: Math.random() * 10 + 5,
            h: Math.random() * 6 + 3,
            color: colors[Math.floor(Math.random() * colors.length)],
            vx: (Math.random() - 0.5) * 3,
            vy: Math.random() * 3 + 2,
            rot: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 10
        });
    }

    let frame = 0;
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;

        for (const p of pieces) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05;
            p.rot += p.rotSpeed;

            if (p.y < canvas.height + 50) alive = true;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rot * Math.PI) / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        }

        frame++;
        if (alive && frame < 300) {
            requestAnimationFrame(animate);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    animate();
}

// ---- Elimination: half-mast flag ----
function playEliminationAnimation(team) {
    if (!team) return Promise.resolve();
    const owner = state.assignments[team.name];
    const overlay = document.createElement("div");
    overlay.className = "anim-overlay elimination";
    overlay.innerHTML = `
        <div class="anim-stage">
            <div class="flagpole">
                <div class="pole-top"></div>
                <div class="pole"></div>
                <div class="pole-base"></div>
                <div class="flag-hoist" id="elim-flag">
                    <div class="flag-cloth">
                        <span class="flag-emoji">${team.flag}</span>
                        <span class="flag-name">${escapeHtml(team.name)}</span>
                    </div>
                </div>
            </div>
            <div class="anim-caption">
                <div class="anim-title">Going Home</div>
                <div class="anim-sub">${escapeHtml(team.name)} eliminated${owner ? ` &mdash; commiserations ${escapeHtml(owner)}` : ''}</div>
            </div>
        </div>
        <button class="anim-close" aria-label="Close">&times;</button>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector(".anim-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    return new Promise(resolve => {
        // Trigger the descent
        requestAnimationFrame(() => {
            overlay.classList.add("show");
            setTimeout(() => {
                overlay.querySelector("#elim-flag").classList.add("half-mast");
            }, 600);
        });
        setTimeout(() => {
            overlay.classList.add("fade-out");
            setTimeout(() => { close(); resolve(); }, 500);
        }, 4200);
    });
}

// ---- Advancement: march toward the trophy ----
const STAGE_PROGRESS = {
    groups: 0,
    r32: 1,
    r16: 2,
    qf: 3,
    sf: 4,
    final: 5,
    winner: 6
};

function playAdvanceAnimation(team, fromStage, toStage, opts = {}) {
    if (!team) return Promise.resolve();
    const review = !!opts.review;
    const owner = state.assignments[team.name];
    const fromIdx = STAGE_PROGRESS[fromStage] ?? 0;
    const toIdx = STAGE_PROGRESS[toStage] ?? 0;
    // Real advancements need to actually move; review mode plays even at equal stages.
    if (!review && toIdx <= fromIdx) return Promise.resolve();

    const stagesPath = ["Groups", "R32", "R16", "QF", "Semi", "Final", "🏆"];
    const totalSteps = 6;
    const startPct = (fromIdx / totalSteps) * 100;
    const endPct = (toIdx / totalSteps) * 100;
    const isWinner = toStage === "winner";
    const stillInGroups = review && toIdx === 0;
    const title = isWinner ? 'CHAMPIONS!'
        : review
            ? (stillInGroups ? 'Still flying the flag' : `Marching on!`)
            : 'Through to the next round!';
    const sub = isWinner ? `${escapeHtml(team.name)} lift the Jules Rimet!`
        : review
            ? (stillInGroups
                ? `${escapeHtml(team.name)} are in the group stage`
                : `${escapeHtml(team.name)} are currently in the ${getStageName(toStage)}`)
            : `${escapeHtml(team.name)} march on to the ${getStageName(toStage)}`;
    const ownerLine = owner
        ? (isWinner || !review ? ` &mdash; well played ${escapeHtml(owner)}!` : ` &mdash; come on ${escapeHtml(owner)}!`)
        : '';

    const overlay = document.createElement("div");
    overlay.className = "anim-overlay advance" + (isWinner ? " winner" : "");
    overlay.innerHTML = `
        <div class="anim-stage advance-stage">
            <div class="march-track">
                <div class="march-pitch"></div>
                <div class="march-checkpoints">
                    ${stagesPath.map((s, i) => `
                        <div class="checkpoint${i <= toIdx ? ' reached' : ''}${i === toIdx ? ' active' : ''}">
                            <div class="checkpoint-dot"></div>
                            <div class="checkpoint-label">${s}</div>
                        </div>
                    `).join("")}
                </div>
                <div class="trophy-target">
                    <div class="trophy-glow"></div>
                    <div class="trophy-icon">🏆</div>
                </div>
                <div class="march-lane">
                    <div class="marcher" id="adv-marcher" style="--start: ${startPct}%; --end: ${endPct}%;">
                        <div class="marcher-flag">${team.flag}</div>
                        <div class="marcher-name">${escapeHtml(team.name)}</div>
                    </div>
                </div>
            </div>
            <div class="anim-caption">
                <div class="anim-title">${title}</div>
                <div class="anim-sub">${sub}${ownerLine}</div>
            </div>
        </div>
        <button class="anim-close" aria-label="Close">&times;</button>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector(".anim-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    return new Promise(resolve => {
        requestAnimationFrame(() => {
            overlay.classList.add("show");
            setTimeout(() => {
                overlay.querySelector("#adv-marcher").classList.add("marching");
            }, 400);
            if (isWinner) {
                setTimeout(() => launchConfetti(), 1800);
            }
        });
        const duration = isWinner ? 5200 : 4200;
        setTimeout(() => {
            overlay.classList.add("fade-out");
            setTimeout(() => { close(); resolve(); }, 500);
        }, duration);
    });
}

// ---- Helpers ----
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Escapes quotes as well as &<>, so it's safe inside HTML attributes too
// (the old element-based trick left " and ' unescaped).
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}
