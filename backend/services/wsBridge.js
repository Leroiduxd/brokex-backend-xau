// services/wsBridge.js (CommonJS)
const { WebSocketServer, WebSocket } = require('ws');
const EventEmitter = require('events');
const keeperConfig = require('../config/config');

const priceEmitter = new EventEmitter();

// Note : Utilisation du fetch natif de Node.js 18+ ou fallback
const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');

// === CONFIG en dur ===
const SUPRA_API_KEY = keeperConfig.SUPRA_API_KEY || '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2';
const REST_BASE = 'https://prod-kline-rest.supra.com';
const WS_URL = 'wss://prod-kline-ws.supra.com';

const RESOLUTION = 1;
const CHUNK_SIZE = 30;
const REFRESH_MS = 2 * 60 * 1000; // re-évalue horaires toutes les 2 min
const MIN_GAP_MS = 50; // 🟢 DÉLAI RÉDUIT À 50ms ENTRE CHAQUE APPEL REST

// 🟢 LISTE DES PAIRES MISE À ZONE (Uniquement XAU_USD)
const PAIRS = [
    'xau_usd'
];

// 🟢 ALIASES
const ALIASES = {};
const normalize = (t) => ALIASES[t] || t;

// 🟢 META (Uniquement XAU_USD)
const META = {
    // 5500: Commodities
    'xau_usd':{id:5500,name:'GOLD/US DOLLAR'}
};

const CRYPTO = []; 

const FOREX = [];

const COMMODITIES = ['xau_usd'];

const US_EQ = [];

const US_ETF = [];

const WD = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
const TZ_PARIS = 'Europe/Paris';
const TZ_NY = 'America/New_York';

const state = {};
let currentWSSet = [];
let supraWS = null;
let wss = null;
let goldWss = null; // 🟢 WSS dédié à l'or (XAU_USD)
let spreadWss = null; // 🟢 WSS dédié aux spreads KMS (/ws/kms ou /ws/spread)

// 🔻 Watchdog d’inactivité Supra
let supraWSLastActivity = 0;
let supraWSInactivityTimer = null;
const SUPRA_INACTIVITY_LIMIT_MS = 10000;

// 🔻 Fallback REST pour flux “stale”
const STALE_WS_MAX_AGE_MS = 10000;      // si pas de WS depuis > 10s → considéré stale
const REST_STALE_REFRESH_INTERVAL_MS = 5000;    // REST max toutes les 5s par paire
let staleRestIntervalStarted = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

function clearSupraInactivityTimer() {
    if (supraWSInactivityTimer) {
        clearInterval(supraWSInactivityTimer);
        supraWSInactivityTimer = null;
    }
}

function partsFromTZ(date, timeZone) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = fmt.formatToParts(date);
    const wdStr = parts.find(p => p.type === 'weekday')?.value;
    const hour = +parts.find(p => p.type === 'hour')?.value;
    const minute = +parts.find(p => p.type === 'minute')?.value;
    return { wd: WD[wdStr] ?? 0, hour, minute };
}

function isUsEquityOpen(d = new Date()) {
    const { wd, hour, minute } = partsFromTZ(d, TZ_NY);
    if (wd <= 0 || wd === 6) return false; // dimanche ou samedi
    const m = hour * 60 + minute;
    return m >= 9 * 60 + 30 && m < 16 * 60 + 30; // 9h30–16h30 NY
}

function isForexLikeOpen(d = new Date()) {
    const { wd, hour } = partsFromTZ(d, TZ_PARIS);
    if (wd === 0) return hour >= 22;      // dimanche 22h+
    if (wd >= 1 && wd <= 4) return true;  // lundi–jeudi H24
    if (wd === 5) return hour < 23;        // vendredi jusqu’à 23h
    return false;
}

const isCryptoOpen = () => false;

function initCache(p) {
    if (!state[p]) {
        const m = META[p] || { id: null, name: 'UNKNOWN' };
        state[p] = {
            id: m.id ?? null,
            name: m.name || 'UNKNOWN',
            lastWsMs: 0,
            lastRestMs: 0
        };
    }
}

