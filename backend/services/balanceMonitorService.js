const { ethers } = require('ethers');
const config = require('../config/config');
const notificationService = require('./notificationService');
const { readProviders } = require('./providerService');

class BalanceMonitorService {
  constructor() {
    this.lastNotificationTime = 0;
    this.intervalId = null;
    this.address = null;
  }

  /**
   * Initializes and starts the balance monitoring check loop.
   */
  start() {
    // Only monitor on mainnet if Mainnet private key is configured
    if (!config.mainnet.PRIVATE_KEY || !readProviders.mainnet) {
      console.log(`[BalanceMonitor] Mainnet private key not configured. Balance monitoring skipped.`);
      return;
    }

    try {
      const wallet = new ethers.Wallet(config.mainnet.PRIVATE_KEY);
      this.address = wallet.address;
      console.log(`[BalanceMonitor] Monitoring balance for Mainnet Executor: ${this.address}`);

      // Perform initial check
      this.checkBalance();

      // Check every 10 minutes (600,000 ms)
      this.intervalId = setInterval(() => {
        this.checkBalance();
      }, 10 * 60 * 1000);
    } catch (err) {
      console.error(`[BalanceMonitor] Initialization error:`, err.message);
    }
  }

  /**
   * Check balance and emit ntfy notification if low (throttled hourly).
   */
  async checkBalance() {
    try {
      const provider = readProviders.mainnet;
      if (!provider || !this.address) return;

      const balanceWei = await provider.getBalance(this.address);
      const balanceEth = Number(ethers.formatEther(balanceWei));

      console.log(`[BalanceMonitor] Current Mainnet Executor Balance: ${balanceEth.toFixed(4)} ETH/PR`);

      if (balanceEth < 0.1) {
        const now = Date.now();
        // Limit notifications to once per hour (3,600,000 ms)
        if (now - this.lastNotificationTime >= 60 * 60 * 1000) {
          this.lastNotificationTime = now;
          const title = `⚠️ Solde Faible Exécuteur Mainnet`;
          const message = `Le solde de l'exécuteur (${this.address.slice(0, 6)}...${this.address.slice(-4)}) est de ${balanceEth.toFixed(4)} ETH/PR. Inférieur au seuil de 0.10. Recharger au plus vite !`;
          const tags = 'warning,moneybag,alarm_clock';

          notificationService.send(title, message, tags).catch(err => {
            console.error(`[BalanceMonitor] Notification sending error:`, err.message);
          });
        }
      }
    } catch (err) {
      console.error(`[BalanceMonitor] Failed to retrieve balance:`, err.message);
    }
  }

  /**
   * Stop check interval.
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

module.exports = new BalanceMonitorService();
