# Fantasy Draft Strategy Network

A local HTML app for modeling and optimizing fantasy football draft strategy as a directed acyclic graph (DAG).

## Concept

A fantasy football draft is modeled as a network of **roster states** connected across **rounds**. Each state is a 4-element vector `[RB, WR, TE, QB]` representing how many players of each position have been drafted so far. At each round, exactly one position is incremented by 1 (i.e., you draft one player). The graph is a DAG: edges connect round `r` states to round `r+1` states that differ by exactly one pick.

**The strategic insight**: not all paths through this space are equally good. Rules, preferences, and positional scarcity constrain which roster constructions are realistic. By pruning the full combinatorial space down to a strategic subset and analyzing the resulting network topology, we can answer questions like:

- Which intermediate roster states preserve the most downstream flexibility?
- Which early decisions are high-leverage vs. "don't matter because they converge"?
- Are certain terminal constructions only reachable through bottleneck intermediates?
- What's the cost (in lost optionality) of drafting a TE early vs. late?

## Architecture

Single-page HTML app. No framework needed — vanilla JS is fine, or lightweight libraries (D3.js for the graph layout would be natural). Everything runs client-side, no server.

### Core data structures

```
node: {
  roster: [RB, WR, TE, QB],  // e.g. [2, 1, 1, 0]
  label: "2110",               // string concatenation of roster
  round: 4                     // sum of roster elements
}

edge: {
  source: nodeIndex,
  target: nodeIndex
  // edge exists iff target.roster - source.roster ∈ {[1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,1]}
}
```

### Rule system

Rules are predicates on `(roster, round) → boolean`. A roster state is included in the graph only if:
1. It passes ALL active rules
2. It is reachable from at least one valid state in the previous round

Example rules (these are the ones from the current hand-drawn graph):
- Round 1: RB or WR only (no TE/QB) → `round !== 1 || (roster[2] === 0 && roster[3] === 0)`
- Round 2: still no TE/QB → `round !== 2 || (roster[2] === 0 && roster[3] === 0)`
- No QB in first 7 rounds → `roster[3] === 0`
- At most 1 TE → `roster[2] <= 1`
- Terminal constraint: round 7 must have RB ≥ 3 AND WR ≥ 3

Users should be able to add, remove, and toggle rules. Some rules are "soft" — the user intentionally includes exceptions to see how pruning affects the network. The UI should support this (e.g., a rule can be active/inactive, and the user can manually include/exclude specific nodes). If a rule in a later round cuts off previous nodes from the terminal node (last round), these earlier nodes should also be culled; in other words, all nodes in the final graph should be part of a path from round 1 to the final round.

### Metrics (computed on the DAG, used for node coloring)

1. **Out-degree**: number of next-round states reachable. Direct measure of flexibility.
2. **In-degree**: number of parent states. High in-degree = convergence point.
3. **Path count**: total number of start-to-finish paths that pass through this node. Computed via forward-backward propagation on the DAG:
   - Forward pass: `paths_in[source] = 1`; for each node in topological order, `paths_in[j] = Σ paths_in[parent]`
   - Backward pass: `paths_out[terminal] = 1`; reverse topological order, `paths_out[i] = Σ paths_out[child]`
   - `paths_through[i] = paths_in[i] × paths_out[i]`
4. **Terminal reachability**: number of distinct terminal (final-round) states reachable from this node. Computed via backward boolean propagation.
5. **Bottleneck score**: path count normalized within each round, so `max = 1.0` at every round. Highlights chokepoints relative to the round's total capacity.
6. **Betweenness centrality**: standard graph betweenness on the directed graph.

The user should be able to switch the coloring metric interactively (buttons or dropdown).

### Network generation algorithm

```
function buildNetwork(nRounds, rules, maxPerPosition = [6, 6, 2, 2]):
    statesByRound = [[0, 0, 0, 0]]  // round 0: empty roster
    for round = 1 to nRounds:
        candidates = []
        for each state in statesByRound[round - 1]:
            for each position in [0, 1, 2, 3]:
                newState = state + unitVector[position]
                if newState[position] <= maxPerPosition[position]:
                    if ALL rules pass for (newState, round):
                        candidates.push(newState)
        statesByRound[round] = deduplicate(candidates)

    // Collect nodes (exclude round-0 root) and build edges
    nodes = flatten(statesByRound[1..nRounds])
    edges = [(i, j) for all node pairs where
             round(j) == round(i) + 1 AND
             roster(j) - roster(i) is a unit vector]
    return {nodes, edges}
```

