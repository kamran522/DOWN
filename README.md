# KAMI Downloader Bot

WhatsApp bot (Baileys) that downloads TikTok and Instagram videos and auto-views statuses.

## Server setup (Ubuntu / EC2)

```bash
sudo apt update && sudo apt install -y ffmpeg curl
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version

cd ~/kami-dl-bot
cp .env.example .env && nano .env      # set PAIRING_NUMBER and OWNER_NUMBERS
npm install
node index.js                           # first run: enter the pairing code in WhatsApp
```

When it says "Bot is online", press Ctrl+C and run it under PM2:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 logs kami-dl
```

Keep yt-dlp fresh (Instagram changes often): `sudo yt-dlp -U`

## Instagram tips
Instagram often blocks datacenter IPs. If you see "login required", export your
Instagram cookies in Netscape format as `cookies.txt` into this folder (use a
secondary account), or set `PROXY` in `.env`.

## Commands
`.dl <link>`, `.tt`, `.ig`, `.ping`, `.status`, `.autoview on|off`, `.autolike on|off`, `.help`
