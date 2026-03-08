# 🏴‍☠️ ONE PIECE TCG Collection Manager

Applicazione desktop per gestire la tua collezione di carte ONE PIECE TCG.

![Electron](https://img.shields.io/badge/Electron-33.2.0-blue)
![Node](https://img.shields.io/badge/Node.js-Required-green)

## 🎯 Caratteristiche

- 📦 **Database Scanner** - Scansiona automaticamente le carte dal tuo database locale
- 🌍 **Multi-lingua** - Supporta carte in più lingue (JAP, ENG, ITA, etc.)
- 🎴 **Gestione Collezione** - Aggiungi quantità per ogni carta posseduta
- 📊 **Statistiche** - Visualizza il completamento della collezione in tempo reale
- 🔍 **Ricerca Avanzata** - Trova carte rapidamente per ID o nome
- 🎨 **UI Moderna** - Interfaccia grafica intuitiva e responsive
- 💾 **Salvataggio Automatico** - La tua collezione viene salvata localmente

## 🚀 Installazione

### Prerequisiti
- Node.js (v14 o superiore)
- npm

### Setup

1. Clona o scarica il progetto
2. Installa le dipendenze:
```bash
npm install
```

3. Avvia l'applicazione:
```bash
npm start
```

Per sviluppo con DevTools:
```bash
npm run dev
```

## 📖 Come Usare

### Prima Configurazione

1. **Avvia l'applicazione**
2. Clicca su "Seleziona Cartella Database"
3. Naviga alla cartella `downloads` del tuo scraper (es: `C:\...\OP TCG CODE\downloads\ONE PIECE`)
4. L'app scansionerà automaticamente tutte le carte

### Gestione Collezione

1. **Visualizza Carte**
   - Seleziona una lingua dalla sidebar
   - Filtra per espansione specifica o visualizza tutte

2. **Aggiungi Carte alla Collezione**
   - Clicca su una carta per aprire il dettaglio
   - Usa i pulsanti +/- per modificare la quantità
   - Clicca "Salva" per confermare

3. **Ricerca e Filtri**
   - Usa la barra di ricerca per trovare carte per ID
   - Attiva "Mostra solo possedute" per vedere la tua collezione
   - Attiva "Mostra solo mancanti" per vedere cosa ti serve

### Statistiche

L'header mostra sempre:
- **Carte Database**: Totale carte disponibili nel database
- **Carte Possedute**: Numero totale di carte nella tua collezione
- **Completamento**: Percentuale di carte uniche possedute

## 📁 Struttura Progetto

```
OP TCG Collection Manager/
├── main.js              # Processo principale Electron
├── preload.js           # Bridge sicuro main↔renderer
├── renderer.js          # Logica interfaccia utente
├── index.html           # Interfaccia grafica
├── styles.css           # Stili UI
├── package.json         # Configurazione npm
└── README.md            # Questo file
```

## 🗄️ Formato Database

L'applicazione si aspetta questa struttura di cartelle:

```
downloads/
└── ONE PIECE/
    ├── JAP/
    │   ├── ブースターパック ROMANCE DAWN【OP-01】/
    │   │   ├── OP01-001.png
    │   │   ├── OP01-002.png
    │   │   └── ...
    │   ├── スタートデッキ 麦わらの一味【ST-01】/
    │   └── ...
    ├── ENG/
    └── ITA/
```

## 💾 Dati Salvati

L'applicazione salva:
- **collection.json**: Quantità per ogni carta posseduta
- **settings.json**: Percorso del database e preferenze

I file sono salvati in: `%APPDATA%/op-tcg-collection-manager/`

## 🛠️ Sviluppo

### Debug con DevTools Electron

Per connettersi all'app con gli MCP tools:
```bash
npm run dev
```

Questo apre l'app sulla porta 9222 per il debug remoto.

### Tecnologie Usate

- **Electron**: Framework desktop multi-piattaforma
- **IPC (Inter-Process Communication)**: Comunicazione sicura main↔renderer
- **Node.js fs/promises**: Scansione file asincrona
- **Vanilla JavaScript**: Nessuna dipendenza frontend pesante

## 🎨 Personalizzazione

### Modificare i Colori

Modifica le variabili CSS in `styles.css`:
```css
:root {
    --primary-color: #e74c3c;    /* Rosso principale */
    --secondary-color: #3498db;  /* Blu secondario */
    --success-color: #2ecc71;    /* Verde successo */
}
```

## 🐛 Troubleshooting

### L'app non trova le carte
- Verifica che la struttura delle cartelle sia corretta
- Assicurati di selezionare la cartella `ONE PIECE`, non `downloads`

### Le immagini non si caricano
- Controlla che i file siano .png o .jpg
- Verifica i permessi di lettura sulla cartella

### La collezione non viene salvata
- Controlla i permessi di scrittura in `%APPDATA%`
- Verifica che non ci siano errori nella console DevTools

## 📝 TODO / Future Features

- [ ] Export collezione in PDF/CSV
- [ ] Import/Export backup collezione
- [ ] Statistiche avanzate per espansione
- [ ] Modalità scura/chiara
- [ ] Supporto carte inglesi con traduzione
- [ ] Wishlist carte mancanti
- [ ] Confronto collezioni con altri utenti

## 📄 Licenza

MIT License - Sentiti libero di modificare e distribuire!

## 👤 Autore

Lorenzo - ONE PIECE TCG Collector

## 🤝 Contributi

Contributi, issues e feature requests sono benvenuti!

---

Buon collezionismo! 🏴‍☠️✨
