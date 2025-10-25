# 🎉 Updated: Auto-Scan Feature Added!

## What's New?

Your bot now has **automatic scheduled scanning** functionality! It will scan stocks 3 times daily and send you alerts with buy signals.

## 📦 Files You Have

### Core Files
1. **bot.js** - Basic version (manual scanning only)
2. **bot-autoscan.js** ⭐ - **NEW!** With auto-scan feature
3. **package.json** - Updated with `node-cron` dependency

### Documentation
4. **README.md** - Original basic bot documentation
5. **README-AUTOSCAN.md** ⭐ - **NEW!** Complete auto-scan documentation
6. **WHICH_VERSION.md** ⭐ - **NEW!** Comparison guide
7. **QUICKSTART.md** - Quick setup guide

### Configuration
8. **railway.json** - Basic bot config (uses bot.js)
9. **railway-autoscan.json** ⭐ - **NEW!** Auto-scan config (uses bot-autoscan.js)
10. **.env.example** - Environment variables template
11. **.gitignore** - Git ignore file
12. **Procfile** - Process file

## 🚀 Quick Start for Auto-Scan

### Deploy to Railway:

1. **Upload all files to GitHub**
2. **Deploy on Railway**
3. **Important: Use the auto-scan config**
   - Rename `railway-autoscan.json` to `railway.json`
   - OR set start command to: `node bot-autoscan.js`
4. **Add environment variable:**
   - `TELEGRAM_BOT_TOKEN` = your bot token
5. **Test it!**
   - Send `/start` to your bot
   - Send `/subscribe` to get auto-scan alerts
   - Wait for next scheduled time!

### Scheduled Scan Times (WIB):
- 🌅 **08:45** - Pre-Market (before opening)
- ☀️ **12:05** - After Session 1 (lunch break)
- 🌆 **15:00** - Post-Market (after closing)

## 🆕 New Bot Commands

All the old commands still work, plus:

```
/subscribe   - Subscribe to auto-scan alerts
/unsubscribe - Unsubscribe from alerts  
/autoscan    - View auto-scan settings
```

## 🎯 How Auto-Scan Works

1. **Bot runs automatically** 3 times per day (Mon-Fri)
2. **Scans configured sectors** (default: Finance, Energy, Tech)
3. **Finds stocks with signals** (🟢 BUY or 🟡 POTENTIAL)
4. **Sends alerts** to all subscribers via Telegram

### Example Alert You'll Receive:

```
🔔 Auto-Scan Alert - Pre-Market (08:45 WIB)
⏰ Time: 08:45 WIB

📂 Finance (3 signals)
• BBCA: Rp 9250 🟢 BUY
• BMRI: Rp 6150 🟡 POTENTIAL
• BBNI: Rp 4850 🟢 BUY

📂 Energy Minerals (1 signal)
• ADRO: Rp 2340 🟢 BUY
```

## ⚙️ Customization

Edit `bot-autoscan.js` to customize:

```javascript
const AUTO_SCAN_CONFIG = {
  ENABLED: true,  // Turn off/on auto-scan
  
  // Which sectors to monitor (add/remove as needed)
  SECTORS_TO_SCAN: [
    'Finance',
    'Energy Minerals', 
    'Technology Services'
  ],
  
  // Change scan times if needed (WIB format)
  SCHEDULE: {
    PRE_MARKET: '08:45',
    AFTER_SESSION_1: '12:05',
    POST_MARKET: '15:00',
  }
};
```

## 💡 Recommendations

### Sector Selection
**Start with 2-3 sectors:**
- Smaller sectors = faster scans
- Larger sectors = more opportunities but slower

**Good starting combinations:**
- **Conservative:** Utilities (12) + Communications (13) = 25 stocks
- **Balanced:** Energy Minerals (39) + Health Tech (12) = 51 stocks
- **Aggressive:** Finance (190) + Energy (39) + Tech (84) = 313 stocks

### Scan Times
**Default times are optimal for IDX:**
- 08:45 - Catch pre-market movements
- 12:05 - Check lunch session changes
- 15:00 - Review day's end signals

**Want different times?** Just edit the SCHEDULE config!

## 📊 What Gets Scanned?

By default, the bot monitors **3 major sectors:**

| Sector | Stocks | Why? |
|--------|--------|------|
| Finance | 190 | Most liquid sector |
| Energy Minerals | 39 | High volatility |
| Technology Services | 84 | Growth sector |

**Total: 313 stocks** scanned 3x daily!

Each full scan takes approximately **5-8 minutes**.

## 🔔 Managing Alerts

### Subscribe
```
/subscribe
```
You'll get alerts at all 3 scheduled times.

### Unsubscribe
```
/unsubscribe  
```
Stop receiving alerts (you can still use manual commands).

