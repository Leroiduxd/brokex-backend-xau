const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

class StorageService {
  constructor() {
    this.basePath = path.resolve(config.storage.basePath);
    if (!fsSync.existsSync(this.basePath)) {
      fsSync.mkdirSync(this.basePath, { recursive: true });
    }
  }

  getSymbolPath(symbol) {
    const folderName = symbol.replace(/\//g, '_');
    const dirPath = path.join(this.basePath, folderName);
    if (!fsSync.existsSync(dirPath)) {
      fsSync.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
  }

  getFilePath(symbol, timeframe) {
    return path.join(this.getSymbolPath(symbol), `${timeframe}m.json`);
  }

  async save(symbol, timeframe, candles) {
    try {
      const filePath = this.getFilePath(symbol, timeframe);
      await fs.writeFile(filePath, JSON.stringify(candles));
    } catch (error) {
      logger.error(`Storage: Erreur sauvegarde ${symbol} ${timeframe}m: ${error.message}`);
    }
  }

  async load(symbol, timeframe) {
    try {
      const filePath = this.getFilePath(symbol, timeframe);
      if (fsSync.existsSync(filePath)) {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      logger.error(`Storage: Erreur chargement ${symbol} ${timeframe}m: ${error.message}`);
    }
    return [];
  }
}

module.exports = new StorageService();
