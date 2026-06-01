const express = require('express');
const { ethers } = require('ethers');
const config = require('../config/config');
const lensAbi = require('../abi/lensAbi');

const router = Router();

function Router() {
  return express.Router();
}

// Import centrally managed, rate-limited providers
const { readProviders } = require('../services/providerService');

const lensContracts = {
  testnet: new ethers.Contract((config.testnet.LENS_ADDRESS || '').toLowerCase(), lensAbi, readProviders.testnet),
  mainnet: config.mainnet.RPC_URL && config.mainnet.LENS_ADDRESS 
    ? new ethers.Contract((config.mainnet.LENS_ADDRESS || '').toLowerCase(), lensAbi, readProviders.mainnet) 
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

// Centralized configurations parsed to BigInt on initialization
const MIN_RATIO = BigInt(config.KMS_MIN_RATIO || "1200000");
const MAX_RATIO = BigInt(config.KMS_MAX_RATIO || "2000000");
const K = BigInt(config.KMS_K || "50000000000");
const BASE_SPREAD = BigInt(config.KMS_BASE_SPREAD || "100");

// Memory cache for asset 5500 snapshots across networks
const snapshotCache = {
  testnet: null,
  mainnet: null
};

/**
 * Background worker to fetch snapshot and update cache
 */
async function updateSnapshotCache(network) {
  try {
    const lensContract = lensContracts[network];
    if (!lensContract) return;

    // We fetch for asset 5500n
    const snapshot = await lensContract.getAssetSnapshot(5500n);
    snapshotCache[network] = {
      openInterestLong: BigInt(snapshot.openInterestLong.toString()),
      openInterestShort: BigInt(snapshot.openInterestShort.toString()),
      totalOpenInterest: BigInt(snapshot.totalOpenInterest.toString()),
      maxGlobalOI: BigInt(snapshot.config.maxGlobalOI.toString()),
      lastUpdated: Date.now()
    };
    console.log(`[KMS-Cache] [${network.toUpperCase()}] Snapshot successfully cached.`);
  } catch (err) {
    console.error(`[KMS-Cache] [${network.toUpperCase()}] Background sync failed:`, err.message);
  }
}

/**
 * Initialize 10-second polling worker
 */
function startPollingWorker() {
  console.log("[KMS-Cache] Starting background polling worker (5-second interval)...");
  
  // Initial prime
  updateSnapshotCache('testnet');
  if (config.mainnet.RPC_URL && config.mainnet.LENS_ADDRESS) {
    updateSnapshotCache('mainnet');
  }

  // Periodic worker
  setInterval(() => {
    updateSnapshotCache('testnet');
    if (config.mainnet.RPC_URL && config.mainnet.LENS_ADDRESS) {
      updateSnapshotCache('mainnet');
    }
  }, 5000);
}

// Boot worker
startPollingWorker();

// Binary search for maximum dominant open interest allowed (capped at maxGlobalOI / 2)
function getMaxSideOI(minorityOI, buffer, minRatio, maxRatio, k, maxGlobalOI) {
  const cap = maxGlobalOI / 2n;

  if (minorityOI === 0n) {
    return buffer > cap ? cap : buffer;
  }

  // Binary search range capped at maxGlobalOI / 2
  let low = minorityOI;
  let high = cap;
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

  if (ans > cap) {
    ans = cap;
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
 * Main proof builder function (instantaneous cache-driven generation)
 */
async function buildKmsProof(network, supraIdVal) {
  const supraId = BigInt(supraIdVal || '0');

  // Only asset 5500 is allowed. Any other assetId MUST NOT be signed.
  if (supraId !== 5500n) {
    return { error: 'nap', status: 403 };
  }

  const signer = network === 'mainnet' ? signerMainnet : signerTestnet;
  if (!signer) {
    return { error: `KMS Private Key for ${network.toUpperCase()} is not configured in .env.`, status: 400 };
  }

  // Attempt to read from memory cache
  let cached = snapshotCache[network];
  if (!cached) {
    console.warn(`[KMS-Cache] Cache miss for ${network.toUpperCase()}. Fetching synchronously...`);
    const lensContract = lensContracts[network];
    if (!lensContract) {
      return { error: `Lens contract instance for ${network.toUpperCase()} is not initialized.`, status: 400 };
    }
    
    // Synchronous fallback to guarantee zero uptime disruption
    const snapshot = await lensContract.getAssetSnapshot(supraId);
    cached = {
      openInterestLong: BigInt(snapshot.openInterestLong.toString()),
      openInterestShort: BigInt(snapshot.openInterestShort.toString()),
      totalOpenInterest: BigInt(snapshot.totalOpenInterest.toString()),
      maxGlobalOI: BigInt(snapshot.config.maxGlobalOI.toString())
    };
  }
  
  const { openInterestLong, openInterestShort, totalOpenInterest, maxGlobalOI } = cached;

  // Buffer is dynamic: 10% of half of global OI
  const buffer = (maxGlobalOI / 2n) / 10n;

  // Universally calculate values for all networks
  const maxOILong = getMaxSideOI(openInterestShort, buffer, MIN_RATIO, MAX_RATIO, K, maxGlobalOI);
  const maxOIShort = getMaxSideOI(openInterestLong, buffer, MIN_RATIO, MAX_RATIO, K, maxGlobalOI);

  let spreadLong, spreadShort;
  if (totalOpenInterest <= buffer) {
    spreadLong = BASE_SPREAD;
    spreadShort = BASE_SPREAD;
  } else {
    spreadLong = calculateSkewSpread(DIR_LONG, openInterestLong, openInterestShort, BASE_SPREAD);
    spreadShort = calculateSkewSpread(DIR_SHORT, openInterestLong, openInterestShort, BASE_SPREAD);
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

// Getter function to expose dynamic KMS calculated spreads to other modules (like WebSockets)
router.getLatestSpreads = function(network = 'testnet') {
  const cached = snapshotCache[network];
  if (!cached) {
    return {
      spreadLong: BASE_SPREAD.toString(),
      spreadShort: BASE_SPREAD.toString(),
      lastUpdated: Date.now()
    };
  }

  const { openInterestLong, openInterestShort, totalOpenInterest, maxGlobalOI } = cached;
  const buffer = (maxGlobalOI / 2n) / 10n;

  let spreadLong, spreadShort;
  if (totalOpenInterest <= buffer) {
    spreadLong = BASE_SPREAD;
    spreadShort = BASE_SPREAD;
  } else {
    spreadLong = calculateSkewSpread(DIR_LONG, openInterestLong, openInterestShort, BASE_SPREAD);
    spreadShort = calculateSkewSpread(DIR_SHORT, openInterestLong, openInterestShort, BASE_SPREAD);
  }

  return {
    spreadLong: spreadLong.toString(),
    spreadShort: spreadShort.toString(),
    lastUpdated: cached.lastUpdated
  };
};

module.exports = router;
