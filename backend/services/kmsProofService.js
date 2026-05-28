const axios = require('axios');
const config = require('../config/config');

/**
 * Fetch AWS KMS-signed Risk Proof from the local Brokex API.
 * Expected return structure:
 * {
 *   signer,
 *   maxOILong,
 *   maxOIShort,
 *   alphaLock,
 *   spreadLong,
 *   spreadShort,
 *   expiry,
 *   signature
 * }
 * Supports: getKmsProof(network)
 * @param {string} network 'testnet' | 'mainnet'
 * @returns {Promise<Object>}
 */
async function getKmsProof(network = 'testnet') {
  try {
    const port = config.PORT || 3000;
    const url = `http://localhost:${port}/kms-proof?network=${network}`;
    console.log(`[KmsProofService] Fetching KMS risk proof for ${network.toUpperCase()}...`);
    
    const response = await axios.get(url);
    if (response.data) {
      return response.data;
    }
    throw new Error('No data returned from KMS proof service');
  } catch (error) {
    console.error(`[KmsProofService] Failed to fetch KMS proof for ${network.toUpperCase()}:`, error.message);
    throw error;
  }
}

module.exports = {
  getKmsProof
};