function upsertFromWS(item) {
    const p = normalize(item.tradingPair || '');
    if (!p) return;
    initCache(p);
    const s = state[p];

    const live = item.currentPrice ?? item.close;
    if (live != null) {
        s.wsPriceStr = String(live);
        if (p === 'xau_usd') {
            priceEmitter.emit('price', Number(live));
        }
    }
    if (item.time != null) s.wsTime = String(item.time);
    if (item.timestamp) s.wsTimestamp = item.timestamp;

    s.lastWsMs = Date.now();
}

async function fetchLatestREST(p) {
    try {
        const r = await fetchFn(`${REST_BASE}/latest?trading_pair=${p}`, { headers: { 'x-api-key': SUPRA_API_KEY } });
        if (!r.ok) {
            if (r.status === 429) console.warn(`[REST] 429 ${p}`);
            else console.warn(`[REST] ${r.status} ${p}`);
            return;
        }
        const raw = await r.json().catch(() => ({}));
        const d = Array.isArray(raw?.instruments) ? raw.instruments[0] : null;
        if (!d) return;

        initCache(p);
        const s = state[p];

        if (d.currentPrice != null) {
            s.restPriceStr = String(d.currentPrice);
            if (p === 'xau_usd') {
                priceEmitter.emit('price', Number(d.currentPrice));
            }
        }
        if (d['24h_high'] != null)    s.h24 = String(d['24h_high']);
        if (d['24h_low']  != null)    s.l24 = String(d['24h_low']);
        if (d['24h_change'] != null) s.ch24 = String(d['24h_change']);
        if (d.timestamp) s.restTimestamp = d.timestamp;
        if (d.time != null) s.restTime = String(d.time);

        s.lastRestMs = Date.now();
    } catch (e) {
        console.error(`[REST] ${p}:`, e?.message);
    }
}

async function fetchOnceREST(pairs) {
    for (const raw of pairs) {
        const p = normalize(raw);
        initCache(p);
        // Ici on garde l'await pour l'initialisation pour ne pas spammer au boot
        await fetchLatestREST(p);
        await sleep(MIN_GAP_MS);
    }
}

function isPairOpen(p) {
    return currentWSSet.includes(p);
}

function buildPageForPair(p) {
    const meta = META[p] || { id: null, name: 'UNKNOWN' };
    const s = state[p] || {};
    // Toujours renvoyer le dernier prix connu disponible (WS, REST ou fallback Pyth)
    const price = s.wsPriceStr || s.restPriceStr;
    const time = s.wsTime || s.restTime || String(Math.floor(Date.now() / 1000));
    const ts = s.wsTimestamp || s.restTimestamp || Date.now();
    
    const haveAny = price || s.h24 || s.l24 || s.ch24 || time || ts;
    const instruments = haveAny ? [{
        time: time ? String(time) : undefined,
        timestamp: ts || undefined,
        currentPrice: price ? String(price) : undefined,
        '24h_high': s.h24 ?? undefined,
        '24h_low': s.l24 ?? undefined,
        '24h_change': s.ch24 ?? undefined,
        tradingPair: p
    }] : [];
    return {
        id: meta.id ?? null,
        name: meta.name || 'UNKNOWN',
        currentPage: 1,
        totalPages: 1,
        totalRecords: instruments.length,
        pageSize: 1,
        instruments
    };
}

function buildSnapshot() {
    const out = {};
    for (const raw of PAIRS) {
        const p = normalize(raw);
        if (META[p]) {
            out[p] = buildPageForPair(p);
        }
    }
    return JSON.stringify(out);
}

// 🟢 Construit le snapshot contenant UNIQUEMENT le prix de l'or
function buildGoldSnapshot() {
    const p = 'xau_usd';
    const out = {};
    if (META[p]) {
        out[p] = buildPageForPair(p);
    }
    return JSON.stringify(out);
}

