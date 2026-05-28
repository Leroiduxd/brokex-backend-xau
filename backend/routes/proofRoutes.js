const express = require('express');
const supraProofService = require('../services/supraProofService');
const router = express.Router();

/**
 * GET /proof?pairs=5500&network=mainnet
 * GET /proof?pairs=5500&network=testnet
 * Unifies access to the proof with supraProofService (cache & RPC/REST auto-fallback)
 */
router.get('/proof', async (req, res) => {
  const query = req.query.pairs;
  const network = req.query.network || 'testnet'; // Read network parameter, defaults to testnet

  if (!query) return res.status(400).json({ error: 'Missing ?pairs=0,1,2' });

  const pairIndexes = String(query)
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));

  if (!pairIndexes.length) return res.status(400).json({ error: 'No valid pair indexes' });

  try {
    const proof = await supraProofService.getSupraProof(pairIndexes, network);
    res.json({ proof });
  } catch (e) {
    console.error(`[Proof Route] [${network.toUpperCase()}] error:`, e.message);
    res.status(503).json({ error: `Failed to fetch proof for ${network}` });
  }
});

module.exports = router;
