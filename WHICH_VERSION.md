# 🤖 Which Bot Version Should I Use?

## Two Versions Available

### 1. Basic Version (`bot.js`)
**Simple manual screening bot**

✅ **Use if you want:**
- Manual control over when to scan
- Simpler setup
- Lower resource usage
- On-demand screening only

📦 **File:** `bot.js`

---

### 2. Auto-Scan Version (`bot-autoscan.js`) ⭐ **RECOMMENDED**
**Automated scheduled scanning with alerts**

✅ **Use if you want:**
- Automatic scanning 3x daily
- Push notifications with buy signals
- Subscribe/unsubscribe functionality
- Hands-free monitoring
- Never miss opportunities

📦 **File:** `bot-autoscan.js`

## Feature Comparison

| Feature | Basic | Auto-Scan |
|---------|-------|-----------|
| Manual stock check | ✅ | ✅ |
| Manual sector screening | ✅ | ✅ |
| View all sectors | ✅ | ✅ |
| **Scheduled auto-scanning** | ❌ | ✅ |
| **Push notifications** | ❌ | ✅ |
| **Subscribe/Unsubscribe** | ❌ | ✅ |
| **3x daily alerts** | ❌ | ✅ |
| **WIB timezone aware** | ❌ | ✅ |
| Multiple subscribers | N/A | ✅ |
| Dependencies | 3 packages | 4 packages |

## Auto-Scan Features

### 📅 Schedule (Indonesia Time - WIB)
- **08:45 WIB** - Pre-Market Scan (before opening)
- **12:05 WIB** - Mid-Day Scan (after Session 1)
- **15:00 WIB** - Post-Market Scan (after closing)

### 🔔 What You Get
1. Automatic scanning of monitored sectors
2. Instant Telegram alerts with buy signals
3. Summary of all opportunities found
4. Runs Monday-Friday during trading days

### 💡 Example Alert
```
🔔 Auto-Scan Alert - Pre-Market (08:45 WIB)
⏰ Time: 08:45 WIB

📂 Finance (2 signals)
• BBCA: Rp 9250 🟢 BUY
• BMRI: Rp 6150 🟡 POTENTIAL

📂 Energy Minerals (1 signal)
• ADRO: Rp 2340 🟢 BUY
```

## Setup Instructions

### For Basic Version
```bash
# In railway.json or Railway settings
# Start command:
node bot.js
```

### For Auto-Scan Version ⭐
```bash
# In railway.json or Railway settings
# Start command:
node bot-autoscan.js
```

**Note:** Make sure `node-cron` is in your `package.json` dependencies for auto-scan!

## How to Switch Between Versions

### If Already Deployed on Railway:

1. Go to Railway dashboard
2. Click your project
3. Go to **Settings**
4. Find **Start Command**
5. Change to either:
   - `node bot.js` (Basic)
   - `node bot-autoscan.js` (Auto-scan)
6. Save and redeploy

### Both Files Deployed Together?
**Yes!** You can have both files in your repository. Railway will only run the one specified in the start command.

## Recommendations

### 👥 For Personal Use
**Use Auto-Scan Version**
- Set and forget
- Get notified automatically
- Never miss signals

### 👨‍💼 For Shared/Public Bot
**Use Basic Version**
- Users control when to scan
- No spam notifications
- Lower server load

### 🧪 Testing First?
**Start with Basic, Upgrade to Auto-Scan**
1. Deploy basic version first
2. Test with `/stock BBCA`
3. Test with `/screen` 
4. Once comfortable, switch to auto-scan

## Auto-Scan Customization

Edit `bot-autoscan.js` to customize:

```javascript
const AUTO_SCAN_CONFIG = {
  ENABLED: true,  // Set false to disable
  
  // Which sectors to monitor
  SECTORS_TO_SCAN: [
    'Finance',          // 190 stocks
    'Energy Minerals',  // 39 stocks
    'Technology Services' // 84 stocks
  ],
  
  // When to scan (WIB time)
  SCHEDULE: {
    PRE_MARKET: '08:45',
    AFTER_SESSION_1: '12:05',
    POST_MARKET: '15:00',
  }
};
```

### Tips for Sector Selection:
- **Start small**: 2-3 sectors (faster scans)
- **High liquidity**: Finance, Energy Minerals
- **Your interests**: Pick sectors you trade
- **Avoid large sectors initially**: Finance has 190 stocks!

## Resource Usage

### Basic Version
- **CPU**: Low (only when user requests)
- **Memory**: ~50-100 MB
- **Network**: On-demand only

### Auto-Scan Version
- **CPU**: Medium (scans 3x daily)
- **Memory**: ~50-150 MB
- **Network**: Scheduled + on-demand

Both fit comfortably in Railway's free tier! 🎉

## Quick Decision Tree

```
Do you want automatic alerts?
├─ YES → Use Auto-Scan Version (bot-autoscan.js)
│         Subscribe with /subscribe
│         Sit back and receive alerts!
│
└─ NO  → Use Basic Version (bot.js)
          Manual screening whenever you want
          Full control over scanning
```

## Final Recommendation

### 🌟 For Most Users: **Auto-Scan Version**

**Why?**
- That's the whole point of a 24/7 bot!
- Catch opportunities while you sleep
- Set it up once, works forever
- You can always unsubscribe if needed

**How to Start:**
1. Deploy `bot-autoscan.js` to Railway
2. Send `/start` to your bot
3. Send `/subscribe`
4. Done! You'll get alerts 3x daily

---

## Need Help?

- Check `README-AUTOSCAN.md` for detailed auto-scan docs
- Check `README.md` for basic bot docs
- Check `QUICKSTART.md` for quick setup guide

**Questions?** Test locally first with:
```bash
npm install
node bot-autoscan.js
```
