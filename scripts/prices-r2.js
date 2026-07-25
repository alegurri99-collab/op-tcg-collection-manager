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

// Sorgenti prezzo supportate nel JSON
const SOURCES = ['cardmarket', 'tcgplayer'];

// Tuning list Firestore
const PAGE_SIZE = 1000;       // documenti per pagina (max Firestore = 1000)
const MAX_RETRIES = 4;        // retry su 429/errori transitori della singola pagina
const RETRY_BASE_MS = 800;    // backoff esponenziale di base
const PAGE_PAUSE_MS = 200;    // pausa tra una pagina e la successiva

const { firebaseConfig } = require('../firebase-config');

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// Scarica una singola pagina della collezione sharedPrices con retry/backoff sui 429.
// Ritorna { documents, nextPageToken } oppure lancia se esaurisce i retry.
async function fetchPage(pageToken, log) {
    const base = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/sharedPrices`;
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
            log(`   ⏳ 429 sulla list — attendo ${wait}ms (retry ${attempt + 1}/${MAX_RETRIES})`);
            await sleep(wait);
            continue;
        }

        if (res.status && res.status >= 400) {
            throw new Error(`HTTP ${res.status} sulla list di sharedPrices`);
        }

        return {
            documents: res.json?.documents || [],
            nextPageToken: res.json?.nextPageToken || null
        };
    }
    throw new Error('list fallita');
}

// Trasforma un documento Firestore (campi piatti) in una entry per l'index.
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
