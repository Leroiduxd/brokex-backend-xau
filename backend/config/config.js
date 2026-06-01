require('dotenv').config();

module.exports = {
  // Global port for the Express API server
  PORT: process.env.PORT || 3000,

  // API Key for the Supra oracle
  SUPRA_API_KEY: process.env.SUPRA_API_KEY || "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",

  // Centralized KMS Parameters (dynamic off-chain spread & OI config)
  KMS_MIN_RATIO: process.env.KMS_MIN_RATIO || "1200000",
  KMS_MAX_RATIO: process.env.KMS_MAX_RATIO || "2000000",
  KMS_K: process.env.KMS_K || "50000000000",
  KMS_BASE_SPREAD: process.env.KMS_BASE_SPREAD || "100",

  // 🧪 PHAROS TESTNET CONFIGURATION
  testnet: {
    RPC_URL: process.env.TESTNET_RPC_URL || process.env.TESTNET_WRITE_RPC_URL || process.env.RPC_URL || "https://atlantic.dplabs-internal.com",
    WS_URL: process.env.TESTNET_WS_URL || process.env.WS_URL || "wss://atlantic.dplabs-internal.com",
    CORE_ADDRESS: process.env.TESTNET_CORE_ADDRESS || process.env.CORE_ADDRESS || "0x302d139487Dcb7bd0Fa3466aF51049a70EAF4353",
    LENS_ADDRESS: process.env.TESTNET_LENS_ADDRESS || process.env.LENS_ADDRESS || "0xD9B592d2Cb993dFcC04D893DE3e5c322bB626f84",
    PRIVATE_KEY: process.env.TESTNET_PRIVATE_KEY || process.env.PRIVATE_KEY,
    KMS_PRIVATE_KEY: process.env.TESTNET_KMS_PRIVATE_KEY || process.env.KMS_PRIVATE_KEY || "0xe12f9b03327a875c2d5bf9b40a75cd2effeed46ea508ee595c6bc708c386da8c",
    WRITE_RPC_URL: process.env.TESTNET_WRITE_RPC_URL || null,
  },

  // 🚀 MAINNET CONFIGURATION
  mainnet: {
    RPC_URL: process.env.MAINNET_RPC_URL || process.env.MAINNET_WRITE_RPC_URL || null,
    WS_URL: process.env.MAINNET_WS_URL || null,
    CORE_ADDRESS: process.env.MAINNET_CORE_ADDRESS || null,
    LENS_ADDRESS: process.env.MAINNET_LENS_ADDRESS || null,
    PRIVATE_KEY: process.env.MAINNET_PRIVATE_KEY || null,
    KMS_PRIVATE_KEY: process.env.MAINNET_KMS_PRIVATE_KEY || null,
    WRITE_RPC_URL: process.env.MAINNET_WRITE_RPC_URL || null,
  },

  // Legacy single-env fallbacks (for any un-migrated services/routes)
  RPC_URL: process.env.RPC_URL || "https://atlantic.dplabs-internal.com",
  WS_URL: process.env.WS_URL || "wss://atlantic.dplabs-internal.com",
  CORE_ADDRESS: process.env.CORE_ADDRESS || "0x302d139487Dcb7bd0Fa3466aF51049a70EAF4353",
  LENS_ADDRESS: process.env.LENS_ADDRESS || "0xD9B592d2Cb993dFcC04D893DE3e5c322bB626f84",
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  KMS_PRIVATE_KEY: process.env.KMS_PRIVATE_KEY || "0xe12f9b03327a875c2d5bf9b40a75cd2effeed46ea508ee595c6bc708c386da8c"
};
