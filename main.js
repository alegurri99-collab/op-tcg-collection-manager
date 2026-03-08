const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { autoUpdater } = require('electron-updater');

// ============================================================================
// AUTO-UPDATER — controlla aggiornamenti su GitHub Releases all'avvio
// ============================================================================

function setupAutoUpdater() {
    // Non controllare in modalità sviluppo (electron . )
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = false; // Scarica solo se l'utente accetta
    autoUpdater.autoInstallOnAppQuit = true; // Installa alla chiusura

    // Aggiornamento disponibile → chiedi all'utente
    autoUpdater.on('update-available', (info) => {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Aggiornamento disponibile',
            message: `È disponibile la versione ${info.version} di OP TCG Collection Manager.\nVuoi scaricarla ora?`,
            buttons: ['Sì, scarica', 'Più tardi'],
            defaultId: 0,
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                autoUpdater.downloadUpdate();
                dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: 'Download in corso',
                    message: 'Il download è avviato in background.\nL\'app si aggiornerà automaticamente alla prossima chiusura.',
                    buttons: ['OK']
                });
            }
        });
    });

    // Nessun aggiornamento disponibile (silenzioso)
    autoUpdater.on('update-not-available', () => {
        console.log('✅ App aggiornata — nessun aggiornamento disponibile.');
    });

    // Errore durante il controllo (silenzioso in produzione)
    autoUpdater.on('error', (err) => {
        console.error('❌ Errore auto-updater:', err.message);
    });

    // Controlla aggiornamenti all'avvio (dopo 3 secondi per non rallentare il boot)
    setTimeout(() => {
        autoUpdater.checkForUpdates();
    }, 3000);
}

// ============================================================================
// DATA UPDATER — scarica e scompatta downloads-data.zip da GitHub Releases
// ============================================================================

const https = require('https');
const { createWriteStream, existsSync, mkdirSync } = require('fs');
const fsSync = require('fs');

// Percorso dove verranno estratti i dati delle carte (accanto all'exe installato)
function getDownloadsPath() {
    if (app.isPackaged) {
        // In produzione: cartella downloads accanto all'exe installato
        return path.join(path.dirname(app.getPath('exe')), 'downloads');
    } else {
        // In sviluppo: cartella downloads nella root del progetto
        return path.join(__dirname, '..', 'downloads');
    }
}

// Scarica un file da URL con progress callback
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const follow = (currentUrl) => {
            const protocol = currentUrl.startsWith('https') ? https : require('http');
            protocol.get(currentUrl, { headers: { 'User-Agent': 'OP-TCG-Updater' } }, (res) => {
                // Gestisci redirect
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
                    follow(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`Download fallito: HTTP ${res.statusCode}`));
                    return;
                }

                const total = parseInt(res.headers['content-length'] || '0', 10);
                let downloaded = 0;
                const file = createWriteStream(destPath);

                res.on('data', (chunk) => {
                    downloaded += chunk.length;
                    if (total > 0 && onProgress) {
                        onProgress(Math.floor((downloaded / total) * 100), downloaded, total);
                    }
                });

                res.pipe(file);
                file.on('finish', () => file.close(resolve));
                file.on('error', reject);
            }).on('error', reject);
        };
        follow(url);
    });
}

// Scompatta lo zip dei dati usando il modulo built-in di Node.js 18+
async function extractZip(zipPath, destDir) {
    // Usa PowerShell per estrarre (disponibile su tutti i Windows moderni)
    const { execFile } = require('child_process');
    return new Promise((resolve, reject) => {
        const args = [
            '-NoProfile', '-NonInteractive', '-Command',
            `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`
        ];
        execFile('powershell.exe', args, { timeout: 300000 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`Estrazione fallita: ${stderr || err.message}`));
            } else {
                resolve();
            }
        });
    });
}

// Controlla GitHub Releases per la versione più recente del data package
async function getLatestDataVersion() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/alegurri99-collab/op-tcg-collection-manager/releases',
            headers: { 'User-Agent': 'OP-TCG-Updater' }
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const releases = JSON.parse(data);
                    // Cerca la release che contiene downloads-data.zip
                    for (const release of releases) {
                        const asset = release.assets.find(a => a.name === 'downloads-data.zip');
                        if (asset) {
                            resolve({
                                tag: release.tag_name,
                                downloadUrl: asset.browser_download_url,
                                size: asset.size
                            });
                            return;
                        }
                    }
                    resolve(null); // Nessuna release con dati trovata
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// Versione dati correntemente installata (salvata in userData)
function getInstalledDataVersion() {
    try {
        const versionFile = path.join(app.getPath('userData'), 'data-version.json');
        const data = fsSync.readFileSync(versionFile, 'utf-8');
        return JSON.parse(data).version || null;
    } catch {
        return null;
    }
}

function saveInstalledDataVersion(version) {
    const versionFile = path.join(app.getPath('userData'), 'data-version.json');
    fsSync.writeFileSync(versionFile, JSON.stringify({ version }));
}