let kmsRoutes = null;
function buildSpreadPayload() {
    if (!kmsRoutes) {
        try {
            kmsRoutes = require('../routes/kmsRoutes');
        } catch (e) {}
    }
    const result = {
        testnet: { spreadLong: "100", spreadShort: "100" },
        mainnet: { spreadLong: "100", spreadShort: "100" }
    };
    if (kmsRoutes && typeof kmsRoutes.getLatestSpreads === 'function') {
        result.testnet = kmsRoutes.getLatestSpreads('testnet');
        result.mainnet = kmsRoutes.getLatestSpreads('mainnet');
    }
    return JSON.stringify(result);
}

function setsDiff(a, b) {
    const A = new Set(a), B = new Set(b);
    const add = [...B].filter(x => !A.has(x));
    const del = [...A].filter(x => !B.has(x));
    return { add, del, changed: add.length || del.length };
}

function computeOpenSets() {
    const openPairs = new Set();
    const closedPairs = new Set();
    const openCrypto = isCryptoOpen();
    const openFx = isForexLikeOpen();
    const openEq = isUsEquityOpen();

    for (const p of CRYPTO) (openCrypto ? openPairs : closedPairs).add(normalize(p));
    for (const p of [...FOREX, ...COMMODITIES]) (openFx ? openPairs : closedPairs).add(normalize(p));
    for (const p of [...US_EQ, ...US_ETF]) (openEq ? openPairs : closedPairs).add(normalize(p));

    for (const raw of PAIRS) {
        const p = normalize(raw);
        if (META[p]) { 
             if (!openPairs.has(p) && !closedPairs.has(p)) closedPairs.add(p);
        }
    }

    return { open: [...openPairs], closed: [...closedPairs] };
}

function openSupraWS(pairs) {
    try {
        if (supraWS) supraWS.close();
    } catch {}
    clearSupraInactivityTimer();

    currentWSSet = [...pairs];
    supraWS = new WebSocket(WS_URL, { headers: { 'x-api-key': SUPRA_API_KEY } });

    const thisWS = supraWS;

    thisWS.on('open', () => {
        if (supraWS !== thisWS) return;

        console.log(`[SupraWS] Open. Subscribing to ${pairs.length} pairs.`);
        supraWSLastActivity = Date.now();

        for (const g of chunk(pairs, CHUNK_SIZE)) {
            const msg = {
                action: 'subscribe',
                channels: [{
                    name: 'ohlc_datafeed',
                    resolution: RESOLUTION,
                    tradingPairs: g
                }]
            };
            thisWS.send(JSON.stringify(msg));
        }

        supraWSInactivityTimer = setInterval(() => {
            if (supraWS !== thisWS) return;
            if (!thisWS || thisWS.readyState !== WebSocket.OPEN) return;

            const diff = Date.now() - supraWSLastActivity;
            if (diff > SUPRA_INACTIVITY_LIMIT_MS) {
                console.warn(`[SupraWS] No data for ${diff} ms, attempting reconnect...`);
                clearSupraInactivityTimer();
                try { thisWS.terminate(); } catch {}
                openSupraWS(currentWSSet);
            }
        }, 1000);
    });

    thisWS.on('message', (buf) => {
        if (supraWS !== thisWS) return;
        supraWSLastActivity = Date.now();

        try {
            const msg = JSON.parse(buf.toString());
            if (msg.event === 'ohlc_datafeed' && Array.isArray(msg.payload)) {
                for (const k of msg.payload) upsertFromWS(k);
                
                // Broadcast aux clients du WSS complet
                const payload = buildSnapshot();
                if (wss) {
                    wss.clients.forEach((c) => {
                        if (c.readyState === WebSocket.OPEN) {
                            try { c.send(payload); } catch {}
                        }
                    });
                }

                // Broadcast aux clients du WSS Or (uniquement s'il y a du flux ou à chaque message)
                const goldPayload = buildGoldSnapshot();
                if (goldWss) {
                    goldWss.clients.forEach((c) => {
                        if (c.readyState === WebSocket.OPEN) {
                            try { c.send(goldPayload); } catch {}
                        }
                    });
                }
            }
        } catch {
            // ignore parse errors
        }
    });

    thisWS.on('error', (e) => {
        if (supraWS !== thisWS) return;
        console.error('[SupraWS] error:', e?.message || e);
        clearSupraInactivityTimer();
    });

    thisWS.on('close', () => {
        if (supraWS !== thisWS) return;
        console.log('[SupraWS] closed (active).');
        clearSupraInactivityTimer();
        currentWSSet = [];
    });
}

