module.exports = {
  apps: [
    {
      name: 'kami-dl',
      script: 'index.js',
      autorestart: true,
      max_memory_restart: '400M',
      restart_delay: 3000,
    },
  ],
};