### Check Status
```
/autoscan
```
See if you're subscribed, current settings, and number of subscribers.

## 🆚 Basic vs Auto-Scan Version

| Feature | Basic | Auto-Scan |
|---------|-------|-----------|
| Manual commands | ✅ | ✅ |
| Auto scanning | ❌ | ✅ |
| Push alerts | ❌ | ✅ |
| Subscribe/Unsubscribe | ❌ | ✅ |
| Best for | On-demand use | Set & forget |

**Both versions work!** Choose based on your needs:
- Want alerts automatically? → Use `bot-autoscan.js`
- Prefer manual control? → Use `bot.js`

## 🎓 Example Usage Flow

### Day 1: Setup
```
You: /start
Bot: Welcome! [shows commands]

You: /subscribe
Bot: ✅ Subscribed! You'll receive alerts at...
```

### Day 2: Receive Alerts
```
[08:45 WIB - Bot sends automatically]
Bot: 🔔 Auto-Scan Alert - Pre-Market
     📂 Finance (2 signals)
     • BBCA: Rp 9250 🟢 BUY
     ...

[12:05 WIB - Bot sends automatically]
Bot: 🔔 Auto-Scan Alert - After Session 1
     📂 Energy Minerals (1 signal)
     ...

[15:00 WIB - Bot sends automatically]  
Bot: 🔔 Auto-Scan Alert - Post-Market
     No signals found today.
```

### Anytime: Manual Check
```
You: /stock TLKM
Bot: 📊 TLKM Analysis
     💰 Price: Rp 3450
     🎯 Signal: 🟢 BUY
```

## 🐛 Troubleshooting

### Not receiving auto-scan alerts?

1. **Check if subscribed:**
   ```
   /autoscan
   ```
   Should show "✅ Subscribed"

2. **Check Railway logs:**
   - Look for "✅ Auto-scan schedules set up"
   - Look for "[timestamp] Starting auto-scan"

3. **Verify it's a weekday:**
   - Auto-scan only runs Monday-Friday
   - No scanning on weekends/holidays

4. **Check time:**
   - Make sure current time is past a scheduled time
   - Next scan will be at next scheduled time

### Bot not starting?

1. **Check start command:**
   - Should be `node bot-autoscan.js` (not `bot.js`)

2. **Check dependencies:**
   - Make sure `node-cron` is in package.json

3. **Check Railway logs:**
   - Look for error messages

## 📈 Performance

### Railway Free Tier Usage:
- **Runtime:** ~200-300 hours/month (well under 500 limit)
- **Memory:** ~100-150 MB (plenty of room)
- **Network:** Moderate (auto-scans 3x daily)

### Scan Duration:
- **Small sectors** (10-20 stocks): ~30 seconds - 1 minute
- **Medium sectors** (30-50 stocks): ~2-3 minutes  
- **Large sectors** (100+ stocks): ~5-8 minutes
- **Multiple sectors:** Cumulative time

## 🎯 Best Practices

1. **Start small:** Begin with 1-2 small sectors
2. **Test first:** Use `/stock BBCA` to verify bot works
3. **Subscribe gradually:** Try one day of alerts before committing
4. **Customize sectors:** Pick sectors you actually trade
5. **Check logs:** Monitor Railway logs initially
6. **Adjust times:** Change schedule if default doesn't suit you

## 🔐 Security Reminders

- ✅ Never commit `.env` file
- ✅ Use Railway environment variables
- ✅ Keep bot token secret
- ✅ `.gitignore` already configured
- ✅ Private GitHub repo recommended

## 📝 Next Steps

1. ✅ Upload files to GitHub
2. ✅ Deploy to Railway  
3. ✅ Add bot token to Railway variables
4. ✅ Set start command: `node bot-autoscan.js`
5. ✅ Test bot with `/start`
6. ✅ Subscribe with `/subscribe`
7. ✅ Wait for first auto-scan alert!
8. 🎉 Enjoy automated stock screening!

## 📚 Documentation

- **Complete guide:** README-AUTOSCAN.md
- **Version comparison:** WHICH_VERSION.md
- **Quick setup:** QUICKSTART.md
- **Basic bot:** README.md

## 🎉 That's It!

You now have a fully automated stock screening bot that:
- ✅ Runs 24/7 on Railway
- ✅ Scans stocks 3x daily automatically
- ✅ Sends you Telegram alerts with buy signals
- ✅ Monitors key IDX sectors
- ✅ Uses Stochastic Oscillator (10,5,5)
- ✅ Works even when you're asleep!

**Happy automated trading! 📈🤖**

---

*Questions? Check the documentation files or test locally first with `npm install && node bot-autoscan.js`*
