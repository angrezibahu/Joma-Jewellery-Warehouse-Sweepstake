// World Cup 2026 - 48 Teams in 12 Groups
// Joma Jewellery sweepstake — curated by Megg

const WORLD_CUP_DATA = {
    groups: {
        "A": [
            { name: "Mexico", flag: "\u{1F1F2}\u{1F1FD}" },
            { name: "South Africa", flag: "\u{1F1FF}\u{1F1E6}" },
            { name: "South Korea", flag: "\u{1F1F0}\u{1F1F7}" },
            { name: "Czechia", flag: "\u{1F1E8}\u{1F1FF}" }
        ],
        "B": [
            { name: "Canada", flag: "\u{1F1E8}\u{1F1E6}" },
            { name: "Bosnia and Herzegovina", flag: "\u{1F1E7}\u{1F1E6}" },
            { name: "Qatar", flag: "\u{1F1F6}\u{1F1E6}" },
            { name: "Switzerland", flag: "\u{1F1E8}\u{1F1ED}" }
        ],
        "C": [
            { name: "Brazil", flag: "\u{1F1E7}\u{1F1F7}" },
            { name: "Morocco", flag: "\u{1F1F2}\u{1F1E6}" },
            { name: "Haiti", flag: "\u{1F1ED}\u{1F1F9}" },
            { name: "Scotland", flag: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}" }
        ],
        "D": [
            { name: "United States", flag: "\u{1F1FA}\u{1F1F8}" },
            { name: "Paraguay", flag: "\u{1F1F5}\u{1F1FE}" },
            { name: "Australia", flag: "\u{1F1E6}\u{1F1FA}" },
            { name: "Türkiye", flag: "\u{1F1F9}\u{1F1F7}" }
        ],
        "E": [
            { name: "Germany", flag: "\u{1F1E9}\u{1F1EA}" },
            { name: "Curaçao", flag: "\u{1F1E8}\u{1F1FC}" },
            { name: "Ivory Coast", flag: "\u{1F1E8}\u{1F1EE}" },
            { name: "Ecuador", flag: "\u{1F1EA}\u{1F1E8}" }
        ],
        "F": [
            { name: "Netherlands", flag: "\u{1F1F3}\u{1F1F1}" },
            { name: "Japan", flag: "\u{1F1EF}\u{1F1F5}" },
            { name: "Sweden", flag: "\u{1F1F8}\u{1F1EA}" },
            { name: "Tunisia", flag: "\u{1F1F9}\u{1F1F3}" }
        ],
        "G": [
            { name: "Belgium", flag: "\u{1F1E7}\u{1F1EA}" },
            { name: "Egypt", flag: "\u{1F1EA}\u{1F1EC}" },
            { name: "IR Iran", flag: "\u{1F1EE}\u{1F1F7}" },
            { name: "New Zealand", flag: "\u{1F1F3}\u{1F1FF}" }
        ],
        "H": [
            { name: "Spain", flag: "\u{1F1EA}\u{1F1F8}" },
            { name: "Cape Verde", flag: "\u{1F1E8}\u{1F1FB}" },
            { name: "Saudi Arabia", flag: "\u{1F1F8}\u{1F1E6}" },
            { name: "Uruguay", flag: "\u{1F1FA}\u{1F1FE}" }
        ],
        "I": [
            { name: "France", flag: "\u{1F1EB}\u{1F1F7}" },
            { name: "Senegal", flag: "\u{1F1F8}\u{1F1F3}" },
            { name: "Iraq", flag: "\u{1F1EE}\u{1F1F6}" },
            { name: "Norway", flag: "\u{1F1F3}\u{1F1F4}" }
        ],
        "J": [
            { name: "Argentina", flag: "\u{1F1E6}\u{1F1F7}" },
            { name: "Algeria", flag: "\u{1F1E9}\u{1F1FF}" },
            { name: "Austria", flag: "\u{1F1E6}\u{1F1F9}" },
            { name: "Jordan", flag: "\u{1F1EF}\u{1F1F4}" }
        ],
        "K": [
            { name: "Portugal", flag: "\u{1F1F5}\u{1F1F9}" },
            { name: "DR Congo", flag: "\u{1F1E8}\u{1F1E9}" },
            { name: "Uzbekistan", flag: "\u{1F1FA}\u{1F1FF}" },
            { name: "Colombia", flag: "\u{1F1E8}\u{1F1F4}" }
        ],
        "L": [
            { name: "England", flag: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}" },
            { name: "Croatia", flag: "\u{1F1ED}\u{1F1F7}" },
            { name: "Ghana", flag: "\u{1F1EC}\u{1F1ED}" },
            { name: "Panama", flag: "\u{1F1F5}\u{1F1E6}" }
        ]
    }
};

// How many of the 48 spots have been claimed
const SPOTS_TAKEN = 0;

// Draw results — populate once Megg has the list of names.
// Format: { "Team Name": "Owner Name", ... }
const DEFAULT_ASSIGNMENTS = {};

// Schedule and results loaded from JSON files by loadLiveData()
let SCHEDULE = [];
let RESULTS = {};
let LIVE = { eliminated: [], stages: {}, updatedAt: null };

async function loadLiveData() {
    try {
        const [scheduleRes, resultsRes, trackerRes] = await Promise.all([
            fetch("schedule.json").then(r => r.ok ? r.json() : null),
            fetch("results.json").then(r => r.ok ? r.json() : null),
            fetch("tracker-state.json").then(r => r.ok ? r.json() : null)
        ]);
        SCHEDULE = (scheduleRes && scheduleRes.matches) || [];
        RESULTS = (resultsRes && resultsRes.results) || {};
        LIVE = {
            eliminated: (trackerRes && trackerRes.eliminated) || [],
            stages: (trackerRes && trackerRes.stages) || {},
            updatedAt: (trackerRes && trackerRes.updatedAt) || null
        };
    } catch (e) {
        console.warn("Could not load live data:", e);
    }
}

// ---- State management via localStorage ----
const STORAGE_KEY = "joma_sweepstake_2026";

function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            parsed.assignments = DEFAULT_ASSIGNMENTS;
            parsed.drawComplete = Object.keys(DEFAULT_ASSIGNMENTS).length > 0;
            return parsed;
        }
    } catch (e) {}
    return getDefaultState();
}

function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getDefaultState() {
    return {
        drawComplete: Object.keys(DEFAULT_ASSIGNMENTS).length > 0,
        assignments: DEFAULT_ASSIGNMENTS,
        eliminated: [],
        stages: {}
    };
}