async function rebalance() {
    console.log('[Rebalance] evaluate market hours...');
    const { open, closed } = computeOpenSets();
    const { changed } = setsDiff(currentWSSet, open);

    if (changed) {
        console.log(`[Rebalance] WS set changed -> resubscribe (${open.length} pairs)`);
        openSupraWS(open);
    } else {
        currentWSSet = open;
    }

    const all = [...closed, ...open];
    if (all.length) {
        console.log(`[Rebalance] REST refresh for ${all.length} pairs`);
        await fetchOnceREST(all);
    }
}

/**
 * Fallback REST: Appelle l'API pour les actifs "stale" un par un,
 * espacés de 50ms, sans bloquer l'attente de la réponse précédente.
 */
function startStaleRestRefresher() {
    if (staleRestIntervalStarted) return;
    staleRestIntervalStarted = true;

    setInterval(() => {
        (async () => {
            const now = Date.now();
            const candidates = [];

            for (const p of currentWSSet) {
                const s = state[p];
                if (!s) continue;
                const lastWs = s.lastWsMs || 0;
                const lastRest = s.lastRestMs || 0;

                const wsAge = now - lastWs;
                const restAge = now - lastRest;

                if (wsAge > STALE_WS_MAX_AGE_MS && restAge > REST_STALE_REFRESH_INTERVAL_MS) {
                    candidates.push(p);
                }
            }

            if (candidates.length) {
                console.log(`[REST-Stale] Refreshing ${candidates.length} stale pairs (50ms gap)`);
            }

            for (const p of candidates) {
                // On n'attend PAS le fetch ici (no await) pour garantir que le prochain appel
                // partira bien 50ms plus tard, quelle que soit la lenteur du réseau.
                fetchLatestREST(p).catch(err => console.error(`[REST-Stale] error ${p}:`, err.message));
                
                // On attend 50ms avant de passer au candidat suivant
                await sleep(MIN_GAP_MS);
            }
        })().catch((e) => {
            console.error('[REST-Stale] loop error:', e?.message);
        });
    }, 1000); // Check loop toutes les 1s
}

function attachPriceWSS() {
    // 1. Initialisation du WSS général (/ws/prices)
    wss = new WebSocketServer({
        noServer: true,
        perMessageDeflate: {
            zlibDeflateOptions: { level: 9 },
            zlibInflateOptions: { chunkSize: 1024 },
            clientNoContextTakeover: true,
            serverNoContextTakeover: true,
            threshold: 0
        }
    });

    console.log('✅ WSS mounted at /ws/prices');

    wss.on('connection', (ws) => {
        console.log('🟢 WS client connected');
        try { ws.send(buildSnapshot()); } catch {}
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
    });

    setInterval(() => {
        const payload = buildSnapshot();
        wss.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN) {
                try { c.send(payload); } catch {}
            }
        });
    }, 1000);

    setInterval(() => {
        wss.clients.forEach((c) => {
            if (c.isAlive === false) c.terminate();
            c.isAlive = false;
            try { c.ping(); } catch {}
        });
    }, 30000);

    // 2. 🟢 Initialisation du WSS Or (/ws/gold)
    goldWss = new WebSocketServer({
        noServer: true,
        perMessageDeflate: {
            zlibDeflateOptions: { level: 9 },
            zlibInflateOptions: { chunkSize: 1024 },
            clientNoContextTakeover: true,
            serverNoContextTakeover: true,
            threshold: 0
        }
    });

    console.log('✅ Gold WSS mounted at /ws/gold');

    goldWss.on('connection', (ws) => {
        console.log('🟢 Gold WS client connected');
        try { ws.send(buildGoldSnapshot()); } catch {}
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
    });

    setInterval(() => {
        const payload = buildGoldSnapshot();
        goldWss.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN) {
                try { c.send(payload); } catch {}
            }
        });
    }, 1000);

    setInterval(() => {
        goldWss.clients.forEach((c) => {
            if (c.isAlive === false) c.terminate();
            c.isAlive = false;
            try { c.ping(); } catch {}
        });
    }, 30000);

    // 3. 🟢 Initialisation du WSS Spreads KMS (/ws/spread ou /ws/kms)
    spreadWss = new WebSocketServer({
        noServer: true,
        perMessageDeflate: {
            zlibDeflateOptions: { level: 9 },
            zlibInflateOptions: { chunkSize: 1024 },
            clientNoContextTakeover: true,
            serverNoContextTakeover: true,
            threshold: 0
        }
    });

    console.log('✅ KMS Spread WSS mounted at /ws/spread & /ws/kms');

    spreadWss.on('connection', (ws) => {
        console.log('🟢 KMS Spread WS client connected');
        try { ws.send(buildSpreadPayload()); } catch {}
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
    });

    setInterval(() => {
        const payload = buildSpreadPayload();
        spreadWss.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN) {
                try { c.send(payload); } catch {}
            }
        });
    }, 1000);

    setInterval(() => {
        spreadWss.clients.forEach((c) => {
            if (c.isAlive === false) c.terminate();
            c.isAlive = false;
            try { c.ping(); } catch {}
        });
    }, 30000);
}

