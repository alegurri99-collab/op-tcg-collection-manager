#!/usr/bin/env node
/**
 * prices-r2.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Genera downloads/prices-index.json leggendo i prezzi condivisi da Firestore
 * (collezione /sharedPrices, struttura piatta) e lo carica su Cloudflare R2.
 *
 * Scopo: spostare la LETTURA dei prezzi dai client (N letture Firestore a ogni
 * apertura di Portfolio/Admin → rate limit 429) a un singolo file statico
 * servito da R2 (CDN, zero costo, nessun limite, leggibile senza login).
 * Le letture Firestore le paga questo script UNA volta in fase di generazione.
 *
 * Strategia (Opzione 2 — struttura piatta): i documenti /sharedPrices/{docId}
 * contengono direttamente i campi prezzo (migrati da /data/latest), quindi sono
 * LISTABILI. Si fa UNA list paginata della collezione invece di N GET per-carta:
 * niente più 404, niente Collection Group index, ~1 lettura per ~1000 documenti.
 *
 * CardTrader (unificato in questo stesso script/workflow, non un file separato):
 * SOLO le carte con un link CardTrader già salvato in /sharedCardLinks vengono
 * processate (senza link non c'è modo di scoprire il blueprint_id). Ogni prezzo
 * trovato finisce nello STESSO prices-index.json, chiave "${cardKey}:cardtrader" —
 * stessi filtri (Mint/Near Mint, no graded/altered/signed) dell'ipcMain
 * 'fetch-cardtrader-price' in main.js, per zero divergenza tra fetch on-demand
 * del modal e questo batch. Rate limit CardTrader: 200 richieste/10s — con poche
 * decine di carte linkate, CT_PAUSE_MS è di cortesia, non necessario per stare
 * sotto il limite.
 *
 * Uso:
 *   node scripts/prices-r2.js                  (CLI: genera + carica)
 *   const { generateAndUploadPrices } = require('./prices-r2.js')
 *   await generateAndUploadPrices({ onLog })   (programmatico, usato dall'IPC)
 *
 * Output: downloads/prices-index.json
 *   Forma: { "LANG:EXP:ID:source": { priceInfo, chartLabels, chartData, fetched_at } }
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// ─── Percorsi ────────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const DOWNLOADS_DIR = path.join(ROOT, '..', 'downloads');
const OUTPUT_PATH = path.join(DOWNLOADS_DIR, 'prices-index.json');
const OUTPUT_KEY = 'prices-index.json';

// ─── .env loader (stesso pattern di upload-to-r2.js) ──────────────────────────
(function loadDotEnv() {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (key && process.env[key] === undefined) process.env[key] = value;
    }
})();

const R2_ENDPOINT   = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const { R2_PUBLIC_URL, R2_BUCKET_DEFAULT } = require('../config-public');
const R2_BUCKET     = process.env.R2_BUCKET || R2_BUCKET_DEFAULT;

// Sorgenti prezzo supportate nel JSON. Cardmarket/tcgplayer letti da Firestore.
// 'cardtrader' ora è incluso anche qui: il modal carta (client) scrive i propri
// fetch on-demand su /sharedPrices con source 'cardtrader' (vedi
// saveCardtraderPriceToCloud in auth-manager.js), così questa scansione generica
// li raccoglie. addCardtraderPrices() più sotto resta comunque l'autorità finale:
// fa un fetch live indipendente su TUTTE le carte con link salvato (copertura
// garantita ogni 6h anche per carte che nessuno apre mai nel modal) e sovrascrive
// quanto raccolto qui con il prezzo di mercato più fresco.
const SOURCES = ['cardmarket', 'tcgplayer', 'cardtrader'];

// Tuning list Firestore
const PAGE_SIZE = 1000;       // documenti per pagina (max Firestore = 1000)
const MAX_RETRIES = 4;        // retry su 429/errori transitori della singola pagina
const RETRY_BASE_MS = 800;    // backoff esponenziale di base
const PAGE_PAUSE_MS = 200;    // pausa tra una pagina e la successiva

const { firebaseConfig } = require('../firebase-config');

// ─── Helpers Firestore ─────────────────────────────────────────────────────────
// Inverso di cardKeyToFirestoreId: il docId usa '__' al posto di ':'
function firestoreIdToCardKey(docId) {
    return docId.replace(/__/g, ':');
}

function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}

// GET pubblico Firestore. Risolve { status, json }.
function firestoreGetRaw(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'OP-TCG-PricesIndex' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(data); } catch { /* non-JSON */ }
                resolve({ status: res.statusCode, json });
            });
        }).on('error', reject);
    });
}

