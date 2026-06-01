const express = require('express');
const { ethers } = require('ethers');
const config = require('../config/config');
const lensAbi = require('../abi/lensAbi');

const router = express.Router();

// Initialize providers and contracts maps
const providers = {
  testnet: new ethers.JsonRpcProvider(config.testnet.RPC_URL),
  mainnet: config.mainnet.RPC_URL ? new ethers.JsonRpcProvider(config.mainnet.RPC_URL) : null
};

const lensContracts = {
  testnet: new ethers.Contract((config.testnet.LENS_ADDRESS || '').toLowerCase(), lensAbi, providers.testnet),
  mainnet: config.mainnet.RPC_URL && config.mainnet.LENS_ADDRESS 
    ? new ethers.Contract((config.mainnet.LENS_ADDRESS || '').toLowerCase(), lensAbi, providers.mainnet) 
    : null
};

// Initialize testnet & mainnet wallets for risk signing
const signerTestnet = new ethers.Wallet(config.testnet.KMS_PRIVATE_KEY);
const signerMainnet = config.mainnet.KMS_PRIVATE_KEY 
  ? new ethers.Wallet(config.mainnet.KMS_PRIVATE_KEY) 
  : null;

// Enforce distinct keys for testnet and mainnet
if (signerMainnet && signerTestnet.privateKey.toLowerCase() === signerMainnet.privateKey.toLowerCase()) {
  throw new Error("CRITICAL CONFIG ERROR: TESTNET_KMS_PRIVATE_KEY and MAINNET_KMS_PRIVATE_KEY must not be the same private key!");
}

const DIR_LONG = 1;
const DIR_SHORT = 2;
const PRECISION = 1000000n;

// KMS spreads and skew config parameters
const BASE_SPREAD = 100n; // 0.01% base spread
const MIN_RATIO = 1200000n; // 1.2x min ratio
const MAX_RATIO = 2000000n; // 2.0x max ratio
const K = 50000000000n; // 50,000 USDC with 6 decimals

// Binary search for maximum dominant open interest allowed
function getMaxSideOI(minorityOI, buffer, minRatio, maxRatio, k, maxGlobalOI) {
  if (minorityOI === 0n) {
    return buffer;
  }

  let low = minorityOI;
  let high = maxGlobalOI;
  let ans = minorityOI;

  const k2 = k * k;

  while (low <= high) {
    let mid = (low + high) / 2n;
    let total = mid + minorityOI;

    if (total <= buffer) {
      ans = mid;
      low = mid + 1n;
      continue;
    }

    let x = total - buffer;
    let R = minRatio + ((maxRatio - minRatio) * k2) / (x * x + k2);
    let limit = (minorityOI * R) / PRECISION;

    if (mid <= limit) {
      ans = mid;
      low = mid + 1n;
    } else {
      high = mid - 1n;
    }
  }

  if (ans < buffer - minorityOI) {
    ans = buffer - minorityOI;
  }

  if (ans > maxGlobalOI) {
    ans = maxGlobalOI;
  }

  return ans;
}

function smoothstepSkew(longOI, shortOI) {
  const total = longOI + shortOI;
  if (total === 0n) return 0n;
  const diff = longOI > shortOI ? longOI - shortOI : shortOI - longOI;
  const r = (diff * PRECISION) / total;
  const r2 = (r * r) / PRECISION;
  return (r2 * (3n * PRECISION - 2n * r)) / PRECISION;
}

function calculateSkewSpread(direction, longOI, shortOI, baseSpread) {
  const total = longOI + shortOI;
  if (total === 0n || longOI === shortOI) {
    return baseSpread;
  }

  const p = smoothstepSkew(longOI, shortOI);
  const isDominant = (direction === DIR_LONG && longOI > shortOI) ||
                     (direction === DIR_SHORT && shortOI > longOI);

  if (isDominant) {
    return (baseSpread * (PRECISION + 3n * p)) / PRECISION;
  } else {
    const red = (200000n * p) / PRECISION;
    const spreadFactor = PRECISION > red ? PRECISION - red : 0n;
    return (baseSpread * spreadFactor) / PRECISION;
  }
}

/**
 * Main proof builder function
 */
