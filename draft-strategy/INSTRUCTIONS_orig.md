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

## Priority 4: Player value overlay

Add the ability to import a player rankings CSV (not PDF — I'll pre-convert BeerSheets or other rankings to CSV).

Expected CSV format (flexible, but at minimum):
```
Player,Position,ADP,VORP
Christian McCaffrey,RB,1.2,85
CeeDee Lamb,WR,2.8,78
...
```

### Integration with the graph

- The user specifies their draft slot (1–12) and league size (e.g., 12-team snake).
- From the slot, compute actual pick numbers for each round (snake draft: round 1 pick = slot, round 2 pick = 2×league_size - slot + 1, etc.).
- For each edge in the DAG (which represents "draft position P at round R"), compute the expected best-available VORP at that position given the pick number. Use ADP to estimate availability: a player with ADP < pick_number is likely gone; players with ADP near the pick number are the relevant tier.
- Simple approach: for each position and pick number, find the highest-VORP player whose ADP ≥ pick_number. That player's VORP is the edge weight.
- Once edges are weighted, the total VORP of a path = sum of edge weights along that path.

### Path comparison view

- Compute total VORP for all start-to-finish paths.
- Rank paths by total VORP.
- Show a panel listing the top-K paths (e.g., top 10), each as a sequence of roster codes with total VORP.
- Clicking a path in the list highlights it on the graph.
- Optionally show the specific player assigned to each edge on the highlighted path.

### Draft-slot sensitivity

- Allow the user to change their draft slot and see how the optimal path shifts.
- This is a re-run of the edge weighting + path ranking, not a structural change to the graph.

## Technical notes

- Keep it as a single-page app. Vanilla JS + D3.js is fine.
- All computation is client-side. No server.
- The graph generation algorithm is in README.md — follow it exactly.
- For metric computations (path count, reachability, bottleneck), the algorithms are also in README.md.
- The seed network (25 nodes, 7 rounds, 114 total paths) should always be available as a "reset to default" option.