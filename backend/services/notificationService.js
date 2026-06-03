const config = require('../config/config');

class NotificationService {
  constructor() {
    // Topic defaults to 'brokex_mainnet_alerts' if not set in environment variables
    this.topic = process.env.NTFY_TOPIC || 'brokex_mainnet_alerts';
  }

  /**
   * Publishes a raw notification message to ntfy.sh topic.
   * @param {string} title 
   * @param {string} message 
   * @param {string} tags 
   */
  async send(title, message, tags = '') {
    if (!this.topic) return;

    try {
      console.log(`[NotificationService] Sending alert to ntfy.sh/${this.topic}: ${title} - ${message}`);
      
      // RFC 2047 Base64 encoding to support emojis and non-ASCII characters in headers
      const encodedTitle = `=?utf-8?B?${Buffer.from(title).toString('base64')}?=`;

      const headers = {
        'Title': encodedTitle,
        'Priority': 'default'
      };
      if (tags) {
        headers['Tags'] = tags;
      }
      const response = await fetch(`https://ntfy.sh/${this.topic}`, {
        method: 'POST',
        headers,
        body: message
      });
      if (!response.ok) {
        console.error(`[NotificationService] Failed to send ntfy alert: ${response.statusText}`);
      }
    } catch (err) {
      console.error(`[NotificationService] Error sending ntfy alert:`, err.message);
    }
  }

  /**
   * Checks state change transitions of trades and dispatches formatted alerts on Mainnet.
   * @param {string} network 
   * @param {Object|null} oldTrade 
   * @param {Object} newTrade 
   */
  async handleTradeTransition(network, oldTrade, newTrade) {
    // Only send alerts for Mainnet activity
    if (network !== 'mainnet') return;

    const oldState = oldTrade ? Number(oldTrade.state) : null;
    const newState = Number(newTrade.state);

    const id = newTrade.id;
    const dirStr = Number(newTrade.direction) === 1 ? '📈 LONG' : '📉 SHORT';
    const marginUSD = (Number(newTrade.margin) / 1000000).toFixed(2);
    const leverage = newTrade.leverage;
    const openPrice = (Number(newTrade.openPrice) / 100000000).toFixed(2);
    const closePrice = (Number(newTrade.closePrice) / 100000000).toFixed(2);
    const targetPrice = (Number(newTrade.targetPrice) / 100000000).toFixed(2);

    let title = '';
    let message = '';
    let tags = '';

    if (oldState === null) {
      // New record inserted
      if (newState === 0) {
        title = `📝 Nouvel Ordre Mainnet #${id}`;
        message = `${dirStr} (${leverage}x) | Marge: ${marginUSD}$ | Cible: ${targetPrice}$`;
        tags = 'pencil,memo';
      } else if (newState === 1) {
        title = `🚀 Position Mainnet Ouverte #${id}`;
        message = `${dirStr} (${leverage}x) | Marge: ${marginUSD}$ | Entrée: ${openPrice}$`;
        tags = 'chart_with_upwards_trend,moneybag';
      }
    } else if (oldState !== newState) {
      // State transition
      if (oldState === 0 && newState === 1) {
        title = `🚀 Ordre Mainnet Exécuté #${id}`;
        message = `${dirStr} (${leverage}x) | Marge: ${marginUSD}$ | Entrée: ${openPrice}$`;
        tags = 'rocket,moneybag';
      } else if (newState === 2) {
        title = `🏁 Position Mainnet Fermée #${id}`;
        message = `${dirStr} | Prix de fermeture: ${closePrice}$`;
        tags = 'checkered_flag,heavy_check_mark';
      } else if (newState === 3) {
        title = `❌ Ordre Mainnet Annulé #${id}`;
        message = `L'ordre #${id} a été annulé ou a expiré.`;
        tags = 'x,warning';
      }
    }

    if (title && message) {
      this.send(title, message, tags).catch(err => 
        console.error(`[NotificationService] Non-blocking dispatch error:`, err.message)
      );
    }
  }
}

module.exports = new NotificationService();
