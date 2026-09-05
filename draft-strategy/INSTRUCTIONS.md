# INSTRUCTIONS.md — for Claude Code

Read this file before making changes. It describes what to fix and what to build next.

## Priority 1: Fix the visual style

The current app uses a dark-mode color scheme with large saturated circles. Switch to a clean, light, academic style inspired by MATLAB's default `parula` colormap on a white background.

Specific changes:

- **Background**: white or near-white (`#fafafa`). No dark backgrounds anywhere.
- **Node style**: filled circles with a thin gray stroke (`#666`, 0.8px). Node size should be moderate — roughly 24px radius, not the large circles currently used.
- **Node label**: monospace, ~11px, bold. Black text on light nodes, white text on dark nodes (compute luminance to decide).
- **Color ramp**: use a perceptually uniform blue ramp for metric coloring — lightest for low values, darkest for high values. Something like: `#E6F1FB → #85B7EB → #378ADD → #185FA5 → #042C53`. NOT the current red-orange-yellow scheme.
- **Edges**: thin lines (`0.6–0.8px`), light gray (`#bbb`), low opacity (`0.35`). No arrowheads needed since directionality is implied by the top-to-bottom round layout.
- **Metric value annotations**: small (`7–8px`), gray, offset slightly above-right of each node. Not inside the node.
- **Round labels**: left margin, gray, `12px`.
- **Node info panel**: right sidebar is fine, but use a clean light style — no dark panel background. Light border, standard body text.
- **Metric buttons**: simple outlined buttons, accent border/text when active. Not filled/colored buttons.
- **Overall feel**: a MATLAB figure or a D3 academic visualization, not a gaming dashboard.

## Priority 2: Rule editor and manual node control

This is central to the whole tool — the graph should be something the user actively sculpts, not just views.

### Rule editor panel

A UI panel (sidebar or collapsible drawer) where the user defines rules that govern which nodes appear in the graph. Rules are predicates on (roster, round). The UI should let the user express things like:
- "No QB before round X" → position constraint by round
- "At least N of position P by round R" → minimum threshold
- "At most N of position P" → maximum cap
- "Position P only in round R" → round-specific constraint

Provide a structured rule builder (dropdowns/inputs), not a free-text code editor. For example:
- Position dropdown: [RB, WR, TE, QB]
- Comparator: [at least, at most, exactly, none]
- Value: number input
- Scope: [by round X, in round X, total, in rounds X through Y]

Each rule has:
- A human-readable description (auto-generated from the dropdowns)
- An active/inactive toggle
- A delete button

**Changing a rule, toggling it, or deleting it regenerates the graph in real time.** The user should see the DAG reshape immediately. All metrics recompute on regeneration.

The seed network rules should be pre-loaded as defaults:
- Round 1: RB or WR only
- Round 2: no TE or QB
- No QB in rounds 1–7
- At most 1 TE
- At round 7: at least 3 RB and at least 3 WR

### Manual node deletion

- Clicking a node selects it. A selected node can be deleted (via a delete button, keyboard shortcut, or click-based interaction — whatever feels natural).
- Deleting a node removes it from the graph AND removes all edges to/from it. If removing a node makes downstream nodes unreachable from any round-1 source, those orphaned nodes are automatically removed too (cascade pruning). Similarly, if removing a node makes upstream nodes unable to reach any terminal, prune those dead-end nodes too.
- Deleted nodes should be visually recoverable — maintain a list of manually excluded nodes with the ability to restore them. This is separate from the rule system: a node might pass all rules but still be manually excluded.
- The motivation: some roster constructions technically satisfy all rules but the user knows from experience (or current draft board conditions) that the players available make that path undesirable. This is the "I just don't like it" override.

### Interaction between rules and manual exclusions

- Rules define the base graph. Manual exclusions are applied on top.
- If a rule change would re-introduce a manually excluded node, it stays excluded (manual exclusions are sticky).
- A "clear all manual exclusions" button should exist.
- The node info panel should indicate whether a node was excluded by a rule or manually.

## Priority 3: Draft tracker mode