// Flusso principale: controlla e scarica dati se necessario
async function checkAndUpdateData() {
    if (!app.isPackaged) return; // Non eseguire in modalità sviluppo

    const downloadsPath = getDownloadsPath();
    const dataExists = existsSync(downloadsPath);
    const installedVersion = getInstalledDataVersion();

    let latestData = null;
    try {
        latestData = await getLatestDataVersion();
    } catch (e) {
        console.warn('⚠️ Impossibile controllare aggiornamenti dati:', e.message);
        if (!dataExists) {
            dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Dati carte non trovati',
                message: 'I dati delle carte non sono stati trovati e non è stato possibile connettersi a GitHub per scaricarli.\nVerifica la connessione internet e riavvia l\'app.',
                buttons: ['OK']
            });
        }
        return;
    }

    if (!latestData) {
        console.log('ℹ️ Nessun pacchetto dati trovato su GitHub Releases.');
        return;
    }

    const needsDownload = !dataExists || installedVersion !== latestData.tag;

    if (!needsDownload) {
        console.log(`✅ Dati carte aggiornati (${installedVersion})`);
        return;
    }

    const sizeMB = (latestData.size / 1024 / 1024).toFixed(0);
    const message = dataExists
        ? `È disponibile un aggiornamento dei dati carte (${latestData.tag}, ~${sizeMB} MB).\nVuoi scaricarli ora?`
        : `I dati delle carte non sono ancora installati (~${sizeMB} MB).\nVuoi scaricarli ora? (necessari per usare l'app)`;

    const result = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: dataExists ? 'Aggiornamento dati carte' : 'Dati carte richiesti',
        message,
        buttons: ['Sì, scarica', 'Più tardi'],
        defaultId: 0,
        cancelId: 1
    });

    if (result.response !== 0) return;

    // Mostra finestra di progresso
    let progressWin = new BrowserWindow({
        width: 420,
        height: 160,
        resizable: false,
        minimizable: false,
        maximizable: false,
        alwaysOnTop: true,
        frame: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false }
    });

    progressWin.loadURL(`data:text/html,
        <html><body style="font-family:sans-serif;background:#1a1a2e;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
        <div style="font-size:14px;margin-bottom:12px;">📦 Download dati carte in corso...</div>
        <div id="bar" style="width:100%;background:#333;border-radius:6px;overflow:hidden;height:20px;">
            <div id="fill" style="height:100%;background:#4CAF50;width:0%;transition:width 0.3s;"></div>
        </div>
        <div id="pct" style="margin-top:8px;font-size:13px;">0%</div>
        </body></html>`);

    const zipDest = path.join(app.getPath('temp'), 'downloads-data.zip');

    try {
        await downloadFile(latestData.downloadUrl, zipDest, (percent) => {
            if (!progressWin.isDestroyed()) {
                progressWin.webContents.executeJavaScript(
                    `document.getElementById('fill').style.width='${percent}%';
                     document.getElementById('pct').textContent='${percent}%';`
                ).catch(() => {});
            }
        });

        if (!progressWin.isDestroyed()) {
            progressWin.webContents.executeJavaScript(
                `document.getElementById('pct').textContent='Estrazione in corso...';`
            ).catch(() => {});
        }

        // Estrai nella cartella corretta
        const extractDest = path.dirname(downloadsPath); // cartella padre di downloads/
        await extractZip(zipDest, extractDest);

        // Pulisci zip temporaneo
        fsSync.unlinkSync(zipDest);

        // Salva versione installata
        saveInstalledDataVersion(latestData.tag);

        if (!progressWin.isDestroyed()) progressWin.close();
        progressWin = null;

        await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Download completato',
            message: '✅ Dati carte installati correttamente!\nRiavvia l\'app per applicare le modifiche.',
            buttons: ['Riavvia ora']
        });

        app.relaunch();
        app.exit(0);

    } catch (err) {
        if (!progressWin.isDestroyed()) progressWin.close();
        console.error('❌ Errore download dati:', err);
        await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Errore download',
            message: `Si è verificato un errore durante il download:\n${err.message}\nRiprova più tardi.`,
            buttons: ['OK']
        });
    }
}




let mainWindow;

// ============================================================================
// PRICE STORAGE - JSON-based (storico + latest)
// ============================================================================
// File: price-snapshots.json → array di tutti i fetch (storico completo)
// File: price-latest.json    → oggetto { "cardKey:source" → ultimo dato }

let priceSnapshots = null; // array caricato in memoria
let priceLatest = null;    // oggetto caricato in memoria

function getPriceSnapshotsPath() {
    return path.join(app.getPath('userData'), 'price-snapshots.json');
}
function getPriceLatestPath() {
    return path.join(app.getPath('userData'), 'price-latest.json');
}

