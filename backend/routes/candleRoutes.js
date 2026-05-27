const express = require('express');
const config = require('../config');
const storageService = require('../services/storageService');
const router = express.Router();

/**
 * GET /candles?symbol=...&timeframe=...&days=7
 */
router.get('/candles', async (req, res) => {
  try {
    const { symbol, timeframe } = req.query;
    let { days } = req.query;

    if (!symbol || !timeframe) {
      return res.status(400).json({ error: "Missing symbol or timeframe" });
    }

    // Charger les données depuis le disque
    let candles = await storageService.load(symbol, timeframe);
    
    // Logique de filtrage par jours
    const requestedDays = parseFloat(days) || config.apiResponse.defaultDays;
    const finalDays = Math.min(requestedDays, config.apiResponse.maxDays);
    
    const nowTs = Math.floor(Date.now() / 1000);
    const filterTs = nowTs - (finalDays * 24 * 60 * 60);

    const filteredData = candles.filter(c => c.time >= filterTs);

    res.json({
      symbol,
      timeframe,
      requestedDays: finalDays,
      count: filteredData.length,
      data: filteredData
    });

  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
