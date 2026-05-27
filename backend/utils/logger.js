const logger = {
  info: (msg) => console.log(`\x1b[34m[INFO]\x1b[0m ${msg}`),
  success: (msg) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
  error: (msg, err = '') => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`, err),
  pyth: (msg) => console.log(`\x1b[35m[PYTH API]\x1b[0m ${msg}`),
  sync: (msg) => console.log(`\x1b[36m[SYNC]\x1b[0m ${msg}`)
};

module.exports = logger;
