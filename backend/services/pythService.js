const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const storageService = require('./storageService');

class PythService {
  constructor() {
    this.baseUrl = "https://benchmarks.pyth.network/v1/shims/tradingview/history";
    this.lastRequestTime = 0;
    this.currentRetryDelay = config.api.retry429DelayMs;
  }

  async get1mHistory(symbol, from, to) {
    await this.throttle();
    
    try {
      const response = await axios.get(this.baseUrl, {
        params: { symbol, resolution: "1", from, to },
        timeout: 15000
      });

      if (response.data && response.data.s === "ok") {
        this.currentRetryDelay = config.api.retry429DelayMs;
        return response.data.t.map((t, i) => ({
          time: t,
          open: response.data.o[i],
          high: response.data.h[i],
          low: response.data.l[i],
          close: response.data.c[i],
          volume: response.data.v[i]
        }));
      }
      return [];
    } catch (error) {
      if (error.response && error.response.status === 429) {
        logger.warn(`429 détecté. Pause de ${this.currentRetryDelay / 1000}s...`);
        await new Promise(res => setTimeout(res, this.currentRetryDelay));
        this.currentRetryDelay *= 2;
        return this.get1mHistory(symbol, from, to);
      }
      logger.error(`Erreur Pyth API (${symbol}): ${error.message}`);
      return [];
    }
  }

  async fetchMissing1m(symbol, from, to) {
    let currentFrom = from;
    const step = 5000 * 60; 
    const allNewData = [];

    while (currentFrom < to) {
      const currentTo = Math.min(currentFrom + step, to);
      const progress = (((currentFrom - from) / (to - from)) * 100).toFixed(1);
      
      logger.sync(`${symbol} 1m: ${progress}% complet...`);
      
      const chunk = await this.get1mHistory(symbol, currentFrom, currentTo);
      
      if (chunk && chunk.length > 0) {
        allNewData.push(...chunk);
        const existing = await storageService.load(symbol, "1");
        const merged = this.mergeCandles(existing, chunk);
        await storageService.save(symbol, "1", merged);
        
        currentFrom = chunk[chunk.length - 1].time + 1;
      } else {
        currentFrom += step;
      }
    }

    return allNewData;
  }

  mergeCandles(existing, newData) {
    const map = new Map();
    existing.forEach(c => map.set(c.time, c));
    newData.forEach(c => map.set(c.time, c));
    return Array.from(map.values()).sort((a, b) => a.time - b.time);
  }

  /**
   * Limiteur de débit strict : assure un délai minimum entre chaque requête
   */
  async throttle() {
    const now = Date.now();
    // On calcule le délai minimum requis (ex: 10s / 1 requête = 10000ms)
    const minDelay = (config.api.windowSeconds / config.api.maxRequests) * 1000;
    
    const timeSinceLast = now - this.lastRequestTime;

    if (timeSinceLast < minDelay) {
      const waitTime = minDelay - timeSinceLast;
      await new Promise(res => setTimeout(res, waitTime));
      return this.throttle(); // On revérifie après l'attente
    }

    this.lastRequestTime = Date.now();
  }
}

module.exports = new PythService();