Add a "Draft mode" toggle. When active:

- User clicks a position button (RB / WR / TE / QB) each round to record their pick.
- The app tracks the current roster state and identifies the corresponding node in the graph.
- The current node is highlighted with a distinct marker (e.g., thick border, pulsing ring, or a different shape).
- All nodes NOT reachable from the current node are dimmed/grayed out.
- All edges not on a valid forward path from the current node are dimmed.
- A "path so far" is highlighted (the sequence of nodes traversed).
- An undo button to go back one pick.
- A reset button to start over.

This requires no player data — it's pure graph traversal. The user sees the network prune in real time as they commit to picks.

## Priority 4: Player value integration

Two-layer system: target players (primary) and general rankings (fallback).

### Layer 1: Target player list (build first)

The user maintains a personal list of ~20–30 target players they specifically want. Each target has:

```
Player name, Position (RB/WR/TE/QB), ADP, Priority (1–5 or custom weight), Ideal round (optional)
```

Example:
```
Devonta Smith,WR,30,5,3
Javonte Williams,RB,31,4,4
Bijan Robinson,RB,3,5,1
```

The ideal round is the round the user *wants* to draft this player. A player drafted earlier than their ideal round is a "reach"; later is "hoping they fall." Both the priority and ideal round matter: a high-priority target at risk of being taken is worth reaching for; a low-priority target with plenty of positional alternatives is not.

Enter manually in a UI panel or import from CSV. The user also specifies:
- **Draft slot** (1–12 or per league size)
- **League size** (e.g., 12)
- **Draft format**: snake (default) or linear

From these, compute pick numbers per round:
- Snake: round 1 = slot, round 2 = 2×league_size − slot + 1, round 3 = 2×league_size + slot, etc.

#### Availability estimation

A target is **likely available** at round R if ADP ≥ user's pick number in round R. Classify as:
- **Safe**: ADP is 6+ picks above user's pick number
- **Risky**: ADP is within 6 picks of user's pick number (someone might reach)
- **Gone**: ADP < user's pick number

Thresholds should be adjustable.

#### Target depth by position (reach-or-wait analysis)

This is the core decision-support feature. For each round R, given the user's pick number:

1. Define an **availability window**: all targets with ADP between the user's current pick and their next pick (roughly league_size picks later in snake). These are the targets that are available now but might not survive to the next round.

2. Count targets by position within this window. Display as a compact summary at each node:
   - "RB: 4 targets | WR: 1 target | TE: 1 target"

3. Compute **wait risk** per position: the probability of losing access to ALL targets at a position if you don't draft it this round. Heuristic: if you have N targets at position P in the window, and there are (league_size − 1) other managers picking before your next turn, estimate the probability that all N are taken. Simple model: each target has an independent probability of being taken based on how close their ADP is to the window boundary. More targets = lower wait risk = safer to defer.

4. **Decision signal per edge**: for each outgoing edge from the current node, show:
   - How many targets at that position are in the availability window
   - Wait risk: "safe to wait" (3+ targets) / "moderate risk" (2 targets) / "draft now or lose access" (1 target)
   - The specific target(s) and their priorities

This directly answers "should I take Javonte (RB) in round 3 or wait?": if there are 4 target RBs in the ADP 29–44 window but only 1 target WR (Devonta), the tool shows WR as "draft now or lose access" and RB as "safe to wait." The graph's structural flexibility is abstract; target depth makes it concrete.

#### Edge and node annotation

For each edge (= "draft position P in round R"), show which targets at position P are likely available at that pick, plus the wait-risk classification. Display on hover or in the info panel.

For each node, show: target depth by position in the current window, wait risk per position, and total targets remaining.

#### Positional summary panel

