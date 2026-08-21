# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ezra Winter-Nelson's personal academic website, served via GitHub Pages at `ezrawinternelson.com` (custom domain configured in `CNAME`). It is a static, hand-written HTML/CSS site with no build step and no package manager. The only JavaScript is `network-bg.js`, a small vanilla script with one decorative purpose (see below) — there is no other client-side behavior and no framework.

## Working with this repo

There is no build, lint, or test tooling — this is plain HTML/CSS deployed as-is by GitHub Pages on push to `main`. To preview changes, open the HTML files directly in a browser or serve the directory with any static file server (e.g. `python -m http.server`).

## Structure

- `index.html` — About page (site root)
- `research.html` — Research page
- `reading.html` — Reading List page
- `style.css` — single shared stylesheet for all pages
- `network-bg.js` — generates the decorative background network (see below); linked from every page
- `EWN_headshot.jpg`, `Winter-Nelson_CV_20260112.pdf` — static assets linked from the sidebar
- `CNAME` — GitHub Pages custom domain config

## Page structure convention

Every page shares an identical two-column layout (`.layout` → `.sidebar` + `.main`, defined in `style.css`):

- The `<aside class="sidebar">` markup (photo, name, role, institution, lab, nav links, contact list) is **duplicated verbatim across every HTML file** rather than templated — there is no include/partial mechanism. When adding a page or editing sidebar content (name, role, affiliation, contact links), update it identically in every `.html` file.
- The nav link matching the current page has `class="active"` added — set this correctly per file.
- New pages should follow the same skeleton: copy the sidebar block, wrap page content in `<main class="main">` with `<section>` blocks, and link `style.css`.

## Style notes

- CSS uses custom properties defined once in `:root` in `style.css` (colors, sidebar width, font). There are two color families: `--accent`/`--accent-soft`/`--text`/`--soft`/`--faint`/`--rule` for the light main content column, and a parallel `--sidebar-*` set (`--sidebar-bg-1/2`, `--sidebar-text`, `--sidebar-soft`, `--sidebar-faint`, `--sidebar-rule`, `--sidebar-accent`, `--sidebar-ring`) for the sidebar, which is intentionally dark against the light main column. Reuse these variables rather than hardcoding new values.
- Responsive behavior is handled by a single `@media (max-width: 640px)` block at the bottom of `style.css` that collapses the sidebar to a top bar.
- The overall page (`.layout`) is capped at `--layout-max-w` and centered via `margin: 0 auto`, so on wide viewports there's empty margin outside it — that margin is where `network-bg.js` draws.

## `network-bg.js`

Draws a generated node/edge graph as a `position: fixed` full-viewport SVG behind everything (`z-index: -1`). It's built, not templated: nodes are placed via rejection sampling, edges via Barabási–Albert preferential attachment (giving hub nodes — the "scale-free" property) plus nearest-neighbor edges and a few random long-range shortcuts (giving local clustering and short path length — the "small-world" property). Generation is seeded (fixed constant in `mulberry32`), so the same graph appears on every page and every reload rather than reshuffling on navigation — change the seed if a different fixed layout is wanted. It reads `--accent` and `--layout-max-w` from computed CSS so it stays in sync with the palette, and it no-ops entirely when the viewport is narrower than `--layout-max-w`, since there's no margin for it to be visible in. It's purely decorative — no interactivity, no state, `pointer-events: none`, `aria-hidden="true"`.
