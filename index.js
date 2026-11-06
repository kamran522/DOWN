const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const config = require('./config');
const settings = require('./lib/settings');
const { handleMessage } = require('./lib/handler');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));

// clear leftovers from a crashed run
fs.rmSync(config.tmpDir, { recursive: true, force: true });
fs.mkdirSync(config.tmpDir, { recursive: true });

let pairingRequested = false;

async function onStatus(sock, msg) {
  if (!settings.get('autoViewStatus')) return;
  if (msg.key.fromMe || msg.message?.protocolMessage) return;

  await sleep(rand(config.statusDelayMin, config.statusDelayMax));
  await sock.readMessages([msg.key]);

  if (settings.get('autoLikeStatus') && sock.user?.id) {
    const me = jidNormalizedUser(sock.user.id);
    const poster = msg.key.participant || msg.participant;
    if (poster) {
      await sock.sendMessage(
        'status@broadcast',
        { react: { text: config.statusEmoji, key: msg.key } },
        { statusJidList: [poster, me] }
      );
    }
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    version,
    logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  // Pairing code login (headless server friendly)
  if (!sock.authState.creds.registered && config.pairingNumber && !pairingRequested) {
    pairingRequested = true;
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(config.pairingNumber);
        console.log(`\n🔗 Pairing code: ${code}\nWhatsApp > Linked devices > Link with phone number\n`);
      } catch (e) {
        console.error('Pairing code failed:', e.message);
        pairingRequested = false;
      }
    }, 3000);
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr && !config.pairingNumber) {
      console.log('Scan this QR in WhatsApp > Linked devices:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('✅ Bot is online');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Logged out. Delete the ./auth folder and start again to re-link.');
        process.exit(1);
      }
      console.log(`Connection closed (${code}). Reconnecting...`);
      setTimeout(start, 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        if (msg.key.remoteJid === 'status@broadcast') {
          await onStatus(sock, msg);
        } else {
          await handleMessage(sock, msg);
        }
      } catch (e) {
        console.error('Handler error:', e.message);
      }
    }
  });
}

process.on('unhandledRejection', (e) => console.error('Unhandled:', e?.message || e));
process.on('uncaughtException', (e) => console.error('Uncaught:', e?.message || e));

start();
