const fs = require('fs');
const config = require('../config');
const settings = require('./settings');
const { download, cleanup, extractUrls } = require('./downloader');

const seen = new Set();
const startedAt = Date.now();

// ---------- tiny concurrency limiter ----------
let active = 0;
const queue = [];
function limit(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        active--;
        const next = queue.shift();
        if (next) next();
      }
    };
    active < config.maxConcurrent ? run() : queue.push(run);
  });
}

// ---------- message helpers ----------
function unwrap(m) {
  let msg = m;
  while (msg) {
    if (msg.ephemeralMessage) msg = msg.ephemeralMessage.message;
    else if (msg.viewOnceMessage) msg = msg.viewOnceMessage.message;
    else if (msg.documentWithCaptionMessage) msg = msg.documentWithCaptionMessage.message;
    else break;
  }
  return msg || {};
}

function getText(m) {
  const msg = unwrap(m);
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    ''
  );
}

function getQuotedText(m) {
  const q = unwrap(m).extendedTextMessage?.contextInfo?.quotedMessage;
  return q ? getText(q) : '';
}

function isOwner(msg) {
  if (msg.key.fromMe) return true;
  const jid = msg.key.participant || msg.key.remoteJid || '';
  const num = jid.split('@')[0].split(':')[0];
  return config.owners.includes(num);
}

const react = (sock, msg, emoji) =>
  sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }).catch(() => {});

// ---------- sending ----------
async function sendResult(sock, msg, result) {
  const jid = msg.key.remoteJid;
  const opts = { quoted: msg };

  if (result.kind === 'images') {
    for (let i = 0; i < result.images.length; i++) {
      await sock.sendMessage(
        jid,
        { image: { url: result.images[i] }, caption: i === 0 ? result.caption : undefined },
        opts
      );
    }
    return;
  }

  const sizeMB = fs.statSync(result.file).size / 1024 / 1024;
  if (sizeMB > config.maxFileMB) {
    await sock.sendMessage(
      jid,
      {
        document: { url: result.file },
        mimetype: 'video/mp4',
        fileName: 'video.mp4',
        caption: result.caption,
      },
      opts
    );
  } else {
    await sock.sendMessage(
      jid,
      { video: { url: result.file }, mimetype: 'video/mp4', caption: result.caption },
      opts
    );
  }
}

async function processUrl(sock, msg, url) {
  await react(sock, msg, '⏳');
  let result;
  try {
    result = await limit(() => download(url));
    await sendResult(sock, msg, result);
    await react(sock, msg, '✅');
  } catch (e) {
    console.error('[download] failed:', e.message);
    await react(sock, msg, '❌');
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: `❌ ${e.userMessage || 'Download failed. Try again in a moment.'}` },
      { quoted: msg }
    );
  } finally {
    cleanup(result);
  }
}

// ---------- main entry ----------
async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;

  if (seen.has(msg.key.id)) return;
  seen.add(msg.key.id);
  if (seen.size > 500) seen.delete(seen.values().next().value);

  const text = getText(msg.message).trim();
  if (!text) return;

  const isGroup = jid.endsWith('@g.us');
  const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });

  // ----- commands -----
  if (text.startsWith(config.prefix)) {
    const [cmdRaw, ...args] = text.slice(config.prefix.length).trim().split(/\s+/);
    const cmd = (cmdRaw || '').toLowerCase();

    switch (cmd) {
      case 'help':
      case 'menu':
        return reply(
          [
            '*KAMI Downloader*',
            '',
            'Send a TikTok or Instagram link and I will send the video back.',
            '',
            `${config.prefix}dl <link>  - download (also works replying to a link)`,
            `${config.prefix}tt / ${config.prefix}ig  - same as ${config.prefix}dl`,
            `${config.prefix}ping  - check the bot`,
            `${config.prefix}status  - show settings`,
            `${config.prefix}autoview on/off  - owner only`,
            `${config.prefix}autolike on/off  - owner only`,
          ].join('\n')
        );

      case 'ping':
        return reply('🏓 Online');

      case 'status': {
        const up = Math.floor((Date.now() - startedAt) / 60000);
        return reply(
          [
            `Uptime: ${up} min`,
            `Auto view status: ${settings.get('autoViewStatus') ? 'ON' : 'OFF'}`,
            `Auto like status: ${settings.get('autoLikeStatus') ? 'ON' : 'OFF'}`,
          ].join('\n')
        );
      }

      case 'autoview':
      case 'autolike': {
        if (!isOwner(msg)) return reply('Owner only.');
        const v = (args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(v)) return reply(`Use: ${config.prefix}${cmd} on|off`);
        settings.set(cmd === 'autoview' ? 'autoViewStatus' : 'autoLikeStatus', v === 'on');
        return reply(`${cmd} is now ${v.toUpperCase()}`);
      }

      case 'dl':
      case 'tt':
      case 'ig':
      case 'download': {
        const urls = extractUrls(`${args.join(' ')} ${getQuotedText(msg.message)}`);
        if (!urls.length) return reply('Send a TikTok or Instagram link after the command, or reply to one.');
        for (const u of urls) await processUrl(sock, msg, u);
        return;
      }

      default:
        return;
    }
  }

  // ----- auto-detect links -----
  if (isGroup && !config.autoInGroups) return;
  const urls = extractUrls(text);
  for (const u of urls) await processUrl(sock, msg, u);
}

module.exports = { handleMessage };
