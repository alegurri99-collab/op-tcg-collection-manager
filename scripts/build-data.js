/**
 * build-data.js
 * Crea lo zip dei dati delle carte (downloads/) e lo mette in dist/
 * Eseguito automaticamente da "npm run build:full" dopo electron-builder
 *
 * Output: dist/downloads-data.zip
 */

const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOWNLOADS_PATH = path.join(ROOT, '..', 'downloads');
const DIST_PATH = path.join(ROOT, 'dist');
const OUTPUT_ZIP = path.join(DIST_PATH, 'downloads-data.zip');

// Pulizia file dist/ — tiene solo l'exe, il blockmap, il latest.yml e lo zip dati
// Rimuove file vecchi di build precedenti non necessari
function cleanDist() {
    const keepExtensions = ['.exe', '.blockmap', '.yml', '.yaml', '.zip'];
    const files = fs.readdirSync(DIST_PATH);
    for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const filePath = path.join(DIST_PATH, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) continue; // non toccare win-unpacked ecc.
        if (!keepExtensions.includes(ext)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️  Rimosso: ${file}`);
        }
    }
    // Rimuovi builder-debug.yml e builder-effective-config.yaml (non servono per la release)
    const toRemove = ['builder-debug.yml', 'builder-effective-config.yaml'];
    for (const f of toRemove) {
        const fp = path.join(DIST_PATH, f);
        if (fs.existsSync(fp)) {
            fs.unlinkSync(fp);
            console.log(`🗑️  Rimosso: ${f}`);
        }
    }
}

async function createDataZip() {
    console.log('\n📦 OP TCG Collection Manager — Build Data\n');

    // Verifica che la cartella downloads esista
    if (!fs.existsSync(DOWNLOADS_PATH)) {
        console.error(`❌ Cartella downloads non trovata: ${DOWNLOADS_PATH}`);
        process.exit(1);
    }

    // Assicura che dist/ esista
    if (!fs.existsSync(DIST_PATH)) {
        fs.mkdirSync(DIST_PATH, { recursive: true });
    }

    // Rimuovi zip precedente se esiste
    if (fs.existsSync(OUTPUT_ZIP)) {
        fs.unlinkSync(OUTPUT_ZIP);
        console.log('🗑️  Rimosso zip precedente');
    }

    console.log(`📁 Sorgente: ${DOWNLOADS_PATH}`);
    console.log(`📦 Output:   ${OUTPUT_ZIP}\n`);
    console.log('⏳ Creazione zip in corso (potrebbe richiedere qualche minuto)...\n');

    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(OUTPUT_ZIP);
        const archive = archiver('zip', {
            zlib: { level: 6 } // Compressione bilanciata (velocità vs dimensione)
        });

        let lastPercent = -1;

        archive.on('progress', (progress) => {
            const percent = Math.floor((progress.entries.processed / progress.entries.total) * 100);
            if (percent !== lastPercent && percent % 10 === 0) {
                console.log(`   ${percent}% completato (${progress.entries.processed}/${progress.entries.total} file)`);
                lastPercent = percent;
            }
        });

        output.on('close', () => {
            const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(1);
            console.log(`\n✅ ZIP creato: downloads-data.zip (${sizeMB} MB)`);

            // Pulizia dist/ dai file non necessari per la release
            console.log('\n🧹 Pulizia dist/...');
            cleanDist();

            // Mostra contenuto finale di dist/
            console.log('\n📂 Contenuto finale dist/:');
            const distFiles = fs.readdirSync(DIST_PATH).filter(f => {
                const stat = fs.statSync(path.join(DIST_PATH, f));
                return stat.isFile();
            });
            for (const f of distFiles) {
                const size = (fs.statSync(path.join(DIST_PATH, f)).size / 1024 / 1024).toFixed(1);
                console.log(`   📄 ${f} (${size} MB)`);
            }

            console.log('\n🚀 Build completato! Carica i file di dist/ su GitHub Releases.\n');
            resolve();
        });

        archive.on('error', (err) => {
            console.error('❌ Errore creazione zip:', err);
            reject(err);
        });

        archive.pipe(output);

        // Aggiunge tutta la cartella downloads mantenendo la struttura
        archive.directory(DOWNLOADS_PATH, 'downloads');

        archive.finalize();
    });
}

createDataZip().catch(err => {
    console.error('❌ Build data fallito:', err);
    process.exit(1);
});
