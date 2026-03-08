// ==================================================
// ONE PIECE TCG COLLECTION MANAGER - RENDERER
// Modern Multi-Page Architecture with Routing
// ==================================================

// === APPLICATION STATE ===
let appState = {
    // Database
    database: null,
    collection: {},
    cardLinks: {},
    settings: {},
    
    // Navigation
    currentPage: 'sets',
    navigationHistory: [],
    
    // Current Selection
    selectedLanguage: null,
    selectedExpansion: null,
    
    // Filters
    searchQuery: '',
    currentFilter: 'all', // all, owned, missing
    expansionSearchQuery: '',
    
    // UI State
    currentCard: null
};

// Global listener reference for 3D card effect cleanup
let globalCardHoloListener = null;

// === PAGE MANAGER ===
const pageManager = {
    showPage(pageId) {
        // Hide all pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
            page.classList.add('hidden');
        });
        
        // Show target page
        const targetPage = document.getElementById(`page-${pageId}`);
        if (targetPage) {
            targetPage.classList.remove('hidden');
            targetPage.classList.add('active');
            appState.currentPage = pageId;
        }
    },
    
    navigateTo(page, data = {}) {
        // Save current state to history
        appState.navigationHistory.push({
            page: appState.currentPage,
            data: {
                language: appState.selectedLanguage,
                expansion: appState.selectedExpansion
            }
        });
        
        // Update state
        Object.assign(appState, data);
        
        // Show page
        this.showPage(page);
    },
    
    goBack() {
        if (appState.navigationHistory.length > 0) {
            const previous = appState.navigationHistory.pop();
            
            // Restore previous state
            appState.selectedLanguage = previous.data.language;
            appState.selectedExpansion = previous.data.expansion;
            
            // Show previous page
            this.showPage(previous.page);
            
            // Re-render if needed
            if (previous.page === 'expansions') {
                renderExpansionsPage();
            } else if (previous.page === 'cards') {
                renderCardsPage();
            }
        }
    }
};

// === INITIALIZATION ===
document.addEventListener('DOMContentLoaded', async () => {
    // Show splash screen immediately
    showSplash();
    
    // Start loading sequence
    updateSplashProgress(10);
    
    await loadSettings();
    updateSplashProgress(30);
    
    await loadCollection();
    await loadCardLinks();
    await loadVintedListings();
    updateSplashProgress(50);
    
    setupEventListeners();
    updateSplashProgress(70);
    
    if (appState.settings.databasePath) {
        updateSplashProgress(80);
        await initializeDatabase(appState.settings.databasePath);
        updateSplashProgress(95);
        pageManager.showPage('sets');
        renderSetsPage(); // Carica gli sfondi dei giochi
    } else {
        pageManager.showPage('welcome');
        loadWelcomeBackground(); // Carica sfondo Welcome
    }
    
    updateSplashProgress(100);
    updateAllStats();
    
    // Hide splash screen after completion
    setTimeout(() => {
        hideSplash();
    }, 500);
});

// === SPLASH SCREEN CONTROL ===
function showSplash() {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('active');
        splash.classList.remove('hidden', 'fade-out');
    }
}

function updateSplashProgress(percent) {
    const fill = document.getElementById('splash-loading-fill');
    const percentageText = document.getElementById('splash-percentage');
    
    if (fill) {
        fill.style.width = percent + '%';
    }
    
    if (percentageText) {
        // Animate number counting up
        const current = parseInt(percentageText.textContent) || 0;
        const target = Math.min(percent, 100);
        
        if (current < target) {
            const step = Math.ceil((target - current) / 10);
            let value = current;
            
            const interval = setInterval(() => {
                value += step;
                if (value >= target) {
                    value = target;
                    clearInterval(interval);
                }
                percentageText.textContent = value;
            }, 50);
        } else {
            percentageText.textContent = target;
        }
    }
}

function hideSplash() {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('fade-out');
        
        // Remove from DOM after animation
        setTimeout(() => {
            splash.classList.remove('active');
            splash.classList.add('hidden');
        }, 800);
    }
}

// === EVENT LISTENERS SETUP ===
function setupEventListeners() {
    // Welcome page - Database selection
    document.getElementById('welcome-select-btn')?.addEventListener('click', selectDatabase);
    
    // Header - Stats panel toggle
    document.querySelector('.stats-btn')?.addEventListener('click', toggleStatsPanel);
    document.querySelector('.stats-panel-close')?.addEventListener('click', toggleStatsPanel);
    document.getElementById('change-db-btn')?.addEventListener('click', selectDatabase);
    
    // Currency selector
    document.getElementById('currency-selector')?.addEventListener('change', (e) => {
        appState.settings.currency = e.target.value;
        window.electronAPI.saveSettings(appState.settings);
        
        // Refresh portfolio page if active
        if (appState.currentPage === 'portfolio') {
            renderPortfolioPage();
        }
    });
    
    // Click outside stats panel to close
    document.getElementById('stats-panel')?.addEventListener('click', (e) => {
        if (e.target.id === 'stats-panel') toggleStatsPanel();
    });
    
    // Back buttons (event delegation)
    document.addEventListener('click', (e) => {
        if (e.target.closest('.back-btn')) {
            e.preventDefault();
            const backTo = e.target.closest('.back-btn').dataset.back;
            handleBackNavigation(backTo);
        }
        
        // Navigation links
        if (e.target.closest('.nav-link')) {
            e.preventDefault();
            const page = e.target.closest('.nav-link').dataset.page;
            
            // Update active nav link
            document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
            e.target.closest('.nav-link').classList.add('active');
            
            // Navigate to page
            if (page === 'sets') {
                pageManager.navigateTo('sets');
                renderSetsPage();
            } else if (page === 'portfolio') {
                pageManager.navigateTo('portfolio');
                renderPortfolioPage();
            } else if (page === 'vinted') {
                pageManager.navigateTo('vinted');
                renderVintedPage();
            } else {
                // Other pages not implemented yet
                console.log(`Navigate to ${page} - Coming soon!`);
            }
        }
    });
    
    // Sets page - ONE PIECE card click
    document.addEventListener('click', (e) => {
        const setCard = e.target.closest('.set-card');
        if (setCard && setCard.dataset.set === 'one-piece') {
            handleSetSelection();
        }
    });
    
    // Expansion search
    document.getElementById('expansion-search')?.addEventListener('input', (e) => {
        appState.expansionSearchQuery = e.target.value.toLowerCase();
        renderExpansionsPage();
    });
    
    // Cards search
    document.getElementById('cards-search')?.addEventListener('input', (e) => {
        appState.searchQuery = e.target.value.toLowerCase();
        renderCardsPage();
    });
    
    // Cards filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filter = e.currentTarget.dataset.filter;
            setActiveFilter(filter);
        });
    });
    
    // Modal controls
    document.querySelector('.modal-close')?.addEventListener('click', closeModal);
    document.getElementById('card-modal')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeModal();
    });
    
    // Modal quantity controls with auto-save
    document.querySelectorAll('.btn-quantity').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            const input = document.getElementById('modal-quantity');
            const current = parseInt(input.value) || 0;
            
            if (action === 'increase') {
                input.value = Math.min(current + 1, 99);
            } else if (action === 'decrease') {
                input.value = Math.max(current - 1, 0);
            }
            
            // Auto-save after button click
            saveCardQuantity();
        });
    });
    
    // Auto-save on input change (with debounce for manual typing)
    let saveTimeout;
    document.getElementById('modal-quantity')?.addEventListener('input', (e) => {
        const value = parseInt(e.target.value) || 0;
        e.target.value = Math.max(0, Math.min(99, value));
        
        // Debounce auto-save for manual typing
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveCardQuantity();
        }, 500); // Wait 500ms after user stops typing
    });
    
    // Marketplace link buttons
    document.getElementById('btn-save-cardmarket')?.addEventListener('click', async () => {
        await saveCardLink('cardmarket');
        // Trigger fetch prezzi dopo salvataggio link Cardmarket
        if (appState.currentCard) {
            const cardKey = getCardKey(appState.currentCard);
            const url = document.getElementById('modal-link-cardmarket').value.trim();
            if (url && url.includes('cardmarket.com')) {
                loadCardmarketPricing(cardKey, url);
            }
        }
    });
    document.getElementById('btn-save-tcgplayer')?.addEventListener('click', () => saveCardLink('tcgplayer'));
    document.getElementById('btn-open-cardmarket')?.addEventListener('click', () => openCardLink('cardmarket'));
    document.getElementById('btn-open-tcgplayer')?.addEventListener('click', () => openCardLink('tcgplayer'));
    
    // Refresh Cardmarket prices
    document.getElementById('btn-refresh-prices')?.addEventListener('click', () => {
        if (appState.currentCard) {
            const cardKey = getCardKey(appState.currentCard);
            const links = appState.cardLinks[cardKey] || {};
            if (links.cardmarket) {
                // Invalida cache e ri-fetcha
                loadCardmarketPricing(cardKey, links.cardmarket);
            }
        }
    });
    
    // Enable/disable open buttons as user types
    document.getElementById('modal-link-cardmarket')?.addEventListener('input', (e) => {
        document.getElementById('btn-open-cardmarket').disabled = !e.target.value.trim();
    });
    document.getElementById('modal-link-tcgplayer')?.addEventListener('input', (e) => {
        document.getElementById('btn-open-tcgplayer').disabled = !e.target.value.trim();
    });
}

// === NAVIGATION HANDLERS ===
function handleBackNavigation(backTo) {
    // Rimuovi wallpaper quando esci dalla pagina cards
    document.body.style.removeProperty('--wallpaper-url');
    document.body.classList.remove('has-wallpaper');
    
    switch(backTo) {
        case 'sets':
            pageManager.navigateTo('sets', { selectedLanguage: null, selectedExpansion: null });
            renderSetsPage();
            break;
        case 'languages':
            pageManager.navigateTo('languages', { selectedExpansion: null });
            renderLanguagesPage();
            break;
        case 'expansions':
            pageManager.navigateTo('expansions');
            renderExpansionsPage();
            break;
    }
}

function handleSetSelection() {
    if (!appState.database) {
        alert('Please select a database folder first');
        return;
    }
    
    // Select first available language and go directly to expansions
    const languages = Object.keys(appState.database.languages);
    if (languages.length > 0) {
        appState.selectedLanguage = languages[0];
        pageManager.navigateTo('expansions', { selectedLanguage: languages[0] });
        renderExpansionsPage();
    }
}

// === DATABASE FUNCTIONS ===
async function selectDatabase() {
    const path = await window.electronAPI.selectDatabaseFolder();
    if (path) {
        // Show splash for database loading
        showSplash();
        updateSplashProgress(0);
        
        updateSplashProgress(20);
        await initializeDatabase(path);
        updateSplashProgress(80);
        
        appState.settings.databasePath = path;
        await window.electronAPI.saveSettings(appState.settings);
        updateSplashProgress(95);
        
        pageManager.showPage('sets');
        renderSetsPage();
        updateSplashProgress(100);
        
        // Hide splash after completion
        setTimeout(() => {
            hideSplash();
        }, 500);
    }
}

async function initializeDatabase(path) {
    try {
        const result = await window.electronAPI.scanDatabase(path);
        
        if (result.success) {
            appState.database = result.cards;
            appState.settings.databasePath = path;
            updateAllStats();
            return true;
        } else {
            alert('Error loading database: ' + result.error);
            return false;
        }
    } catch (error) {
        console.error('Database initialization error:', error);
        alert('Failed to initialize database');
        return false;
    }
}

// === SETTINGS & COLLECTION ===
async function loadSettings() {
    appState.settings = await window.electronAPI.loadSettings();
}

