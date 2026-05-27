module.exports = {
  symbols: [
    "Metal.XAU/USD",
  ],

  historyStartDate: "2025-01-01",

  generatedTimeframes: ["5", "15", "30", "60", "240", "1440"],

  apiResponse: {
    defaultDays: 7,
    maxDays: 365
  },

  // --- LIMITES API PYTH ---
  api: {
    maxRequests: 1,        // Nombre de requêtes autorisées
    windowSeconds: 10,     // Dans cet intervalle de secondes
    retry429DelayMs: 20000 // Pause initiale si 429 (doublée à chaque fois)
  },

  server: {
    port: 3000
  },

  storage: {
    basePath: "./data"
  }
};
