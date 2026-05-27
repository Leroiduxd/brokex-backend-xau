const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

const ASSETS = [
  "Metal.XAU/USD",
  "Crypto.BTC/USD",
  "Crypto.ETH/USD",
  "Crypto.SOL/USD",
  "Metal.XAG/USD",
  "Commodities.USOILSPOT",
  "FX.EUR/USD",
  "FX.GBP/USD",
  "FX.USD/JPY",
  "Equity.US.AAPL/USD",
  "Equity.US.TSLA/USD",
  "Equity.US.GOOG/USD",
  "Equity.US.MSFT/USD",
  "Equity.US.AMZN/USD"
];

class PythPriceDiffService {
  constructor() {
    this.apiUrl = "https://benchmarks.pyth.network/v1/price_differences/";
    this.filePath = path.join(__dirname, '../data/price_differences.json');
    this.cache = null;
  }

  async start() {
    logger.info("Démarrage du PythPriceDiffService (Mise à jour toutes les 1h)...");
    
    // Essayer de charger les données locales au démarrage
    await this.loadLocalData();

    // Si pas de données locales ou si le fichier est périmé (> 1h), on fetch tout de suite
    const fileNeedsUpdate = await this.checkIfFileExpired();
    if (!this.cache || fileNeedsUpdate) {
      await this.fetchAndSave();
    }

    // Programmer la mise à jour toutes les 1 heure
    setInterval(async () => {
      logger.info("Mise à jour automatique horaire des price differences Pyth...");
      await this.fetchAndSave();
    }, 60 * 60 * 1000);
  }

  async loadLocalData() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.cache = JSON.parse(raw);
        logger.success("Price differences Pyth chargées depuis le fichier local.");
      }
    } catch (error) {
      logger.error(`Erreur lors du chargement des price differences locales: ${error.message}`);
    }
  }

  async checkIfFileExpired() {
    try {
      if (!fs.existsSync(this.filePath)) return true;
      const stats = fs.statSync(this.filePath);
      const ageMs = Date.now() - stats.mtimeMs;
      return ageMs > 60 * 60 * 1000; // Plus de 1 heure
    } catch (e) {
      return true;
    }
  }

  async fetchAndSave() {
    try {
      logger.pyth("Appel API Pyth pour récupérer les price differences...");
      const response = await axios.get(this.apiUrl, { timeout: 15000 });
      
      if (Array.isArray(response.data)) {
        // Filtrer les actifs configurés
        const filtered = response.data.filter(item => ASSETS.includes(item.symbol));
        
        // Assurer que le dossier parent existe
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Sauvegarder dans le fichier local
        fs.writeFileSync(this.filePath, JSON.stringify(filtered, null, 2), 'utf8');
        this.cache = filtered;
        
        logger.success(`Price differences Pyth synchronisées. ${filtered.length} actifs enregistrés.`);
      } else {
        logger.warn("Réponse Pyth invalide (pas un tableau).");
      }
    } catch (error) {
      logger.error(`Erreur lors de la récupération des price differences chez Pyth: ${error.message}`);
    }
  }

  async getData() {
    if (this.cache) return this.cache;
    // Fallback lecture de secours
    await this.loadLocalData();
    return this.cache || [];
  }
}

module.exports = new PythPriceDiffService();
