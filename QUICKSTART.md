# 🚀 Quick Start Guide

## Step 1: Create Telegram Bot (2 minutes)

1. Open Telegram, search for `@BotFather`
2. Send: `/newbot`
3. Choose a name: `My IDX Screener`
4. Choose a username: `my_idx_screener_bot` (must end with 'bot')
5. **Copy the token** (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

## Step 2: Deploy to Railway (5 minutes)

### Option A: Direct GitHub Deploy (Recommended)

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   # Create repo on GitHub first, then:
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

2. **Deploy on Railway:**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Wait for build to complete

3. **Add Environment Variable:**
   - In Railway dashboard, go to "Variables"
   - Click "New Variable"
   - Name: `TELEGRAM_BOT_TOKEN`
   - Value: Paste your token from BotFather
   - Railway will auto-redeploy

### Option B: Railway CLI Deploy

1. **Install Railway CLI:**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login and Deploy:**
   ```bash
   railway login
   railway init
   railway up
   ```

3. **Set Environment Variable:**
   ```bash
   railway variables set TELEGRAM_BOT_TOKEN=your_token_here
   ```

## Step 3: Test Your Bot (1 minute)

1. Open Telegram
2. Search for your bot username
3. Send `/start`
4. Try: `/stock BBCA`
5. Try: `/sectors`

## That's it! 🎉

Your bot is now running 24/7 on Railway!

## Quick Commands Reference

```
/start          - Start the bot
/help           - Show help
/sectors        - List all sectors
/screen         - Screen a sector (interactive)
/stock BBCA     - Check BBCA stock
/stock TLKM     - Check TLKM stock
```

## Troubleshooting

**Bot not responding?**
- Check Railway logs: Dashboard → Your Project → Deployments
- Look for "🤖 Bot is running..." message
- Verify token is correct in Variables section

**"No data available" error?**
- Stock might be delisted
- Try popular stocks first: BBCA, TLKM, BBRI

**Want to test locally first?**
```bash
npm install
cp .env.example .env
# Edit .env and add your token
npm start
```

## Need Help?

1. Check Railway deployment logs
2. Review README.md for detailed docs
3. Test with small commands first (/stock BBCA)
4. Start with small sectors (Utilities has only 12 stocks)

---

**Pro Tips:**
- Start screening with smaller sectors first (Utilities, Communications)
- Finance sector has 190 stocks and takes ~10 minutes
- Bot can handle multiple users simultaneously
- Railway free tier gives 500 hours/month (enough for 24/7!)
