# IDX Stock Screener Telegram Bot 🤖📊 (with Auto-Scan)

A Telegram bot that screens Indonesian (IDX) stocks using Stochastic Oscillator (10,5,5) with **automatic scheduled scanning** at key market times.

## 🆕 New Features

### Automatic Scheduled Scanning
- **3 daily scans** at key IDX trading times (WIB timezone)
- **Subscribe/Unsubscribe** to receive alerts
- **Customizable sectors** to monitor
- **Push notifications** with buy signals

### Scan Times (Indonesia Time - WIB):
- 🌅 **08:45 WIB** - Pre-Market (before opening)
- ☀️ **12:05 WIB** - After Session 1 (lunch break)
- 🌆 **15:00 WIB** - Post-Market (after closing)

## Features

- 📊 Screen stocks by sector (20+ sectors available)
- 🔍 Analyze individual stocks
- 🎯 Stochastic Oscillator signals (10,5,5 configuration)
- 📈 Real-time stock data from Yahoo Finance
- 🟢 Buy signals when K crosses above D in oversold zone
- 🟡 Potential signals for other crossovers
- ⚡ Optimized batch processing
- 🔔 **Auto-scan alerts 3x daily**
- ⏰ **Timezone-aware scheduling (WIB)**

## Bot Commands

### Basic Commands
- `/start` - Welcome message and bot introduction
- `/help` - Display help and settings information
- `/sectors` - View all available sectors with stock counts
- `/screen` - Start screening a sector (interactive menu)
- `/stock <SYMBOL>` - Analyze a single stock (e.g., `/stock BBCA`)

### Auto-Scan Commands
- `/subscribe` - Subscribe to automatic scan alerts
- `/unsubscribe` - Unsubscribe from alerts
- `/autoscan` - View auto-scan settings and status

## Setup Instructions

