# IDX Stock Screener Telegram Bot 🤖📊

A Telegram bot that screens Indonesian (IDX) stocks using Stochastic Oscillator (10,5,5) to identify potential buy signals.

## Features

- 📊 Screen stocks by sector (20+ sectors available)
- 🔍 Analyze individual stocks
- 🎯 Stochastic Oscillator signals (10,5,5 configuration)
- 📈 Real-time stock data from Yahoo Finance
- 🟢 Buy signals when K crosses above D in oversold zone
- 🟡 Potential signals for other crossovers
- ⚡ Optimized batch processing

## Bot Commands

- `/start` - Welcome message and bot introduction
- `/help` - Display help and settings information
- `/sectors` - View all available sectors with stock counts
- `/screen` - Start screening a sector (interactive menu)
- `/stock <SYMBOL>` - Analyze a single stock (e.g., `/stock BBCA`)

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

# Run the bot locally
npm start
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
   git commit -m "Initial commit - IDX Stock Screener Bot"
   
   # Create a new repository on GitHub, then:
   git remote add origin https://github.com/yourusername/your-repo-name.git
   git branch -M main
   git push -u origin main
   ```

4. **Deploy on Railway**
   - Select your GitHub repository
   - Railway will auto-detect the Node.js project
   - Click "Deploy"

5. **Add Environment Variables**
   - Go to your project dashboard
   - Click on "Variables" tab
   - Add variable:
     - `TELEGRAM_BOT_TOKEN` = your bot token from BotFather
   - Railway will automatically redeploy

6. **Verify Deployment**
   - Check the "Deployments" tab for logs
   - Look for "🤖 Bot is running..." in logs
   - Test your bot on Telegram

## Configuration

Edit the `CONFIG` object in `bot.js` to customize:

```javascript
const CONFIG = {
  STOCH_K_PERIOD: 10,      // K period
  STOCH_K_SMOOTH: 5,       // K smoothing
  STOCH_D_PERIOD: 5,       // D period
  OVERSOLD_LEVEL: 20,      // Oversold threshold
  DAYS_TO_FETCH: 100,      // Historical data days
  BATCH_SIZE: 10,          // Batch processing size
  WAIT_TIME: 500,          // Delay between requests (ms)
};
```

## Available Sectors

The bot includes 20+ IDX sectors:

- Finance (190 stocks)
- Energy Minerals (39 stocks)
- Non-Energy Minerals (45 stocks)
- Utilities (12 stocks)
- Technology Services (84 stocks)
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

The bot uses the standard Stochastic Oscillator formula:

1. **Raw %K** = ((Current Close - Lowest Low) / (Highest High - Lowest Low)) × 100
2. **Smoothed %K** = SMA of Raw %K over K_Smooth period
3. **%D** = SMA of Smoothed %K over D period

### Data Source

- Uses Yahoo Finance API for real-time IDX stock data
- Automatically adds `.JK` suffix for Indonesian stocks
- Fetches up to 100 days of historical data

## Troubleshooting

### Bot not responding
- Check if bot token is correct in Railway variables
- Verify deployment logs in Railway dashboard
- Ensure bot is running (look for "🤖 Bot is running..." in logs)

### "No data available" errors
- Stock symbol might be delisted or invalid
- Try another stock or sector
- Check Yahoo Finance directly to verify stock exists

### Rate limiting
- Increase `WAIT_TIME` in CONFIG if getting errors
- Process smaller sectors first
- Yahoo Finance has rate limits (usually sufficient for normal use)

### Railway deployment issues
- Check build logs for errors
- Ensure `package.json` has correct start script
- Verify Node.js version compatibility (18+)

## Cost & Limits

### Railway Free Tier
- 500 hours/month of runtime (enough for 24/7 with room to spare)
- $5 free credit per month
- No credit card required for basic use

### Bot Limits
- No limit on number of users
- Rate limiting depends on data source (Yahoo Finance)
- Recommended: Add delays between large sector screens

## Development

### Run in Development Mode
```bash
npm run dev
```

This uses `nodemon` to auto-restart on file changes.

### Testing Individual Functions
```javascript
// Test single stock
/stock BBCA

// Test sector screening (start with small sector)
/screen
// Then select "Utilities" (12 stocks)
```

## Security Notes

- Never commit `.env` file to GitHub
- Keep your bot token secret
- Use Railway's environment variables for production
- The `.gitignore` file prevents accidental token commits

## Support & Updates

For issues or questions:
1. Check Railway deployment logs
2. Verify bot token is correct
3. Test with `/stock BBCA` command first
4. Try smaller sectors before large ones

## License

MIT License - feel free to modify and use for your needs.

## Credits

- Original Google Apps Script version adapted for Telegram
- Uses Yahoo Finance for stock data
- Built with node-telegram-bot-api

---

**Happy Trading! 📈💰**

*Disclaimer: This bot is for educational purposes only. Not financial advice. Always do your own research before making investment decisions.*