async function loadCollection() {
    appState.collection = await window.electronAPI.loadCollection();
}

async function saveCollection() {
    await window.electronAPI.saveCollection(appState.collection);
    updateAllStats();
}

async function loadCardLinks() {
    appState.cardLinks = await window.electronAPI.loadCardLinks();
}

async function saveCardLinks() {
    await window.electronAPI.saveCardLinks(appState.cardLinks);
}

// === STATS FUNCTIONS ===
function updateAllStats() {
    updateHeaderStats();
    updateStatsPanel();
    updateSetsPageStats();
}

function updateHeaderStats() {
    const totalOwned = Object.values(appState.collection).reduce((sum, qty) => sum + qty, 0);
    document.getElementById('header-owned-count').textContent = totalOwned;
}

function updateStatsPanel() {
    const totalDbCards = appState.database ? appState.database.totalCards : 0;
    const totalOwned = Object.values(appState.collection).reduce((sum, qty) => sum + qty, 0);
    const uniqueOwned = Object.keys(appState.collection).length;
    const completion = totalDbCards > 0 ? ((uniqueOwned / totalDbCards) * 100).toFixed(1) : 0;
    
    document.getElementById('stat-total-db').textContent = totalDbCards;
    document.getElementById('stat-total-owned').textContent = totalOwned;
    document.getElementById('stat-unique-owned').textContent = uniqueOwned;
    document.getElementById('stat-completion').textContent = completion + '%';
    document.getElementById('stat-progress-bar').style.width = completion + '%';
    document.getElementById('stat-db-path').textContent = appState.settings.databasePath || 'Not selected';
}

function updateSetsPageStats() {
    if (!appState.database) return;
    
    const totalCards = appState.database.totalCards;
    const uniqueOwned = Object.keys(appState.collection).length;
    
    document.getElementById('set-total-cards').textContent = `${totalCards} cards`;
    document.getElementById('set-owned-cards').textContent = `${uniqueOwned} owned`;
}

function toggleStatsPanel() {
    const panel = document.getElementById('stats-panel');
    panel.classList.toggle('active');
    panel.classList.toggle('hidden');
}

// === SETS PAGE ===
function renderSetsPage() {
    updateSetsPageStats();
    
    // Carica sfondo per la card ONE PIECE
    const onePieceCard = document.querySelector('.set-card[data-set="one-piece"]');
    if (onePieceCard) {
        loadGameBackground(onePieceCard, 'ONE PIECE');
    }
}

// === LANGUAGES PAGE ===
function renderLanguagesPage() {
    const container = document.querySelector('#page-languages .languages-grid');
    container.innerHTML = '';
    
    if (!appState.database) {
        container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-secondary);">Database not loaded</p>';
        return;
    }
    
    const languages = appState.database.languages;
    
    // Filter out non-language folders (like product_images)
    const validLanguages = Object.keys(languages).filter(langCode => 
        langCode !== 'product_images'
    );
    
    validLanguages.forEach(langCode => {
        const lang = languages[langCode];
        const card = document.createElement('div');
        card.className = 'language-card';
        card.dataset.language = langCode;
        
        // Flag emoji mapping
        const flags = {
            'ENG': '🇬🇧',
            'JAP': '🇯🇵',
            'ITA': '🇮🇹',
            'SPA': '🇪🇸',
            'FRA': '🇫🇷',
            'GER': '🇩🇪'
        };
        
        card.innerHTML = `
            <div class="language-flag">${flags[langCode] || '🌍'}</div>
            <h3>${langCode}</h3>
            <span class="language-count">${lang.totalCards} cards</span>
        `;
        
        card.addEventListener('click', () => {
            appState.selectedLanguage = langCode;
            pageManager.navigateTo('expansions', { selectedLanguage: langCode });
            renderExpansionsPage();
        });
        
        container.appendChild(card);
    });
}

// === EXPANSIONS PAGE ===
function renderLanguageTabs() {
    const container = document.getElementById('language-tabs');
    if (!container || !appState.database) return;
    
    container.innerHTML = '';
    const languages = appState.database.languages;
    
    // Flag emoji mapping
    const flags = {
        'ENG': '🇬🇧',
        'JAP': '🇯🇵',
        'ITA': '🇮🇹',
        'SPA': '🇪🇸',
        'FRA': '🇫🇷',
        'GER': '🇩🇪'
    };
    
    // Filter out non-language folders (like product_images)
    const validLanguages = Object.keys(languages).filter(langCode => 
        langCode !== 'product_images'
    );
    
    validLanguages.forEach(langCode => {
        const tab = document.createElement('button');
        tab.className = 'language-tab';
        tab.dataset.language = langCode;
        
        if (langCode === appState.selectedLanguage) {
            tab.classList.add('active');
        }
        
        tab.innerHTML = `
            <span class="tab-flag">${flags[langCode] || '🌍'}</span>
            <span class="tab-label">${langCode}</span>
        `;
        
        tab.addEventListener('click', () => {
            appState.selectedLanguage = langCode;
            renderExpansionsPage();
        });
        
        container.appendChild(tab);
    });
}

function renderExpansionsPage() {
    // Render language tabs first
    renderLanguageTabs();
    
    const container = document.querySelector('#page-expansions .expansions-grid');
    const title = document.getElementById('expansions-title');
    const subtitle = document.getElementById('expansions-subtitle');
    
    container.innerHTML = '';
    
    if (!appState.selectedLanguage || !appState.database) return;
    
    const lang = appState.database.languages[appState.selectedLanguage];
    
    // Update header
    title.textContent = `${appState.selectedLanguage} Expansions`;
    subtitle.textContent = `${lang.totalCards} total cards available`;
    
    // Get and sort expansions
    const expansions = Object.keys(lang.expansions).sort();
    
    // Filter by search query
    const filtered = expansions.filter(exp => 
        exp.toLowerCase().includes(appState.expansionSearchQuery)
    );
    
    if (filtered.length === 0) {
        container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 2rem;">No expansions found</p>';
        return;
    }
    
    filtered.forEach(expName => {
        const exp = lang.expansions[expName];
        const card = document.createElement('div');
        card.className = 'expansion-card';
        card.dataset.expansion = expName;
        
        // Calcola progresso collezione per questa espansione
        const ownedCards = exp.cards.filter(cardData => {
            const cardKey = `${appState.selectedLanguage}:${expName}:${cardData.id}`;
            return appState.collection[cardKey] > 0;
        }).length;
        const totalCards = exp.totalCards;
        const progress = totalCards > 0 ? Math.round((ownedCards / totalCards) * 100) : 0;
        
        card.innerHTML = `
            <div class="expansion-image"></div>
            <div class="expansion-info">
                <span class="expansion-name">${formatExpansionName(expName)}</span>
                <span class="expansion-count">${totalCards}</span>
            </div>
            <div class="expansion-progress">
                <div class="progress-bar" style="width: ${progress}%"></div>
                <span class="progress-text">${ownedCards}/${totalCards} (${progress}%)</span>
            </div>
        `;
        
        // Carica immagine prodotto asincrona
        loadExpansionImage(card, expName);
        
        card.addEventListener('click', () => {
            appState.selectedExpansion = expName;
            pageManager.navigateTo('cards', { selectedExpansion: expName });
            renderCardsPage();
        });
        
        container.appendChild(card);
    });
}

// Carica immagine di sfondo per pagina Welcome
async function loadWelcomeBackground() {
    try {
        // Se non c'è database configurato, non possiamo caricare lo sfondo
        if (!appState.settings.databasePath) {
            console.log('ℹ️ No database configured yet - Welcome page will show default style');
            return;
        }
        
        // Estrai la cartella downloads dal database path
        const dbPath = appState.settings.databasePath;
        const lastSlashIndex = Math.max(dbPath.lastIndexOf('\\'), dbPath.lastIndexOf('/'));
        const downloadsPath = lastSlashIndex > 0 ? dbPath.substring(0, lastSlashIndex) : dbPath;
        
        console.log('🎮 Loading Welcome background for: ONE PIECE');
        console.log('📍 Downloads path:', downloadsPath);
        
        const result = await window.electronAPI.loadGameBackground(
            downloadsPath,
            'ONE PIECE'
        );
        
        console.log('📦 Welcome background result:', result);
        
        if (result.success && result.imagePath) {
            const container = document.querySelector('.welcome-container');
            
            if (!container) {
                console.warn('⚠️ Welcome container not found');
                return;
            }
            
            // Normalizza path per Windows -> Unix style per file:// protocol
            const normalizedPath = result.imagePath.replace(/\\/g, '/');
            const fileUrl = `url("file:///${normalizedPath}")`;
            
            console.log('🔗 Setting Welcome background:', fileUrl);
            
            // Applica usando CSS variable
            container.style.setProperty('--welcome-bg-url', fileUrl);
        } else {
            console.log('ℹ️ No background image found for Welcome page');
        }
    } catch (error) {
        console.error('❌ Error loading Welcome background:', error);
    }
}

// Carica immagine di sfondo per gioco (game_backgrounds)
async function loadGameBackground(cardElement, gameName) {
    try {
        // Verifica che database path sia valido
        if (!appState.settings.databasePath) {
            console.warn('⚠️ Database path not set, skipping game background load');
            return;
        }
        
        // Estrai la cartella downloads dal database path rimuovendo l'ultima parte
        // Es: "C:\...\downloads\ENG" -> "C:\...\downloads"
        const dbPath = appState.settings.databasePath;
        const lastSlashIndex = Math.max(dbPath.lastIndexOf('\\'), dbPath.lastIndexOf('/'));
        const downloadsPath = lastSlashIndex > 0 ? dbPath.substring(0, lastSlashIndex) : dbPath;
        
        console.log('🎮 Loading game background for:', gameName);
        console.log('📍 Downloads path:', downloadsPath);
        
        const result = await window.electronAPI.loadGameBackground(
            downloadsPath,
            gameName
        );
        
        console.log('📦 Background result:', result);
        
        if (result.success && result.imagePath) {
            const imageContainer = cardElement.querySelector('.set-card-image');
            const placeholder = cardElement.querySelector('.set-placeholder');
            
            // Normalizza path per Windows -> Unix style per file:// protocol
            const normalizedPath = result.imagePath.replace(/\\/g, '/');
            const fileUrl = `file:///${normalizedPath}`;
            
            console.log('🔗 Setting game background:', fileUrl);
            
            imageContainer.style.backgroundImage = `url("${fileUrl}")`;
            imageContainer.style.backgroundSize = 'cover';
            imageContainer.style.backgroundPosition = 'center';
            
            // Nascondi l'emoji placeholder quando c'è un'immagine
            if (placeholder) {
                placeholder.style.display = 'none';
            }
        } else {
            console.warn('⚠️ No background found for game:', gameName, result.error || '');
        }
    } catch (error) {
        console.error('❌ Error loading game background:', error);
    }
}

// Carica immagine prodotto per expansion card
async function loadExpansionImage(cardElement, expansionName) {
    try {
        // Verifica che database path sia valido
        if (!appState.settings.databasePath) {
            console.warn('⚠️ Database path not set, skipping image load');
            return;
        }
        
        console.log('🖼️ Loading image for:', expansionName);
        console.log('📍 Database path:', appState.settings.databasePath);
        
        const result = await window.electronAPI.loadExpansionProductImage(
            appState.settings.databasePath,
            appState.selectedLanguage,
            expansionName
        );
        
        console.log('📦 Result:', result);
        
        if (result.success && result.imagePath) {
            const imageContainer = cardElement.querySelector('.expansion-image');
            
            // Normalizza path per Windows -> Unix style per file:// protocol
            const normalizedPath = result.imagePath.replace(/\\/g, '/');
            const fileUrl = `file:///${normalizedPath}`;
            
            console.log('🔗 Setting background:', fileUrl);
            
            imageContainer.style.backgroundImage = `url("${fileUrl}")`;
        } else {
            console.warn('⚠️ No image found for:', expansionName, result.error || '');
        }
    } catch (error) {
        console.error('❌ Error loading expansion image:', error);
    }
}

