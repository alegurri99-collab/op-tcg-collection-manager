const { contextBridge, ipcRenderer } = require('electron');

// Espone API sicure al renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Database
    selectDatabaseFolder: () => ipcRenderer.invoke('select-database-folder'),
    scanDatabase: (path) => ipcRenderer.invoke('scan-database', path),
    
    // Immagine prodotto espansione
    loadExpansionProductImage: (databasePath, language, expansion) =>
        ipcRenderer.invoke('load-expansion-product-image', databasePath, language, expansion),
    
    // Wallpaper espansione (SET_Wallpaper)
    loadExpansionWallpaper: (databasePath, expansion) =>
        ipcRenderer.invoke('load-expansion-wallpaper', databasePath, expansion),
    
    // Immagine di sfondo gioco
    loadGameBackground: (downloadsPath, gameName) =>
        ipcRenderer.invoke('load-game-background', downloadsPath, gameName),
    
    // Collezione
    loadCollection: () => ipcRenderer.invoke('load-collection'),
    saveCollection: (collection) => ipcRenderer.invoke('save-collection', collection),
    
    // Card Links (Cardmarket, TCGPlayer)
    loadCardLinks: () => ipcRenderer.invoke('load-card-links'),
    saveCardLinks: (cardLinks) => ipcRenderer.invoke('save-card-links', cardLinks),
    
    // Open external URL in system browser
    openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
    
    // Cardmarket price fetching
    fetchCardmarketPrices: (url) => ipcRenderer.invoke('fetch-cardmarket-prices', url),
    
    // Price database (SQLite)
    savePriceData: (cardKey, priceData, source) => ipcRenderer.invoke('save-price-data', cardKey, priceData, source),
    loadPriceLatest: (cardKey, source) => ipcRenderer.invoke('load-price-latest', cardKey, source),
    loadPriceHistory: (cardKey, source, limit) => ipcRenderer.invoke('load-price-history', cardKey, source, limit),
    loadAllLatestPrices: () => ipcRenderer.invoke('load-all-latest-prices'),
    getPriceStats: () => ipcRenderer.invoke('get-price-stats'),
    
    // Settings
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    
    // Vinted Listings
    loadVintedListings: () => ipcRenderer.invoke('load-vinted-listings'),
    saveVintedListings: (listings) => ipcRenderer.invoke('save-vinted-listings', listings),
    upsertVintedListing: (listing) => ipcRenderer.invoke('upsert-vinted-listing', listing),
    markVintedSold: (listingId) => ipcRenderer.invoke('mark-vinted-sold', listingId),
    checkVintedListingStatus: (vintedUrl) => ipcRenderer.invoke('check-vinted-listing-status', vintedUrl),
    
    // Path helper per immagini
    getCardImagePath: (databasePath, relativePath) => {
        return `file:///${databasePath}/${relativePath}`.replace(/\\/g, '/');
    }
});