// GET pubblico generico (non-Firestore) con risoluzione "soft": ritorna null invece
// di rigettare, usato per leggere l'indice R2 precedente senza far fallire il run
// se non esiste ancora o la CDN non risponde.
function httpsGetJSONSoft(url) {
    return new Promise((resolve) => {
        https.get(url, { headers: { 'User-Agent': 'OP-TCG-PricesIndex' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400) { resolve(null); return; }
                try { resolve(JSON.parse(data)); } catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

// Scarica una singola pagina di una collezione Firestore pubblica con retry/backoff
// sui 429. Generica per riuso su collezioni diverse (sharedPrices, sharedCardLinks).
// Ritorna { documents, nextPageToken } oppure lancia se esaurisce i retry.
async function fetchPage(pageToken, log, collection = 'sharedPrices') {
    const base = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/${collection}`;

    let url = `${base}?pageSize=${PAGE_SIZE}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let res;
        try {
            res = await firestoreGetRaw(url);
        } catch (err) {
            if (attempt === MAX_RETRIES) throw new Error(`errore rete durante la list: ${err.message}`);
            await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
            continue;
        }

        if (res.status === 429) {
            if (attempt === MAX_RETRIES) throw new Error('429 persistente sulla list dopo i retry');
            const wait = RETRY_BASE_MS * Math.pow(2, attempt);
            log(`   ⏳ 429 sulla list (${collection}) — attendo ${wait}ms (retry ${attempt + 1}/${MAX_RETRIES})`);
            await sleep(wait);
            continue;
        }

        if (res.status && res.status >= 400) {
            throw new Error(`HTTP ${res.status} sulla list di ${collection}`);
        }

        return {
            documents: res.json?.documents || [],
            nextPageToken: res.json?.nextPageToken || null
        };
    }
    throw new Error('list fallita');
}

// Trasforma un documento Firestore /sharedPrices (campi piatti) in una entry per l'index.
// Ritorna { key, entry } oppure null se il documento non è un prezzo valido.
function docToEntry(doc) {
    const f = doc.fields;
    if (!f) return null; // documento senza campi (eventuale fantasma residuo)

    // Il docId è l'ultimo segmento di doc.name (".../documents/sharedPrices/{docId}")
    const docId = doc.name.split('/').pop();
    const cardKey = f.card_key?.stringValue || firestoreIdToCardKey(docId);

    const source = f.source?.stringValue || 'cardmarket';
    if (!SOURCES.includes(source)) return null;

    let entry;
    try {
        entry = {
            card_key:    f.card_key?.stringValue || cardKey,
            source:      source,
            fetched_at:  f.fetched_at?.stringValue || null,
            chartLabels: JSON.parse(f.chart_labels?.stringValue || '[]'),
            chartData:   JSON.parse(f.chart_data?.stringValue || '[]'),
            priceInfo:   JSON.parse(f.price_info?.stringValue || '{}')
        };
    } catch {
        return null;
    }

    return { key: `${cardKey}:${source}`, entry };
}

// ─── CardTrader — merge nello STESSO prices-index.json (source 'cardtrader') ──
const CARDTRADER_API_BASE = 'https://api.cardtrader.com/api/v2';
const CT_LANGUAGE_MAP = { ENG: 'en', JAP: 'jp', FRA: 'fr' };
const CT_TOKEN = process.env.CT_TOKEN;
const CT_PAUSE_MS = 250; // cortesia verso l'API, non necessario per il rate limit (200 req/10s)
const CT_ACCEPTED_CONDITIONS = ['Mint', 'Near Mint'];

// Estrae il blueprint_id da un link CardTrader (.../cards/354313-nome...).
function extractCardtraderBlueprintId(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/\/cards\/(\d+)/);
    return m ? m[1] : null;
}

// Lingua CardTrader dalla cardKey (primo segmento "LANG:EXP:ID").
function ctLanguageFromCardKey(cardKey) {
    const lang = String(cardKey).split(':')[0];
    return CT_LANGUAGE_MAP[lang] || null;
}

// GET autenticato (Bearer) verso l'API CardTrader. Stesso pattern di
// cardtraderGetJSON/fetch-cardtrader-price in main.js.
function cardtraderGetJSON(fullUrl, token) {
    return new Promise((resolve, reject) => {
        const req = https.get(fullUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'User-Agent': 'OP-TCG-PricesIndex'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
                try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse error')); }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

// Prezzo minimo eligible per blueprint+lingua — STESSI filtri dell'ipcMain
// 'fetch-cardtrader-price' in main.js (solo Mint/Near Mint, esclusi graded/altered/
// signed), per comportamento identico tra fetch on-demand del modal e questo batch.
async function fetchCardtraderBestPrice(blueprintId, language, token) {
    const url = `${CARDTRADER_API_BASE}/marketplace/products?blueprint_id=${blueprintId}`
              + (language ? `&language=${encodeURIComponent(language)}` : '');
    const json = await cardtraderGetJSON(url, token);
    const listings = (json && Array.isArray(json[blueprintId])) ? json[blueprintId] : [];

    const eligible = listings.filter(p => {
        const ph = p.properties_hash || {};
        if (p.graded) return false;
        if (ph.altered || ph.signed) return false;
        if (!CT_ACCEPTED_CONDITIONS.includes(ph.condition)) return false;
        const cents = (p.price && typeof p.price.cents === 'number') ? p.price.cents : null;
        return cents !== null && cents > 0;
    });
    if (eligible.length === 0) return null;

    const best = eligible.reduce((min, p) => (p.price.cents < min.price.cents ? p : min));
    return {
        price: best.price.cents / 100,
        currency: best.price.currency || 'EUR',
        condition: best.properties_hash?.condition || null
    };
}

// Legge tutti i link CardTrader salvati: list paginata di /sharedCardLinks (stesso
// fetchPage generico usato per /sharedPrices). Ritorna { cardKey → url }.
async function fetchAllCardtraderLinks(log) {
    const links = {};
    let pageToken = null;
    do {
        const { documents, nextPageToken } = await fetchPage(pageToken, log, 'sharedCardLinks');
        for (const doc of documents) {
            const f = doc.fields || {};
            const cardtrader = f.cardtrader?.stringValue;
            const docId = doc.name.split('/').pop();
            const cardKey = f.card_key?.stringValue || firestoreIdToCardKey(docId);
            if (cardtrader && cardKey) links[cardKey] = cardtrader;
        }
        pageToken = nextPageToken;
        if (pageToken) await sleep(PAGE_PAUSE_MS);
    } while (pageToken);
    return links;
}

// Scarica l'indice prezzi PRECEDENTE da R2 (se esiste) per estendere lo storico
// CardTrader punto su punto invece di ripartire da zero a ogni run: a differenza
// di Cardmarket (la cui history vive in Firestore), la history CardTrader esiste
// SOLO dentro le entry già pubblicate dai run precedenti di questo stesso script.
async function fetchPreviousPricesIndex(log) {
    const json = await httpsGetJSONSoft(`${R2_PUBLIC_URL}/prices-index.json`);
    if (!json || !json.prices) {
        log('   ⚠️ Nessun prices-index.json precedente su R2 — storico CardTrader riparte da zero.');
        return {};
    }
    return json.prices;
}

// Genera le entry CardTrader e le fonde DENTRO pricesIndex (stesso oggetto/file di
// Cardmarket, chiave "${cardKey}:cardtrader"). Muta pricesIndex in place.
// Ritorna il conteggio di entry aggiunte/aggiornate (per il totale withPrice).
async function addCardtraderPrices(pricesIndex, log) {
    if (!CT_TOKEN) {
        log('⚠️ CT_TOKEN assente: salto l\'aggiornamento prezzi CardTrader (solo Cardmarket in questo run).');
        return { added: 0 };
    }

    log('🔗 Lettura link CardTrader salvati (/sharedCardLinks)...');
    const links = await fetchAllCardtraderLinks(log);
    const cardKeys = Object.keys(links);
    log(`   📎 ${cardKeys.length} carte con link CardTrader salvato`);
    if (cardKeys.length === 0) return { added: 0 };

    const previous = await fetchPreviousPricesIndex(log);
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD (batch server-side, UTC)

    let added = 0, skipped = 0, failed = 0;
    for (const cardKey of cardKeys) {
        const blueprintId = extractCardtraderBlueprintId(links[cardKey]);
        const ctLang = ctLanguageFromCardKey(cardKey);
        const key = `${cardKey}:cardtrader`;
        const prevEntry = previous[key];

        if (!blueprintId || !ctLang) { skipped++; continue; }

        try {
            const best = await fetchCardtraderBestPrice(blueprintId, ctLang, CT_TOKEN);

            if (best) {
                // Storico a gradini con dedup per giorno, stesso criterio di
                // appendCardtraderPrice in main.js.
                const chartLabels = Array.isArray(prevEntry?.chartLabels) ? prevEntry.chartLabels.slice() : [];
                const chartData = Array.isArray(prevEntry?.chartData) ? prevEntry.chartData.slice() : [];
                if (chartLabels.length && chartLabels[chartLabels.length - 1] === today) {
                    chartData[chartData.length - 1] = best.price;
                } else {
                    chartLabels.push(today);
                    chartData.push(best.price);
                }

                pricesIndex[key] = {
                    card_key: cardKey,
                    source: 'cardtrader',
                    fetched_at: new Date().toISOString(),
                    chartLabels,
                    chartData,
                    priceInfo: {
                        priceTrend: best.price.toFixed(2),
                        currency: best.currency,
                        condition: best.condition,
                        cardtrader: true,
                        lastUpdate: today
                    }
                };
                added++;
            } else if (prevEntry) {
                // Nessuna offerta eleggibile oggi: mantiene l'ultima entry nota invece
                // di far sparire la carta dal Portfolio per un buco temporaneo di mercato.
                pricesIndex[key] = prevEntry;
                skipped++;
            } else {
                skipped++;
            }
        } catch (err) {
            log(`   ⚠️ CardTrader ${cardKey}: ${err.message}`);
            if (prevEntry) pricesIndex[key] = prevEntry;
            failed++;
        }
        await sleep(CT_PAUSE_MS);
    }

    log(`✅ CardTrader: ${added} aggiornati, ${skipped} saltati, ${failed} falliti`);
    return { added };
}

// ─── Generazione prices-index.json ────────────────────────────────────────────
async function generatePricesIndex({ onLog = () => {} } = {}) {
    const log = (m) => { onLog(m); console.log(m); };

    log('📖 Lettura prezzi da Firestore (list paginata di /sharedPrices)...');

    const pricesIndex = {};
    let withPrice = 0;
    let scanned = 0;
    let pageNum = 0;
    const startTime = Date.now();

    let pageToken = null;
    do {
        const { documents, nextPageToken } = await fetchPage(pageToken, log);
        pageNum++;

        for (const doc of documents) {
            scanned++;
            const res = docToEntry(doc);
            if (res) {
                pricesIndex[res.key] = res.entry;
                withPrice++;
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        log(`   📊 pagina ${pageNum}: ${documents.length} doc — totale scansionati: ${scanned}, con prezzo: ${withPrice} — ${elapsed}s`);

        pageToken = nextPageToken;
        if (pageToken) await sleep(PAGE_PAUSE_MS);
    } while (pageToken);

    // ── Fase 2: prezzi CardTrader per le carte con link salvato ──
    // Stesso indice/file di Cardmarket (chiave ':cardtrader'), niente secondo output.
    const ctResult = await addCardtraderPrices(pricesIndex, log);
    withPrice += ctResult.added;

    const payload = {
        version: new Date().toISOString().split('T')[0],
        generatedAt: new Date().toISOString(),
        sources: SOURCES,
        count: withPrice,
        partial: false,
        prices: pricesIndex
    };

    const jsonStr = JSON.stringify(payload);
    // Assicura che la cartella di output esista: in locale downloads/ c'è sempre
    // (contiene anche le immagini), ma in CI (repo appena clonato, senza quella
    // cartella sibling) andrebbe altrimenti in ENOENT.
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, jsonStr);

    const sizeMB = (Buffer.byteLength(jsonStr) / 1024 / 1024).toFixed(2);
    log(`✅ prices-index.json scritto: ${withPrice} prezzi, ${sizeMB} MB`);

    return { ok: true, count: withPrice, partial: false, sizeMB, path: OUTPUT_PATH };
}

// ─── Upload del solo prices-index.json su R2 ──────────────────────────────────
async function uploadPricesIndex({ onLog = () => {} } = {}) {
    const log = (m) => { onLog(m); console.log(m); };

    if (!R2_ENDPOINT || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
        throw new Error('Configurazione R2 incompleta: servono R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY nel file .env.');
    }
    if (!fs.existsSync(OUTPUT_PATH)) {
        throw new Error(`${OUTPUT_PATH} non esiste: genera prima l'index.`);
    }

    const s3 = new S3Client({
        region: 'auto',
        endpoint: R2_ENDPOINT,
        credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
    });

    log('📤 Upload prices-index.json su R2...');
    const body = fs.readFileSync(OUTPUT_PATH);
    await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: OUTPUT_KEY,
        Body: body,
        ContentType: 'application/json',
        // Cache breve: i prezzi sono manuali e rari, 5 min di propagazione sono accettabili.
        // NON usare la cache di 1 anno delle immagini, altrimenti la CDN servirebbe prezzi vecchi.
        CacheControl: 'public, max-age=300',
    }));

    log(`✅ Caricato: ${R2_PUBLIC_URL}/${OUTPUT_KEY}`);
    return { ok: true, url: `${R2_PUBLIC_URL}/${OUTPUT_KEY}` };
}

// ─── Combinata: genera + carica (usata dal bottone "Rigenera prezzi") ─────────
async function generateAndUploadPrices({ onLog = () => {} } = {}) {
    const gen = await generatePricesIndex({ onLog });
    const up = await uploadPricesIndex({ onLog });
    return { ok: true, ...gen, ...up };
}

module.exports = { generatePricesIndex, uploadPricesIndex, generateAndUploadPrices, firestoreIdToCardKey };

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
    generateAndUploadPrices({}).then(() => {
        console.log('\n🎉 Fatto.');
    }).catch(err => {
        console.error(`❌ Errore: ${err.message}`);
        process.exit(1);
    });
}