For each round (given the user's pick number), compute a **positional summary** of available players in the ADP window (from current pick to next pick). This panel sits in the bottom-right of the UI, next to the draft tracker / roster display. For each position (RB, WR, TE, QB), show:

1. **Count**: number of target players available at this position in the window
2. **Mean VORP**: average VORP of those players
3. **VORP range**: min–max VORP, indicating whether the players form a single tier or span multiple tiers. A tight range (e.g., 18–21) means they're interchangeable — pure flexibility, pick any. A wide range (e.g., 12–28) means there are distinct tiers within the position — reaching for the top of the range has real value over waiting for the bottom.

Display as a compact table:
```
       Count  Mean VORP  Range
  RB:    4      22.3     18–28
  WR:    1      25.0     25
  TE:    0       —        —
  QB:    0       —        —
```

This updates in real time as the user steps through the draft (in draft tracker mode) or as they hover over nodes.

#### Player selection on draft

In draft tracker mode, when the user clicks a position button (e.g., "draft RB"), a popup/dropdown appears listing all target players at that position who are available in the current ADP window. Each entry shows:

- Player name
- ADP
- VORP
- Availability status (safe / risky / gone)
- Whether this is a reach (drafted before ideal round) or a value pick (at or after ideal round)

The user selects the specific player they drafted (or "Other / non-target" if they drafted someone not on their list). The selected player is removed from future availability.

#### Running VORP tracker

Below the positional summary, maintain a **running draft log** that shows:

- Each round: position drafted, player selected (if from target list), their VORP
- **Running total VORP**: sum of VORP for all selected players so far
- **Running mean VORP per pick**: total / rounds drafted
- **Projected total**: running total + (mean VORP of best available at each position for remaining rounds along the current path) — a rough estimate of where the draft is heading value-wise

When no specific player is selected (user picked "Other / non-target"), show the VORP as the mean VORP for that position in that window (a reasonable estimate), visually distinguished from confirmed values (e.g., italicized or lighter color).

This running tracker lets the user see in real time whether they're ahead or behind their pre-draft plan, and whether a reach in one round is being compensated by value in subsequent rounds.

#### Path scoring: target acquisition

For each start-to-finish path, compute a **target score**: sum of priority weights of target players the path can plausibly acquire, one per round. Use greedy assignment — at each round along the path, assign the highest-priority available target at the drafted position. A target used in one round is removed from subsequent availability.

This answers: "which draft strategy lands the most (or highest-priority) target players?"

#### Path comparison view

- Rank all paths by target score.
- Top-K paths in a panel, each showing: roster sequence, total target score, specific target assigned at each round.
- Clicking a path highlights it on the graph with player assignments along edges.
- Unassigned rounds (no target at that position) are flagged — Layer 2 fills these.
- Show how each path's assignments compare to the "ideal round" for each target. A path that gets all targets at or near their ideal rounds is a good plan; one that requires multiple reaches is riskier.

### Layer 2: General rankings (BeerSheets / CSV import)

Import a full rankings CSV: Player, Position, ADP, VORP (or any value metric). This provides the generic value surface.

For edges where no target is available, the fallback is the best-available player at that position by VORP, estimated from ADP.

Composite path score: **target score** (Layer 1) + **fallback VORP** (Layer 2 for non-target rounds). Combines "did I get my guys?" with "how much value did I capture otherwise?"

### Draft-slot sensitivity

Changing the draft slot re-runs availability estimation and path scoring — graph structure is unchanged, but edge weights and target availability shift. This lets the user see how strategy changes across draft positions.

### Flexibility–value tradeoff view

For each node, compute two numbers:
1. **Structural flexibility** — paths-to-end, terminal reachability, or bottleneck (user selects)
2. **Target availability** — how many targets are available for the next pick from this state

Display as a scatterplot or dual-axis node coloring. The key insight: some nodes have high flexibility but low target availability (options are open but nobody you want is there), and some have low flexibility but high target availability (locked in, but your guy is right there). The strategic tension between flexibility and value is the whole game.

## Technical notes

- Keep it as a single-page app. Vanilla JS + D3.js is fine.
- All computation is client-side. No server.
- The graph generation algorithm is in README.md — follow it exactly.
- For metric computations (path count, reachability, bottleneck), the algorithms are also in README.md.
- The seed network (25 nodes, 7 rounds, 114 total paths) should always be available as a "reset to default" option.