## Desired features

### MVP (build this first)

- [x] **Graph visualization**: DAG laid out with rounds as horizontal rows, nodes as circles/pills with the 4-digit roster label inside. Edges drawn between adjacent rounds. Layered top-to-bottom layout.
- [x] **Metric coloring**: nodes colored by a selectable metric (path count, out-degree, terminal reachability, bottleneck score). Color bar/legend. Metric values annotated near each node.
- [x] **Hard-coded seed network**: the 25-node, 7-round network described below as the default/starting graph.
- [x] **Hover/click info**: hovering or clicking a node shows its full metrics in a panel or tooltip.

### Phase 2

- [ ] **Rule editor**: UI panel where the user can define rules as logical statements. Each rule has a toggle (active/inactive). Changing rules regenerates the graph in real time.
- [ ] **Manual node inclusion/exclusion**: ability to click a node to force-include or force-exclude it, overriding rules. This supports the "soft rules with exceptions" workflow.
- [ ] **Path highlighting**: click a node to highlight all paths from sources to terminals that pass through it.
- [ ] **Comparison view**: show two graphs side-by-side (e.g., with and without a rule) to see the effect of a rule change.

### Phase 3 (stretch)

- [ ] **Export**: save the current graph as JSON or adjacency matrix (for MATLAB import).
- [ ] **Undo/redo** for rule and node changes.
- [ ] **Configurable positions**: extend beyond the 4-position [RB, WR, TE, QB] model (e.g., add FLEX, K, DEF).

## Seed network (hand-drawn, verified)

25 nodes across 7 rounds. This is the default graph the app should load with.

### Nodes by round

| Round | Nodes |
|-------|-------|
| 1 | 1000, 0100 |
| 2 | 2000, 1100 |
| 3 | 2010, 2100, 1110, 1200 |
| 4 | 2110, 3100, 2200, 1210, 1300 |
| 5 | 3110, 2210, 3200, 2300 |
| 6 | 3210, 4200, 3300, 2310, 2400 |
| 7 | 4300, 3310, 3400 |

### Edges

Edges are fully determined by the node set: an edge exists from node A to node B iff `round(B) = round(A) + 1` and `B - A` is a unit vector `[1,0,0,0]`, `[0,1,0,0]`, `[0,0,1,0]`, or `[0,0,0,1]`. No need to enumerate them — compute from the node list.

### Key structural facts (for verification)

- Total start-to-finish paths: **114**
- Node `1100` carries **90 of 114 paths** (79%) — the dominant hub
- Terminal `3310` receives **69 paths**, `4300` gets 23, `3400` gets 22
- TE-early nodes (2010, 1110, 2110, 1210, 3110, 2210, etc.) reach only terminal `3310`
- All non-TE nodes reach all 3 terminals

## Technical notes

- The graph is a DAG by construction (edges only go from round r to r+1), so topological ordering is trivial: just process by round.
- For metric computation, forward and backward passes over the DAG are O(nodes + edges), not expensive.
- D3.js is a natural fit for the visualization (force-directed isn't needed — use a fixed layered layout with rounds as y-coordinates and nodes spread horizontally within each round).
- The app should work offline — no API calls needed. Pure client-side computation and rendering.

## File structure suggestion

```
draft-strategy/
├── index.html          # single-page app entry point
├── README.md           # this file
├── src/
│   ├── graph.js        # network data structures, edge computation, rule engine
│   ├── metrics.js      # path counting, reachability, centrality computations
│   ├── layout.js       # DAG layout (round-based y, spread x)
│   ├── render.js       # D3 or Canvas rendering, color mapping, interactions
│   └── rules.js        # rule definitions, rule editor logic
├── data/
│   └── seed-network.json   # the 25-node hand-drawn network
└── style.css           # app styling
```
