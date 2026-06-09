# ResellBuddy ⚡

> Automate your reselling on Poshmark & Mercari. Save hours every day.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## ✨ Features

### 🔄 Auto Share
Share your closet listings and community feed items to Posh Parties automatically. Scroll-loads all listings, skips sold/unavailable, and shares with random delays. **Poshmark only.**

### ❤️ Auto Like
Like items in your feed and search results with one click. Automatically skips already-liked items. Works on **Poshmark & Mercari** 🆕

### 👤 Auto Follow
Follow users in your niche automatically. Build your follower base and increase closet traffic. Works on **Poshmark & Mercari** 🆕

### ⏰ Smart Scheduler (Pro)
Schedule auto-shares with configurable intervals and time windows (e.g., 8 AM - 10 PM). Uses Chrome's Alarm API for reliable scheduling.

### 📊 Usage Analytics
Track daily actions, remaining free tier quota, and estimated time saved. See your productivity at a glance.

### 🛑 Stop Button
Abort any running action instantly. Full control at all times.

### 📋 Export/Import Settings
Backup your configuration to a JSON file and restore on another device.

## 💵 Pricing

| Feature | Free | Pro ($9/mo) |
|---|---|---|
| Auto Share | ✅ 50 actions/day | ✅ Unlimited |
| Auto Like | ✅ Included | ✅ Unlimited |
| Auto Follow | ✅ Included | ✅ Unlimited |
| Scheduler | — | ✅ |
| Mercari Support | — | ✅ |
| Analytics | ✅ Basic | ✅ Full |

## 🌐 Supported Platforms

| Platform | Auto Share | Auto Like | Auto Follow | Status |
|---|---|---|---|---|
| Poshmark | ✅ | ✅ | ✅ | Stable |
| Mercari 🆕 | — | ✅ | ✅ | **NEW in v1.1** |

## 🚀 Install

### Option 1: Download Release
1. Download [resellbuddy-v1.1.0.zip](https://github.com/Chesten223/resell-buddy/releases/tag/v1.1.0)
2. Unzip the file
3. Go to `chrome://extensions` → Enable Developer Mode → Load Unpacked
4. Select the unzipped folder
5. Navigate to Poshmark or Mercari — the ResellBuddy panel appears automatically

### Option 2: Chrome Web Store (Coming Soon)

## 🛡️ Safety

- **Human-like delays** — 3-8 second randomized intervals between actions
- **Scroll safety** — max 30 scroll iterations to prevent infinite loops
- **Rate limiting** — free tier capped at 50 actions/day
- **No password required** — works with your existing logged-in session
- **Open source** — audit the code yourself

## 🔗 Companion Tools

- **[Listing Analyzer](https://listing-analyzer.pages.dev)** — Free AI-powered listing optimization tool
- **[JSON Hero](https://json-hero-8fu.pages.dev)** — Free JSON viewer/formatter for developers

## 📝 Why This Exists
Resellers on Poshmark and Mercari spend 2-4 hours daily on repetitive tasks: sharing listings, liking items, following users. Closet Tools ($42K/month revenue) proved this is a massive market. ResellBuddy makes it accessible at $9/month — the cheapest option available.

## 🛠 Tech
- Chrome Extension (Manifest V3)
- Content scripts with real Poshmark & Mercari DOM selectors
- Background service worker for scheduling
- ExtPay for licensing
- Zero server costs — everything runs in the browser

## 📄 License

MIT © [Chesten](https://github.com/Chesten223)
