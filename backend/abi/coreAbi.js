/**
 * Minimal BrokexCore ABI
 * Only includes the elements requested:
 * - batchExecute
 * - TradeEvent
 */
module.exports = [
  {
    "inputs": [
      { "name": "oracleProof", "type": "bytes" },
      { "name": "tradeIds", "type": "uint256[]" },
      { "name": "reasons", "type": "uint8[]" },
      {
        "components": [
          { "name": "maxOILong", "type": "uint256" },
          { "name": "maxOIShort", "type": "uint256" },
          { "name": "spreadLong", "type": "uint256" },
          { "name": "spreadShort", "type": "uint256" },
          { "name": "expiry", "type": "uint256" },
          { "name": "sig", "type": "bytes" }
        ],
        "name": "riskProofs",
        "type": "tuple[]"
      }
    ],
    "name": "batchExecute",
    "outputs": [
      { "name": "executedIds", "type": "uint256[]" },
      { "name": "skippedIds", "type": "uint256[]" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "tradeId", "type": "uint256" }
    ],
    "name": "TradeEvent",
    "type": "event"
  }
];