async function buildKmsProof(network, supraIdVal) {
  const supraId = BigInt(supraIdVal || '0');

  // Rule 3: Only asset 5500 is allowed. Any other assetId MUST NOT be signed.
  if (supraId !== 5500n) {
    return { error: 'nap', status: 403 };
  }

  const signer = network === 'mainnet' ? signerMainnet : signerTestnet;
  if (!signer) {
    return { error: `KMS Private Key for ${network.toUpperCase()} is not configured in .env.`, status: 400 };
  }

  const lensContract = lensContracts[network];
  if (!lensContract) {
    return { error: `Lens contract instance for ${network.toUpperCase()} is not initialized.`, status: 400 };
  }

  // Rule 2: The backend MUST read protocol state directly from getAssetSnapshot(assetId)
  const snapshot = await lensContract.getAssetSnapshot(supraId);
  
  const openInterestLong = BigInt(snapshot.openInterestLong.toString());
  const openInterestShort = BigInt(snapshot.openInterestShort.toString());
  const totalOpenInterest = BigInt(snapshot.totalOpenInterest.toString());
  const maxGlobalOI = BigInt(snapshot.config.maxGlobalOI.toString());

  // Buffer is dynamic: 10% of global OI
  const buffer = maxGlobalOI / 10n;

  let maxOILong, maxOIShort;
  let spreadLong, spreadShort;

  if (network === 'testnet') {
    // For testnet, keep max open interest super high as requested
    maxOILong = 1000000000000000000n; // 1e18
    maxOIShort = 1000000000000000000n; // 1e18
    
    // Spread calculation: baseSpread or skew spread depending on totalOpenInterest vs buffer
    if (totalOpenInterest <= buffer) {
      spreadLong = BASE_SPREAD;
      spreadShort = BASE_SPREAD;
    } else {
      spreadLong = calculateSkewSpread(DIR_LONG, openInterestLong, openInterestShort, BASE_SPREAD);
      spreadShort = calculateSkewSpread(DIR_SHORT, openInterestLong, openInterestShort, BASE_SPREAD);
    }
  } else {
    // For mainnet, compute actual OI skew/imbalance constraints strictly
    maxOILong = getMaxSideOI(openInterestShort, buffer, MIN_RATIO, MAX_RATIO, K, maxGlobalOI);
    maxOIShort = getMaxSideOI(openInterestLong, buffer, MIN_RATIO, MAX_RATIO, K, maxGlobalOI);

    if (totalOpenInterest <= buffer) {
      spreadLong = BASE_SPREAD;
      spreadShort = BASE_SPREAD;
    } else {
      spreadLong = calculateSkewSpread(DIR_LONG, openInterestLong, openInterestShort, BASE_SPREAD);
      spreadShort = calculateSkewSpread(DIR_SHORT, openInterestLong, openInterestShort, BASE_SPREAD);
    }
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // ABI encode: (supraId, maxOILong, maxOIShort, spreadLong, spreadShort, timestamp)
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const hash = ethers.keccak256(
    coder.encode(
      ["uint256", "uint256", "uint256", "uint256", "uint256", "uint256"],
      [supraId, maxOILong, maxOIShort, spreadLong, spreadShort, timestamp]
    )
  );

  const signature = await signer.signMessage(ethers.getBytes(hash));

  return {
    signer: signer.address,
    supraId: supraId.toString(),
    maxOILong: maxOILong.toString(),
    maxOIShort: maxOIShort.toString(),
    spreadLong: spreadLong.toString(),
    spreadShort: spreadShort.toString(),
    timestamp: timestamp,
    sig: signature
  };
}

/**
 * Dedicated Testnet Endpoint
 */
router.get(['/kms-proof/testnet', '/kms-proof/testnet/:supraId'], async (req, res) => {
  let supraIdVal = '0';
  if (req.params.supraId !== undefined) {
    supraIdVal = req.params.supraId;
  } else if (req.query.supraId !== undefined) {
    supraIdVal = req.query.supraId;
  }

  try {
    const result = await buildKmsProof('testnet', supraIdVal);
    if (result.error) {
      if (result.error === 'nap') {
        return res.status(403).json({ status: "nap" });
      }
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error("[KMS-Proof Testnet Route] Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Dedicated Mainnet Endpoint
 */
router.get(['/kms-proof/mainnet', '/kms-proof/mainnet/:supraId'], async (req, res) => {
  let supraIdVal = '0';
  if (req.params.supraId !== undefined) {
    supraIdVal = req.params.supraId;
  } else if (req.query.supraId !== undefined) {
    supraIdVal = req.query.supraId;
  }

  try {
    const result = await buildKmsProof('mainnet', supraIdVal);
    if (result.error) {
      if (result.error === 'nap') {
        return res.status(403).json({ status: "nap" });
      }
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error("[KMS-Proof Mainnet Route] Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Combined / Fallback Endpoint (Supports network query param, defaults to testnet)
 */
router.get(['/kms-proof', '/kms-proof/:supraId'], async (req, res) => {
  const network = req.query.network || 'testnet';
  let supraIdVal = '0';
  if (req.params.supraId !== undefined) {
    supraIdVal = req.params.supraId;
  } else if (req.query.supraId !== undefined) {
    supraIdVal = req.query.supraId;
  }

  try {
    const result = await buildKmsProof(network, supraIdVal);
    if (result.error) {
      if (result.error === 'nap') {
        return res.status(403).json({ status: "nap" });
      }
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error("[KMS-Proof Fallback Route] Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
