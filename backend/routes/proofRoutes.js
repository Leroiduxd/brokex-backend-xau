const express = require('express');
const supraProofService = require('../services/supraProofService');
const router = express.Router();

/**
 * GET /proof?pairs=0,1,2
 * Unifie l'accès à la proof avec supraProofService (cache & tolérance de panne RPC/REST)
 */
router.get('/proof', async (req, res) => {
  const query = req.query.pairs;
  if (!query) return res.status(400).json({ error: 'Missing ?pairs=0,1,2' });

  const pairIndexes = String(query)
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));

  if (!pairIndexes.length) return res.status(400).json({ error: 'No valid pair indexes' });

  try {
    const proof = await supraProofService.getSupraProof(pairIndexes);
    res.json({ proof });
  } catch (e) {
    console.error('[Proof Route] error:', e.message);
    res.status(503).json({ error: 'Failed to fetch proof' });
  }
});

module.exports = router;
