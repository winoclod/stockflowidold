# ⏰ Updated Scan Times

## New Schedule (WIB - Indonesia Time)

The auto-scan times have been updated to:

| Time | Session | Description |
|------|---------|-------------|
| ☀️ **10:00 WIB** | Morning Scan | During Session 1 (market active) |
| 🌤️ **13:00 WIB** | Afternoon Scan | Start of Session 2 |
| 🌆 **16:00 WIB** | Evening Scan | After market close |

## Why These Times?

### 10:00 WIB - Morning Scan
- Market has been open for 1 hour (Session 1: 09:00-12:00)
- Early price movements have settled
- Good time to catch momentum stocks

### 13:00 WIB - Afternoon Scan  
- Right at the start of Session 2 (13:30-14:50)
- Catch lunch-break movements
- Mid-day trend analysis

### 16:00 WIB - Evening Scan
- Market closed (closes at 14:50-15:15)
- Review end-of-day signals
- Plan for next day's trades

## IDX Trading Schedule Reference

For context, here's the complete IDX schedule:

```
08:45-08:55   Pre-Opening
09:00-12:00   Session 1 (Morning)
12:00-13:30   Lunch Break
13:30-14:50   Session 2 (Afternoon)
14:50-15:15   Post-Trading

Your Bot Scans:
10:00 ────►  During Session 1
13:00 ────►  Session 2 Start
16:00 ────►  After Close
```

## What Changed?

### Old Times (Previous):
- ❌ 08:45 WIB - Pre-Market
- ❌ 12:05 WIB - After Session 1
- ❌ 15:00 WIB - Post-Market

### New Times (Current):
- ✅ 10:00 WIB - Morning Scan
- ✅ 13:00 WIB - Afternoon Scan
- ✅ 16:00 WIB - Evening Scan

## How to Verify

After deploying the updated bot, check your Telegram:

```
You: /autoscan
Bot: ⚙️ Auto-Scan Settings
     
     Schedule (WIB):
     ☀️ Morning Scan: 10:00
     🌤️ Afternoon Scan: 13:00
     🌆 Evening Scan: 16:00
```

## Testing the Schedule

To test if the schedule works:

1. **Deploy the updated bot** to Railway
2. **Subscribe**: Send `/subscribe`
3. **Wait for 10:00, 13:00, or 16:00 WIB**
4. **You should receive** an auto-scan alert

### Quick Test (Optional)
If you want to test immediately without waiting:

1. Edit `bot-autoscan.js` locally
2. Change times to 1-2 minutes from now
3. Run: `node bot-autoscan.js`
4. Wait and see if alert arrives
5. Change back to 10:00, 13:00, 16:00
6. Deploy to Railway

## Example Alert You'll Receive

```
🔔 Auto-Scan Alert - Morning Scan (10:00 WIB)
⏰ Time: 10:00 WIB

📂 Finance (3 signals)
• BBCA: Rp 9250 🟢 BUY
• BMRI: Rp 6150 🟡 POTENTIAL
• BBNI: Rp 4850 🟢 BUY

📂 Energy Minerals (1 signal)
• ADRO: Rp 2340 🟢 BUY
```

## Need Different Times?

You can easily customize the times by editing `bot-autoscan.js`:

```javascript
const AUTO_SCAN_CONFIG = {
  ENABLED: true,
  SECTORS_TO_SCAN: ['Finance', 'Energy Minerals', 'Technology Services'],
  SCHEDULE: {
    MORNING_SCAN: '10:00',    // Change this
    AFTERNOON_SCAN: '13:00',  // Change this
    EVENING_SCAN: '16:00',    // Change this
  }
};
```

Just change the times and redeploy!

## Important Notes

✅ Times are in **24-hour format** (10:00 not 10:00 AM)
✅ Timezone is **Asia/Jakarta (WIB)**
✅ Scans only run **Monday-Friday** (weekdays)
✅ No scanning on **weekends or holidays**
✅ All 3 scans run **automatically every trading day**

## Deployment Checklist

- [x] Times updated to 10:00, 13:00, 16:00
- [ ] Upload updated `bot-autoscan.js` to GitHub
- [ ] Redeploy on Railway
- [ ] Check Railway logs for "✅ Auto-scan schedules set up"
- [ ] Send `/subscribe` on Telegram
- [ ] Wait for first scan at 10:00 WIB
- [ ] Verify alert received

## Files Updated

Only one file was changed:
- ✅ **bot-autoscan.js** - Updated scan times and messages

All other files remain the same.

---

**Your bot will now scan at 10:00, 13:00, and 16:00 WIB daily!** 🎉

*Questions? Just redeploy the updated bot-autoscan.js file to Railway!*
