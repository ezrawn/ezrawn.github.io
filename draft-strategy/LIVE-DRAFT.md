# Live draft mode

The Draft Strategy Network can follow a real draft (an ESPN mock, say) as it
happens: players taken by anyone drop off the board, BPA pools shrink, and path
rankings recompute. Your own picks auto-advance the Draft Mode path when the
feed knows pick order. The NV% / median-Δ Monte Carlo is disabled while live so
each recompute stays fast.

There are two ways to feed it. **Paste picks** needs no install and works for any
platform. The **ESPN bridge userscript** automates it for ESPN mocks.

---

## Option A — Paste picks (no install)

1. Open the tool, click **⚡ Live** (top-right), then **Paste picks**.
2. In the ESPN draft room, copy the list of drafted players.
3. Paste into the box (one per line or comma-separated) and click **Apply**.
4. Whenever you want to refresh, paste the updated (longer) list and Apply again.

The result line shows how many names matched. Unmatched names are listed in the
live bar — fix their spelling or tag them Avoid on the Player Board by hand.

You still drive Draft Mode yourself (click your position each round); pasted
picks only prune the pools and rankings.

---

## Option B — ESPN bridge userscript

### Install

1. Install **Tampermonkey** (Chrome/Edge/Firefox extension).
2. Open `draft-strategy/espn-mock-bridge.user.js` from this repo — raw view — and
   Tampermonkey will offer to install it. Or: Tampermonkey dashboard →
   **+ → Utilities → Import from file** (or paste the contents into a new script).
3. Confirm it's **enabled**.

The script matches both `fantasy.espn.com/*` and the tool's URLs
(`ezrawinternelson.com/draft-strategy/*`, `ezrawn.github.io/draft-strategy/*`,
`localhost:*/draft-strategy/*`). Edit the `@match` lines if you host the tool
somewhere else.

### Use

1. Open the tool in one tab. Click **⚡ Live**.
2. Open your ESPN mock draft in another tab (same browser).
3. A small **Draft bridge** panel appears bottom-right on the ESPN page. Set
   **My draft slot** to your position in that mock (and league size if it's not
   auto-detected).
4. Back in the tool, click **▶ Start**. Set the tool's **Draft slot** and
   **League size** (Rule Initialization) to match the mock.
5. Draft. Picks flow in automatically.

### If picks aren't showing up

ESPN changes its draft room without notice, so the capture logic may need
re-tuning. To help:

1. On the **ESPN draft tab**, open DevTools → Console.
2. Filter for `[espn-bridge]`.
3. Run a few mock picks (turn on autopick to go fast).
4. Copy every `[espn-bridge]` line — especially `ws msg sample:` objects and
   `DOM pick candidate:` lines — and send them over.

Meanwhile, **Paste picks** (Option A) always works.

---

## How it's wired

```
ESPN draft tab                          Tool tab
─────────────                           ────────
espn-mock-bridge.user.js                espn-mock-bridge.user.js (same script)
  hooks the draft WebSocket               reads GM storage
  + scrapes the pick list                 posts window.message → the tool
  + resolves player IDs via
    ESPN's players endpoint
  writes picks → GM_setValue  ─────────►  GM_addValueChangeListener fires
       (Tampermonkey storage is shared across origins)
```

The tool listens for `window.postMessage({ source: 'espn-mock-bridge', state })`
where `state.picks` is `[{ overall, name, pos, team }]`. It maps each name to the
embedded rankings CSV (punctuation/suffix-insensitive), marks matches drafted,
and — for picks whose `overall` number lands on your snake slot — replays them
into the Draft Mode path.

### Tuning name matches

If a player consistently fails to match (e.g. ESPN spells them differently),
add an override in `index.html`:

```js
const LIVE_NAME_OVERRIDES = {
  'marquise brown': 47,   // normalised ESPN name : that player's ADP in the CSV
};
```

`ADP` is the unique per-player key in the rankings CSV.

---

## Limitations

- **Pace.** ESPN mocks run every few seconds. Use the live view to glance at
  refreshed top paths between your picks, not to re-plan every pick.
- **Fragility.** The bridge reads ESPN's unofficial draft feed. It can break on
  an ESPN update; Paste picks is the fallback.
- **Values are still a snapshot.** Only *availability* goes live. Re-export the
  Player Board CSV the week of your real draft if ADP has moved.
- **Rounds/positions.** The tool models the number of rounds you set and only
  RB/WR/TE/QB. K/DST and rounds beyond your setting are ignored.
- **Personal use.** A userscript reading your own screen is low-risk, but don't
  redistribute it or point it at anything but your own drafts.