// Carica wallpaper per espansione e applicalo come sfondo pagina cards
async function loadExpansionWallpaper(expansionName) {
    try {
        // Verifica che database path sia valido
        if (!appState.settings.databasePath) {
            console.warn('⚠️ Database path not set, skipping wallpaper load');
            return;
        }
        
        console.log('🖼️ Loading wallpaper for:', expansionName);
        console.log('📍 Database path:', appState.settings.databasePath);
        
        const result = await window.electronAPI.loadExpansionWallpaper(
            appState.settings.databasePath,
            expansionName
        );
        
        console.log('📦 Wallpaper result:', result);
        
        if (result.success && result.wallpaperPath) {
            // Normalizza path per Windows -> Unix style per file:// protocol
            const normalizedPath = result.wallpaperPath.replace(/\\/g, '/');
            const fileUrl = `file:///${normalizedPath}`;
            
            console.log('🔗 Setting wallpaper:', fileUrl);
            
            // Applica wallpaper al body usando CSS variable
            document.body.style.setProperty('--wallpaper-url', `url("${fileUrl}")`);
            document.body.classList.add('has-wallpaper');
        } else {
            console.warn('⚠️ No wallpaper found for:', expansionName, result.error || '');
            // Rimuovi wallpaper se non trovato
            document.body.style.removeProperty('--wallpaper-url');
            document.body.classList.remove('has-wallpaper');
        }
    } catch (error) {
        console.error('❌ Error loading wallpaper:', error);
        // Rimuovi wallpaper in caso di errore
        document.body.style.removeProperty('--wallpaper-url');
        document.body.classList.remove('has-wallpaper');
    }
}

// === CARDS PAGE ===
function renderCardsPage() {
    const container = document.getElementById('cards-container');
    const title = document.getElementById('cards-title');
    const subtitle = document.getElementById('cards-subtitle');
    const loading = document.getElementById('cards-loading');
    const empty = document.getElementById('cards-empty');
    
    // Show loading
    loading.classList.remove('hidden');
    container.classList.add('hidden');
    empty.classList.add('hidden');
    
    // Carica wallpaper per l'espansione corrente
    if (appState.selectedExpansion) {
        loadExpansionWallpaper(appState.selectedExpansion);
    }
    
    setTimeout(() => {
        container.innerHTML = '';
        
        if (!appState.selectedLanguage || !appState.selectedExpansion || !appState.database) {
            loading.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }
        
        const lang = appState.database.languages[appState.selectedLanguage];
        const exp = lang.expansions[appState.selectedExpansion];
        
        // Update header
        title.textContent = formatExpansionName(appState.selectedExpansion);
        subtitle.textContent = `${appState.selectedLanguage} • ${exp.totalCards} cards`;
        
        // Get filtered cards
        const cards = getFilteredCards(exp.cards);
        
        // Update filter counts
        updateFilterCounts(exp.cards);
        
        if (cards.length === 0) {
            loading.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }
        
        // Render cards
        cards.forEach(cardData => {
            const cardEl = createCardElement(cardData);
            container.appendChild(cardEl);
        });
        
        loading.classList.add('hidden');
        container.classList.remove('hidden');
        
        // Restore scroll position if saved
        if (appState.savedScrollPosition !== undefined) {
            window.scrollTo(0, appState.savedScrollPosition);
            delete appState.savedScrollPosition;
        }
    }, 200); // Small delay for smooth transition
}

function getFilteredCards(cards) {
    let filtered = cards.map(card => ({
        ...card,
        expansion: appState.selectedExpansion,
        language: appState.selectedLanguage
    }));
    
    // Apply search filter
    if (appState.searchQuery) {
        filtered = filtered.filter(card => 
            card.id.toLowerCase().includes(appState.searchQuery) ||
            card.filename.toLowerCase().includes(appState.searchQuery) ||
            (card.name && card.name.toLowerCase().includes(appState.searchQuery))
        );
    }
    
    // Apply ownership filter
    if (appState.currentFilter === 'owned') {
        filtered = filtered.filter(card => getCardQuantity(card) > 0);
    } else if (appState.currentFilter === 'missing') {
        filtered = filtered.filter(card => getCardQuantity(card) === 0);
    }
    
    return filtered;
}

function updateFilterCounts(cards) {
    const allCards = cards.map(card => ({
        ...card,
        expansion: appState.selectedExpansion,
        language: appState.selectedLanguage
    }));
    
    const owned = allCards.filter(card => getCardQuantity(card) > 0).length;
    const missing = allCards.filter(card => getCardQuantity(card) === 0).length;
    
    document.getElementById('count-all').textContent = allCards.length;
    document.getElementById('count-owned').textContent = owned;
    document.getElementById('count-missing').textContent = missing;
}

function setActiveFilter(filter) {
    appState.currentFilter = filter;
    
    // Update active state
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const filterEl = document.getElementById(`filter-${filter}`);
    if (!filterEl) return; // non siamo sulla pagina Cards
    filterEl.classList.add('active');
    
    renderCardsPage();
}

// === CARD RENDERING ===
function cleanCardId(cardId) {
    let cleanId = cardId.replace(/_[pr]\d+$/g, '');
    cleanId = cleanId.replace(/_/g, '-');
    return cleanId;
}

function formatCardDisplay(cardData) {
    const cleanId = cleanCardId(cardData.id);
    
    if (cardData.name) {
        return `${cardData.name} (${cleanId})`;
    }
    
    return cleanId;
}

function createCardElement(cardData) {
    const div = document.createElement('div');
    
    const quantity = getCardQuantity(cardData);
    div.className = `card-item${quantity > 0 ? ' owned' : ''}`;
    
    const imagePath = window.electronAPI.getCardImagePath(
        appState.settings.databasePath,
        cardData.relativePath
    );
    
    const displayName = formatCardDisplay(cardData);
    
    div.innerHTML = `
        <div class="card-image-container">
            <img src="${imagePath}" alt="${displayName}" class="card-image">
            <div class="card-quantity-badge ${quantity === 0 ? 'zero' : ''}">${quantity}x</div>
        </div>
        <div class="card-info">
            <div class="card-id">${displayName}</div>
        </div>
    `;
    
    div.addEventListener('click', () => openCardModal(cardData));
    
    return div;
}

// === MODAL FUNCTIONS ===
function openCardModal(cardData) {
    appState.currentCard = cardData;
    
    const modal = document.getElementById('card-modal');
    const imagePath = window.electronAPI.getCardImagePath(
        appState.settings.databasePath,
        cardData.relativePath
    );
    
    // Usa metadata già caricati durante lo scan (nessuna lettura disco aggiuntiva)
    const metadata = cardData.metadata || null;
    
    // Populate basic fields
    const modalImageContainer = document.querySelector('.modal-image');
    
    // Set background image (will be blurred and darkened by CSS)
    modalImageContainer.style.backgroundImage = `url("${imagePath}")`;
    
    // Create 3D holographic structure
    modalImageContainer.innerHTML = `
        <div class="card-holo-wrapper">
            <div class="card-holo-rotate">
                <div class="card-holo-image">
                    <img src="${imagePath}" alt="${metadata?.name || cardData.id}">
                </div>
                <div class="holo-layer holo-rainbow"></div>
                <div class="holo-layer holo-shimmer"></div>
                <div class="holo-layer holo-flare"></div>
                <div class="holo-layer holo-gold"></div>
                <div class="holo-layer holo-stripes"></div>
            </div>
        </div>
    `;
    
    // Setup 3D effect
    const holoWrapper = modalImageContainer.querySelector('.card-holo-wrapper');
    setupCardHoloEffect(modalImageContainer, holoWrapper);
    
    document.getElementById('modal-card-name').textContent = metadata?.name || cardData.id;
    document.getElementById('modal-card-id').textContent = cleanCardId(cardData.id);
    document.getElementById('modal-card-language').textContent = cardData.language;
    
    // Populate metadata if available
    if (metadata) {
        // Type and Rarity
        document.getElementById('modal-card-type').textContent = metadata.card_type || '-';
        document.getElementById('modal-card-rarity').textContent = 
            metadata.rarity_full ? `${metadata.rarity_full} (${metadata.rarity})` : (metadata.rarity || '-');
        document.getElementById('modal-card-set').textContent = metadata.card_set || '-';
        
        // Statistics
        const statsSection = document.getElementById('modal-stats-section');
        let hasStats = false;
        
        const lifeRow = document.getElementById('modal-life-row');
        if (metadata.life !== null && metadata.life !== undefined) {
            document.getElementById('modal-card-life').textContent = metadata.life;
            lifeRow.classList.remove('hidden');
            hasStats = true;
        } else {
            lifeRow.classList.add('hidden');
        }
        
        const costRow = document.getElementById('modal-cost-row');
        if (metadata.cost !== null && metadata.cost !== undefined) {
            document.getElementById('modal-card-cost').textContent = metadata.cost;
            costRow.classList.remove('hidden');
            hasStats = true;
        } else {
            costRow.classList.add('hidden');
        }
        
        const powerRow = document.getElementById('modal-power-row');
        if (metadata.power !== null && metadata.power !== undefined) {
            document.getElementById('modal-card-power').textContent = metadata.power;
            powerRow.classList.remove('hidden');
            hasStats = true;
        } else {
            powerRow.classList.add('hidden');
        }
        
        const counterRow = document.getElementById('modal-counter-row');
        if (metadata.counter !== null && metadata.counter !== undefined) {
            document.getElementById('modal-card-counter').textContent = metadata.counter;
            counterRow.classList.remove('hidden');
            hasStats = true;
        } else {
            counterRow.classList.add('hidden');
        }
        
        if (!hasStats) {
            statsSection.classList.add('hidden');
        } else {
            statsSection.classList.remove('hidden');
        }
        
        // Game Details
        document.getElementById('modal-card-attribute').textContent = metadata.attribute || '-';
        document.getElementById('modal-card-colors').textContent = 
            metadata.colors && metadata.colors.length > 0 ? metadata.colors.join(', ') : (metadata.color || '-');
        document.getElementById('modal-card-types').textContent = 
            metadata.types && metadata.types.length > 0 ? metadata.types.join(', ') : '-';
        
        // Effects
        const effectSection = document.getElementById('modal-effect-section');
        let hasEffects = false;
        
        const effectRow = document.getElementById('modal-effect-row');
        if (metadata.effect) {
            document.getElementById('modal-card-effect').textContent = metadata.effect;
            effectRow.classList.remove('hidden');
            hasEffects = true;
        } else {
            effectRow.classList.add('hidden');
        }
        
        const triggerRow = document.getElementById('modal-trigger-row');
        if (metadata.trigger) {
            document.getElementById('modal-card-trigger').textContent = metadata.trigger;
            triggerRow.classList.remove('hidden');
            hasEffects = true;
        } else {
            triggerRow.classList.add('hidden');
        }
        
        if (!hasEffects) {
            effectSection.classList.add('hidden');
        } else {
            effectSection.classList.remove('hidden');
        }
        
        // Special Abilities
        const abilitiesSection = document.getElementById('modal-abilities-section');
        const abilitiesList = document.getElementById('modal-abilities-list');
        const abilities = [];
        
        if (metadata.has_blocker) abilities.push('🛡️ Blocker');
        if (metadata.has_rush) abilities.push('⚡ Rush');
        if (metadata.has_double_attack) abilities.push('⚔️ Double Attack');
        if (metadata.has_banish) abilities.push('🔥 Banish');
        
        if (abilities.length > 0) {
            abilitiesList.innerHTML = abilities.map(a => `<span class="ability-badge">${a}</span>`).join(' ');
            abilitiesSection.classList.remove('hidden');
        } else {
            abilitiesSection.classList.add('hidden');
        }
    } else {
        // Metadata not available - show basic info only
        document.getElementById('modal-card-type').textContent = '-';
        document.getElementById('modal-card-rarity').textContent = '-';
        document.getElementById('modal-card-set').textContent = '-';
        document.getElementById('modal-card-attribute').textContent = '-';
        document.getElementById('modal-card-colors').textContent = '-';
        document.getElementById('modal-card-types').textContent = '-';
        
        // Hide advanced sections
        document.getElementById('modal-stats-section').classList.add('hidden');
        document.getElementById('modal-effect-section').classList.add('hidden');
        document.getElementById('modal-abilities-section').classList.add('hidden');
    }
    
    document.getElementById('modal-quantity').value = getCardQuantity(cardData);
    
    // Populate marketplace links
    const cardKey = getCardKey(cardData);
    const links = appState.cardLinks[cardKey] || {};
    
    const cmInput = document.getElementById('modal-link-cardmarket');
    const tcgInput = document.getElementById('modal-link-tcgplayer');
    const cmOpenBtn = document.getElementById('btn-open-cardmarket');
    const tcgOpenBtn = document.getElementById('btn-open-tcgplayer');
    
    cmInput.value = links.cardmarket || '';
    tcgInput.value = links.tcgplayer || '';
    cmOpenBtn.disabled = !links.cardmarket;
    tcgOpenBtn.disabled = !links.tcgplayer;
    
    modal.classList.remove('hidden');

    // Auto-fetch prezzi Cardmarket se URL disponibile
    if (links.cardmarket) {
        loadCardmarketPricing(cardKey, links.cardmarket);
    } else {
        resetPricingSection();
    }
}

