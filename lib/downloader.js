const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const config = require('../config');

fs.mkdirSync(config.tmpDir, { recursive: true });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const userError = (msg) => Object.assign(new Error(msg), { userMessage: msg });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => crypto.randomBytes(6).toString('hex');

// ---------- link detection ----------
function classify(u) {
  let h;
  try {
    h = new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
  if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) return 'tiktok';
  if (h === 'instagram.com' || h === 'instagr.am') return 'instagram';
  return null;
}

function extractUrls(text) {
  const found = (text || '').match(/https?:\/\/[^\s]+/gi) || [];
  const cleaned = found.map((u) => u.replace(/[)\]>.,!?]+$/, ''));
  return [...new Set(cleaned)].filter((u) => classify(u)).slice(0, config.maxLinksPerMessage);
}

// ---------- helpers ----------
async function resolveTikTok(url) {
  try {
    const res = await axios.get(url, {
      maxRedirects: 5,
      timeout: 15000,
      headers: { 'User-Agent': UA },
      validateStatus: (s) => s < 500,
    });
    const final = res.request?.res?.responseUrl || url;
    const clean = final.split('?')[0];
    return /\/(video|photo)\/\d+/.test(clean) ? clean : url;
  } catch {
    return url;
  }
}

async function saveToTemp(url, ext, referer) {
  const file = path.join(config.tmpDir, `${rid()}.${ext}`);
  const res = await axios.get(url, {
    responseType: 'stream',
    timeout: 60000,
    headers: { 'User-Agent': UA, Referer: referer || 'https://www.tiktok.com/' },
    maxContentLength: config.maxFileMB * 1024 * 1024 * 2,
  });
  const type = String(res.headers['content-type'] || '');
  if (!/video|image|octet-stream/i.test(type)) {
    res.data.destroy();
    throw new Error(`Not a media file (content-type: ${type || 'unknown'})`);
  }
  await pipeline(res.data, fs.createWriteStream(file));
  return file;
}

const cleanCaption = (s) => (s || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);

// ---------- TikTok via tikwm ----------
async function tiktokTikwm(url) {
  let data;
  for (let i = 0; i < 3; i++) {
    const res = await axios.post(
      'https://www.tikwm.com/api/',
      new URLSearchParams({ url, hd: '1' }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        timeout: 20000,
      }
    );
    data = res.data;
    if (data && data.code === 0 && data.data) break;
    if (/limit/i.test(String(data?.msg))) {
      await sleep(1500);
      continue;
    }
    break;
  }
  if (!data || data.code !== 0 || !data.data) {
    throw new Error(`tikwm: ${data?.msg || 'bad response'}`);
  }

  const d = data.data;
  const author = d.author?.unique_id ? `@${d.author.unique_id}` : '';
  const caption = ['✅ TikTok', author, cleanCaption(d.title)].filter(Boolean).join(' • ');

  if (Array.isArray(d.images) && d.images.length) {
    return { kind: 'images', images: d.images.slice(0, 10), caption };
  }

  let media = d.hdplay || d.play;
  if (!media) throw new Error('tikwm: no video url');
  if (media.startsWith('/')) media = 'https://www.tikwm.com' + media;
  const file = await saveToTemp(media, 'mp4');
  return { kind: 'video', file, caption };
}

// ---------- yt-dlp (Instagram + TikTok fallback) ----------
function ytdlp(url, label) {
  return new Promise((resolve, reject) => {
    const id = rid();
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--restrict-filenames',
      '--max-filesize', `${config.maxFileMB * 2}M`,
      '-f', 'b[ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/b',
      '--merge-output-format', 'mp4',
      '--user-agent', UA,
      '-o', path.join(config.tmpDir, `${id}.%(ext)s`),
    ];
    if (fs.existsSync(config.cookiesFile)) args.push('--cookies', config.cookiesFile);
    if (config.proxy) args.push('--proxy', config.proxy);
    args.push(url);

    execFile('yt-dlp', args, { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) {
        const msg = String(stderr || err.message);
        if (err.code === 'ENOENT') {
          return reject(userError('Server is missing yt-dlp. Install it first (see README).'));
        }
        if (/login|cookie|rate-limit|empty media|not available|private/i.test(msg)) {
          return reject(
            userError(`${label} blocked the request (private post or login required). Add a cookies.txt and try again.`)
          );
        }
        return reject(new Error(`yt-dlp: ${msg.slice(0, 300)}`));
      }
      const hit = fs.readdirSync(config.tmpDir).find((f) => f.startsWith(id + '.'));
      if (!hit) return reject(new Error('yt-dlp finished but no file found'));
      resolve({ kind: 'video', file: path.join(config.tmpDir, hit), caption: `✅ ${label}` });
    });
  });
}

// ---------- public API ----------
async function download(rawUrl) {
  const platform = classify(rawUrl);

  if (platform === 'tiktok') {
    const url = await resolveTikTok(rawUrl);
    try {
      return await tiktokTikwm(url);
    } catch (e) {
      console.error('[tiktok] tikwm failed:', e.message);
      try {
        return await ytdlp(url, 'TikTok');
      } catch (e2) {
        console.error('[tiktok] yt-dlp failed:', e2.message);
        throw e2.userMessage ? e2 : userError('Could not download this TikTok. It may be private or removed.');
      }
    }
  }

  if (platform === 'instagram') {
    const url = rawUrl.split('?')[0];
    try {
      return await ytdlp(url, 'Instagram');
    } catch (e) {
      console.error('[instagram] yt-dlp failed:', e.message);
      throw e.userMessage ? e : userError('Could not download this Instagram link. It may be private, an image post, or blocked.');
    }
  }

  throw userError('Unsupported link.');
}

function cleanup(result) {
  if (result?.file) fs.unlink(result.file, () => {});
}

module.exports = { download, cleanup, extractUrls, classify };
