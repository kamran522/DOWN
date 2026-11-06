const fs = require('fs');
const path = require('path');
const config = require('../config');

const file = path.join(config.dataDir, 'settings.json');
fs.mkdirSync(config.dataDir, { recursive: true });

let data = {
  autoViewStatus: config.autoViewStatus,
  autoLikeStatus: config.autoLikeStatus,
};

try {
  data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
} catch {}

module.exports = {
  get: (k) => data[k],
  set(k, v) {
    data[k] = v;
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  },
};