function closeModal() {
    const modal = document.getElementById('card-modal');
    modal.classList.add('hidden');
    
    // Remove global 3D effect listener
    if (globalCardHoloListener) {
        document.removeEventListener('mousemove', globalCardHoloListener);
        globalCardHoloListener = null;
    }
    
    // Clean up 3D structure and background to prevent memory leaks
    const modalImageContainer = document.querySelector('.modal-image');
    if (modalImageContainer) {
        modalImageContainer.innerHTML = '';
        modalImageContainer.style.backgroundImage = '';
    }
    
    // Clean up pricing section
    resetPricingSection();
    
    appState.currentCard = null;
}

async function saveCardQuantity() {
    if (!appState.currentCard) return;
    
    const quantity = parseInt(document.getElementById('modal-quantity').value) || 0;
    const cardKey = getCardKey(appState.currentCard);
    
    if (quantity > 0) {
        appState.collection[cardKey] = quantity;
    } else {
        delete appState.collection[cardKey];
    }
    
    // Save scroll position before re-rendering
    appState.savedScrollPosition = window.scrollY || document.documentElement.scrollTop || 0;
    
    await saveCollection();
    renderCardsPage();
}

async function saveCardLink(platform) {
    if (!appState.currentCard) return;
    
    const cardKey = getCardKey(appState.currentCard);
    const inputId = platform === 'cardmarket' ? 'modal-link-cardmarket' : 'modal-link-tcgplayer';
    const openBtnId = platform === 'cardmarket' ? 'btn-open-cardmarket' : 'btn-open-tcgplayer';
    
    const url = document.getElementById(inputId).value.trim();
    
    if (!appState.cardLinks[cardKey]) {
        appState.cardLinks[cardKey] = {};
    }
    
    if (url) {
        appState.cardLinks[cardKey][platform] = url;
    } else {
        delete appState.cardLinks[cardKey][platform];
        // Clean up empty entries
        if (Object.keys(appState.cardLinks[cardKey]).length === 0) {
            delete appState.cardLinks[cardKey];
        }
    }
    
    document.getElementById(openBtnId).disabled = !url;
    
    await saveCardLinks();
}

function openCardLink(platform) {
    if (!appState.currentCard) return;
    
    const cardKey = getCardKey(appState.currentCard);
    const links = appState.cardLinks[cardKey] || {};
    const url = links[platform];
    
    if (url) {
        window.electronAPI.openExternalLink(url);
    }
}

// === UTILITY FUNCTIONS ===
function getCardKey(cardData) {
    return `${cardData.language}:${cardData.expansion}:${cardData.id}`;
}

function getCardQuantity(cardData) {
    const key = getCardKey(cardData);
    return appState.collection[key] || 0;
}

// Format expansion name: "[OP-07] - BOOSTER PACK -500 YEARS IN THE FUTURE-" 
// → "-500 YEARS IN THE FUTURE- [OP-07]"
function formatExpansionName(fullName) {
    // Extract series code (supports both ASCII [] and Japanese 【】)
    const codeMatch = fullName.match(/[\[\【]([^\]\】]+)[\]\】]/);
    const seriesCode = codeMatch ? codeMatch[0] : ''; // Keep brackets: [OP-07]
    
    // Remove series code from full name
    let name = fullName.replace(/[\[\【][^\]\】]+[\]\】]\s*-?\s*/g, '');
    
    // Remove product type prefixes (BOOSTER PACK, STARTER DECK, EXTRA BOOSTER, etc.)
    name = name.replace(/^(BOOSTER PACK|STARTER DECK|EXTRA BOOSTER|ULTIMATE DECK|PREMIUM BOOSTER|START DECK|ブースターパック|スタートデッキ|エクストラブースター|アルティメットデッキ)\s*-?\s*/gi, '');
    
    // Remove leading/trailing dashes and spaces
    name = name.replace(/^[\s\-]+|[\s\-]+$/g, '');
    
    // Build formatted name
    return `${name} ${seriesCode}`.trim();
}

// === 3D HOLOGRAPHIC CARD EFFECT ===
function setupCardHoloEffect(modalImageContainer, wrapperElement) {
    if (!modalImageContainer || !wrapperElement) return;
    
    const rotateElement = wrapperElement.querySelector('.card-holo-rotate');
    if (!rotateElement) return;
    
    // Activate effect immediately
    wrapperElement.classList.add('active');
    
    // Remove previous listener if exists
    if (globalCardHoloListener) {
        document.removeEventListener('mousemove', globalCardHoloListener);
    }
    
    // Mouse move - update 3D rotation and layer positions (WORKS ON ENTIRE SCREEN)
    globalCardHoloListener = (e) => {
        // Use global screen coordinates
        const x = e.clientX;
        const y = e.clientY;
        
        // Calculate normalized position (-1 to 1) based on screen size
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const percentX = (x - centerX) / centerX;
        const percentY = (y - centerY) / centerY;
        
        // Apply 3D rotation (inverted for natural feel)
        const rotateY = percentX * 15; // Max 15 degrees
        const rotateX = -percentY * 15;
        
        rotateElement.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        
        // Update CSS variables for layer effects (percentage of screen)
        updateCardHoloPosition(wrapperElement, (x / window.innerWidth) * 100, (y / window.innerHeight) * 100);
    };
    
    document.addEventListener('mousemove', globalCardHoloListener);
}

function updateCardHoloPosition(wrapper, percentX, percentY) {
    wrapper.style.setProperty('--mouse-x', `${percentX}%`);
    wrapper.style.setProperty('--mouse-y', `${percentY}%`);
}

function resetCardHoloEffect(wrapper, rotateElement) {
    wrapper.classList.remove('active');
    rotateElement.style.transform = 'rotateX(0deg) rotateY(0deg)';
    wrapper.style.setProperty('--mouse-x', '50%');
    wrapper.style.setProperty('--mouse-y', '50%');
}

// ==============================================
// === PORTFOLIO PAGE ===
// ==============================================

// Parse prezzo da stringa Cardmarket (es. "1,23 €") → float, o null
function parseCMPrice(priceStr) {
    if (!priceStr || typeof priceStr !== 'string') return null;
    // Formato EU: "1.234,56 €" → rimuovi punti-migliaia, converti virgola decimale
    let cleaned = priceStr.replace(/[^\d,.-]/g, ''); // rimuovi simboli valuta e spazi
    // Se contiene virgola: il punto è separatore migliaia → rimuovilo, la virgola diventa punto
    if (cleaned.includes(',')) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }
    // Altrimenti formato anglosassone (punto come decimale): lascia com'è
    const val = parseFloat(cleaned);
    return (isNaN(val) || val <= 0) ? null : val;
}

// Build real portfolio data from user's actual collection
async function buildRealPortfolioData() {
    const portfolioCards = [];
    
    if (!appState.database || !appState.collection) {
        return { cards: [], pricedCards: 0, unpricedCards: 0 };
    }

    // Carica tutti gli ultimi prezzi in un colpo solo
    const allPrices = await window.electronAPI.loadAllLatestPrices();
    
    // Iterate through user's owned cards
    Object.entries(appState.collection).forEach(([cardKey, quantity]) => {
        if (quantity <= 0) return;
        
        // Parse card key: "language:expansion:cardId"
        const [language, expansion, cardId] = cardKey.split(':');
        
        const langData = appState.database.languages[language];
        if (!langData) return;
        
        const expData = langData.expansions[expansion];
        if (!expData) return;
        
        const cardData = expData.cards.find(c => c.id === cardId);
        if (!cardData) return;
        
        const imagePath = window.electronAPI.getCardImagePath(
            appState.settings.databasePath,
            cardData.relativePath
        );

        // Cerca prezzo reale dal price store
        const priceKey = `${cardKey}:cardmarket`;
        const priceEntry = allPrices[priceKey] || null;
        let currentValue = null;
        let fetchedAt = null;

        if (priceEntry && priceEntry.priceInfo) {
            // Usa avg7 come valore principale, fallback su avg30/priceTrend/avg1
            currentValue = parseCMPrice(priceEntry.priceInfo.avg7)
                        || parseCMPrice(priceEntry.priceInfo.avg30)
                        || parseCMPrice(priceEntry.priceInfo.priceTrend)
                        || parseCMPrice(priceEntry.priceInfo.avg1);
            fetchedAt = priceEntry.fetched_at || null;
        }

        portfolioCards.push({
            id:           cleanCardId(cardId),
            name:         cardData.name || cleanCardId(cardId),
            language:     language,
            expansion:    formatExpansionName(expansion),
            rawExpansion: expansion,
            rawCardId:    cardId,
            quantity:     quantity,
            currentValue: currentValue,  // null = ND (no data)
            fetchedAt:    fetchedAt,
            imageUrl:     imagePath,
            relativePath: cardData.relativePath,
            metadata:     cardData.metadata || null
        });
    });

    const pricedCards = portfolioCards.filter(c => c.currentValue !== null).length;
    const unpricedCards = portfolioCards.filter(c => c.currentValue === null).length;
    
    return {
        cards: portfolioCards,
        pricedCards,
        unpricedCards
    };
}

// Currency conversion rates (mock - fissi per demo)
const CURRENCY_RATES = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    JPY: 149.50
};

function getCurrencySymbol(currency) {
    const symbols = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        JPY: '¥'
    };
    return symbols[currency] || '$';
}

function convertPrice(priceUSD, currency) {
    const rate = CURRENCY_RATES[currency] || 1;
    return priceUSD * rate;
}

