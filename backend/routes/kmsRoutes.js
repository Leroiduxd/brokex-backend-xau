const express = require('express');
const { ethers } = require('ethers');

const router = express.Router();

// Récupération de la clé de signature KMS via ENV ou fallback
const KMS_PRIVATE_KEY =
  process.env.KMS_PRIVATE_KEY ||
  "0xe12f9b03327a875c2d5bf9b40a75cd2effeed46ea508ee595c6bc708c386da8c";

const signer = new ethers.Wallet(KMS_PRIVATE_KEY);

// --------------------------------------------------
// CONFIG V1
// --------------------------------------------------
const MAX_OI = BigInt("1000000000000000"); // très haut
const ALPHA = BigInt("1000000"); // 1e6 = 100%

// spread PRECISION = 1e6
// 1000 = 0.1%
const SPREAD_LONG  = BigInt("1000");
const SPREAD_SHORT = BigInt("1000");

const EXPIRY_SECONDS = 3600;

// --------------------------------------------------

/**
 * GET /kms-proof
 * Génère et signe une proof KMS/Risk à la volée
 */
router.get('/kms-proof', async (_req, res) => {
  try {
    const expiry = Math.floor(Date.now() / 1000) + EXPIRY_SECONDS;

    // même hash que le Core
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
