// ==UserScript==
// @name         ESPN Mock Draft → Draft Strategy Network bridge
// @namespace    ezrawinternelson.com/draft-strategy
// @version      0.7.0
// @description  Captures picks from an ESPN mock draft room and feeds them into the Draft Strategy Network so drafted players drop off the board and path values update live.
// @match        *://*.espn.com/*
// @match        https://ezrawinternelson.com/draft-strategy/*
// @match        https://ezrawn.github.io/draft-strategy/*
// @match        http://localhost:*/draft-strategy/*
// @match        http://127.0.0.1:*/draft-strategy/*
// @match        file:///*draft-strategy*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      lm-api-reads.fantasy.espn.com
// @connect      fantasy.espn.com
// @connect      espn.com
// ==/UserScript==

/*
 * ─────────────────────────────────────────────────────────────────────────────
 *  HOW THIS WORKS
 *
 *  This one script runs on two kinds of page:
 *
 *   1. The ESPN draft room  (fantasy.espn.com/...draft...)
 *      - hooks the draft WebSocket and reads pick events
 *      - falls back to scraping the on-screen pick list
 *      - resolves ESPN player IDs to names via ESPN's own players endpoint
 *      - writes the running pick list to shared storage (GM_setValue)
 *      - shows a small control panel (bottom-right) for your draft slot
 *
 *   2. The Draft Strategy Network  (ezrawinternelson.com/draft-strategy/)
 *      - reads shared storage and forwards it into the page as a postMessage
 *        that the tool listens for
 *
 *  Tampermonkey's GM storage is shared across every page the script runs on,
 *  regardless of origin — that's the channel between the two tabs.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  IF PICKS AREN'T BEING CAPTURED
 *
 *  ESPN ships DOM/protocol changes without notice. Open the browser console on
 *  the ESPN draft tab, filter for "[espn-bridge]", run a few mock picks, and
 *  send the logged lines to me — that's what I need to re-tune the selectors /
 *  message parsing. Meanwhile the tool's "Paste picks" box always works.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // With @grant GM_*, this script runs in a sandbox whose `window` is NOT the
  // page's. Hooks (WebSocket/Worker/fetch) and console-visible globals must go
  // on the real page window.
  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  const STORE_KEY = 'espnMockDraftState';
  const VERSION = 'v0.7';

  // Ring-buffered log so diagnostics survive any console level filter.
  // In the ESPN console:  __ebDump()  prints everything;  __ebDump(true)  copies it.
  const _log = [];
  const LOG = (...a) => {
    const line = a.map(x => {
      if (typeof x === 'string') return x;
      try { return JSON.stringify(x); } catch (e) { return String(x); }
    }).join(' ');
    _log.push(new Date().toISOString().slice(11, 19) + ' ' + line);
    if (_log.length > 400) _log.shift();
    try { console.log('[espn-bridge]', ...a); } catch (e) {}
  };
  const IS_TOOL = /\/draft-strategy\//.test(location.pathname);
  const IS_ESPN = /(^|\.)espn\.com$/.test(location.hostname) && !IS_TOOL;

  try {
    const IN_FRAME = W.top !== W.self;
    const dumpFn = (copyIt) => {
      let extra = '';
      try { extra = '\n\n--- request URLs seen ---\n' + httpSeen.join('\n'); } catch (e) {}
      const txt = '=== espn-bridge ' + VERSION + ' ===\n' + W.__espnBridge + '\n\n' + _log.join('\n') + extra;
      if (copyIt) {
        try { GM_setClipboard(txt); return 'copied to clipboard (' + txt.length + ' chars) — paste it'; }
        catch (e) { try { navigator.clipboard.writeText(txt); return 'copied (' + txt.length + ' chars)'; } catch (e2) {} }
      }
      console.log(txt); return txt;
    };
    // Expose on the page window (console runs in page context) AND the sandbox.
    W.__espnBridge = VERSION + ' @ ' + location.href + (IN_FRAME ? ' [iframe]' : '');
    W.__ebDump = dumpFn;
    try { window.__espnBridge = W.__espnBridge; window.__ebDump = dumpFn; } catch (e) {}
    console.warn('%c[espn-bridge] ' + VERSION + ' running', 'background:#ea580c;color:#fff;padding:2px 6px;border-radius:3px',
      '| espn:', IS_ESPN, '| iframe:', IN_FRAME, '| type  __ebDump()  for logs');
  } catch (e) {}

  // ===========================================================================
  //  TOOL SIDE — forward shared storage into the page
  // ===========================================================================
  if (IS_TOOL) {
    const push = () => {
      const state = GM_getValue(STORE_KEY, null);
      if (state) W.postMessage({ source: 'espn-mock-bridge', state }, '*');
    };
    try { GM_addValueChangeListener(STORE_KEY, push); } catch (e) { LOG('no value listener', e); }
    // Push whatever is already stored once the tool page is ready.
    if (document.readyState === 'complete') push();
    else W.addEventListener('load', push);
    // Also re-push periodically in case a listener was missed on a fresh tab.
    setInterval(push, 4000);
    LOG('tool bridge active');
    return;
  }

  if (!IS_ESPN) return;

  // ===========================================================================
  //  ESPN SIDE
  // ===========================================================================

  // Only touch draft-ish pages — never patch fetch/XHR or write shared state on
  // a plain espn.com news tab (that would clobber a live draft's stored picks).
  const LOOKS_DRAFTY = /fantasy|draft|gambit|lobby/i.test(location.href);
  if (!LOOKS_DRAFTY) { LOG('not a fantasy/draft page — bridge idle here'); return; }

  const _params = new URLSearchParams(location.search);
  const LEAGUE_ID = _params.get('leagueId') || '';
  const MY_TEAM_ID = +_params.get('teamId') || 0;
  const SEASON = +_params.get('seasonId') ||
    (new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1);
  const POS_BY_ID = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
  const TEAM_BY_ID = {
    0: '', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
    9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
    17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
    25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'
  };

  // Running draft state
  const capPicks = new Map();  // playerId -> { playerId, overall, name, pos, team }
  const capNamed = new Map();  // name(lc)  -> { overall, name, pos, team }   (DOM fallback only)
  const capCount = () => capPicks.size + capNamed.size;
  let leagueSize = null;
  let mySlot = Number(GM_getValue('espnBridgeMySlot', 0)) || null;

  // ---- ESPN player id → info -------------------------------------------------
  const playerInfo = new Map();         // id -> { name, pos, team }
  let playersLoaded = false;

  function loadPlayers() {
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/players?view=players_wl`;
    const handle = (txt) => {
      try {
        const arr = JSON.parse(txt);
        arr.forEach(p => {
          playerInfo.set(p.id, {
            name: p.fullName || p.name || '',
            pos: POS_BY_ID[p.defaultPositionId] || '',
            team: TEAM_BY_ID[p.proTeamId] || ''
          });
        });
        playersLoaded = true;
        LOG(`player index: ${playerInfo.size} players (season ${SEASON})`);
        reprocessPending();
      } catch (e) { LOG('player parse failed', e); }
    };
    // Same-origin-ish fetch first; fall back to GM_xmlhttpRequest.
    fetch(url, { headers: { 'x-fantasy-filter': '{"filterActive":null}' }, credentials: 'omit' })
      .then(r => r.text()).then(handle)
      .catch(() => {
        try {
          GM_xmlhttpRequest({
            method: 'GET', url,
            headers: { 'x-fantasy-filter': '{"filterActive":null}' },
            onload: r => handle(r.responseText),
            onerror: e => LOG('player fetch failed', e)
          });
        } catch (e) { LOG('player fetch unavailable', e); }
      });
  }

  // ---- REST poll: backfill picks + full drafted set ---------------------
  // The WS only streams picks made AFTER we connect, so anything drafted before
  // the tab loaded (or missed) must come from the API:
  //   mDraftDetail.picks  → ordered picks with overall # (when populated)
  //   mTeam roster        → every drafted playerId (authoritative "gone" set)
  let pollCount = 0;
  function pollDraftDetail() {
    pollCount++;
    if (!LEAGUE_ID) { LOG('no leagueId in URL — set slot/size in the panel'); return; }
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}` +
                `/segments/0/leagues/${LEAGUE_ID}?view=mDraftDetail&view=mTeam&view=mRoster`;
    const done = (txt) => {
      let j; try { j = JSON.parse(txt); } catch (e) { LOG('poll: bad JSON'); return; }

      // settings → league size + my slot
      const st = j.settings || {};
      if (st.size >= 4 && st.size <= 20) leagueSize = st.size;
      const order = (st.draftSettings && st.draftSettings.pickOrder) || (j.draftDetail && j.draftDetail.pickOrder);
      if (Array.isArray(order) && order.length) {
        if (!leagueSize) leagueSize = order.length;
        if (MY_TEAM_ID) { const i = order.indexOf(MY_TEAM_ID); if (i >= 0) mySlot = i + 1; }
      }

      // ordered picks (may be placeholders with playerId 0 until made)
      const apiPicks = (j.draftDetail && j.draftDetail.picks) || [];
      let withPlayer = 0;
      apiPicks.forEach(pk => {
        const pid = pk.playerId || (pk.player && pk.player.id) || 0;
        const ov = pk.overallPickNumber || pk.overallPick || 0;
        if (pid > 0) { withPlayer++; addPickById(pid, ov, pk.teamId || 0); }
      });

      // team rosters → the definitive drafted set (unordered)
      let rosterN = 0;
      (j.teams || []).forEach(t => {
        const entries = (t.roster && t.roster.entries) || [];
        entries.forEach(e => {
          const pid = e.playerId || (e.playerPoolEntry && e.playerPoolEntry.id) || 0;
          if (pid > 0) { rosterN++; addPickById(pid, 0, t.id); }
        });
      });

      LOG(`poll #${pollCount}: apiPicks=${apiPicks.length} withPlayer=${withPlayer} roster=${rosterN} captured=${capCount()} size=${leagueSize} slot=${mySlot}`);
      broadcast();
    };
    if (typeof GM_xmlhttpRequest === 'function') {
      GM_xmlhttpRequest({ method: 'GET', url, headers: { accept: 'application/json' },
        onload: r => done(r.responseText), onerror: () => LOG('poll: xhr error') });
    } else {
      fetch(url, { credentials: 'include' }).then(r => r.text()).then(done).catch(() => LOG('poll: fetch error'));
    }
  }

  // Picks that arrived before the player index was ready
  const pendingIdPicks = [];            // { playerId, overall, teamId }
  function reprocessPending() {
    if (!playersLoaded) return;
    const still = [];
    pendingIdPicks.forEach(p => { if (!addPickById(p.playerId, p.overall, p.teamId)) still.push(p); });
    pendingIdPicks.length = 0;
    pendingIdPicks.push(...still);
    broadcast();
  }

  // ---- adding picks --------------------------------------------------------
  function addPickById(playerId, overall, teamId) {
    if (!playerId) return false;
    if (!playersLoaded) { pendingIdPicks.push({ playerId, overall, teamId }); return false; }
    const info = playerInfo.get(playerId);
    if (!info) { LOG('unknown playerId', playerId); return false; }
    const ex = capPicks.get(playerId);
    if (ex) { if (overall > 0 && !ex.overall) ex.overall = overall; return true; }
    capPicks.set(playerId, { playerId, overall: overall || 0, name: info.name, pos: info.pos, team: info.team });
    return true;
  }

  // name-only picks (DOM scrape fallback; ESPN normally gives us playerIds)
  function addPick({ overall, name, pos, team }) {
    if (!name) return false;
    const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (capNamed.has(key)) return true;
    // don't double-count a player we already have by id
    for (const p of capPicks.values()) {
      if (p.name.toLowerCase() === key) return true;
    }
    capNamed.set(key, { overall: overall || 0, name, pos: pos || '', team: team || '' });
    return true;
  }

  function inferLeagueSize() {
    // Best-effort: ESPN mock lobby is usually 10; try to read it off the page.
    const txt = document.body ? document.body.innerText : '';
    const m = txt.match(/(\d{1,2})\s*[- ]?team/i);
    if (m) leagueSize = Math.max(4, Math.min(20, +m[1]));
  }

  // ---- broadcast to shared storage ---------------------------------------
  let broadcastTimer = null;
  let lastBroadcastN = -1;
  function broadcast() {
    clearTimeout(broadcastTimer);
    broadcastTimer = setTimeout(() => {
      const picks = [...capPicks.values(), ...capNamed.values()]
        .filter(p => p.name)
        .sort((a, b) => (a.overall || 1e9) - (b.overall || 1e9));
      const state = {
        source: 'espn-bridge',
        connected: true,
        ts: Date.now(),
        leagueSize: leagueSize || undefined,
        mySlot: mySlot || undefined,
        picks
      };
      try { GM_setValue(STORE_KEY, state); }
      catch (e) { LOG('GM_setValue failed', e); }
      if (picks.length !== lastBroadcastN) { LOG('broadcast:', picks.length, 'picks'); lastBroadcastN = picks.length; }
      updatePanel(picks.length);
    }, 250);
  }
  // Heartbeat so the tool shows "ESPN connected" even before the first pick.
  // (Started from the go section, only on draft-ish pages, so plain espn.com
  //  tabs never clobber a live draft's stored state.)
  let heartbeat = null;

  // ---- fetch / XHR hooks -------------------------------------------------
  const httpStats = { fetch: 0, xhr: 0, hits: 0 };
  const httpSeen = [];                       // last ~40 request URLs (for __ebDump)
  // Picks come from the WS "SELECTED" stream, not HTTP — this hook now only
  // records request URLs (for __ebDump) and notes league size if it flies by.
  function scanHttpBody(url, text) {
    if (url) { httpSeen.push(url.slice(0, 200)); if (httpSeen.length > 40) httpSeen.shift(); }
    if (!text || text.length > 200000) return;
    const c = text.trimStart()[0];
    if (c !== '{' && c !== '[') return;
    if (!/draft|league|lobby|gambit/i.test(url)) return;
    let obj; try { obj = JSON.parse(text); } catch (e) { return; }
    httpStats.hits++;
    const sz = obj && obj.settings && obj.settings.size;
    if (sz >= 4 && sz <= 20 && !leagueSize) leagueSize = sz;
  }
  const NativeFetch = W.fetch;
  if (NativeFetch) {
    W.fetch = function (...args) {
      const p = NativeFetch.apply(this, args);
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      httpStats.fetch++;
      try { p.then(r => { try { r.clone().text().then(t => scanHttpBody(url, t)); } catch (e) {} }).catch(() => {}); } catch (e) {}
      return p;
    };
  }
  try {
    const XP = W.XMLHttpRequest.prototype;
    const XOpen = XP.open, XSend = XP.send;
    XP.open = function (m, url) { this.__ebUrl = url; return XOpen.apply(this, arguments); };
    XP.send = function () {
      httpStats.xhr++;
      this.addEventListener('load', () => {
        try { scanHttpBody(this.__ebUrl || '', this.responseText); } catch (e) {}
      });
      return XSend.apply(this, arguments);
    };
  } catch (e) { LOG('XHR hook failed', e); }
  LOG('fetch/XHR hooks installed');

  // ---- EventSource (SSE) hook -----------------------------------------
  const NativeES = W.EventSource;
  if (NativeES) {
    W.EventSource = function (url, cfg) {
      LOG('EventSource opened:', url);
      const es = cfg ? new NativeES(url, cfg) : new NativeES(url);
      es.addEventListener('message', ev => {
        if (wsSampleLogged < 12) { LOG('sse msg raw:', String(ev.data).slice(0, 400)); wsSampleLogged++; }
        try { handleWsPayload(ev.data); } catch (e) {}
      });
      return es;
    };
    try { W.EventSource.prototype = NativeES.prototype; } catch (e) {}
    LOG('EventSource hook installed');
  }

  // ---- Worker hooks ---------------------------------------------------
  // ESPN's live-draft realtime client very likely runs in a Web Worker, whose
  // WebSocket a page hook can't see. But the worker posts pick events back to
  // the main thread — catch them there.
  let workerCount = 0, workerMsgCount = 0, wsSampleLogged = 0, wsVerbLogged = 0;
  function wrapWorker(Native, label) {
    if (!Native) return Native;
    const Wrapped = function (url, opts) {
      workerCount++;
      LOG(label + ' #' + workerCount + ' created:', String(url).slice(0, 160));
      const w = opts ? new Native(url, opts) : new Native(url);
      const port = label === 'SharedWorker' ? w.port : w;
      try {
        port.addEventListener && port.addEventListener('message', onWorkerMsg);
        if (label === 'SharedWorker' && port.start) port.start();
      } catch (e) {}
      return w;
    };
    try { Wrapped.prototype = Native.prototype; } catch (e) {}
    return Wrapped;
  }
  function onWorkerMsg(ev) {
    workerMsgCount++;
    const d = ev.data;
    if (wsSampleLogged < 16) {
      LOG('worker msg:', typeof d === 'string' ? d.slice(0, 400)
        : (() => { try { return JSON.stringify(d).slice(0, 400); } catch (e) { return Object.prototype.toString.call(d); } })());
      wsSampleLogged++;
    }
    try {
      if (typeof d === 'string') handleWsPayload(d);
      else if (d && typeof d === 'object') { scanForPicks(d, 0); broadcast(); }
    } catch (e) {}
  }
  try { W.Worker = wrapWorker(W.Worker, 'Worker'); } catch (e) { LOG('Worker hook failed', e); }
  try { W.SharedWorker = wrapWorker(W.SharedWorker, 'SharedWorker'); } catch (e) {}
  LOG('Worker hooks installed');

  // ---- WebSocket hook ---------------------------------------------------
  const NativeWS = W.WebSocket;
  let wsCount = 0, wsMsgCount = 0;
  function hookWebSocket() {
    if (!NativeWS) { LOG('no WebSocket to hook'); return; }
    W.WebSocket = function (url, protocols) {
      const ws = protocols ? new NativeWS(url, protocols) : new NativeWS(url);
      wsCount++;
      LOG('WebSocket #' + wsCount + ' opened:', url);
      ws.addEventListener('message', ev => {
        wsMsgCount++;
        try { handleWsPayload(ev.data); }
        catch (e) { /* ignore per-message errors */ }
      });
      return ws;
    };
    try { W.WebSocket.prototype = NativeWS.prototype; } catch (e) {}
    Object.getOwnPropertyNames(NativeWS).forEach(k => {
      try { W.WebSocket[k] = NativeWS[k]; } catch (e) {}
    });
    LOG('WebSocket hook installed');
  }

  function handleWsPayload(data) {
    if (data instanceof ArrayBuffer) {
      try {
        const s = new TextDecoder('utf-8', { fatal: false }).decode(data);
        if (wsSampleLogged < 12) { LOG('ws binary→utf8:', s.slice(0, 400)); wsSampleLogged++; }
        return handleWsPayload(s);
      } catch (e) { return; }
    }
    if (data && typeof data.arrayBuffer === 'function') {           // Blob
      data.arrayBuffer().then(buf => handleWsPayload(buf)).catch(() => {});
      return;
    }
    if (typeof data !== 'string') {
      if (wsSampleLogged < 12) { LOG('ws non-string msg:', Object.prototype.toString.call(data)); wsSampleLogged++; }
      return;
    }
    const trimmed = data.trimStart();

    // Structured (bamgrid / DSS) frames — scan as JSON, ignore otherwise.
    if (trimmed[0] === '{' || trimmed[0] === '[') {
      try { scanForPicks(JSON.parse(trimmed), 0); broadcast(); } catch (e) {}
      return;
    }

    // fantasydraft.espn.com line protocol: "VERB arg1 arg2 ..."
    const sp = data.indexOf(' ');
    const verb = (sp < 0 ? data : data.slice(0, sp)).trim().toUpperCase();
    const args = (sp < 0 ? '' : data.slice(sp + 1)).trim().split(/\s+/);

    // The ONLY pick message: "SELECTED <overallPick> <playerId> <slotId> [<memberId>]"
    if (verb === 'SELECTED' || verb === 'SELECTED_PLAYER') {
      const overall = +args[0] || 0;
      const playerId = +args[1] || 0;
      LOG('SELECTED → pick', overall, 'playerId', playerId, playerId && playerInfo.get(playerId) ? '(' + playerInfo.get(playerId).name + ')' : '(unknown)');
      if (playerId > 0) { addPickById(playerId, overall, 0); broadcast(); }
      return;
    }

    // Everything else (CLOCK, TICK, SELECTING, DRAFT_LIST=queue, AUTODRAFT,
    // AUTOSUGGEST, JOINED, TOKEN, INIT, PONG…) — never a pick. Log a few
    // unfamiliar verbs for future tuning, but extract nothing.
    const KNOWN = /^(INIT|TOKEN|CLOCK|TICK|SELECTING|DRAFT_LIST|AUTODRAFT|AUTOSUGGEST|JOINED|LEFT|PONG|PING|CHAT|MSG|MESSAGE|KEEPALIVE|HEARTBEAT|SETTINGS|ROSTER|MEMBER|STATUS|ONCLOCK|PAUSED|RESUMED)$/;
    if (!KNOWN.test(verb) && wsVerbLogged < 40) {
      LOG('ws unknown verb:', verb, '|', args.join(' ').slice(0, 160));
      wsVerbLogged++;
    }
  }

  // Recursively look for pick-shaped objects. ESPN has used several shapes over
  // the years; match on "has a player id AND (an overall pick number OR looks
  // like a selection)".
  function scanForPicks(node, depth) {
    if (!node || typeof node !== 'object' || (depth || 0) > 6) return;
    if (Array.isArray(node)) { node.forEach(n => scanForPicks(n, (depth || 0) + 1)); return; }

    const pid = firstNum(node, ['playerId', 'playerID', 'player_id', 'playerid']);
    const overall = firstNum(node, ['overallPickNumber', 'overallPick', 'overall', 'pickNumber', 'overall_selection']);
    const typeStr = String(node.type || node.messageType || node.action || node.command || '').toUpperCase();
    const looksLikeSelection = /SELECT|PICK|DRAFT/.test(typeStr);

    if (pid && (overall || looksLikeSelection)) {
      const teamId = firstNum(node, ['teamId', 'toTeamId', 'memberId', 'fantasyTeamId']);
      if (mySlot == null && looksLikeSelection && node.autodraft === false && teamId) {
        // can't map teamId→slot reliably; leave slot to the user
      }
      addPickById(pid, overall || 0, teamId || 0);
      broadcast();
    }

    // Inline player object (name already present, no lookup needed)
    const nm = node.fullName || (node.player && (node.player.fullName || node.player.name));
    if (nm && (overall || looksLikeSelection)) {
      const posId = firstNum(node, ['defaultPositionId', 'positionId']) ||
                    (node.player && firstNum(node.player, ['defaultPositionId', 'positionId']));
      const teamId2 = firstNum(node, ['proTeamId']) || (node.player && firstNum(node.player, ['proTeamId']));
      addPick({ overall: overall || 0, name: nm, pos: POS_BY_ID[posId] || '', team: TEAM_BY_ID[teamId2] || '' });
      broadcast();
    }

    for (const k in node) {
      if (node[k] && typeof node[k] === 'object') scanForPicks(node[k], (depth || 0) + 1);
    }
  }

  function firstNum(obj, keys) {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'number' && v > 0) return v;
      if (typeof v === 'string' && /^\d+$/.test(v)) return +v;
    }
    return 0;
  }

  // ---- DOM fallback ------------------------------------------------------
  // Watches for rows that look like "<POS> <Player Name>" appearing in a list.
  const seenDomText = new Set();
  function hookDom() {
    const obs = new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          scanDomNode(n);
        }
      }
    });
    const start = () => obs.observe(document.body, { childList: true, subtree: true });
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
    LOG('DOM observer installed');
  }

  function scanDomNode(el) {
    // Heuristic: an element containing a position token and a plausible name.
    const txt = (el.innerText || el.textContent || '').trim();
    if (!txt || txt.length > 80 || seenDomText.has(txt)) return;
    const m = txt.match(/\b(QB|RB|WR|TE|K|D\/ST|DST)\b[\s,\-–|]*([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})/);
    if (!m) return;
    const name = m[2].trim();
    if (name.split(' ').length < 2 && !/D\/ST|DST/.test(m[1])) return;
    seenDomText.add(txt);
    const pos = m[1] === 'D/ST' ? 'DST' : m[1];
    LOG('DOM pick candidate:', pos, name, '   (raw:', JSON.stringify(txt), ')');
    addPick({ overall: 0, name, pos, team: '' });
    broadcast();
  }

  // ---- on-page control panel ------------------------------------------
  let panelEl = null;
  function buildPanel() {
    if (panelEl || !document.body) return;
    panelEl = document.createElement('div');
    panelEl.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647',
      'background:#0f172a', 'color:#e2e8f0', 'font:12px/1.4 system-ui,sans-serif',
      'padding:9px 11px', 'border-radius:8px', 'box-shadow:0 4px 16px #0007',
      'width:210px'
    ].join(';');
    panelEl.innerHTML =
      '<div style="font-weight:700;margin-bottom:5px">Draft bridge</div>' +
      '<div id="eb-status" style="color:#94a3b8;margin-bottom:6px">starting…</div>' +
      '<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px">My draft slot' +
      '<input id="eb-slot" type="number" min="1" max="20" style="width:46px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:2px 4px"></label>' +
      '<label style="display:flex;align-items:center;gap:6px;margin-bottom:6px">League size' +
      '<input id="eb-size" type="number" min="4" max="20" style="width:46px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:2px 4px"></label>' +
      '<button id="eb-resend" style="width:100%;background:#2563eb;color:#fff;border:0;border-radius:4px;padding:3px;cursor:pointer">Force resend</button>' +
      '<div style="color:#64748b;margin-top:5px;font-size:11px">Set your slot to your position in this mock.</div>';
    document.body.appendChild(panelEl);
    const slotIn = panelEl.querySelector('#eb-slot');
    const sizeIn = panelEl.querySelector('#eb-size');
    if (mySlot) slotIn.value = mySlot;
    if (leagueSize) sizeIn.value = leagueSize;
    slotIn.addEventListener('change', () => {
      mySlot = Math.max(1, Math.min(20, +slotIn.value || 0)) || null;
      GM_setValue('espnBridgeMySlot', mySlot || 0);
      broadcast();
    });
    sizeIn.addEventListener('change', () => {
      leagueSize = Math.max(4, Math.min(20, +sizeIn.value || 0)) || null;
      broadcast();
    });
    panelEl.querySelector('#eb-resend').addEventListener('click', broadcast);
  }

  function updatePanel(nPicks) {
    if (!panelEl) return;
    const s = panelEl.querySelector('#eb-status');
    if (s) s.innerHTML =
      `<b>${nPicks}</b> picks captured` + (playersLoaded ? '' : ' · loading players…') +
      `<br><span style="font-size:10px;color:#64748b">poll ${pollCount} · ws ${wsCount}/${wsMsgCount} · wkr ${workerCount}/${workerMsgCount}</span>` +
      `<br><span style="font-size:10px;color:#64748b">__ebDump(true) → clipboard</span>`;
    const sizeIn = panelEl.querySelector('#eb-size');
    if (sizeIn && leagueSize && !sizeIn.value) sizeIn.value = leagueSize;
  }

  // ---- go --------------------------------------------------------------
  hookWebSocket();
  loadPlayers();
  heartbeat = setInterval(broadcast, 3000);
  // Poll the REST API for settings + backfill (picks before we connected) and
  // as a safety net alongside the live WS stream.
  if (LEAGUE_ID) {
    setTimeout(pollDraftDetail, 800);
    setInterval(pollDraftDetail, 4000);
  } else {
    LOG('no leagueId in URL — set slot/size in the panel manually');
  }
  const domReady = () => {
    if (W.top === W.self) buildPanel();
    hookDom();
    inferLeagueSize();
    broadcast();
  };
  if (document.body) domReady();
  else document.addEventListener('DOMContentLoaded', domReady);
  setInterval(() => updatePanel(capCount()), 2000);
  LOG('ESPN side active; season', SEASON, VERSION, '| drafty:', LOOKS_DRAFTY, '| iframe:', W.top !== W.self);
})();
