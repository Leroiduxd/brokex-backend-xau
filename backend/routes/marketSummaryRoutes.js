const express = require('express');
const marketSummaryService = require('../services/marketSummaryService');
const pythPriceDiffService = require('../services/pythPriceDiffService');
const router = express.Router();

/**
 * GET /market-summary
 * Retourne le résumé de tous les actifs configurés
 */
router.get('/market-summary', async (req, res) => {
  try {
    const summary = await marketSummaryService.getSummary();
    res.json(summary);
  } catch (error) {
    console.error("Erreur Route Market Summary:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * GET /price-differences
 * Retourne les price differences filtrées de Pyth (mise à jour horaire)
 */
router.get('/price-differences', async (req, res) => {
  try {
    const data = await pythPriceDiffService.getData();
    res.json(data);
  } catch (error) {
    console.error("Erreur Route Price Differences:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
