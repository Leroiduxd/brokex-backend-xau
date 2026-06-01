const { ethers } = require('ethers');
const config = require('../config/config');

/**
 * Centrally managed FIFO queue to rate-limit JSON-RPC requests to a maximum
 * rate of 100 calls per minute (guaranteeing at least 600ms delay between consecutive requests).
 */
class RpcQueue {
  constructor(minDelayMs = 600) {
    this.minDelayMs = minDelayMs;
    this.queue = [];
    this.lastRequestTime = 0;
    this.processing = false;
  }

  /**
   * Enqueues an RPC request and resolves with the result when processed.
   * @param {Function} fn Async function performing the actual RPC send
   */
  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLast = now - this.lastRequestTime;
      const delay = Math.max(0, this.minDelayMs - timeSinceLast);

      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Dequeue the next task
      const { fn, resolve, reject } = this.queue.shift();
      this.lastRequestTime = Date.now();

      fn()
        .then(resolve)
        .catch(reject);
    }

    this.processing = false;
  }
}

// 1. Instantiate the read and write providers centrally
const readProviders = {
  testnet: new ethers.JsonRpcProvider(config.testnet.RPC_URL),
  mainnet: config.mainnet.RPC_URL ? new ethers.JsonRpcProvider(config.mainnet.RPC_URL) : null
};

const writeProviders = {
  testnet: new ethers.JsonRpcProvider(config.testnet.WRITE_RPC_URL || config.testnet.RPC_URL),
  mainnet: config.mainnet.WRITE_RPC_URL 
    ? new ethers.JsonRpcProvider(config.mainnet.WRITE_RPC_URL) 
    : (config.mainnet.RPC_URL ? new ethers.JsonRpcProvider(config.mainnet.RPC_URL) : null)
};

// 2. Setup rate-limit queues for read providers to shield public nodes from 429 errors
console.log(`[RpcQueueService] Enforcing strict 100-request-per-minute rate limit on Testnet RPC reads (Atlantic).`);
const testnetQueue = new RpcQueue(600);
const originalTestnetSend = readProviders.testnet.send;
readProviders.testnet.send = function (method, params) {
  return testnetQueue.enqueue(() => originalTestnetSend.call(readProviders.testnet, method, params));
};

if (readProviders.mainnet) {
  console.log(`[RpcQueueService] Enforcing strict 100-request-per-minute rate limit on Mainnet RPC reads.`);
  const mainnetQueue = new RpcQueue(600);
  const originalMainnetSend = readProviders.mainnet.send;
  readProviders.mainnet.send = function (method, params) {
    return mainnetQueue.enqueue(() => originalMainnetSend.call(readProviders.mainnet, method, params));
  };
}

module.exports = {
  readProviders,
  writeProviders
};