async function loadPriceStore() {
    if (priceSnapshots !== null && priceLatest !== null) return; // già caricato

    // Carica snapshots
    if (priceSnapshots === null) {
        try {
            const data = await fs.readFile(getPriceSnapshotsPath(), 'utf-8');
            priceSnapshots = JSON.parse(data);
        } catch {
            priceSnapshots = [];
        }
    }
    // Carica latest
    if (priceLatest === null) {
        try {
            const data = await fs.readFile(getPriceLatestPath(), 'utf-8');
            priceLatest = JSON.parse(data);
        } catch {
            priceLatest = {};
        }
        // Migra dati dal vecchio price-cache.json se esiste e latest è vuoto
        if (Object.keys(priceLatest).length === 0) {
            try {
                const oldCachePath = path.join(app.getPath('userData'), 'price-cache.json');
                const oldData = await fs.readFile(oldCachePath, 'utf-8');
                const oldCache = JSON.parse(oldData);
                for (const [cardKey, entry] of Object.entries(oldCache)) {
                    const key = `${cardKey}:cardmarket`;
                    priceLatest[key] = {
                        card_key: cardKey,
                        source: 'cardmarket',
                        fetched_at: entry.cachedAt || new Date().toISOString(),
                        data: entry.data
                    };
                    priceSnapshots.push({
                        card_key: cardKey,
                        source: 'cardmarket',
                        fetched_at: entry.cachedAt || new Date().toISOString(),
                        data: entry.data
                    });
                }
                console.log(`📦 Migrated ${Object.keys(oldCache).length} entries from price-cache.json`);
            } catch { /* no old cache, skip */ }
        }
    }

    // Dedup esistenti: rimuovi snapshot con stessi dati consecutivi per card
    const beforeCount = priceSnapshots.length;
    priceSnapshots = deduplicateSnapshots(priceSnapshots);
    if (priceSnapshots.length < beforeCount) {
        console.log(`🧹 Dedup: rimossi ${beforeCount - priceSnapshots.length} doppioni (${beforeCount} → ${priceSnapshots.length})`);
        await savePriceStore();
    }

    console.log(`💾 Price store: ${priceSnapshots.length} snapshots, ${Object.keys(priceLatest).length} latest`);
}

// Confronta due snapshot: true se i dati di mercato sono identici
function isSameMarketData(a, b) {
    if (!a || !b || !a.data || !b.data) return false;
    const labelsA = JSON.stringify(a.data.chartLabels || []);
    const labelsB = JSON.stringify(b.data.chartLabels || []);
    const dataA = JSON.stringify(a.data.chartData || []);
    const dataB = JSON.stringify(b.data.chartData || []);
    return labelsA === labelsB && dataA === dataB;
}

// Rimuovi doppioni: per ogni card+source, tieni solo snapshot con dati diversi
function deduplicateSnapshots(snapshots) {
    // Ordina per card_key, source, fetched_at
    const sorted = [...snapshots].sort((a, b) => {
        const keyA = `${a.card_key}:${a.source}`;
        const keyB = `${b.card_key}:${b.source}`;
        if (keyA !== keyB) return keyA.localeCompare(keyB);
        return new Date(a.fetched_at) - new Date(b.fetched_at);
    });

    const result = [];
    let prev = null;
    for (const snap of sorted) {
        const sameCard = prev && prev.card_key === snap.card_key && prev.source === snap.source;
        if (sameCard && isSameMarketData(prev, snap)) {
            // Doppione: aggiorna solo il timestamp del precedente (tieni il più recente)
            prev.fetched_at = snap.fetched_at;
            continue;
        }
        result.push(snap);
        prev = snap;
    }
    return result;
}

async function savePriceStore() {
    await fs.writeFile(getPriceSnapshotsPath(), JSON.stringify(priceSnapshots, null, 2));
    await fs.writeFile(getPriceLatestPath(), JSON.stringify(priceLatest, null, 2));
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: path.join(__dirname, 'assets', 'icon.png')
    });

    mainWindow.loadFile('index.html');
}
app.whenReady().then(() => {
    createWindow();
    setupAutoUpdater();
});

app.whenReady().then(async () => {
    createWindow();
    setupAutoUpdater();
    // Controlla dati carte dopo 5 secondi (lascia caricare la finestra)
    setTimeout(() => checkAndUpdateData(), 5000);
});


app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});







// IPC Handlers

