require('dotenv').config();
const path = require('path');

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const digits = (s) => (s || '').replace(/\D/g, '');

module.exports = {
  prefix: process.env.PREFIX || '.',
  owners: (process.env.OWNER_NUMBERS || '').split(',').map(digits).filter(Boolean),
  pairingNumber: digits(process.env.PAIRING_NUMBER),

  authDir: path.join(__dirname, 'auth'),
  tmpDir: path.join(__dirname, 'tmp'),
  dataDir: path.join(__dirname, 'data'),
  cookiesFile: path.join(__dirname, 'cookies.txt'),
  proxy: process.env.PROXY || '',

  // status features (defaults; can be toggled at runtime with .autoview / .autolike)
  autoViewStatus: bool(process.env.AUTO_VIEW_STATUS, true),
  autoLikeStatus: bool(process.env.AUTO_LIKE_STATUS, false),
  statusEmoji: process.env.STATUS_EMOJI || '💚',
  statusDelayMin: 2000,
  statusDelayMax: 8000,

  // downloader behaviour
  autoInGroups: bool(process.env.AUTO_IN_GROUPS, false),
  maxConcurrent: 2,
  maxLinksPerMessage: 3,
  maxFileMB: 60,
};
