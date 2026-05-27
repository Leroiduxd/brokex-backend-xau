// services/supraProofService.js (CommonJS) — client Supra DORA inline
const axios = require('axios');

// ── Config en dur
const DORA_RPC   = 'https://rpc-testnet-dora-2.supra.com';
const DORA_CHAIN = 'evm';

// ─────────────────────────────────────────────────────────────
// Client minimal tolérant pour Supra DORA Pull (getProof)
// Essaie plusieurs endpoints & formats connus (JSON-RPC & REST).
// ─────────────────────────────────────────────────────────────
class PullServiceClient {
  constructor(address) {
    this.address = address.replace(/\/+$/, '');
    this.timeoutMs = 12_000;
  }

  async _post(url, body) {
    try {
      const res = await axios.post(url, body, {
        headers: { 'content-type': 'application/json' },
        timeout: this.timeoutMs,
      });
      return res.data;
    } catch (error) {
      const status = error.response?.status || 'Error';
      const statusText = error.response?.statusText || error.message;
      const dataStr = error.response?.data ? JSON.stringify(error.response.data) : '';
      throw new Error(`HTTP ${status} ${statusText} @ ${url} :: ${dataStr.slice(0, 200)}`);
    }
  }

  /**
   * getProof({ pair_indexes: number[], chain_type: "evm" | ... })
   * Retourne un objet { proof_bytes: "0x..." , ... }
   */
  async getProof({ pair_indexes, chain_type }) {
    if (!Array.isArray(pair_indexes) || pair_indexes.length === 0) {
      throw new Error('pair_indexes must be a non-empty array');
    }
    const chain = chain_type || 'evm';

    // Candidats: chemins et formats (certains environnements DORA exposent JSON-RPC root, d'autres /v2/pull/…)
    const endpoints = [
      // JSON-RPC au root
      {
        url: `${this.address}`,
        body: { id: 1, jsonrpc: '2.0', method: 'get_proof', params: { pair_indexes, chain_type: chain } },
        pick: (j) => j?.result?.proof_bytes || j?.result?.proofBytes || j?.proof_bytes || j?.proofBytes,
      },
      // JSON-RPC sur /rpc
      {
        url: `${this.address}/rpc`,
        body: { id: 1, jsonrpc: '2.0', method: 'get_proof', params: { pair_indexes, chain_type: chain } },
        pick: (j) => j?.result?.proof_bytes || j?.result?.proofBytes || j?.proof_bytes || j?.proofBytes,
      },
      // REST-style (v2/pull)
      {
        url: `${this.address}/v2/pull/get_proof`,
        body: { pair_indexes, chain_type: chain },
        pick: (j) => j?.proof_bytes || j?.proofBytes || j?.data?.proof_bytes || j?.data?.proofBytes,
      },
      // REST-style (pull-service)
      {
        url: `${this.address}/pull-service/get_proof`,
        body: { pair_indexes, chain_type: chain },
        pick: (j) => j?.proof_bytes || j?.proofBytes || j?.data?.proof_bytes || j?.data?.proofBytes,
      },
      // REST-style (get_proof à la racine)
      {
        url: `${this.address}/get_proof`,
        body: { pair_indexes, chain_type: chain },
        pick: (j) => j?.proof_bytes || j?.proofBytes || j?.data?.proof_bytes || j?.data?.proofBytes,
      },
    ];

    let lastErr;
    for (const cand of endpoints) {
      try {
        const json = await this._post(cand.url, cand.body);
        const proof = cand.pick(json);
        if (proof) return { proof_bytes: String(proof) };
        // Certains renvoient { data: { proof_bytes } }
        if (json?.data?.proof_bytes) return { proof_bytes: String(json.data.proof_bytes) };
        lastErr = new Error(`No proof_bytes in response from ${cand.url}`);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Unable to fetch proof from any known endpoint');
  }
}

// ─────────────────────────────────────────────────────────────
// Client Supra DORA Pull et cache global (1s) unifié
// ─────────────────────────────────────────────────────────────
const client = new PullServiceClient(DORA_RPC);
const cache = new Map(); // key = "0,1,2" ; value = { proof, timestamp }

/**
 * Fetch caching Supra DORA oracle pull proof for specific asset pair indexes.
 * @param {number[]} pairIndexes Array of pair indexes (e.g. [5500] for XAU/USD)
 * @returns {Promise<string>} The proof hex string (starts with '0x')
 */
async function getSupraProof(pairIndexes) {
  const key = [...pairIndexes].sort((a, b) => a - b).join(',');
  const now = Date.now();
  const cached = cache.get(key);
  
  if (cached) {
    if (now - cached.timestamp < 1000) {
      console.log(`🔄 [SupraProofService Cache] hit pairs=[${key}] age=${now - cached.timestamp}ms`);
      return cached.proof;
    } else {
      // Nettoie activement de la mémoire si expiré
      cache.delete(key);
    }
  }

  console.log(`🌐 [SupraProofService Fetch] Fetching oracle proof for pairs: [${key}]...`);
  const data = await client.getProof({ pair_indexes: pairIndexes, chain_type: DORA_CHAIN });
  const proofBytes = data.proof_bytes;
  const proof = String(proofBytes).startsWith('0x') ? proofBytes : '0x' + proofBytes;

  cache.set(key, { proof, timestamp: now });

  // Supprime activement de la mémoire après exactement 1 seconde
  setTimeout(() => {
    const entry = cache.get(key);
    if (entry && entry.timestamp === now) {
      cache.delete(key);
      console.log(`🗑️ [SupraProofService Cache] cleared memory for pairs=[${key}]`);
    }
  }, 1000);

  return proof;
}

module.exports = {
  getSupraProof
};
