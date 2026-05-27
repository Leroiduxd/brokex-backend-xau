const axios = require('axios');

/**
 * Fetch AWS KMS-signed Risk Proof from the Brokex API.
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
 * @returns {Promise<Object>}
 */
async function getKmsProof() {
  try {
    const url = 'https://backend.brokex.trade/kms-proof';
    console.log('[KmsProofService] Fetching KMS risk proof...');
    
    const response = await axios.get(url);
    if (response.data) {
      return response.data;
    }
    throw new Error('No data returned from KMS proof service');
  } catch (error) {
    console.error('[KmsProofService] Failed to fetch KMS proof:', error.message);
    throw error;
  }
}

module.exports = {
  getKmsProof
};