// Seleziona cartella database
ipcMain.handle('select-database-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Seleziona cartella downloads del database carte'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// Scansiona database carte
ipcMain.handle('scan-database', async (event, databasePath) => {
    try {
        const cards = await scanCardsDatabase(databasePath);
        return { success: true, cards };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Carica immagine prodotto per espansione
ipcMain.handle('load-expansion-product-image', async (event, databasePath, language, expansion) => {
    try {
        console.log('🔍 Loading product image for:', { databasePath, language, expansion });
        
        // 🆕 NUOVA STRUTTURA CENTRALIZZATA: prova prima qui
        // Estrai codice serie (es: [OP-07] o 【OP-07】)
        const codeMatch = expansion.match(/[\[\【]([^\]\】]+)[\]\】]/);
        
        if (codeMatch) {
            const seriesCode = codeMatch[1]; // Es: "OP-07"
            const centralizedPath = path.join(databasePath, 'product_images', seriesCode);
            
            console.log('📁 Checking centralized path:', centralizedPath);
            
            try {
                await fs.access(centralizedPath);
                const files = await fs.readdir(centralizedPath);
                console.log('📂 Files found in centralized:', files);
                
                // Cerca primo file mv_* (case-insensitive)
                const mvImage = files.find(f => f.toLowerCase().startsWith('mv_'));
                
                if (mvImage) {
                    const fullPath = path.join(centralizedPath, mvImage);
                    console.log('✅ Found image in centralized:', fullPath);
                    
                    return { 
                        success: true, 
                        imagePath: fullPath
                    };
                }
            } catch (err) {
                console.log('⚠️ Centralized product_images not found, trying legacy...');
            }
        }
        
        // 🔄 FALLBACK LEGACY: struttura vecchia (per retrocompatibilità)
        const productImagesPath = path.join(databasePath, language, expansion, 'product_images');
        console.log('📁 Checking legacy path:', productImagesPath);
        
        try {
            await fs.access(productImagesPath);
        } catch (err) {
            console.log('⚠️ Legacy product_images folder not found');
            return { success: false, error: 'Folder not found' };
        }
        
        const files = await fs.readdir(productImagesPath);
        console.log('📂 Files found in legacy:', files);
        
        // Cerca primo file mv_* (case-insensitive)
        const mvImage = files.find(f => f.toLowerCase().startsWith('mv_'));
        
        if (mvImage) {
            const fullPath = path.join(productImagesPath, mvImage);
            console.log('✅ Found image in legacy:', fullPath);
            
            return { 
                success: true, 
                imagePath: fullPath
            };
        }
        
        console.log('⚠️ No mv_* files found');
        return { success: false, error: 'No mv_* files' };
    } catch (error) {
        console.error('❌ Error loading product image:', error);
        return { success: false, error: error.message };
    }
});

// Carica immagine di sfondo per gioco (game_backgrounds)
ipcMain.handle('load-game-background', async (event, downloadsPath, gameName) => {
    try {
        console.log('🎮 Loading game background for:', { downloadsPath, gameName });
        
        const gameBackgroundsPath = path.join(downloadsPath, 'game_backgrounds');
        
        console.log('📁 Checking game backgrounds path:', gameBackgroundsPath);
        
        try {
            await fs.access(gameBackgroundsPath);
            const files = await fs.readdir(gameBackgroundsPath);
            console.log('📂 Files found:', files);
            
            // Cerca file che inizia con il nome del gioco (case-insensitive)
            // Supporta: "ONE PIECE.jpg", "ONE PIECE.png", etc.
            const backgroundFile = files.find(f => {
                const nameWithoutExt = path.parse(f).name.toLowerCase();
                return nameWithoutExt === gameName.toLowerCase();
            });
            
            if (backgroundFile) {
                const fullPath = path.join(gameBackgroundsPath, backgroundFile);
                console.log('✅ Found game background:', fullPath);
                
                return { 
                    success: true, 
                    imagePath: fullPath
                };
            }
            
            console.log('⚠️ No background file found for game:', gameName);
            return { success: false, error: 'No background file found' };
        } catch (err) {
            console.log('⚠️ Game backgrounds folder not found:', err.message);
            return { success: false, error: 'Folder not found' };
        }
    } catch (error) {
        console.error('❌ Error loading game background:', error);
        return { success: false, error: error.message };
    }
});

// Carica wallpaper per espansione (SET_Wallpaper)
ipcMain.handle('load-expansion-wallpaper', async (event, databasePath, expansion) => {
    try {
        console.log('🖼️ Loading wallpaper for:', { databasePath, expansion });
        
        // Estrai codice serie (es: [OP-13] o 【OP-13】)
        const codeMatch = expansion.match(/[\[\【]([^\]\】]+)[\]\】]/);
        
        if (!codeMatch) {
            console.log('⚠️ No series code found in expansion name');
            return { success: false, error: 'No series code in expansion name' };
        }
        
        const seriesCode = codeMatch[1]; // Es: "OP-13"
        const wallpaperPath = path.join(databasePath, 'product_images', seriesCode);
        
        console.log('📁 Checking wallpaper path:', wallpaperPath);
        
        try {
            await fs.access(wallpaperPath);
            const files = await fs.readdir(wallpaperPath);
            console.log('📂 Files found:', files);
            
            // Cerca file con "SET_Wallpaper" nel nome (case-insensitive)
            const wallpaperFile = files.find(f => f.toLowerCase().includes('set_wallpaper'));
            
            if (wallpaperFile) {
                const fullPath = path.join(wallpaperPath, wallpaperFile);
                console.log('✅ Found wallpaper:', fullPath);
                
                return { 
                    success: true, 
                    wallpaperPath: fullPath
                };
            }
            
            console.log('⚠️ No SET_Wallpaper file found');
            return { success: false, error: 'No SET_Wallpaper file' };
        } catch (err) {
            console.log('⚠️ Wallpaper folder not found:', err.message);
            return { success: false, error: 'Folder not found' };
        }
    } catch (error) {
        console.error('❌ Error loading wallpaper:', error);
        return { success: false, error: error.message };
    }
});

// Carica collezione
ipcMain.handle('load-collection', async () => {
    try {
        const collectionPath = path.join(app.getPath('userData'), 'collection.json');
        const data = await fs.readFile(collectionPath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        return {}; // Collezione vuota se file non esiste
    }
});

// Salva collezione
ipcMain.handle('save-collection', async (event, collection) => {
    try {
        const collectionPath = path.join(app.getPath('userData'), 'collection.json');
        await fs.writeFile(collectionPath, JSON.stringify(collection, null, 2));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Carica settings
ipcMain.handle('load-settings', async () => {
    // Path automatico: 2 livelli su da __dirname + downloads\ONE PIECE
    const autoDbPath = path.join(__dirname, '..', 'downloads', 'ONE PIECE');

    try {
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        const data = await fs.readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(data);

        // Se il path salvato non esiste più, usa quello automatico
        try {
            await fs.access(settings.databasePath);
        } catch {
            console.log('⚠️ Saved databasePath not found, switching to auto path:', autoDbPath);
            settings.databasePath = autoDbPath;
        }

        return settings;
    } catch (error) {
        // Nessun settings salvato: usa path automatico
        console.log('ℹ️ No settings found, using auto databasePath:', autoDbPath);
        return { databasePath: autoDbPath };
    }
});

// Salva settings
ipcMain.handle('save-settings', async (event, settings) => {
    try {
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Carica card links (Cardmarket, TCGPlayer)
ipcMain.handle('load-card-links', async () => {
    try {
        const linksPath = path.join(app.getPath('userData'), 'card-links.json');
        const data = await fs.readFile(linksPath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        return {}; // Nessun link salvato
    }
});

// Salva card links
ipcMain.handle('save-card-links', async (event, cardLinks) => {
    try {
        const linksPath = path.join(app.getPath('userData'), 'card-links.json');
        await fs.writeFile(linksPath, JSON.stringify(cardLinks, null, 2));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================================================
// VINTED LISTINGS - gestione inserzioni e stock
// ============================================================================
// File: vinted-listings.json
// Struttura:
// {
//   "listingId": {
//     "id": "listingId",               ← UUID locale
//     "cardKey": "LANG:EXP:ID",        ← chiave carta
//     "vintedUrl": "https://vinted...", ← URL inserzione
//     "vintedItemId": "123456",         ← ID numerico estratto dall'URL
//     "price": 5.00,                    ← prezzo inserzione (€)
//     "status": "active"|"sold"|"removed",
//     "createdAt": "ISO date",
//     "soldAt": null|"ISO date"
//   }
// }

function getVintedListingsPath() {
    return path.join(app.getPath('userData'), 'vinted-listings.json');
}

async function loadVintedListingsFromDisk() {
    try {
        const data = await fs.readFile(getVintedListingsPath(), 'utf-8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

async function saveVintedListingsToDisk(listings) {
    await fs.writeFile(getVintedListingsPath(), JSON.stringify(listings, null, 2));
}

// Carica tutte le inserzioni Vinted
ipcMain.handle('load-vinted-listings', async () => {
    return await loadVintedListingsFromDisk();
});

// Salva tutte le inserzioni Vinted
ipcMain.handle('save-vinted-listings', async (event, listings) => {
    try {
        await saveVintedListingsToDisk(listings);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Aggiungi / aggiorna singola inserzione
ipcMain.handle('upsert-vinted-listing', async (event, listing) => {
    try {
        const listings = await loadVintedListingsFromDisk();
        listings[listing.id] = listing;
        await saveVintedListingsToDisk(listings);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Marca inserzione come venduta → scala collection per ogni item della lista
ipcMain.handle('mark-vinted-sold', async (event, listingId) => {
    try {
        const listings = await loadVintedListingsFromDisk();
        const listing = listings[listingId];
        if (!listing) return { success: false, error: 'Inserzione non trovata' };

        // Aggiorna stato inserzione
        listing.status = 'sold';
        listing.soldAt = new Date().toISOString();
        listings[listingId] = listing;
        await saveVintedListingsToDisk(listings);

        // Carica collection
        const collectionPath = path.join(app.getPath('userData'), 'collection.json');
        let collection = {};
        try {
            const data = await fs.readFile(collectionPath, 'utf-8');
            collection = JSON.parse(data);
        } catch { /* collection vuota */ }

        // Scala ogni item della lista (struttura multi-carta)
        const items = listing.items || [];
        const newQuantities = {};

        if (items.length > 0) {
            // Struttura nuova: lista di { cardKey, qty, unitPrice }
            for (const item of items) {
                if (!item.cardKey) continue;
                const current = collection[item.cardKey] || 0;
                const toRemove = item.qty || 1;
                const newQty = current - toRemove;
                if (newQty <= 0) {
                    delete collection[item.cardKey];
                    newQuantities[item.cardKey] = 0;
                } else {
                    collection[item.cardKey] = newQty;
                    newQuantities[item.cardKey] = newQty;
                }
            }
        } else if (listing.cardKey) {
            // Compatibilità con struttura vecchia (singola carta)
            const current = collection[listing.cardKey] || 0;
            if (current <= 1) {
                delete collection[listing.cardKey];
                newQuantities[listing.cardKey] = 0;
            } else {
                collection[listing.cardKey] = current - 1;
                newQuantities[listing.cardKey] = current - 1;
            }
        }

        await fs.writeFile(collectionPath, JSON.stringify(collection, null, 2));

        return { success: true, newQuantities };
    } catch (error) {
        return { success: false, error: error.message };
    }
});


// Controlla stato singola inserzione Vinted → legge la pagina item e cerca il div "venduto"
// Restituisce: { success, sold, price }
// sold = true se trova il div .web_ui__Cell__success nel sidebar
// price = il prezzo estratto dal selettore pricing (se trovato)
ipcMain.handle('check-vinted-listing-status', async (event, vintedUrl) => {
    if (!vintedUrl || !vintedUrl.includes('vinted.')) {
        return { success: false, error: 'URL Vinted non valido' };
    }

    let hiddenWin = null;
    try {
        hiddenWin = new BrowserWindow({
            width: 1280,
            height: 900,
            show: false,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true
            }
        });

        hiddenWin.webContents.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        );

        await hiddenWin.loadURL(vintedUrl);
        // Attesa caricamento pagina + rendering
        await new Promise(resolve => setTimeout(resolve, 4000));

        const result = await hiddenWin.webContents.executeJavaScript(`
            (function() {
                // Selettore ESATTO "venduto" fornito dall'utente
                const soldEl = document.querySelector(
                    '#sidebar > div.item-page-sidebar-content > div:nth-child(1) > div > div.web_ui__Cell__cell.web_ui__Cell__default.web_ui__Cell__success'
                );

                // Selettore ESATTO prezzo fornito dall'utente
                const priceEl = document.querySelector(
                    '#sidebar > div.item-page-sidebar-content > div:nth-child(1) > div > div:nth-child(2) > div > div > div > div.details-list--main-info > div.details-list--pricing > div:nth-child(1) > div'
                );

                const sold = !!soldEl;
                let price = null;
                if (priceEl) {
                    // Estrae solo cifre, virgola e punto; converte virgola decimale in punto
                    const raw = priceEl.textContent.replace(/[^0-9,.]/g, '').replace(',', '.').trim();
                    price = parseFloat(raw) || null;
                }

                // Debug info per console Electron
                console.log('[Vinted Check] sold:', sold, '| soldEl:', soldEl ? soldEl.outerHTML.substring(0, 100) : 'null');
                console.log('[Vinted Check] priceEl text:', priceEl ? priceEl.textContent : 'null', '| price:', price);

                return { sold, price };
            })()
        `);

        hiddenWin.close();
        hiddenWin = null;

        return { success: true, sold: result.sold, price: result.price };
    } catch (error) {
        console.error('❌ Errore check Vinted listing:', error);
        if (hiddenWin) { try { hiddenWin.close(); } catch(e) {} }
        return { success: false, error: error.message };
    }
});




// Fetch prezzi da Cardmarket via BrowserWindow nascosta
ipcMain.handle('fetch-cardmarket-prices', async (event, url) => {
    if (!url || !url.includes('cardmarket.com')) {
        return { success: false, error: 'URL Cardmarket non valido' };
    }

    let hiddenWin = null;
    try {
        hiddenWin = new BrowserWindow({
            width: 1280,
            height: 900,
            show: false,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true
            }
        });

        // User-agent reale per evitare blocchi
        hiddenWin.webContents.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        );

        // Naviga e attendi caricamento completo
        await hiddenWin.loadURL(url);
        // Attendi che Chart.js renderizzi il grafico
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Estrai dati dalla pagina
        const data = await hiddenWin.webContents.executeJavaScript(`
            (function() {
                const result = {
                    chartLabels: [],
                    chartData: [],
                    priceInfo: {},
                    productName: '',
                    imageUrl: ''
                };

                // 1) Estrai dati del grafico dallo script inline
                const chartScript = document.querySelector('script.chart-init-script');
                if (chartScript) {
                    const scriptText = chartScript.textContent;
                    // Estrai labels
                    const labelsMatch = scriptText.match(/"labels":\\[([^\\]]+)\\]/);
                    if (labelsMatch) {
                        result.chartLabels = JSON.parse('[' + labelsMatch[1] + ']');
                    }
                    // Estrai data (primo dataset)
                    const dataMatch = scriptText.match(/"data":\\[([\\d.,\\s]+)\\]/);
                    if (dataMatch) {
                        result.chartData = dataMatch[1].split(',').map(v => parseFloat(v.trim()));
                    }
                }

                // 2) Estrai info prezzi dalla tabella
                const dtElements = document.querySelectorAll('#tabContent-info dl.labeled dt');
                dtElements.forEach(dt => {
                    const dd = dt.nextElementSibling;
                    if (!dd) return;
                    const label = dt.textContent.trim();
                    const value = dd.textContent.trim();

                    if (label.includes('Da')) result.priceInfo.priceFrom = value;
                    if (label.includes('Tendenza')) result.priceInfo.priceTrend = value;
                    if (label.includes('30 giorni')) result.priceInfo.avg30 = value;
                    if (label.includes('7 giorni')) result.priceInfo.avg7 = value;
                    if (label.includes('1 giorno')) result.priceInfo.avg1 = value;
                    if (label.includes('Articoli')) result.priceInfo.availableItems = value;
                    if (label.includes('Rarità')) result.priceInfo.rarity = value;
                });

                // 3) Nome prodotto e immagine
                const titleEl = document.querySelector('h1');
                if (titleEl) result.productName = titleEl.textContent.trim();

                const imgEl = document.querySelector('#tabContent-info img.is-front');
                if (imgEl) result.imageUrl = imgEl.src;

                return result;
            })()
        `);

        hiddenWin.close();
        hiddenWin = null;

        return {
            success: true,
            data: data,
            fetchedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('❌ Errore fetch Cardmarket:', error);
        if (hiddenWin) {
            try { hiddenWin.close(); } catch(e) {}
        }
        return { success: false, error: error.message };
    }
});

// ============================================================================
// PRICE DATABASE - JSON-based con storico completo
// ============================================================================

// Salva prezzo in database (storico + latest)
ipcMain.handle('save-price-data', async (event, cardKey, priceData, source = 'cardmarket') => {
    try {
        await loadPriceStore();
        const now = new Date().toISOString();

        const snapshot = {
            card_key: cardKey,
            source: source,
            fetched_at: now,
            data: {
                chartLabels: priceData.chartLabels || [],
                chartData: priceData.chartData || [],
                priceInfo: priceData.priceInfo || {},
                productName: priceData.productName || null,
                imageUrl: priceData.imageUrl || null
            }
        };

        // Check doppione: confronta con ultimo snapshot della stessa carta
        const lastSnap = priceSnapshots
            .filter(s => s.card_key === cardKey && s.source === source)
            .sort((a, b) => new Date(b.fetched_at) - new Date(a.fetched_at))[0];

        if (lastSnap && isSameMarketData(lastSnap, snapshot)) {
            // Dati identici → aggiorna solo timestamp del latest, no nuovo storico
            const latestKey = `${cardKey}:${source}`;
            priceLatest[latestKey] = snapshot;
            await savePriceStore();
            console.log(`♻️ Price unchanged for ${cardKey} — updated timestamp only`);
            return { success: true, savedAt: now, duplicate: true };
        }

        // Dati nuovi → aggiungi allo storico + aggiorna latest
        priceSnapshots.push(snapshot);
        const latestKey = `${cardKey}:${source}`;
        priceLatest[latestKey] = snapshot;

        await savePriceStore();
        console.log(`💾 Price saved for ${cardKey} (${source}) — new data point`);
        return { success: true, savedAt: now, duplicate: false };
    } catch (error) {
        console.error('❌ Error saving price:', error);
        return { success: false, error: error.message };
    }
});

// Carica ultimo prezzo per una carta
ipcMain.handle('load-price-latest', async (event, cardKey, source = 'cardmarket') => {
    try {
        await loadPriceStore();
        const latestKey = `${cardKey}:${source}`;
        const entry = priceLatest[latestKey];
        if (!entry) return null;

        return {
            card_key: entry.card_key,
            source: entry.source,
            fetched_at: entry.fetched_at,
            chartLabels: entry.data.chartLabels || [],
            chartData: entry.data.chartData || [],
            priceInfo: entry.data.priceInfo || {}
        };
    } catch (error) {
        console.error('❌ Error loading latest price:', error);
        return null;
    }
});

// Carica storico prezzi per una carta
ipcMain.handle('load-price-history', async (event, cardKey, source = 'cardmarket', limit = 100) => {
    try {
        await loadPriceStore();
        const filtered = priceSnapshots
            .filter(s => s.card_key === cardKey && s.source === source)
            .sort((a, b) => new Date(b.fetched_at) - new Date(a.fetched_at))
            .slice(0, limit);

        return filtered.map(entry => ({
            card_key: entry.card_key,
            source: entry.source,
            fetched_at: entry.fetched_at,
            chartLabels: entry.data.chartLabels || [],
            chartData: entry.data.chartData || [],
            priceInfo: entry.data.priceInfo || {}
        }));
    } catch (error) {
        console.error('❌ Error loading price history:', error);
        return [];
    }
});

// Carica tutti gli ultimi prezzi (per portfolio)
ipcMain.handle('load-all-latest-prices', async () => {
    try {
        await loadPriceStore();
        const result = {};
        for (const [key, entry] of Object.entries(priceLatest)) {
            result[key] = {
                card_key: entry.card_key,
                source: entry.source,
                fetched_at: entry.fetched_at,
                chartLabels: entry.data.chartLabels || [],
                chartData: entry.data.chartData || [],
                priceInfo: entry.data.priceInfo || {}
            };
        }
        return result;
    } catch (error) {
        console.error('❌ Error loading all prices:', error);
        return {};
    }
});

// Statistiche database prezzi
ipcMain.handle('get-price-stats', async () => {
    try {
        await loadPriceStore();
        const cardKeys = new Set(priceSnapshots.map(s => s.card_key));
        const dates = priceSnapshots.map(s => s.fetched_at).sort();
        return {
            totalSnapshots: priceSnapshots.length,
            uniqueCards: cardKeys.size,
            firstFetch: dates[0] || null,
            lastFetch: dates[dates.length - 1] || null
        };
    } catch (error) {
        return { totalSnapshots: 0, uniqueCards: 0, firstFetch: null, lastFetch: null };
    }
});

// Open external URL in system browser
ipcMain.handle('open-external-link', async (event, url) => {
    try {
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            await shell.openExternal(url);
            return { success: true };
        }
        return { success: false, error: 'Invalid URL' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================================================
// DATABASE SCAN - Ottimizzato con batch parallelo + indice ENG pre-caricato
// ============================================================================

// Concurrency limiter: esegue max N promise in parallelo
async function parallelMap(items, fn, concurrency = 20) {
    const results = [];
    let index = 0;

    async function worker() {
        while (index < items.length) {
            const i = index++;
            results[i] = await fn(items[i], i);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

// Pre-carica indice ENG: mappa { baseCardId → fullPath al .json }
// Costruito una volta sola, usato come fallback O(1) per tutte le lingue non-ENG
async function buildEngMetadataIndex(databasePath) {
    const engIndex = {}; // { "OP01-001" → "C:\...\ENG\[OP-01]...\metadata\OP01-001.json" }
    const engPath = path.join(databasePath, 'ENG');

    try {
        await fs.access(engPath);
    } catch {
        return engIndex; // Nessuna cartella ENG
    }

    const engExpansions = await fs.readdir(engPath);

    for (const engExp of engExpansions) {
        const engExpPath = path.join(engPath, engExp);
        try {
            const stat = await fs.stat(engExpPath);
            if (!stat.isDirectory()) continue;
        } catch { continue; }

        const metadataDir = path.join(engExpPath, 'metadata');
        try {
            await fs.access(metadataDir);
        } catch { continue; }

        const jsonFiles = await fs.readdir(metadataDir);
        for (const file of jsonFiles) {
            if (!file.endsWith('.json')) continue;
            const cardId = file.slice(0, -5); // rimuovi .json
            engIndex[cardId] = path.join(metadataDir, file);
        }
    }

    console.log(`📇 Indice ENG costruito: ${Object.keys(engIndex).length} metadata`);
    return engIndex;
}

// Carica tutti i metadata di un'espansione in batch parallelo
// Ritorna mappa { cardId → metadata object }
async function loadExpansionMetadataBatch(langPath, expDir, cardIds, engIndex, currentLang) {
    const metadataDir = path.join(langPath, expDir, 'metadata');
    const metadataMap = {};

    // Leggi tutti i JSON in parallelo (max 30 concurrent I/O)
    await parallelMap(cardIds, async (cardId) => {
        // 1) Prova lingua corrente
        const filePath = path.join(metadataDir, `${cardId}.json`);
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            metadataMap[cardId] = JSON.parse(data);
            return;
        } catch { /* non trovato, prova fallback */ }

        // 2) Fallback ENG via indice pre-caricato (O(1) lookup)
        if (currentLang !== 'ENG' && engIndex) {
            const baseCardId = cardId.replace(/_p\d+$/, '');
            const engPath = engIndex[baseCardId];
            if (engPath) {
                try {
                    const engData = await fs.readFile(engPath, 'utf-8');
                    metadataMap[cardId] = JSON.parse(engData);
                    return;
                } catch { /* file corrotto o rimosso */ }
            }
        }

        metadataMap[cardId] = null;
    }, 30);

    return metadataMap;
}

// Funzione principale per scansionare il database
async function scanCardsDatabase(databasePath) {
    const startTime = Date.now();
    const database = {
        languages: {},
        totalCards: 0
    };

    // STEP 1: Pre-carica indice metadata ENG (una sola volta)
    const engIndex = await buildEngMetadataIndex(databasePath);

    // STEP 2: Leggi le cartelle delle lingue (es: JAP, ENG, ITA)
    const languageDirs = await fs.readdir(databasePath);

    for (const langDir of languageDirs) {
        const langPath = path.join(databasePath, langDir);
        const stats = await fs.stat(langPath);

        if (!stats.isDirectory()) continue;

        // Skip non-language folders (like product_images, game_backgrounds)
        if (langDir === 'product_images' || langDir === 'game_backgrounds') continue;

        database.languages[langDir] = {
            name: langDir,
            expansions: {},
            totalCards: 0
        };

        // Leggi le espansioni
        const expansionDirs = await fs.readdir(langPath);

        for (const expDir of expansionDirs) {
            const expPath = path.join(langPath, expDir);
            const expStats = await fs.stat(expPath);

            if (!expStats.isDirectory()) continue;

            // Leggi le carte dell'espansione
            const files = await fs.readdir(expPath);
            const imageFiles = files.filter(file => file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.webp'));

            if (imageFiles.length === 0) continue;

            // Estrai tutti i cardId
            const cardIds = imageFiles.map(file => path.parse(file).name);

            // STEP 3: Carica TUTTI i metadata dell'espansione in parallelo
            const metadataMap = await loadExpansionMetadataBatch(
                langPath, expDir, cardIds, engIndex, langDir
            );

            // Costruisci array carte
            const cards = imageFiles.map(file => {
                const cardId = path.parse(file).name;
                const metadata = metadataMap[cardId] || null;

                return {
                    id: cardId,
                    filename: file,
                    path: path.join(expPath, file),
                    relativePath: path.join(langDir, expDir, file),
                    metadata: metadata,
                    name: metadata ? (metadata.name || null) : null,
                    cardIdBase: metadata ? (metadata.card_id || null) : null
                };
            });

            database.languages[langDir].expansions[expDir] = {
                name: expDir,
                cards: cards,
                totalCards: cards.length
            };

            database.languages[langDir].totalCards += cards.length;
            database.totalCards += cards.length;
        }
    }

    const elapsed = Date.now() - startTime;
    console.log(`⚡ Database scan completato: ${database.totalCards} carte in ${elapsed}ms`);
    return database;
}
