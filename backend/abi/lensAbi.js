/**
 * Minimal BrokexLens ABI
 * Only includes the functions requested:
 * - getProtocolSnapshot
 * - getTradeRange
 * - getTradesByIds
 * - getStatesByIds
 * - getStopsByIds
 */
module.exports = [
  {
    "inputs": [],
    "name": "getProtocolSnapshot",
    "outputs": [
      {
        "components": [
          { "name": "lastTradeId", "type": "uint256" },
          { "name": "openInterestLong", "type": "uint256" },
          { "name": "openInterestShort", "type": "uint256" },
          { "name": "totalOpenInterest", "type": "uint256" },
          { "name": "paused", "type": "bool" },
          { "name": "emergencyMode", "type": "bool" },
          { "name": "coreOwner", "type": "address" },
          { "name": "kmsSigner", "type": "address" },
          { "name": "lpTotalCapital", "type": "uint256" },
          { "name": "lpFreeCapital", "type": "uint256" },
          { "name": "lpLockedCapital", "type": "uint256" },
          { "name": "vaultUsageBps", "type": "uint256" },
          { "name": "totalPayoutPaid", "type": "uint256" },
          { "name": "vaultOwner", "type": "address" },
          { "name": "vaultCore", "type": "address" },
          { "name": "coreLocked", "type": "bool" },
          {
            "components": [
              { "name": "minLeverage", "type": "uint256" },
              { "name": "maxLeverage", "type": "uint256" },
              { "name": "minTradeSize", "type": "uint256" },
              { "name": "commissionBps", "type": "uint256" },
              { "name": "fundingRateHourly", "type": "uint256" },
              { "name": "profitCap", "type": "uint256" },
              { "name": "executionTolerance", "type": "uint256" },
              { "name": "maxProofAge", "type": "uint256" }
            ],
            "name": "config",
            "type": "tuple"
          }
        ],
        "name": "s",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "startId", "type": "uint256" },
      { "name": "length", "type": "uint256" }
    ],
    "name": "getTradeRange",
    "outputs": [
      {
        "components": [
          { "name": "id", "type": "uint256" },
          { "name": "trader", "type": "address" },
          { "name": "state", "type": "uint8" },
          { "name": "direction", "type": "uint8" },
          { "name": "orderType", "type": "uint8" },
          { "name": "margin", "type": "uint256" },
          { "name": "leverage", "type": "uint256" },
          { "name": "openInterest", "type": "uint256" },
          { "name": "targetPrice", "type": "uint256" },
          { "name": "openPrice", "type": "uint256" },
          { "name": "closePrice", "type": "uint256" },
          { "name": "stopLoss", "type": "uint256" },
          { "name": "takeProfit", "type": "uint256" },
          { "name": "liqPrice", "type": "uint256" },
          { "name": "maxProfit", "type": "uint256" },
          { "name": "openTimestamp", "type": "uint256" },
          { "name": "closeTimestamp", "type": "uint256" }
        ],
        "name": "result",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "ids", "type": "uint256[]" }
    ],
    "name": "getTradesByIds",
    "outputs": [
      {
        "components": [
          { "name": "id", "type": "uint256" },
          { "name": "trader", "type": "address" },
          { "name": "state", "type": "uint8" },
          { "name": "direction", "type": "uint8" },
          { "name": "orderType", "type": "uint8" },
          { "name": "margin", "type": "uint256" },
          { "name": "leverage", "type": "uint256" },
          { "name": "openInterest", "type": "uint256" },
          { "name": "targetPrice", "type": "uint256" },
          { "name": "openPrice", "type": "uint256" },
          { "name": "closePrice", "type": "uint256" },
          { "name": "stopLoss", "type": "uint256" },
          { "name": "takeProfit", "type": "uint256" },
          { "name": "liqPrice", "type": "uint256" },
          { "name": "maxProfit", "type": "uint256" },
          { "name": "openTimestamp", "type": "uint256" },
          { "name": "closeTimestamp", "type": "uint256" }
        ],
        "name": "result",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "ids", "type": "uint256[]" }
    ],
    "name": "getStatesByIds",
    "outputs": [
      {
        "components": [
          { "name": "id", "type": "uint256" },
          { "name": "state", "type": "uint8" }
        ],
        "name": "result",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "ids", "type": "uint256[]" }
    ],
    "name": "getStopsByIds",
    "outputs": [
      {
        "components": [
          { "name": "id", "type": "uint256" },
          { "name": "stopLoss", "type": "uint256" },
          { "name": "takeProfit", "type": "uint256" },
          { "name": "liqPrice", "type": "uint256" }
        ],
        "name": "result",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];