### 1. Create a Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Follow the instructions to create your bot
4. Copy the **bot token** (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Local Development Setup

```bash
# Clone or download the project
cd idx-stock-screener-bot

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env and add your bot token
# TELEGRAM_BOT_TOKEN=your_actual_token_here

# Run the bot with auto-scan
node bot-autoscan.js

# Or run the basic version (no auto-scan)
node bot.js
```

### 3. Deploy to Railway (24/7 Hosting)

#### Step-by-step Railway Deployment:

1. **Sign up for Railway**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub (recommended)

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - If this is your first time, connect your GitHub account

3. **Push Code to GitHub**
   ```bash
   # Initialize git repository
   git init
   
   # Add all files
   git add .
   
   # Commit
   git commit -m "Initial commit - IDX Stock Screener Bot with Auto-Scan"
   
   # Create a new repository on GitHub, then:
   git remote add origin https://github.com/yourusername/your-repo-name.git
   git branch -M main
   git push -u origin main
   ```

4. **Deploy on Railway**
   - Select your GitHub repository
   - Railway will auto-detect the Node.js project
   - Click "Deploy"

5. **Update Start Command (Important for Auto-Scan)**
   - Go to project Settings
   - Find "Start Command" or edit `railway.json`
   - Change to: `node bot-autoscan.js`
   - Or keep `node bot.js` for basic version without auto-scan

6. **Add Environment Variables**
   - Go to your project dashboard
   - Click on "Variables" tab
   - Add variable:
     - `TELEGRAM_BOT_TOKEN` = your bot token from BotFather
   - Railway will automatically redeploy

7. **Verify Deployment**
   - Check the "Deployments" tab for logs
   - Look for "🤖 Bot is running..." in logs
   - Look for "✅ Auto-scan schedules set up..." 
   - Test your bot on Telegram

## Configuration

### Auto-Scan Settings

Edit `AUTO_SCAN_CONFIG` in `bot-autoscan.js`:

```javascript
const AUTO_SCAN_CONFIG = {
  ENABLED: true,  // Set to false to disable auto-scan
  
  // Sectors to monitor (smaller sectors = faster scans)
  SECTORS_TO_SCAN: ['Finance', 'Energy Minerals', 'Technology Services'],
  
  // Scan times in WIB (24-hour format)
  SCHEDULE: {
    PRE_MARKET: '08:45',       // Before market opens
    AFTER_SESSION_1: '12:05',   // After morning session
    POST_MARKET: '15:00',       // After market closes
  }
};
```

### Stochastic Settings

Edit `CONFIG` object in bot file:

```javascript
const CONFIG = {
  STOCH_K_PERIOD: 10,      // K period
  STOCH_K_SMOOTH: 5,       // K smoothing
  STOCH_D_PERIOD: 5,       // D period
  OVERSOLD_LEVEL: 20,      // Oversold threshold
  DAYS_TO_FETCH: 100,      // Historical data days
  BATCH_SIZE: 10,          // Batch processing size
  WAIT_TIME: 500,          // Delay between requests (ms)
  TIMEZONE: 'Asia/Jakarta', // WIB timezone
};
```

## How Auto-Scan Works

1. **Schedule**: Bot runs scans automatically at configured times (WIB)
2. **Scanning**: Screens all stocks in monitored sectors
3. **Filtering**: Identifies stocks with buy/potential signals
4. **Notification**: Sends alerts to all subscribers
5. **Repeat**: Happens 3 times daily during trading days (Mon-Fri)

### Example Auto-Scan Alert:

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

## Available Sectors

The bot includes 20+ IDX sectors (🔔 = auto-monitored by default):

- 🔔 Finance (190 stocks)
- 🔔 Energy Minerals (39 stocks)
- 🔔 Technology Services (84 stocks)
- Non-Energy Minerals (45 stocks)
- Utilities (12 stocks)
- Process Industries (44 stocks)
- Consumer Non-Durables (68 stocks)
- Communications (13 stocks)
- Consumer Services (61 stocks)
- Retail Trade (31 stocks)
- Health Services (15 stocks)
- Producer Manufacturing (44 stocks)
- Transportation (54 stocks)
- Industrial Services (43 stocks)
- Distribution Services (18 stocks)
- Health Technology (12 stocks)
- Consumer Durables (27 stocks)
- Commercial Services (30 stocks)
- Miscellaneous (2 stocks)
- Electronic Technology (7 stocks)

## Signal Types

- **🟢 BUY**: %K crossed above %D in oversold zone (< 20)
- **🟡 POTENTIAL**: %K crossed above %D (not in oversold)
- **⚪ No Signal**: No crossover detected

## Technical Details

### Stochastic Oscillator Calculation

1. **Raw %K** = ((Current Close - Lowest Low) / (Highest High - Lowest Low)) × 100
2. **Smoothed %K** = SMA of Raw %K over K_Smooth period
3. **%D** = SMA of Smoothed %K over D period

### Data Source

- Uses Yahoo Finance API for real-time IDX stock data
- Automatically adds `.JK` suffix for Indonesian stocks
- Fetches up to 100 days of historical data

### Scheduling

- Uses `node-cron` for timezone-aware scheduling
- Configured for `Asia/Jakarta` (WIB) timezone
- Runs only on weekdays (Monday-Friday)
- Automatically handles holidays (no trades = no data = no alerts)

## Troubleshooting

### Bot not responding
- Check if bot token is correct in Railway variables
- Verify deployment logs in Railway dashboard
- Ensure bot is running (look for "🤖 Bot is running..." in logs)

### Auto-scan not working
- Check Railway logs for "✅ Auto-scan schedules set up..."
- Verify timezone is correct (should be Asia/Jakarta)
- Make sure you're subscribed: send `/subscribe`
- Check if it's a weekday (auto-scan only runs Mon-Fri)

### Not receiving alerts
- Send `/subscribe` to subscribe
- Check if you blocked the bot
- Verify bot is still running on Railway
- Send `/autoscan` to check your subscription status

### "No data available" errors
- Stock symbol might be delisted or invalid
- Try another stock or sector
- Check Yahoo Finance directly to verify stock exists

### Rate limiting
- Increase `WAIT_TIME` in CONFIG if getting errors
- Reduce number of sectors in `SECTORS_TO_SCAN`
- Yahoo Finance has rate limits (usually sufficient for normal use)

### Railway deployment issues
- Check build logs for errors
- Ensure `package.json` has correct start script
- Verify Node.js version compatibility (18+)
- Make sure `node-cron` is in dependencies

## Cost & Limits

### Railway Free Tier
- 500 hours/month of runtime (enough for 24/7 with room to spare)
- $5 free credit per month
- No credit card required for basic use

### Bot Limits
- No limit on number of users/subscribers
- Rate limiting depends on data source (Yahoo Finance)
- Auto-scan processes ~200-300 stocks per scan
- Each scan takes 2-5 minutes depending on sectors

### Recommendations
- Start with 2-3 monitored sectors
- Add more sectors as needed
- Finance sector (190 stocks) takes ~5-8 minutes per scan

## File Structure

```
idx-stock-screener-bot/
├── bot.js              # Basic bot (no auto-scan)
├── bot-autoscan.js     # Bot with auto-scan features ⭐
├── package.json        # Dependencies
├── .env.example        # Environment variables template
├── .gitignore         # Git ignore file
├── railway.json       # Railway configuration
├── Procfile           # Process file
├── README.md          # This file
└── QUICKSTART.md      # Quick setup guide
```

## Usage Examples

### Subscribe to Alerts
```
You: /subscribe
Bot: 🔔 Subscribed to Auto-Scan Alerts!
     You will receive alerts at:
     🌅 08:45 WIB - Pre-Market
     ☀️ 12:05 WIB - After Session 1
     🌆 15:00 WIB - Post-Market
```

### Check Single Stock
```
You: /stock TLKM
Bot: 📊 TLKM Analysis
     💰 Price: Rp 3450
     📈 %K: 18.5
     📉 %D: 22.3
     🎯 Signal: 🟢 BUY
```

### Manual Sector Screening
```
You: /screen
Bot: Select a sector to screen:
     [Interactive buttons appear]
     
You: [Click "Utilities (12)"]
Bot: Starting to screen Utilities sector...
     Progress: 12/12 (100%)
     
Bot: 📊 Screening Results - Utilities
     🎯 Stocks with Signals (2)
     
     PGAS
     Price: Rp 1500
     %K: 16.2 | %D: 19.8
     Signal: 🟢 BUY
```

## Development

### Run in Development Mode
```bash
npm run dev
```

This uses `nodemon` to auto-restart on file changes.

### Testing Auto-Scan
To test auto-scan without waiting:
1. Edit schedule times in `AUTO_SCAN_CONFIG`
2. Set times to 1-2 minutes from now
3. Subscribe with `/subscribe`
4. Wait for the scheduled time
5. Check if you receive the alert

### Debugging
Check Railway logs for:
- `✅ Auto-scan schedules set up:` - Confirms scheduling is active
- `[timestamp] Starting auto-scan for...` - Shows when scan starts
- `Auto-scan completed. Notified X subscribers` - Shows scan finished

## Security Notes

- Never commit `.env` file to GitHub
- Keep your bot token secret
- Use Railway's environment variables for production
- The `.gitignore` file prevents accidental token commits
- Auto-scan only notifies subscribed users

## Support & Updates

For issues or questions:
1. Check Railway deployment logs
2. Verify bot token is correct
3. Test with `/stock BBCA` command first
4. Send `/autoscan` to verify auto-scan status
5. Check if subscribed with `/subscribe`

## Roadmap

Future features being considered:
- [ ] Custom sector selection per user
- [ ] Adjustable oversold threshold
- [ ] Email notifications
- [ ] Historical signal tracking
- [ ] Performance analytics
- [ ] Multiple timeframe analysis
- [ ] Watchlist management

## License

MIT License - feel free to modify and use for your needs.

## Credits

- Original Google Apps Script version adapted for Telegram
- Uses Yahoo Finance for stock data
- Built with node-telegram-bot-api
- Scheduling with node-cron

---

**Happy Trading! 📈💰**

*Disclaimer: This bot is for educational purposes only. Not financial advice. Always do your own research before making investment decisions.*
