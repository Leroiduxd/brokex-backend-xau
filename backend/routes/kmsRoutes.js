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
// Super high max open interest limits
const MAX_OI = BigInt("1000000000000000000000000000"); 

// Extremely low spreads (PRECISION = 1e6, where 10 = 0.001%)
const SPREAD_LONG  = BigInt("10");
const SPREAD_SHORT = BigInt("10");

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

    // Same standard hashing layout as Core smart contract (abi.encode equivalent)
    const hash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
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
      )
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
