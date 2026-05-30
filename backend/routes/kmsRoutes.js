const express = require('express');
const { ethers } = require('ethers');
const config = require('../config/config');

const router = express.Router();

// Initialize testnet & mainnet wallets for risk signing
const signerTestnet = new ethers.Wallet(config.testnet.KMS_PRIVATE_KEY);
const signerMainnet = config.mainnet.KMS_PRIVATE_KEY 
  ? new ethers.Wallet(config.mainnet.KMS_PRIVATE_KEY) 
  : null;

// --------------------------------------------------
// CONFIG V2 (Risk limits - AlphaLock removed)
// --------------------------------------------------
const MAX_OI = BigInt("1000000000000000000"); // Extremely high limit (10^18)
const SPREAD_LONG  = BigInt("100");           // Very low spread (0.01% with 1e6 precision)
const SPREAD_SHORT = BigInt("100");           // Very low spread (0.01% with 1e6 precision)
const EXPIRY_SECONDS = 45;                    // Proof expires in 45 seconds

/**
 * GET /kms-proof?network=testnet
 * Generates and signs a KMS/Risk proof on the fly
 */
router.get('/kms-proof', async (req, res) => {
  try {
    const network = req.query.network || 'testnet';
    const signer = network === 'mainnet' ? signerMainnet : signerTestnet;

    if (!signer) {
      return res.status(400).json({
        error: `KMS Private Key for MAINNET is not configured in .env. Please define MAINNET_KMS_PRIVATE_KEY.`
      });
    }

    const expiry = Math.floor(Date.now() / 1000) + EXPIRY_SECONDS;

    // Same hashing layout as Core smart contract (alphaLock removed)
    const hash = ethers.solidityPackedKeccak256(
      [
        "uint256", // maxOILong
        "uint256", // maxOIShort
        "uint256", // spreadLong
        "uint256", // spreadShort
        "uint256"  // expiry
      ],
      [
        MAX_OI,
        MAX_OI,
        SPREAD_LONG,
        SPREAD_SHORT,
        expiry
      ]
    );

    const signature = await signer.signMessage(
      ethers.getBytes(hash)
    );

    res.json({
      signer: signer.address,
      maxOILong:  MAX_OI.toString(),
      maxOIShort: MAX_OI.toString(),
      spreadLong: SPREAD_LONG.toString(),
      spreadShort: SPREAD_SHORT.toString(),
      expiry,
      signature
    });

  } catch (err) {
    console.error("[KMS-Proof Route] Error:", err);
    res.status(500).json({
      error: err.message
    });
  }
});

module.exports = router;
