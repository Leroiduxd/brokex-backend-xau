require('dotenv').config();

module.exports = {
  // RPC URL for read/write transactions
  RPC_URL: process.env.RPC_URL || "https://atlantic.dplabs-internal.com",

  // WebSocket URL for real-time events
  WS_URL: process.env.WS_URL || "wss://atlantic.dplabs-internal.com",

  // BrokexCore Smart Contract Address
  CORE_ADDRESS: process.env.CORE_ADDRESS || "0x302d139487Dcb7bd0Fa3466aF51049a70EAF4353",

  // BrokexLens Smart Contract Address
  LENS_ADDRESS: process.env.LENS_ADDRESS || "0xD9B592d2Cb993dFcC04D893DE3e5c322bB626f84",

  // Private key of the executing keeper (must have gas funds)
  PRIVATE_KEY: process.env.PRIVATE_KEY,

  // API Key for the Supra oracle
  SUPRA_API_KEY: process.env.SUPRA_API_KEY || "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",

  // Port for the Express server
  PORT: process.env.PORT || 3000
};