function formatPrice(priceUSD, currency) {
    const converted = convertPrice(priceUSD, currency);
    const symbol = getCurrencySymbol(currency);
    
    if (currency === 'JPY') {
        return `${symbol}${Math.round(converted).toLocaleString()}`;
    }
    return `${symbol}${converted.toFixed(2)}`;
}



async function renderPortfolioPage() {
    const currency = appState.settings.currency || 'EUR';
    
    // Build portfolio data from real collection (async: carica prezzi)
    const portfolioData = await buildRealPortfolioData();
    
    // Save to appState for use in other functions
    appState.portfolioData = portfolioData;
    
    // Calcola stats solo su carte con prezzo reale
    const pricedCards = portfolioData.cards.filter(c => c.currentValue !== null);
    const totalValueEUR = pricedCards.reduce((sum, card) => 
        sum + (card.currentValue * card.quantity), 0
    );
    
    const uniqueCards = portfolioData.cards.length;
    const totalCards = portfolioData.cards.reduce((sum, card) => sum + card.quantity, 0);
    
    // Top card by value (solo prezzate)
    const topCard = pricedCards.length > 0 
        ? pricedCards.reduce((max, card) => 
            card.currentValue > max.currentValue ? card : max
          )
        : { currentValue: null, name: 'N/A' };
    
    // Update stats — i prezzi CM sono già in EUR
    document.getElementById('portfolio-total-value').textContent = 
        totalValueEUR > 0 ? `€${totalValueEUR.toFixed(2)}` : 'ND';
    
    // Variazione: per ora non abbiamo storico portfolio aggregato, mostriamo info
    const pricedInfo = `${portfolioData.pricedCards} priced / ${portfolioData.unpricedCards} ND`;
    document.getElementById('portfolio-value-change').textContent = pricedInfo;
    document.getElementById('portfolio-value-change').className = 'stat-change';
    
    // 7-Day Change — non disponibile ancora senza storico aggregato
    document.getElementById('portfolio-week-change').textContent = 'ND';
    document.getElementById('portfolio-week-percent').textContent = '';
    document.getElementById('portfolio-week-percent').className = 'stat-change';
    
    document.getElementById('portfolio-cards-count').textContent = totalCards;
    document.getElementById('portfolio-unique-count').textContent = `${uniqueCards} unique`;
    
    document.getElementById('portfolio-top-value').textContent = 
        topCard.currentValue !== null ? `€${topCard.currentValue.toFixed(2)}` : 'ND';
    document.getElementById('portfolio-top-card').textContent = topCard.name;
    
    // Update cards count badge
    document.getElementById('portfolio-cards-badge').textContent = `${totalCards} cards`;
    
    // Render charts con dati reali (storico combinato di tutte le carte prezzate)
    await renderRealValueCharts(currency);
    
    // Render cards grid
    renderPortfolioCards();
}

let valueChart = null;
let growthChart = null;

// Costruisce lo storico del valore totale portfolio da dati reali
// Combina i chartData di tutti gli snapshot di tutte le carte prezzate
async function renderRealValueCharts(currency) {
    // Destroy existing charts
    if (valueChart) { valueChart.destroy(); valueChart = null; }
    if (growthChart) { growthChart.destroy(); growthChart = null; }

    if (!appState.portfolioData) return;

    // Raccogliamo le carte prezzate con la loro cardKey
    const pricedCards = appState.portfolioData.cards.filter(c => c.currentValue !== null);
    if (pricedCards.length === 0) return;

    // Per ogni carta prezzata, carica lo storico e combina i chartData
    // Mappa globale: data → { somma valori di tutte le carte * quantità }
    const dailyTotals = new Map(); // "dd.mm.yy" → totale EUR

    for (const card of pricedCards) {
        const cardKey = `${card.language}:${card.rawExpansion}:${card.rawCardId}`;
        const history = await window.electronAPI.loadPriceHistory(cardKey, 'cardmarket', 5000);
        if (!history || history.length === 0) continue;

        // Combina chartLabels/chartData di tutti gli snapshot in una timeline per questa carta
        const cardPoints = new Map();
        const sorted = history.sort((a, b) => new Date(a.fetched_at) - new Date(b.fetched_at));

        for (const snap of sorted) {
            const labels = snap.chartLabels || [];
            const data = snap.chartData || [];
            for (let i = 0; i < labels.length && i < data.length; i++) {
                if (typeof data[i] !== 'number' || isNaN(data[i]) || data[i] <= 0) continue;
                const dateKey = normalizeChartLabel(labels[i], snap.fetched_at);
                if (dateKey) cardPoints.set(dateKey, data[i]);
            }
        }

        // Aggiungi al totale portfolio (prezzo * quantità)
        for (const [dateKey, price] of cardPoints) {
            const prev = dailyTotals.get(dateKey) || 0;
            dailyTotals.set(dateKey, prev + (price * card.quantity));
        }
    }

    if (dailyTotals.size === 0) return;

    // Ordina per data
    const sortedEntries = [...dailyTotals.entries()].sort((a, b) => 
        parseDateKey(a[0]) - parseDateKey(b[0])
    );

    const labels = sortedEntries.map(([key]) => key);
    const values = sortedEntries.map(([, val]) => val);

    // Growth %
    const firstValue = values[0];
    const growthData = values.map(v => ((v - firstValue) / firstValue) * 100);

    // Value Chart
    const valueCtx = document.getElementById('value-chart').getContext('2d');
    valueChart = new Chart(valueCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Portfolio Value',
                data: values,
                borderColor: '#e74c3c',
                backgroundColor: 'rgba(231, 76, 60, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: values.length > 50 ? 0 : 2,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#e74c3c',
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: '#e74c3c',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return `€${context.parsed.y.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } },
                y: {
                    beginAtZero: false,
                    ticks: { callback: v => `€${v.toFixed(0)}`, font: { size: 10 } },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });
    
    // Growth Chart
    const growthCtx = document.getElementById('growth-chart').getContext('2d');
    growthChart = new Chart(growthCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Growth %',
                data: growthData,
                borderColor: '#2ecc71',
                backgroundColor: 'rgba(46, 204, 113, 0.1)',
                segment: {
                    borderColor: ctx => {
                        if (!ctx.p1 || !ctx.p1.parsed || ctx.p1.parsed.y === undefined) return '#2ecc71';
                        return ctx.p1.parsed.y >= 0 ? '#2ecc71' : '#e74c3c';
                    }
                },
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: values.length > 50 ? 0 : 2,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#2ecc71',
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return `${context.parsed.y >= 0 ? '+' : ''}${context.parsed.y.toFixed(2)}%`;
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } },
                y: {
                    ticks: { callback: v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`, font: { size: 10 } },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });
}

function renderPortfolioCards() {
    const container = document.getElementById('portfolio-cards-grid');
    const emptyState = document.getElementById('portfolio-empty');
    const currency = appState.settings.currency || 'USD';
    
    // Check if portfolio data exists
    if (!appState.portfolioData || !appState.portfolioData.cards) {
        container.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }
    
    // Get filter values
    const searchQuery = document.getElementById('portfolio-search')?.value.toLowerCase() || '';
    const sortBy = document.getElementById('portfolio-sort')?.value || 'value-desc';
    const languageFilter = document.getElementById('portfolio-language')?.value || 'all';
    
    // Filter cards
    let cards = [...appState.portfolioData.cards];
    
    if (searchQuery) {
        cards = cards.filter(card => 
            card.name.toLowerCase().includes(searchQuery) ||
            card.id.toLowerCase().includes(searchQuery)
        );
    }
    
    if (languageFilter !== 'all') {
        cards = cards.filter(card => card.language === languageFilter);
    }
    
    // Sort cards (ND = null va in fondo per value sort)
    cards.sort((a, b) => {
        switch(sortBy) {
            case 'value-desc':
                if (a.currentValue === null && b.currentValue === null) return 0;
                if (a.currentValue === null) return 1;
                if (b.currentValue === null) return -1;
                return (b.currentValue * b.quantity) - (a.currentValue * a.quantity);
            case 'value-asc':
                if (a.currentValue === null && b.currentValue === null) return 0;
                if (a.currentValue === null) return 1;
                if (b.currentValue === null) return -1;
                return (a.currentValue * a.quantity) - (b.currentValue * b.quantity);
            case 'name-asc':
                return a.name.localeCompare(b.name);
            case 'name-desc':
                return b.name.localeCompare(a.name);
            case 'quantity-desc':
                return b.quantity - a.quantity;
            case 'date-desc':
            default:
                return 0; // Mock: no date data
        }
    });
    
    // Render
    if (cards.length === 0) {
        container.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    emptyState.classList.add('hidden');
    container.innerHTML = '';
    
    cards.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = 'portfolio-card-item';
        
        const totalValue = card.currentValue * card.quantity;

        const priceDisplay = card.currentValue !== null ? `€${card.currentValue.toFixed(2)}` : 'ND';
        const totalDisplay = card.currentValue !== null ? `€${(card.currentValue * card.quantity).toFixed(2)}` : 'ND';

        const rarityBadge = card.metadata?.rarity ? `<span class="portfolio-card-rarity">${card.metadata.rarity}</span>` : '';
        const expansionShort = card.expansion ? card.expansion.replace(/\s*\[.*?\]\s*$/, '').trim() : '';

        cardEl.innerHTML = `
            <div class="portfolio-card-image">
                <div class="portfolio-card-value-badge ${card.currentValue === null ? 'nd' : ''}">${priceDisplay}</div>
                ${card.quantity > 1 ? `<div class="portfolio-card-quantity">${card.quantity}x</div>` : ''}
                <img src="${card.imageUrl}" alt="${card.name}" onerror="this.style.display='none'">
            </div>
            <div class="portfolio-card-info">
                <div class="portfolio-card-name">${card.name}</div>
                <div class="portfolio-card-details">
                    <span class="card-language-badge">${card.language}</span>
                    ${rarityBadge}
                </div>
                <div class="portfolio-card-price-row">
                    <div class="portfolio-price-unit">
                        <span class="portfolio-price-label">Unit</span>
                        <span class="portfolio-price-value">${priceDisplay}</span>
                    </div>
                    <div class="portfolio-price-qty">
                        <span class="portfolio-price-label">${card.quantity} cop.</span>
                        <span class="portfolio-price-value total">${totalDisplay}</span>
                    </div>
                </div>
            </div>
        `;
        
        // Click handler to open card detail modal with full data
        cardEl.addEventListener('click', () => {
            const fullCardData = {
                id:           card.rawCardId,
                name:         card.name,
                language:     card.language,
                expansion:    card.rawExpansion,
                relativePath: card.relativePath,
                metadata:     card.metadata
            };
            openCardModal(fullCardData);
        });
        
        container.appendChild(cardEl);
    });
}

// ==============================================
// === CARDMARKET PRICING ===
// ==============================================

let modalPriceChart = null;
let pricingCurrentCardKey = null;     // cardKey corrente per time-range
let pricingCardmarketData = null;     // dati CM originali (per tornare al tab CM)
let pricingCardmarketFetchedAt = null;
let pricingActiveRange = 'cm';        // range attivo

