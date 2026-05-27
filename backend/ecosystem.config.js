module.exports = {
  apps: [
    {
      name: 'brokex-keeper',
      script: 'server.js',
      instances: 1, // Run a single instance as keepers shouldn't run in multiple parallel threads
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_merge: true,
      time: true,
      autorestart: true,
      restart_delay: 4000 // Delay restarts by 4 seconds to protect networks from spamming on start failures
    }
  ]
};
