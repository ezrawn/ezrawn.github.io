# INSTRUCTIONS_P5.md — Player Board & Avoid System

Read this after completing the work in INSTRUCTIONS.md (Priorities 1–4).

This adds a **Player Board** page — a second tab/page alongside the Draft Network where the user prepares their draft by tagging targets, marking avoids, and assigning ideal rounds. It replaces any manual target entry from P4 with a UI built on top of the full rankings CSV.

---

## Priority 5: Player Board

### Overview

The app now has two pages/tabs:
1. **Draft Network** — the existing graph view (Priorities 1–4)
2. **Player Board** — a new page for managing the player pool before and during draft prep

The Player Board is where the user does their pre-draft homework: import a rankings CSV, scroll through all players, tag targets and avoids, set ideal rounds and priorities. The Draft Network then consumes these tags for path scoring, edge weighting, positional summaries, and the reach-or-wait analysis.

### Data source

A single CSV import containing ALL players. Expected format (see `rankings.csv` in the project folder for the full dataset):

```
Player, Position, ADP_Round, ADP_Pick, ADP, VAL, Bye, Team
Jahmyr Gibbs, RB, 1, 1, 1, 9.3, 6, DET
Ja'Marr Chase, WR, 1, 2, 2, 9.2, 6, CIN
...
```

- `ADP` is the overall pick number (not round.pick)
- `VAL` is the player's value above replacement (VORP / BEER+)
- The CSV in the project folder has 149 players across RB (51), WR (61), TE (14), QB (23)

### Player Board layout

A sortable, filterable table showing all imported players.

**Visible columns:** Player, Position, Team, ADP, VAL, Bye, Status (target/avoid/—), Ideal Round, Priority

**Sorting:** click any column header to sort ascending/descending. Default sort: by ADP ascending.

**Filters** (top of table, always visible):
- **Position**: checkboxes for RB / WR / TE / QB — toggle to show/hide positions
- **Status**: radio or toggle — All / Targets only / Avoids only / Untagged only
- **ADP range**: min/max number inputs or a range slider
- **VAL range**: min/max number inputs or a range slider
- **Search**: text input filtering on player name (live, as-you-type)

Filters combine with AND logic (e.g., "RB + Targets only + ADP 20–50" shows only target RBs in that ADP range).

### Player tagging

For each player row, provide interactive controls to set their status:

#### Target (the user wants this player)
- Click a "Target" button/icon on the row, or use a checkbox
- When tagged as target, two additional fields become editable on that row:
  - **Priority**: 1–5 (stars or numeric). Default: 3. Higher = more desired.
  - **Ideal Round**: number input or dropdown. Default: pre-populated with `ADP_Round` from the CSV (the round the player is typically drafted in). The user adjusts this to express their personal valuation — e.g., "I want Javonte in round 4" even though his ADP says round 4 pick 3 (confirming ADP), or "I want Devonta in round 3" even though her ADP says round 3 pick 3 (also confirming, but expressing intent to prioritize her there).
- Target rows are visually highlighted (e.g., green left border or light green background tint)

#### Avoid (the user does NOT want this player)
- Click an "Avoid" button/icon on the row
- Avoided players are excluded from ALL analysis: path scoring, edge weighting, positional summaries, wait-risk calculations, and the fallback value surface. They don't exist in the draft model.
- Avoid rows are visually distinct (e.g., red left border, strikethrough text, or grayed out)
- Use cases: injury concern, already rostered in another league, personal preference

#### Untagged (default)
- No tag applied. These players remain in the general value pool (fallback surface) but are not part of target-specific analysis.
- No visual decoration beyond the default row style.

### Batch operations

- **"Target all in ADP range X–Y at position P"**: quickly build a target list for a position tier. E.g., "Target all WRs with ADP 20–40" tags the relevant WRs and sets their Ideal Round to their ADP_Round.
- **"Clear all targets"** / **"Clear all avoids"**: reset all tags of that type
- **"Clear all"**: reset everything to untagged

### Persistence

Target/avoid tags, priorities, and ideal rounds should persist across page navigation between the Player Board and Draft Network tabs.

Options for persistence (implement at least one):
- **localStorage**: persist in browser across sessions. This is the simplest and most important.
- **JSON export/import**: a "Save my board" button that downloads a JSON file with all tags, and a "Load board" button to restore. Useful for sharing across devices or backing up before draft day.

### How tags flow into the Draft Network

When the user switches to the Draft Network tab, the player data is available for all P4 features:

- **Targets** → used for: path scoring (target acquisition), edge annotation (which targets available at each position/round), positional summary (count/mean VAL/range of targets), wait-risk analysis, player selection popup in draft mode
- **Avoids** → removed from the player pool entirely. They affect positional summaries (fewer players available), wait-risk (scarcity increases), and fallback value (next-best player changes). Removing 3 RBs from a tier changes the strategic picture — the network view should reflect this immediately.
- **Untagged** → fallback value surface. When no target is available at a position in a given round, the best available untagged player fills in. Their VAL is used for the composite path score.

### Positional summary integration

The positional summary panel (described in P4) should distinguish between targets and untagged players:

```
Round 3 (pick 25)          Targets    All available
  RB:  Count                 3            5
       Mean VAL             4.0          3.8
       VAL range          3.5–4.5      3.1–4.5
  WR:  Count                 1            4
       Mean VAL             4.3          4.1
       VAL range           4.3          3.5–4.6
  TE:  Count                 1            1
       Mean VAL             3.7          3.7
       VAL range           3.7          3.7
```

This lets the user see: "I have 3 target RBs here but only 1 target WR — WR is scarce among my guys, even though there are 4 WRs total available." The target column drives the reach-or-wait decision; the "all available" column shows the fallback depth.

### Player selection popup (update from P4)

In draft tracker mode, when the user clicks a position button (e.g., "draft RB"), the popup should show:

1. **Targets first** — highlighted, sorted by priority then VAL, with their ideal round and reach/value indicator
2. **Untagged players** — below targets, sorted by VAL, visually distinct (dimmer or separated by a divider)
3. **Avoided players** — NOT shown at all
4. **"Other / unlisted"** — option at the bottom for drafting someone not in the CSV

Each entry shows: Player name, Team, ADP, VAL, availability status (safe/risky/gone), and for targets: priority stars and reach/value tag.

---

## Implementation notes

- The Player Board can be a separate HTML page (with shared state via localStorage) or a tab within the single-page app (with shared JS state). Single-page with tabs is simpler.
- The table should handle 149 rows without virtualization — it's small enough to render all at once.
- Mobile responsiveness is not a priority — this is a desktop draft-prep tool.
- The rankings CSV (`rankings.csv`) is in the project folder and should be the default data loaded on first visit. Provide a "Re-import CSV" option to load updated rankings later.