async function loadCardmarketPricing(cardKey, url) {
    const section = document.getElementById('modal-pricing-section');
    const loading = document.getElementById('pricing-loading');
    const info = document.getElementById('pricing-info');
    const chartContainer = document.getElementById('pricing-chart-container');
    const footer = document.getElementById('pricing-footer');

    // Salva cardKey per i bottoni time-range
    pricingCurrentCardKey = cardKey;
    pricingCardmarketData = null;
    pricingCardmarketFetchedAt = null;
    pricingActiveRange = 'cm';
    updatePricingRangeButtons('cm');

    // Mostra sezione e loading
    section.classList.remove('hidden');
    loading.classList.remove('hidden');
    info.classList.add('hidden');
    chartContainer.classList.add('hidden');
    footer.classList.add('hidden');

    // 1) Carica ultimo dato salvato da SQLite (mostra subito mentre fetcha)
    const saved = await window.electronAPI.loadPriceLatest(cardKey, 'cardmarket');
    if (saved) {
        loading.classList.add('hidden');
        pricingCardmarketData = {
            chartLabels: saved.chartLabels,
            chartData: saved.chartData,
            priceInfo: saved.priceInfo
        };
        pricingCardmarketFetchedAt = saved.fetched_at;
        displayPricingData(pricingCardmarketData, pricingCardmarketFetchedAt);
    }

    // 2) Fetch SEMPRE dati freschi da Cardmarket
    const result = await window.electronAPI.fetchCardmarketPrices(url);

    if (result.success) {
        loading.classList.add('hidden');
        pricingCardmarketData = result.data;
        pricingCardmarketFetchedAt = result.fetchedAt;
        displayPricingData(pricingCardmarketData, pricingCardmarketFetchedAt);
        // Salva in SQLite (storico + latest)
        await window.electronAPI.savePriceData(cardKey, result.data, 'cardmarket');
    } else if (!saved) {
        // Fetch fallito e nessun dato salvato
        loading.classList.add('hidden');
        section.querySelector('.pricing-loading')?.insertAdjacentHTML('afterend',
            '<p style="color: var(--text-secondary); text-align: center; padding: 1rem;">⚠️ Unable to fetch prices. Try again later.</p>'
        );
    } else {
        // Fetch fallito ma dati salvati già mostrati — nascondi solo loading
        loading.classList.add('hidden');
    }
}

function displayPricingData(data, fetchedAt) {
    const info = document.getElementById('pricing-info');
    const chartContainer = document.getElementById('pricing-chart-container');
    const footer = document.getElementById('pricing-footer');

    // Popola info prezzi
    const pi = data.priceInfo || {};
    document.getElementById('pricing-trend').textContent = pi.priceTrend || '-';
    document.getElementById('pricing-avg30').textContent = pi.avg30 || '-';
    document.getElementById('pricing-avg7').textContent = pi.avg7 || '-';
    document.getElementById('pricing-avg1').textContent = pi.avg1 || '-';
    document.getElementById('pricing-from').textContent = pi.priceFrom || '-';
    document.getElementById('pricing-available').textContent = pi.availableItems || '-';
    info.classList.remove('hidden');

    // Render chart
    renderPricingChart(data.chartLabels || [], data.chartData || [], 'Prezzo medio di vendita');

    // Footer
    if (fetchedAt) {
        const dateStr = new Date(fetchedAt).toLocaleString('it-IT');
        document.getElementById('pricing-last-fetched').textContent = `Last fetched: ${dateStr}`;
    }
    footer.classList.remove('hidden');
}

function renderPricingChart(labels, data, label) {
    const chartContainer = document.getElementById('pricing-chart-container');

    if (labels.length > 0 && data.length > 0) {
        if (modalPriceChart) {
            modalPriceChart.destroy();
            modalPriceChart = null;
        }

        chartContainer.classList.remove('hidden');
        const ctx = document.getElementById('modal-price-chart').getContext('2d');
        modalPriceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: label,
                    data: data,
                    borderColor: '#012169',
                    backgroundColor: 'rgba(1, 33, 105, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.25,
                    pointRadius: data.length > 50 ? 1 : 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#012169',
                    pointHoverBackgroundColor: '#e74c3c',
                    pointHoverBorderColor: '#fff',
                    pointHoverBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 2.2,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: '#012169',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: false,
                        callbacks: {
                            label: function(context) {
                                return context.parsed.y.toFixed(2) + ' €';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { maxTicksLimit: 8, font: { size: 10 } },
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: false,
                        ticks: {
                            callback: function(value) { return value.toFixed(0) + ' €'; },
                            font: { size: 10 }
                        },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    }
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    }
}

// === TIME RANGE BUTTONS ===
function updatePricingRangeButtons(activeRange) {
    document.querySelectorAll('.pricing-range-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === activeRange);
    });
    pricingActiveRange = activeRange;
}

async function handlePricingRangeClick(range) {
    if (range === pricingActiveRange) return;
    updatePricingRangeButtons(range);

    // CM = mostra dati Cardmarket originali
    if (range === 'cm') {
        if (pricingCardmarketData) {
            renderPricingChart(
                pricingCardmarketData.chartLabels || [],
                pricingCardmarketData.chartData || [],
                'Prezzo medio di vendita'
            );
        }
        return;
    }

    // Storico: carica tutti gli snapshot per questa carta
    if (!pricingCurrentCardKey) return;

    const history = await window.electronAPI.loadPriceHistory(pricingCurrentCardKey, 'cardmarket', 5000);
    if (!history || history.length === 0) {
        renderPricingChart([], [], 'Storico prezzi');
        return;
    }

    // Combina i chartLabels/chartData di tutti gli snapshot in una timeline unica
    // Ogni snapshot contiene il grafico di Cardmarket (~30gg di dati)
    // Unendo più snapshot otteniamo una timeline più lunga
    const allPoints = new Map(); // chiave: "dd.mm.yyyy" → valore: prezzo

    // Ordina dal più vecchio al più recente (così i più recenti sovrascrivono)
    const sorted = history.sort((a, b) => new Date(a.fetched_at) - new Date(b.fetched_at));

    for (const snap of sorted) {
        const chartLabels = snap.chartLabels || [];
        const chartData = snap.chartData || [];

        for (let i = 0; i < chartLabels.length && i < chartData.length; i++) {
            const label = chartLabels[i]; // es. "01.03." o "01.03.25" o "Mar 1"
            const value = chartData[i];
            if (typeof value !== 'number' || isNaN(value) || value <= 0) continue;

            // Normalizza la label in una data parsabile
            const dateKey = normalizeChartLabel(label, snap.fetched_at);
            if (dateKey) {
                allPoints.set(dateKey, value);
            }
        }
    }

    if (allPoints.size === 0) {
        renderPricingChart([], [], 'Storico prezzi');
        return;
    }

    // Ordina per data
    const sortedEntries = [...allPoints.entries()].sort((a, b) => {
        return parseDateKey(a[0]) - parseDateKey(b[0]);
    });

    // Filtra per range temporale
    const now = new Date();
    let cutoffMs = 0;
    switch (range) {
        case '1w': cutoffMs = 7 * 24 * 60 * 60 * 1000; break;
        case '1m': cutoffMs = 30 * 24 * 60 * 60 * 1000; break;
        case '3m': cutoffMs = 90 * 24 * 60 * 60 * 1000; break;
        case '6m': cutoffMs = 180 * 24 * 60 * 60 * 1000; break;
        case '1y': cutoffMs = 365 * 24 * 60 * 60 * 1000; break;
        case 'all': cutoffMs = 0; break;
    }

    const cutoffDate = cutoffMs > 0 ? new Date(now - cutoffMs) : null;
    const filtered = cutoffDate
        ? sortedEntries.filter(([key]) => parseDateKey(key) >= cutoffDate)
        : sortedEntries;

    if (filtered.length === 0) {
        renderPricingChart([], [], 'Storico prezzi');
        return;
    }

    const labels = filtered.map(([key]) => key);
    const dataPoints = filtered.map(([, val]) => val);

    renderPricingChart(labels, dataPoints, 'Storico Prezzo');
}

// Normalizza le label del chart Cardmarket in formato "dd.mm.yy"
function normalizeChartLabel(label, fetchedAt) {
    if (!label || typeof label !== 'string') return null;
    const trimmed = label.trim();

    // Formato "dd.mm." (senza anno) — comune su Cardmarket
    const match2 = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
    if (match2) {
        const day = match2[1].padStart(2, '0');
        const month = match2[2].padStart(2, '0');
        // Ricava l'anno dal fetchedAt
        const fetchYear = new Date(fetchedAt).getFullYear();
        const yearShort = String(fetchYear).slice(-2);
        return `${day}.${month}.${yearShort}`;
    }

    // Formato "dd.mm.yy" o "dd.mm.yyyy"
    const match3 = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (match3) {
        const day = match3[1].padStart(2, '0');
        const month = match3[2].padStart(2, '0');
        let year = match3[3];
        if (year.length === 4) year = year.slice(-2);
        return `${day}.${month}.${year}`;
    }

    // Fallback: ritorna com'è
    return trimmed;
}

// Parse "dd.mm.yy" → Date
function parseDateKey(key) {
    const parts = key.match(/^(\d{2})\.(\d{2})\.(\d{2,4})$/);
    if (parts) {
        let year = parseInt(parts[3]);
        if (year < 100) year += 2000;
        return new Date(year, parseInt(parts[2]) - 1, parseInt(parts[1]));
    }
    // Fallback
    return new Date(0);
}

// Event delegation per i bottoni time-range
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.pricing-range-btn');
    if (btn && btn.dataset.range) {
        handlePricingRangeClick(btn.dataset.range);
    }
});

function resetPricingSection() {
    // Distruggi chart
    if (modalPriceChart) {
        modalPriceChart.destroy();
        modalPriceChart = null;
    }
    // Reset stato
    pricingCurrentCardKey = null;
    pricingCardmarketData = null;
    pricingCardmarketFetchedAt = null;
    pricingActiveRange = 'cm';
    // Nascondi sezione
    const section = document.getElementById('modal-pricing-section');
    if (section) {
        section.classList.add('hidden');
        document.getElementById('pricing-loading')?.classList.add('hidden');
        document.getElementById('pricing-info')?.classList.add('hidden');
        document.getElementById('pricing-chart-container')?.classList.add('hidden');
        document.getElementById('pricing-footer')?.classList.add('hidden');
    }
}

// Setup portfolio filter listeners
document.addEventListener('DOMContentLoaded', () => {
    // Portfolio search
    document.getElementById('portfolio-search')?.addEventListener('input', () => {
        if (appState.currentPage === 'portfolio') {
            renderPortfolioCards();
        }
    });
    
    // Portfolio sort
    document.getElementById('portfolio-sort')?.addEventListener('change', () => {
        if (appState.currentPage === 'portfolio') {
            renderPortfolioCards();
        }
    });
    
    // Portfolio language filter
    document.getElementById('portfolio-language')?.addEventListener('change', () => {
        if (appState.currentPage === 'portfolio') {
            renderPortfolioCards();
        }
    });
});





// ============================================================================
// === VINTED STOCK MANAGER ===
// ============================================================================

// Stato Vinted
let vintedListings = {};          // { listingId → listing object }
let vintedCurrentFilter = 'all';  // all | active | sold | removed
let vintedSearchQuery = '';
let vintedEditingId = null;       // null = nuova inserzione, stringa = edit
let vintedSelectedCard = null;    // { cardKey, name, imagePath, language, expansion, id, metadata }

// Genera UUID semplice
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Estrae item ID numerico da un URL Vinted
function extractVintedItemId(url) {
    if (!url) return null;
    const match = url.match(/\/items\/(\d+)/);
    return match ? match[1] : null;
}

// ── LOAD / SAVE ────────────────────────────────────────────────────────────

async function loadVintedListings() {
    vintedListings = await window.electronAPI.loadVintedListings();
}

async function saveVintedListings() {
    await window.electronAPI.saveVintedListings(vintedListings);
}

// Ritorna il totalPrice di una listing (usa totalPrice se impostato, altrimenti somma items)
function getListingTotal(listing) {
    if (listing.totalPrice != null && listing.totalPrice > 0) return listing.totalPrice;
    const items = listing.items || [];
    return items.reduce((s, it) => s + ((it.unitPrice || 0) * (it.qty || 1)), 0);
}

