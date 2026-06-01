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

/**
 * GET /kms-proof?network=testnet&supraId=0
 * Generates and signs a KMS/Risk proof on the fly compatible with the updated contract
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

    // Default supraId to 0 (Gold) if not provided
    const supraIdVal = req.query.supraId !== undefined ? req.query.supraId : '0';
    const supraId = BigInt(supraIdVal);

    const timestamp = Math.floor(Date.now() / 1000);

    // Same standard hashing layout as Core smart contract:
    // abi.encode(supraId, maxOILong, maxOIShort, spreadLong, spreadShort, timestamp)
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const hash = ethers.keccak256(
      coder.encode(
        ["uint256", "uint256", "uint256", "uint256", "uint256", "uint256"],
        [supraId, MAX_OI, MAX_OI, SPREAD_LONG, SPREAD_SHORT, timestamp]
      )
    );

    const signature = await signer.signMessage(
      ethers.getBytes(hash)
    );

    res.json({
      signer: signer.address,
      supraId: supraId.toString(),
      maxOILong:  MAX_OI.toString(),
      maxOIShort: MAX_OI.toString(),
      spreadLong: SPREAD_LONG.toString(),
      spreadShort: SPREAD_SHORT.toString(),
      timestamp,
      sig: signature
    });

  } catch (err) {
    console.error("[KMS-Proof Route] Error:", err);
    res.status(500).json({
      error: err.message
    });
  }
});

module.exports = router;