// 🟢 Gestion propre de l'Upgrade HTTP -> WS en fonction du chemin d'accès (Pathname)
function handlePriceUpgrade(req, socket, head) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    console.log(`[wsBridge Upgrade] Upgrade request received for path: ${pathname}`);

    if (pathname === '/ws/prices' || pathname === '/ws/prices/') {
        if (!wss) {
            console.warn('[wsBridge Upgrade] wss instance not initialized');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    } else if (pathname === '/ws/gold' || pathname === '/ws/gold/' || pathname === '/ws/xau' || pathname === '/ws/xau/') {
        if (!goldWss) {
            console.warn('[wsBridge Upgrade] goldWss instance not initialized');
            socket.destroy();
            return;
        }
        goldWss.handleUpgrade(req, socket, head, (ws) => {
            goldWss.emit('connection', ws, req);
        });
    } else if (pathname === '/ws/spread' || pathname === '/ws/spread/' || pathname === '/ws/kms' || pathname === '/ws/kms/') {
        if (!spreadWss) {
            console.warn('[wsBridge Upgrade] spreadWss instance not initialized');
            socket.destroy();
            return;
        }
        spreadWss.handleUpgrade(req, socket, head, (ws) => {
            spreadWss.emit('connection', ws, req);
        });
    } else {
        console.warn(`[wsBridge Upgrade] Path ${pathname} does not match any route, destroying socket`);
        socket.destroy();
    }
}

// 🟢 Fonction permettant d'alimenter le cache WSS depuis le flux Pyth (si Supra renvoie 403 / clé mock)
function updateXauPrice(price, timestamp = Date.now()) {
    initCache('xau_usd');
    const s = state['xau_usd'];
    s.wsPriceStr = String(price);
    s.wsTime = String(Math.floor(timestamp / 1000));
    s.wsTimestamp = timestamp;
    s.lastWsMs = Date.now();
    
    // Émettre en local pour déclencher le triggerEngine immédiatement
    priceEmitter.emit('price', price);

    // Diffuser immédiatement aux clients connectés
    const payload = buildSnapshot();
    if (wss) {
        wss.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN) {
                try { c.send(payload); } catch {}
            }
        });
    }

    const goldPayload = buildGoldSnapshot();
    if (goldWss) {
        goldWss.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN) {
                try { c.send(goldPayload); } catch {}
            }
        });
    }
}

function rebalanceScheduler() {
    (async () => { await rebalance(); })();
    setInterval(rebalance, REFRESH_MS);
    startStaleRestRefresher();
}

module.exports = {
    attachPriceWSS,
    handlePriceUpgrade,
    rebalanceScheduler,
    priceEmitter,
    updateXauPrice
};