// Calcola la somma automatica degli item di una listing
function calcItemsSum(items) {
    return (items || []).reduce((s, it) => s + ((it.unitPrice || 0) * (it.qty || 1)), 0);
}

// ── RENDER PRINCIPALE ──────────────────────────────────────────────────────

async function renderVintedPage() {
    await loadVintedListings();
    updateVintedSummary();
    renderVintedListings();
    setupVintedEventListeners();
}

function updateVintedSummary() {
    const all = Object.values(vintedListings);
    const active  = all.filter(l => l.status === 'active');
    const sold    = all.filter(l => l.status === 'sold');

    const revenue  = sold.reduce((s, l) => s + getListingTotal(l), 0);
    const stockVal = active.reduce((s, l) => s + getListingTotal(l), 0);

    document.getElementById('vinted-stat-active').textContent  = active.length;
    document.getElementById('vinted-stat-sold').textContent    = sold.length;
    document.getElementById('vinted-stat-revenue').textContent = `€${revenue.toFixed(2)}`;
    document.getElementById('vinted-stat-stock-value').textContent = `€${stockVal.toFixed(2)}`;
}

function renderVintedListings() {
    const container = document.getElementById('vinted-listings-container');
    const empty     = document.getElementById('vinted-empty');

    let listings = Object.values(vintedListings);

    // Filtro status
    if (vintedCurrentFilter !== 'all') {
        listings = listings.filter(l => l.status === vintedCurrentFilter);
    }

    // Filtro search
    if (vintedSearchQuery) {
        listings = listings.filter(l => {
            const cardKey = l.cardKey || '';
            const parts = cardKey.split(':');
            const cardId = (parts[2] || '').toLowerCase();
            return cardId.includes(vintedSearchQuery) ||
                   (l.cardName || '').toLowerCase().includes(vintedSearchQuery);
        });
    }

    // Ordina: attive prima, poi vendute, poi rimosse; dentro ogni gruppo dal più recente
    listings.sort((a, b) => {
        const order = { active: 0, sold: 1, removed: 2 };
        const od = (order[a.status] ?? 3) - (order[b.status] ?? 3);
        if (od !== 0) return od;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    container.innerHTML = '';

    if (listings.length === 0) {
        container.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    container.classList.remove('hidden');

    listings.forEach(listing => {
        const card = buildVintedListingCard(listing);
        container.appendChild(card);
    });
}

function buildVintedListingCard(listing) {
    const wrap = document.createElement('div');
    wrap.className = `vinted-listing-card status-${listing.status}`;
    wrap.dataset.id = listing.id;

    // Immagine: usa la prima carta degli items (struttura nuova) o imagePath legacy
    const items = listing.items || [];
    const firstItem = items[0];
    const firstImagePath = firstItem?.imagePath || listing.imagePath || null;

    let imgHtml = '<div class="vinted-card-thumb-placeholder">🎴</div>';
    if (firstImagePath) {
        imgHtml = `<img src="${firstImagePath}" alt="" class="vinted-card-thumb" onerror="this.style.display='none'">`;
    }
    // Badge conteggio carte se multi-item
    const itemCountBadge = items.length > 1
        ? `<span class="vinted-item-count-badge">${items.length} carte</span>`
        : '';

    // Badge status
    const statusLabel = { active: '🟢 Attiva', sold: '✅ Venduta', removed: '🗑️ Rimossa' };
    const badge = statusLabel[listing.status] || listing.status;

    // Titolo inserzione: nomi carte (max 2 poi "...")
    let titleText;
    if (items.length > 0) {
        const names = items.slice(0, 2).map(it => it.cardName || cleanCardId(it.cardKey?.split(':')[2] || ''));
        titleText = names.join(', ') + (items.length > 2 ? ` +${items.length - 2}` : '');
    } else {
        titleText = listing.cardName || cleanCardId(listing.cardKey?.split(':')[2] || '-');
    }

    // Stock info (basata sulla prima carta per compatibilità, o aggregata)
    const primaryCardKey = firstItem?.cardKey || listing.cardKey || '';
    const totalStock = appState.collection[primaryCardKey] || 0;
    const activeForThisCard = Object.values(vintedListings)
        .filter(l => l.cardKey === primaryCardKey && l.status === 'active').length;

    // Prezzo totale
    const total = getListingTotal(listing);
    const priceStr = total > 0 ? `€${total.toFixed(2)}` : 'ND';

    // Mini lista items (max 3 righe)
    let itemsPreview = '';
    if (items.length > 0) {
        const preview = items.slice(0, 3);
        itemsPreview = `<div class="vinted-items-preview">${preview.map(it => {
            const name = it.cardName || cleanCardId(it.cardKey?.split(':')[2] || '');
            const sub = `${it.qty || 1}x · €${(it.unitPrice || 0).toFixed(2)}`;
            return `<span class="vinted-item-pill">${name} <em>${sub}</em></span>`;
        }).join('')}${items.length > 3 ? `<span class="vinted-item-pill more">+${items.length - 3} altre</span>` : ''}</div>`;
    }

    // Link Vinted
    const urlHtml = listing.vintedUrl
        ? `<a class="vinted-listing-link" href="#" data-url="${listing.vintedUrl}" title="Apri su Vinted">🔗 Apri su Vinted</a>`
        : `<span class="vinted-no-url">Nessun URL</span>`;

    // Data
    const dateStr = listing.soldAt
        ? `Venduta: ${new Date(listing.soldAt).toLocaleDateString('it-IT')}`
        : `Aggiunta: ${new Date(listing.createdAt).toLocaleDateString('it-IT')}`;

    // Pulsanti azioni
    let actionsHtml = '';
    if (listing.status === 'active') {
        actionsHtml = `
            <button class="vinted-btn-sold" data-id="${listing.id}" title="Segna come venduta">✅ Venduta</button>
            <button class="vinted-btn-remove" data-id="${listing.id}" title="Rimuovi inserzione">🗑️</button>
            <button class="vinted-btn-edit" data-id="${listing.id}" title="Modifica">✏️</button>
        `;
    } else {
        actionsHtml = `
            <button class="vinted-btn-edit" data-id="${listing.id}" title="Modifica">✏️</button>
            <button class="vinted-btn-delete" data-id="${listing.id}" title="Elimina record">🗑️ Elimina</button>
        `;
    }

    wrap.innerHTML = `
        <div class="vinted-card-image-area">
            ${imgHtml}
            ${itemCountBadge}
            <span class="vinted-status-badge">${badge}</span>
        </div>
        <div class="vinted-card-details">
            <div class="vinted-card-name">${titleText}</div>
            ${itemsPreview}
            <div class="vinted-stock-row">
                <span class="vinted-stock-info">📦 Stock: <strong>${totalStock}</strong></span>
                <span class="vinted-active-info">🏷️ In vendita: <strong>${activeForThisCard}</strong></span>
            </div>
            <div class="vinted-price-row">
                <span class="vinted-price">${priceStr}</span>
                ${urlHtml}
            </div>
            <div class="vinted-date">${dateStr}</div>
        </div>
        <div class="vinted-card-actions">
            ${actionsHtml}
        </div>
    `;

    return wrap;
}

// ── EVENT LISTENERS ────────────────────────────────────────────────────────

let vintedListenersSetup = false;

function setupVintedEventListeners() {
    if (vintedListenersSetup) return;
    vintedListenersSetup = true;

    // Tab filter
    document.querySelectorAll('.vinted-tab').forEach(btn => {
        btn.addEventListener('click', e => {
            document.querySelectorAll('.vinted-tab').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            vintedCurrentFilter = e.currentTarget.dataset.status;
            renderVintedListings();
        });
    });

    // Search
    document.getElementById('vinted-search')?.addEventListener('input', e => {
        vintedSearchQuery = e.target.value.toLowerCase();
        renderVintedListings();
    });

    // Nuova inserzione
    document.getElementById('vinted-add-btn')?.addEventListener('click', () => {
        openVintedModal(null);
    });

    // Sync Vinted
    document.getElementById('vinted-sync-btn')?.addEventListener('click', syncWithVinted);

    // Delegazione click sulla griglia
    document.getElementById('vinted-listings-container')?.addEventListener('click', async e => {
        const soldBtn   = e.target.closest('.vinted-btn-sold');
        const removeBtn = e.target.closest('.vinted-btn-remove');
        const editBtn   = e.target.closest('.vinted-btn-edit');
        const deleteBtn = e.target.closest('.vinted-btn-delete');
        const linkBtn   = e.target.closest('.vinted-listing-link');

        if (soldBtn) {
            await markListingAsSold(soldBtn.dataset.id);
        } else if (removeBtn) {
            await markListingAsRemoved(removeBtn.dataset.id);
        } else if (editBtn) {
            openVintedModal(editBtn.dataset.id);
        } else if (deleteBtn) {
            await deleteVintedListing(deleteBtn.dataset.id);
        } else if (linkBtn) {
            e.preventDefault();
            window.electronAPI.openExternalLink(linkBtn.dataset.url);
        }
    });

    // Modal - close
    document.getElementById('vinted-modal-close')?.addEventListener('click', closeVintedModal);
    document.getElementById('vinted-modal-cancel')?.addEventListener('click', closeVintedModal);
    document.getElementById('vinted-modal')?.addEventListener('click', e => {
        if (e.target.classList.contains('modal-overlay')) closeVintedModal();
    });

    // Modal - save
    document.getElementById('vinted-modal-save')?.addEventListener('click', saveVintedListingFromModal);

    // Modal - URL open
    document.getElementById('vinted-listing-url')?.addEventListener('input', e => {
        document.getElementById('vinted-url-open').disabled = !e.target.value.trim();
    });
    document.getElementById('vinted-url-open')?.addEventListener('click', () => {
        const url = document.getElementById('vinted-listing-url').value.trim();
        if (url) window.electronAPI.openExternalLink(url);
    });

    // Modal - ricerca carta (per aggiungere item)
    let cardSearchTimeout;
    document.getElementById('vinted-card-search-input')?.addEventListener('input', e => {
        clearTimeout(cardSearchTimeout);
        cardSearchTimeout = setTimeout(() => {
            searchCardsForVinted(e.target.value.toLowerCase());
        }, 300);
    });

    // Modal - ricalcola totale dal bottone ↺
    document.getElementById('vinted-recalc-btn')?.addEventListener('click', () => {
        const items = readModalItems();
        const sum = calcItemsSum(items);
        document.getElementById('vinted-listing-total').value = sum.toFixed(2);
    });
}

// ── CARD SEARCH (nel modal) ────────────────────────────────────────────────

function searchCardsForVinted(query) {
    const resultsEl = document.getElementById('vinted-card-search-results');
    resultsEl.innerHTML = '';

    if (!query || query.length < 2 || !appState.database) {
        resultsEl.classList.add('hidden');
        return;
    }

    const matches = [];
    for (const [lang, langData] of Object.entries(appState.database.languages)) {
        for (const [expName, expData] of Object.entries(langData.expansions)) {
            for (const cardData of expData.cards) {
                const cardKey = `${lang}:${expName}:${cardData.id}`;
                const qty = appState.collection[cardKey] || 0;
                if (qty <= 0) continue;

                const name = cardData.name || cleanCardId(cardData.id);
                const idClean = cleanCardId(cardData.id);

                if (name.toLowerCase().includes(query) || idClean.toLowerCase().includes(query)) {
                    matches.push({ lang, expName, cardData, cardKey, qty, name, idClean });
                    if (matches.length >= 20) break;
                }
            }
            if (matches.length >= 20) break;
        }
        if (matches.length >= 20) break;
    }

    if (matches.length === 0) {
        resultsEl.innerHTML = '<div class="vinted-search-no-results">Nessuna carta trovata nella collezione</div>';
        resultsEl.classList.remove('hidden');
        return;
    }

    matches.forEach(m => {
        const item = document.createElement('div');
        item.className = 'vinted-search-result-item';

        const imagePath = window.electronAPI.getCardImagePath(
            appState.settings.databasePath,
            m.cardData.relativePath
        );

        item.innerHTML = `
            <img src="${imagePath}" alt="${m.name}" onerror="this.style.display='none'">
            <div class="vinted-result-info">
                <span class="vinted-result-name">${m.name}</span>
                <span class="vinted-result-id">${m.lang} · ${m.idClean} · ${m.qty}x in coll.</span>
            </div>
        `;

        item.addEventListener('click', () => {
            addVintedItemRow({
                cardKey:   m.cardKey,
                cardName:  m.name,
                imagePath: imagePath,
                qty:       1,
                unitPrice: 0
            });
            // Chiudi risultati e svuota search
            document.getElementById('vinted-card-search-input').value = '';
            resultsEl.classList.add('hidden');
            resultsEl.innerHTML = '';
        });

        resultsEl.appendChild(item);
    });

    resultsEl.classList.remove('hidden');
}

// ── GESTIONE LISTA ITEM NEL MODAL ──────────────────────────────────────────

// Aggiunge una riga nella lista item del modal
function addVintedItemRow(item) {
    const list = document.getElementById('vinted-items-list');

    const row = document.createElement('div');
    row.className = 'vinted-item-row';
    row.dataset.cardKey = item.cardKey;

    row.innerHTML = `
        <img src="${item.imagePath || ''}" alt="" class="vinted-item-row-img" onerror="this.style.display='none'">
        <div class="vinted-item-row-info">
            <span class="vinted-item-row-name">${item.cardName}</span>
            <span class="vinted-item-row-key">${item.cardKey}</span>
        </div>
        <div class="vinted-item-row-controls">
            <label class="vinted-item-row-label">Qtà</label>
            <input type="number" class="quantity-input vinted-item-qty" value="${item.qty || 1}" min="1" max="99" step="1">
            <label class="vinted-item-row-label">€/cad</label>
            <input type="number" class="quantity-input vinted-item-price" value="${(item.unitPrice || 0).toFixed(2)}" min="0" step="0.01" placeholder="0.00">
            <span class="vinted-item-subtotal">= €${((item.qty || 1) * (item.unitPrice || 0)).toFixed(2)}</span>
        </div>
        <button class="vinted-item-row-remove" title="Rimuovi">✕</button>
    `;

    // Aggiorna subtotale e totale al cambio qty/prezzo
    const qtyInput   = row.querySelector('.vinted-item-qty');
    const priceInput = row.querySelector('.vinted-item-price');
    const subtotal   = row.querySelector('.vinted-item-subtotal');

    const updateRow = () => {
        const q = parseFloat(qtyInput.value) || 1;
        const p = parseFloat(priceInput.value) || 0;
        subtotal.textContent = `= €${(q * p).toFixed(2)}`;
        recalcModalTotal();
    };

    qtyInput.addEventListener('input', updateRow);
    priceInput.addEventListener('input', updateRow);

    // Rimuovi riga
    row.querySelector('.vinted-item-row-remove').addEventListener('click', () => {
        row.remove();
        recalcModalTotal();
    });

    list.appendChild(row);
    recalcModalTotal();
}

// Legge tutti gli item dal DOM del modal
function readModalItems() {
    const rows = document.querySelectorAll('#vinted-items-list .vinted-item-row');
    return Array.from(rows).map(row => ({
        cardKey:   row.dataset.cardKey,
        cardName:  row.querySelector('.vinted-item-row-name')?.textContent || '',
        imagePath: row.querySelector('.vinted-item-row-img')?.src || '',
        qty:       parseFloat(row.querySelector('.vinted-item-qty')?.value) || 1,
        unitPrice: parseFloat(row.querySelector('.vinted-item-price')?.value) || 0
    }));
}

// Ricalcola il totale nel modal (ma non sovrascrive se utente ha modificato manualmente)
function recalcModalTotal() {
    const items = readModalItems();
    const sum = calcItemsSum(items);
    document.getElementById('vinted-listing-total').value = sum.toFixed(2);
}

// ── MODAL ──────────────────────────────────────────────────────────────────

function openVintedModal(listingId) {
    vintedEditingId = listingId;
    vintedSelectedCard = null;

    const modal     = document.getElementById('vinted-modal');
    const titleEl   = document.getElementById('vinted-modal-title');
    const searchIn  = document.getElementById('vinted-card-search-input');
    const resultsEl = document.getElementById('vinted-card-search-results');
    const statusGrp = document.getElementById('vinted-status-group');
    const itemsList = document.getElementById('vinted-items-list');

    // Reset form
    searchIn.value = '';
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
    itemsList.innerHTML = '';
    document.getElementById('vinted-listing-url').value   = '';
    document.getElementById('vinted-listing-total').value = '0';
    document.getElementById('vinted-listing-id').value    = '';
    document.getElementById('vinted-url-open').disabled   = true;

    if (listingId) {
        // Edit mode
        const listing = vintedListings[listingId];
        if (!listing) return;

        titleEl.textContent = 'Modifica Inserzione';
        statusGrp.style.display = 'block';

        document.getElementById('vinted-listing-id').value     = listing.id;
        document.getElementById('vinted-listing-url').value    = listing.vintedUrl || '';
        document.getElementById('vinted-listing-status').value = listing.status || 'active';
        document.getElementById('vinted-url-open').disabled    = !listing.vintedUrl;

        // Carica items
        const items = listing.items || [];
        if (items.length > 0) {
            items.forEach(it => addVintedItemRow(it));
        } else if (listing.cardKey) {
            // Compatibilità struttura vecchia: converti in item
            const imgPath = listing.imagePath || '';
            addVintedItemRow({
                cardKey:   listing.cardKey,
                cardName:  listing.cardName || cleanCardId(listing.cardKey.split(':')[2] || ''),
                imagePath: imgPath,
                qty:       1,
                unitPrice: listing.price || 0
            });
        }

        // Totale
        const total = listing.totalPrice != null ? listing.totalPrice : calcItemsSum(listing.items || []);
        document.getElementById('vinted-listing-total').value = total.toFixed(2);

    } else {
        // New mode
        titleEl.textContent = 'Nuova Inserzione Vinted';
        statusGrp.style.display = 'none';
    }

    modal.classList.remove('hidden');
}

function closeVintedModal() {
    document.getElementById('vinted-modal').classList.add('hidden');
    vintedEditingId    = null;
    vintedSelectedCard = null;
}

async function saveVintedListingFromModal() {
    const url        = document.getElementById('vinted-listing-url').value.trim();
    const totalPrice = parseFloat(document.getElementById('vinted-listing-total').value) || 0;
    const id         = document.getElementById('vinted-listing-id').value || generateId();
    const status     = document.getElementById('vinted-listing-status')?.value || 'active';

    const items = readModalItems();

    if (items.length === 0) {
        alert('Aggiungi almeno una carta alla inserzione.');
        return;
    }

    const listing = {
        id:           id,
        items:        items,
        // Legacy: mantieni cardKey/cardName/imagePath dal primo item per retrocompatibilità
        cardKey:      items[0].cardKey,
        cardName:     items[0].cardName,
        imagePath:    items[0].imagePath,
        vintedUrl:    url || null,
        vintedItemId: extractVintedItemId(url),
        totalPrice:   totalPrice,
        // Legacy price
        price:        totalPrice,
        status:       vintedEditingId ? status : 'active',
        createdAt:    vintedListings[id]?.createdAt || new Date().toISOString(),
        soldAt:       vintedListings[id]?.soldAt    || null
    };

    vintedListings[id] = listing;
    await saveVintedListings();

    closeVintedModal();
    updateVintedSummary();
    renderVintedListings();
}

// ── AZIONI ────────────────────────────────────────────────────────────────

async function markListingAsSold(listingId) {
    const result = await window.electronAPI.markVintedSold(listingId);
    if (!result.success) {
        alert('Errore: ' + result.error);
        return;
    }

    // Aggiorna stato locale
    if (vintedListings[listingId]) {
        vintedListings[listingId].status = 'sold';
        vintedListings[listingId].soldAt = new Date().toISOString();
    }

    // Aggiorna la collection in memory (struttura multi-item)
    const newQuantities = result.newQuantities || {};
    Object.entries(newQuantities).forEach(([cardKey, qty]) => {
        if (qty <= 0) {
            delete appState.collection[cardKey];
        } else {
            appState.collection[cardKey] = qty;
        }
    });

    await loadVintedListings();
    updateAllStats();
    updateVintedSummary();
    renderVintedListings();
}

async function markListingAsRemoved(listingId) {
    if (!vintedListings[listingId]) return;
    vintedListings[listingId].status = 'removed';
    await saveVintedListings();
    updateVintedSummary();
    renderVintedListings();
}

async function deleteVintedListing(listingId) {
    if (!confirm('Eliminare questo record definitivamente?')) return;
    delete vintedListings[listingId];
    await saveVintedListings();
    updateVintedSummary();
    renderVintedListings();
}

// ── SYNC CON VINTED ───────────────────────────────────────────────────────

async function syncWithVinted() {
    const btn = document.getElementById('vinted-sync-btn');
    btn.disabled = true;

    const activeListings = Object.values(vintedListings).filter(
        l => l.status === 'active' && l.vintedUrl
    );

    if (activeListings.length === 0) {
        alert('Nessuna inserzione attiva con URL da controllare.');
        btn.disabled = false;
        return;
    }

    let markedSold = 0;
    let errors = 0;
    let skipped = 0;

    try {
        for (let i = 0; i < activeListings.length; i++) {
            const listing = activeListings[i];
            btn.textContent = `⏳ Controllo ${i + 1}/${activeListings.length}...`;

            const result = await window.electronAPI.checkVintedListingStatus(listing.vintedUrl);

            if (!result.success) {
                console.warn(`⚠️ Errore check listing ${listing.id}:`, result.error);
                errors++;
                continue;
            }

            if (!result.sold) {
                skipped++;
                continue;
            }

            const soldResult = await window.electronAPI.markVintedSold(listing.id);
            if (soldResult.success) {
                if (vintedListings[listing.id]) {
                    vintedListings[listing.id].status = 'sold';
                    vintedListings[listing.id].soldAt = new Date().toISOString();
                }
                const newQuantities = soldResult.newQuantities || {};
                Object.entries(newQuantities).forEach(([cardKey, qty]) => {
                    if (qty <= 0) {
                        delete appState.collection[cardKey];
                    } else {
                        appState.collection[cardKey] = qty;
                    }
                });
                markedSold++;
            } else {
                errors++;
            }
        }

        await window.electronAPI.saveVintedListings(vintedListings);
        await loadVintedListings();
        updateAllStats();
        updateVintedSummary();
        renderVintedListings();

        let msg = `✅ Sincronizzazione completata!\n`;
        msg += `• ${activeListings.length} inserzioni controllate\n`;
        if (markedSold > 0) msg += `• ${markedSold} marcate come vendute (stock aggiornato)\n`;
        if (skipped > 0)    msg += `• ${skipped} ancora attive su Vinted\n`;
        if (errors > 0)     msg += `• ${errors} errori (controlla la console)`;
        alert(msg);

    } catch (err) {
        alert('Errore durante la sincronizzazione: ' + err.message);
    } finally {
        btn.textContent = '🔄 Sincronizza Vinted';
        btn.disabled = false;
    }
}
