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
// CONFIG V1 (Risk limits)
// --------------------------------------------------
const MAX_OI = BigInt("1000000000000000"); // very high limit
const ALPHA = BigInt("1000000"); // 1e6 = 100%

// spread PRECISION = 1e6 (1000 = 0.1%)
const SPREAD_LONG  = BigInt("1000");
const SPREAD_SHORT = BigInt("1000");

const EXPIRY_SECONDS = 3600;

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

    // Same hashing layout as Core smart contract
    const hash = ethers.solidityPackedKeccak256(
      [
        "uint256", // maxOILong
        "uint256", // maxOIShort
        "uint256", // alphaLock
        "uint256", // spreadLong
        "uint256", // spreadShort
        "uint256"  // expiry
      ],
      [
        MAX_OI,
        MAX_OI,
        ALPHA,
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
      alphaLock: ALPHA.toString(),
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
