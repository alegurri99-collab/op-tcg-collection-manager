// ============================================================================
// CONFIG PUBBLICA (non segreta) — condivisa tra main process e script Node
// ============================================================================
// Valori pubblici di infrastruttura, centralizzati per evitare duplicazioni.
// I SEGRETI (chiavi R2, token) restano SOLO in .env / process.env.
// ============================================================================

// URL pubblico del CDN Cloudflare R2 (lettura immagini e indici prezzi)
const R2_PUBLIC_URL = 'https://pub-319b6b5d4fa14afe9c1c2d712d907d4c.r2.dev';

// Nome bucket R2 di default (override possibile via process.env.R2_BUCKET)
const R2_BUCKET_DEFAULT = 'op-tcg-images';

module.exports = { R2_PUBLIC_URL, R2_BUCKET_DEFAULT };
