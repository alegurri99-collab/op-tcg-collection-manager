// ============================================================================
// FIREBASE CONFIG — UnPezzo-Collection-Manager
// ============================================================================
// Config web Firebase (pubblica per design; la sicurezza è nelle Security Rules).
// Dual-mode: usabile sia via require() nel main process / script Node, sia come
// <script> nel browser (dev server), dove viene esposta su globalThis.firebaseConfig.
// ============================================================================

const firebaseConfig = {
    apiKey: "AIzaSyD9oxWVjMcuPKImHRb2ntkHbXgvTtABh8I",
    authDomain: "unpezzo-collectin.firebaseapp.com",
    projectId: "unpezzo-collectin",
    storageBucket: "unpezzo-collectin.firebasestorage.app",
    messagingSenderId: "290598240568",
    appId: "1:290598240568:web:b690fab14f71220d70c1cd",
    measurementId: "G-WFT46DL402"
};

// Node (main process / script): export CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { firebaseConfig };
}

// Browser (dev server): esponi come global per dev-polyfill.js
if (typeof globalThis !== 'undefined') {
    globalThis.firebaseConfig = firebaseConfig;
}
