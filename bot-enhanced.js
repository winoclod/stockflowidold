require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const CONSTANTS = {
  // Technical Analysis
  STOCH_K_PERIOD: 10,
  STOCH_K_SMOOTH: 5,
  STOCH_D_PERIOD: 5,
  OVERSOLD_LEVEL: 20,
  DAYS_TO_FETCH: 100,
  
  // API & Performance
  BATCH_SIZE: 15,
  MAX_CONCURRENT: 15,
  WAIT_TIME: 150,
  REQUEST_TIMEOUT: 10000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  
  // Caching
  CACHE_TTL_MINUTES: 30,
  CACHE_CLEANUP_INTERVAL: 10 * 60 * 1000, // 10 minutes
  
  // Data Management
  MAX_SIGNAL_HISTORY: 5000,
  MAX_ACCESS_HISTORY: 1000,
  SAVE_INTERVAL: 5 * 60 * 1000, // 5 minutes
  
  // Telegram
  MESSAGE_CHUNK_SIZE: 4000, // Safe margin below 4096
  TIMEZONE: 'Asia/Jakarta',
  
  // Paths
  DATA_DIR: './data',
  CACHE_DIR: './cache',
  
  // Access Control
  ACCESS_MODE: process.env.ACCESS_MODE || 'open',
  ADMIN_ID: process.env.ADMIN_TELEGRAM_ID || '',
  WHITELIST_USERS: (process.env.WHITELIST_USERS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .map(id => parseInt(id)),
};

// Auto-scan configuration
const AUTO_SCAN_CONFIG = {
  ENABLED: true,
  DEFAULT_SECTORS: [
    'Finance',
    'Energy Minerals',
    'Technology Services',
    'Communications',
    'Consumer Non-Durables',
    'Non-Energy Minerals',
    'Utilities',
    'Health Technology',
  ],
  SCHEDULE: {
    MORNING_SCAN: '10:00',
    MOMENTUM_SCAN: '15:30',
    EVENING_SCAN: '16:00',
  }
};

// ============================================================================
// DATA STRUCTURES
// ============================================================================

class DataStore {
  constructor() {
    this.subscribers = new Set();
    this.userSectors = new Map();
    this.watchlist = new Map();
    this.priceAlerts = new Map();
    this.allowedUsers = new Set();
    this.pendingApprovals = new Set();
    this.blockedUsers = new Set();
    this.signalHistory = [];
    this.accessHistory = [];
    this.lastScanResults = new Map();
    
    // Cached full scans
    this.cachedFullScan = {
      oversold: [],
      momentum: [],
      lastOversoldUpdate: null,
      lastMomentumUpdate: null
    };
    
    this._isDirty = false;
  }
  
  markDirty() {
    this._isDirty = true;
  }
  
  isDirty() {
    return this._isDirty;
  }
  
  clearDirty() {
    this._isDirty = false;
  }
  
  addSignal(signal) {
    this.signalHistory.push(signal);
    if (this.signalHistory.length > CONSTANTS.MAX_SIGNAL_HISTORY) {
      this.signalHistory = this.signalHistory.slice(-CONSTANTS.MAX_SIGNAL_HISTORY);
    }
    this.markDirty();
  }
  
  addAccessLog(log) {
    this.accessHistory.push(log);
    if (this.accessHistory.length > CONSTANTS.MAX_ACCESS_HISTORY) {
      this.accessHistory = this.accessHistory.slice(-CONSTANTS.MAX_ACCESS_HISTORY);
    }
    this.markDirty();
  }
}

// ============================================================================
// CACHE MANAGER
// ============================================================================

class CacheManager {
  constructor() {
    this.cache = new Map();
    this.setupCleanup();
  }
  
  generateKey(symbol, days = CONSTANTS.DAYS_TO_FETCH) {
    return `${symbol}_${days}`;
  }
  
  set(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
  
  get(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    const age = Date.now() - cached.timestamp;
    const maxAge = CONSTANTS.CACHE_TTL_MINUTES * 60 * 1000;
    
    if (age > maxAge) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data;
  }
  
  has(key) {
    return this.get(key) !== null;
  }
  
  clear() {
    this.cache.clear();
  }
  
  cleanup() {
    const now = Date.now();
    const maxAge = CONSTANTS.CACHE_TTL_MINUTES * 60 * 1000;
    
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > maxAge) {
        this.cache.delete(key);
      }
    }
  }
  
  setupCleanup() {
    setInterval(() => {
      this.cleanup();
      console.log(`🧹 Cache cleanup: ${this.cache.size} entries remaining`);
    }, CONSTANTS.CACHE_CLEANUP_INTERVAL);
  }
  
  getStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

// ============================================================================
// API CLIENT WITH RETRY & ERROR HANDLING
// ============================================================================

class APIClient {
  constructor(cache) {
    this.cache = cache;
    this.axiosInstance = axios.create({
      timeout: CONSTANTS.REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
  }
  
  async fetchWithRetry(url, retries = CONSTANTS.MAX_RETRIES) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.axiosInstance.get(url);
        return response.data;
      } catch (error) {
        if (attempt === retries) {
          throw new Error(`Failed after ${retries} attempts: ${error.message}`);
        }
        
        // Exponential backoff
        const delay = CONSTANTS.RETRY_DELAY * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  async getStockData(symbol, days = CONSTANTS.DAYS_TO_FETCH) {
    const cacheKey = this.cache.generateKey(symbol, days);
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Fetch from API
    const url = `https://www.idx.co.id/umbraco/Surface/TradingSummary/GetClosingPrice?code=${symbol}&length=${days}`;
    const data = await this.fetchWithRetry(url);
    
    // Cache the result
    if (data && Array.isArray(data)) {
      this.cache.set(cacheKey, data);
    }
    
    return data;
  }
  
  async getCompanyProfile(symbol) {
    const cacheKey = `profile_${symbol}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    
    const url = `https://www.idx.co.id/umbraco/Surface/ListedCompany/GetCompanyProfilesDetail?code=${symbol}`;
    const data = await this.fetchWithRetry(url);
    
    if (data) {
      this.cache.set(cacheKey, data);
    }
    
    return data;
  }
}

// ============================================================================
// TECHNICAL ANALYSIS ENGINE
// ============================================================================

class TechnicalAnalysis {
  static calculateStochastic(prices) {
    if (prices.length < CONSTANTS.STOCH_K_PERIOD) {
      return null;
    }

    const kPeriod = CONSTANTS.STOCH_K_PERIOD;
    const kSmooth = CONSTANTS.STOCH_K_SMOOTH;
    const dPeriod = CONSTANTS.STOCH_D_PERIOD;

    const kValues = [];
    for (let i = kPeriod - 1; i < prices.length; i++) {
      const slice = prices.slice(i - kPeriod + 1, i + 1);
      const high = Math.max(...slice.map(p => p.High));
      const low = Math.min(...slice.map(p => p.Low));
      const close = prices[i].Close;
      const k = high === low ? 50 : ((close - low) / (high - low)) * 100;
      kValues.push(k);
    }

    const smoothedK = [];
    for (let i = kSmooth - 1; i < kValues.length; i++) {
      const slice = kValues.slice(i - kSmooth + 1, i + 1);
      const avg = slice.reduce((sum, val) => sum + val, 0) / slice.length;
      smoothedK.push(avg);
    }

    const dValues = [];
    for (let i = dPeriod - 1; i < smoothedK.length; i++) {
      const slice = smoothedK.slice(i - dPeriod + 1, i + 1);
      const avg = slice.reduce((sum, val) => sum + val, 0) / slice.length;
      dValues.push(avg);
    }

    if (smoothedK.length === 0 || dValues.length === 0) {
      return null;
    }

    return {
      k: smoothedK[smoothedK.length - 1],
      d: dValues[dValues.length - 1],
      prevK: smoothedK.length > 1 ? smoothedK[smoothedK.length - 2] : null,
      prevD: dValues.length > 1 ? dValues[dValues.length - 2] : null
    };
  }

  static analyzeStock(stockData, symbol) {
    if (!stockData || stockData.length < CONSTANTS.DAYS_TO_FETCH) {
      return null;
    }

    const prices = stockData.map(d => ({
      Date: d.Date,
      Close: parseFloat(d.Close) || 0,
      High: parseFloat(d.High) || 0,
      Low: parseFloat(d.Low) || 0,
      Volume: parseFloat(d.Volume) || 0
    })).reverse();

    const stoch = this.calculateStochastic(prices);
    if (!stoch) return null;

    const currentPrice = prices[prices.length - 1].Close;
    const volume = prices[prices.length - 1].Volume;
    const avgVolume = prices.slice(-20).reduce((sum, p) => sum + p.Volume, 0) / 20;

    // Enhanced signal detection
    const isOversold = stoch.k < CONSTANTS.OVERSOLD_LEVEL && stoch.d < CONSTANTS.OVERSOLD_LEVEL;
    const isCrossover = stoch.prevK && stoch.prevD && 
                        stoch.prevK < stoch.prevD && 
                        stoch.k > stoch.d;
    const isRising = stoch.prevK && stoch.k > stoch.prevK;
    const hasVolume = volume > avgVolume * 0.8;

    let signal = 'HOLD';
    if (isOversold && isCrossover && hasVolume) {
      signal = 'BUY';
    } else if (isOversold && isRising) {
      signal = 'POTENTIAL';
    }

    // Momentum calculation
    const price5DaysAgo = prices.length >= 5 ? prices[prices.length - 6].Close : currentPrice;
    const price10DaysAgo = prices.length >= 10 ? prices[prices.length - 11].Close : currentPrice;
    const momentum5D = ((currentPrice - price5DaysAgo) / price5DaysAgo) * 100;
    const momentum10D = ((currentPrice - price10DaysAgo) / price10DaysAgo) * 100;

    return {
      symbol,
      price: currentPrice,
      stochK: stoch.k,
      stochD: stoch.d,
      signal,
      volume,
      avgVolume,
      volumeRatio: (volume / avgVolume),
      momentum5D,
      momentum10D,
      isOversold,
      isCrossover,
      isRising,
      hasVolume
    };
  }

  static calculateMomentum(prices) {
    if (prices.length < 20) return null;

    const current = prices[prices.length - 1].Close;
    const price5D = prices[prices.length - 6]?.Close || current;
    const price10D = prices[prices.length - 11]?.Close || current;
    const price20D = prices[prices.length - 21]?.Close || current;

    const momentum5D = ((current - price5D) / price5D) * 100;
    const momentum10D = ((current - price10D) / price10D) * 100;
    const momentum20D = ((current - price20D) / price20D) * 100;

    const avgVolume20D = prices.slice(-20).reduce((sum, p) => sum + p.Volume, 0) / 20;
    const recentVolume = prices.slice(-5).reduce((sum, p) => sum + p.Volume, 0) / 5;

    return {
      momentum5D,
      momentum10D,
      momentum20D,
      volumeRatio: recentVolume / avgVolume20D,
      isStrong: momentum5D > 2 && momentum10D > 3 && recentVolume > avgVolume20D * 1.2
    };
  }
}

// ============================================================================
// BATCH PROCESSOR WITH CONCURRENCY CONTROL
// ============================================================================

class BatchProcessor {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }
  
  async processBatch(items, processFn, progressCallback) {
    const results = [];
    const total = items.length;
    let processed = 0;
    
    for (let i = 0; i < items.length; i += CONSTANTS.BATCH_SIZE) {
      const batch = items.slice(i, i + CONSTANTS.BATCH_SIZE);
      
      const batchPromises = batch.map(item => 
        this.processWithLimit(async () => {
          try {
            const result = await processFn(item);
            processed++;
            if (progressCallback) {
              await progressCallback(processed, total);
            }
            return result;
          } catch (error) {
            console.error(`Error processing ${item}:`, error.message);
            processed++;
            if (progressCallback) {
              await progressCallback(processed, total);
            }
            return null;
          }
        })
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(r => r !== null));
      
      // Small delay between batches
      if (i + CONSTANTS.BATCH_SIZE < items.length) {
        await this.delay(CONSTANTS.WAIT_TIME);
      }
    }
    
    return results;
  }
  
  async processWithLimit(fn) {
    // Simple semaphore implementation could go here
    // For now, relying on batch size to control concurrency
    return await fn();
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// MESSAGE FORMATTER
// ============================================================================

class MessageFormatter {
  static splitMessage(message, maxLength = CONSTANTS.MESSAGE_CHUNK_SIZE) {
    if (message.length <= maxLength) {
      return [message];
    }
    
    const chunks = [];
    const lines = message.split('\n');
    let currentChunk = '';
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        
        // If single line is too long, force split
        if (line.length > maxLength) {
          for (let i = 0; i < line.length; i += maxLength) {
            chunks.push(line.substring(i, i + maxLength));
          }
        } else {
          currentChunk = line + '\n';
        }
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }
  
  static formatResults(results, sectorName) {
    if (results.length === 0) {
      return `📊 *${sectorName} Sector*\n\n` +
             `No oversold stocks found at the moment.\n\n` +
             `The screener looks for stocks with:\n` +
             `• Stochastic K & D < 20\n` +
             `• Bullish crossover signals\n` +
             `• Good volume confirmation`;
    }

    const buySignals = results.filter(r => r.signal === 'BUY');
    const potentialSignals = results.filter(r => r.signal === 'POTENTIAL');

    let message = `📊 *${sectorName} Sector Results*\n`;
    message += `📅 ${new Date().toLocaleString('en-US', { timeZone: CONSTANTS.TIMEZONE })}\n\n`;

    if (buySignals.length > 0) {
      message += `🟢 *BUY Signals (${buySignals.length})*\n`;
      message += `_Oversold + Crossover + Volume_\n\n`;
      
      buySignals.forEach(stock => {
        message += `*${stock.symbol}* - Rp ${stock.price.toLocaleString()}\n`;
        message += `K: ${stock.stochK.toFixed(1)} | D: ${stock.stochD.toFixed(1)}\n`;
        message += `Vol: ${(stock.volumeRatio * 100).toFixed(0)}% of avg\n\n`;
      });
    }

    if (potentialSignals.length > 0) {
      message += `🟡 *Watch List (${potentialSignals.length})*\n`;
      message += `_Oversold + Rising momentum_\n\n`;
      
      potentialSignals.forEach(stock => {
        message += `*${stock.symbol}* - Rp ${stock.price.toLocaleString()}\n`;
        message += `K: ${stock.stochK.toFixed(1)} | D: ${stock.stochD.toFixed(1)}\n`;
        message += `5D: ${stock.momentum5D > 0 ? '+' : ''}${stock.momentum5D.toFixed(1)}%\n\n`;
      });
    }

    message += `\n_Screened ${results.length} stocks_`;
    return message;
  }
  
  static formatMomentumResults(results) {
    if (results.length === 0) {
      return `🚀 *IDX Momentum Scan*\n\n` +
             `No strong momentum stocks found.\n\n` +
             `Criteria: 5D > +2%, 10D > +3%, Volume > 1.2x avg`;
    }

    let message = `🚀 *IDX Momentum Leaders*\n`;
    message += `📅 ${new Date().toLocaleString('en-US', { timeZone: CONSTANTS.TIMEZONE })}\n\n`;

    const top20 = results.slice(0, 20);
    top20.forEach((stock, idx) => {
      message += `${idx + 1}. *${stock.symbol}* - Rp ${stock.price.toLocaleString()}\n`;
      message += `   5D: +${stock.momentum5D.toFixed(1)}% | 10D: +${stock.momentum10D.toFixed(1)}%\n`;
      message += `   Vol: ${(stock.volumeRatio * 100).toFixed(0)}% of avg\n\n`;
    });

    message += `\n_Found ${results.length} momentum stocks_`;
    return message;
  }
}

// ============================================================================
// PERSISTENCE MANAGER
// ============================================================================

class PersistenceManager {
  constructor(dataStore) {
    this.dataStore = dataStore;
    this.saveInProgress = false;
  }
  
  async ensureDirectories() {
    for (const dir of [CONSTANTS.DATA_DIR, CONSTANTS.CACHE_DIR]) {
      if (!fsSync.existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }
    }
  }
  
  async loadData() {
    try {
      await this.ensureDirectories();
      
      const dataFile = path.join(CONSTANTS.DATA_DIR, 'bot-data.json');
      
      if (fsSync.existsSync(dataFile)) {
        const content = await fs.readFile(dataFile, 'utf8');
        const data = JSON.parse(content);
        
        if (data.subscribers) {
          data.subscribers.forEach(id => this.dataStore.subscribers.add(id));
        }
        if (data.userSectors) {
          Object.entries(data.userSectors).forEach(([id, sectors]) => 
            this.dataStore.userSectors.set(parseInt(id), sectors)
          );
        }
        if (data.watchlist) {
          Object.entries(data.watchlist).forEach(([id, stocks]) => 
            this.dataStore.watchlist.set(parseInt(id), stocks)
          );
        }
        if (data.priceAlerts) {
          Object.entries(data.priceAlerts).forEach(([id, alerts]) => 
            this.dataStore.priceAlerts.set(parseInt(id), alerts)
          );
        }
        if (data.allowedUsers) {
          data.allowedUsers.forEach(id => this.dataStore.allowedUsers.add(id));
        }
        if (data.pendingApprovals) {
          data.pendingApprovals.forEach(id => this.dataStore.pendingApprovals.add(id));
        }
        if (data.blockedUsers) {
          data.blockedUsers.forEach(id => this.dataStore.blockedUsers.add(id));
        }
        if (data.signalHistory) {
          this.dataStore.signalHistory = data.signalHistory.slice(-CONSTANTS.MAX_SIGNAL_HISTORY);
        }
        if (data.accessHistory) {
          this.dataStore.accessHistory = data.accessHistory.slice(-CONSTANTS.MAX_ACCESS_HISTORY);
        }
        
        console.log('✅ Data loaded successfully');
        console.log(`   Users: ${this.dataStore.allowedUsers.size} allowed, ${this.dataStore.pendingApprovals.size} pending, ${this.dataStore.blockedUsers.size} blocked`);
      }
      
      // Load whitelist from environment
      if (CONSTANTS.ACCESS_MODE === 'whitelist' && CONSTANTS.WHITELIST_USERS.length > 0) {
        CONSTANTS.WHITELIST_USERS.forEach(id => this.dataStore.allowedUsers.add(id));
        console.log(`✅ Whitelist loaded: ${CONSTANTS.WHITELIST_USERS.length} users`);
      }
    } catch (error) {
      console.error('Error loading data:', error.message);
    }
  }
  
  async saveData() {
    if (this.saveInProgress) {
      console.log('⏭️  Save already in progress, skipping...');
      return;
    }
    
    if (!this.dataStore.isDirty()) {
      return;
    }
    
    this.saveInProgress = true;
    
    try {
      const data = {
        subscribers: Array.from(this.dataStore.subscribers),
        userSectors: Object.fromEntries(this.dataStore.userSectors),
        watchlist: Object.fromEntries(this.dataStore.watchlist),
        priceAlerts: Object.fromEntries(this.dataStore.priceAlerts),
        allowedUsers: Array.from(this.dataStore.allowedUsers),
        pendingApprovals: Array.from(this.dataStore.pendingApprovals),
        blockedUsers: Array.from(this.dataStore.blockedUsers),
        signalHistory: this.dataStore.signalHistory.slice(-CONSTANTS.MAX_SIGNAL_HISTORY),
        accessHistory: this.dataStore.accessHistory.slice(-CONSTANTS.MAX_ACCESS_HISTORY),
        lastUpdate: new Date().toISOString()
      };
      
      const dataFile = path.join(CONSTANTS.DATA_DIR, 'bot-data.json');
      await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
      
      this.dataStore.clearDirty();
      console.log(`💾 Data saved: ${this.dataStore.subscribers.size} subscribers, ${this.dataStore.signalHistory.length} signals`);
    } catch (error) {
      console.error('Error saving data:', error.message);
    } finally {
      this.saveInProgress = false;
    }
  }
  
  setupAutoSave() {
    setInterval(async () => {
      await this.saveData();
    }, CONSTANTS.SAVE_INTERVAL);
  }
}

// ============================================================================
// IDX SECTORS DATA (Truncated for brevity - use your full list)
// ============================================================================

const IDX_SECTORS = {
  'Basic Materials': ['ADMG', 'AGII', 'AKPI', 'ALDO', 'ALKA', 'ALMI', 'ANTM', 'APLI', 'BAJA', 'BMSR'],
  'Consumer Cyclicals': ['ABBA', 'ACES', 'AKKU', 'ARGO', 'ARTA', 'AUTO', 'BATA', 'BAYU', 'BIMA', 'BLTZ'],
  'Consumer Non-Cyclicals': ['AALI', 'ADES', 'AISA', 'ALTO', 'AMRT', 'ANJT', 'BISI', 'BTEK', 'BUDI', 'BWPT'],
  'Energy': ['ABMM', 'ADRO', 'AIMS', 'AKRA', 'APEX', 'ARII', 'ARTI', 'BBRM', 'BIPI', 'BSSR'],
  'Financials': ['ABDA', 'ADMF', 'AGRO', 'AGRS', 'AHAP', 'AMAG', 'APIC', 'ARTO', 'ASBI', 'ASDM'],
  'Healthcare': ['ADES', 'BEEN', 'CRPS', 'DLTA', 'HEAL', 'KAEF', 'KLBF', 'MEDA', 'PEHA', 'PRDA'],
  'Industrials': ['AISA', 'ASRI', 'BATA', 'BOLT', 'BRAM', 'CINT', 'EKAD', 'FAST', 'GDST', 'GEMA'],
  'Real Estate': ['ACST', 'APLN', 'ASRI', 'BCIP', 'BIKA', 'BKDP', 'BKSL', 'BSDE', 'COWL', 'CTRA'],
  'Technology': ['AADI', 'ABMM', 'ACES', 'ADMF', 'ARTO', 'BELI', 'BRIS', 'CASH', 'DNET', 'EDGE'],
  'Transportation': ['ASSA', 'BIRD', 'BLTA', 'BULL', 'CASS', 'CMPP', 'GIAA', 'HELI', 'HITS', 'IATA'],
  'Utilities': ['ADHI', 'ASSA', 'BBLD', 'BIMA', 'BTEL', 'CAKK', 'PGAS', 'PTPP', 'TLKM', 'TOWR']
};

// Add the rest of your sectors here...

// ============================================================================
// MAIN BOT CLASS
// ============================================================================

class StockScreenerBot {
  constructor() {
    this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    this.dataStore = new DataStore();
    this.cache = new CacheManager();
    this.apiClient = new APIClient(this.cache);
    this.batchProcessor = new BatchProcessor(this.apiClient);
    this.persistence = new PersistenceManager(this.dataStore);
    
    this.setupErrorHandlers();
    this.registerCommands();
    this.registerCallbacks();
  }
  
  setupErrorHandlers() {
    this.bot.on('polling_error', (error) => {
      console.error('Polling error:', error.message);
    });
    
    process.on('unhandledRejection', (error) => {
      console.error('Unhandled rejection:', error);
    });
    
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down gracefully...');
      await this.persistence.saveData();
      process.exit(0);
    });
  }
  
  // Access control methods
  isAdmin(chatId) {
    return chatId.toString() === CONSTANTS.ADMIN_ID;
  }
  
  hasAccess(chatId) {
    if (this.isAdmin(chatId)) return true;
    if (this.dataStore.blockedUsers.has(chatId)) return false;
    
    if (CONSTANTS.ACCESS_MODE === 'open') return true;
    if (CONSTANTS.ACCESS_MODE === 'whitelist') return this.dataStore.allowedUsers.has(chatId);
    if (CONSTANTS.ACCESS_MODE === 'approval') return this.dataStore.allowedUsers.has(chatId);
    
    return true;
  }
  
  logAccess(userId, username, name, command, result) {
    this.dataStore.addAccessLog({
      userId,
      username: username || 'unknown',
      name: name || 'unknown',
      timestamp: new Date().toISOString(),
      command,
      result
    });
  }
  
  // Command registration
  registerCommands() {
    // Global block handler
    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      
      if (this.isAdmin(chatId)) return;
      
      if (this.dataStore.blockedUsers.has(chatId)) {
        console.log(`[BLOCKED] User ${chatId} attempted: ${msg.text || '[media]'}`);
        await this.bot.sendMessage(chatId, '🚫 You have been blocked from using this bot.');
        throw new Error('User blocked'); // Stop processing
      }
    });
    
    this.bot.onText(/\/start/, async (msg) => this.handleStart(msg));
    this.bot.onText(/\/help/, async (msg) => this.handleHelp(msg));
    this.bot.onText(/\/screen/, async (msg) => this.handleScreen(msg));
    this.bot.onText(/\/oversold/, async (msg) => this.handleOversold(msg));
    this.bot.onText(/\/momentum/, async (msg) => this.handleMomentum(msg));
    this.bot.onText(/\/subscribe/, async (msg) => this.handleSubscribe(msg));
    this.bot.onText(/\/unsubscribe/, async (msg) => this.handleUnsubscribe(msg));
    this.bot.onText(/\/status/, async (msg) => this.handleStatus(msg));
    
    // Admin commands
    this.bot.onText(/\/admin/, async (msg) => this.handleAdmin(msg));
    this.bot.onText(/\/stats/, async (msg) => this.handleStats(msg));
  }
  
  registerCallbacks() {
    this.bot.on('callback_query', async (query) => this.handleCallback(query));
  }
  
  // Command handlers
  async handleStart(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
    
    // Check access
    if (!this.hasAccess(chatId)) {
      if (CONSTANTS.ACCESS_MODE === 'approval' && !this.dataStore.pendingApprovals.has(chatId)) {
        this.dataStore.pendingApprovals.add(chatId);
        this.dataStore.markDirty();
        this.logAccess(userId, username, name, '/start', 'PENDING');
        
        const message = `👋 Welcome! Your access request has been submitted.\n\n` +
                       `Please wait for admin approval.`;
        await this.bot.sendMessage(chatId, message);
        
        // Notify admin
        if (CONSTANTS.ADMIN_ID) {
          await this.bot.sendMessage(CONSTANTS.ADMIN_ID, 
            `🔔 New access request:\n` +
            `User: ${name} (@${username})\n` +
            `ID: ${userId}\n\n` +
            `Use /admin to manage access.`
          );
        }
        return;
      }
      
      this.logAccess(userId, username, name, '/start', 'DENIED');
      await this.bot.sendMessage(chatId, '🚫 Access denied. Contact the administrator.');
      return;
    }
    
    this.logAccess(userId, username, name, '/start', 'APPROVED');
    
    const welcomeMessage = 
      `🤖 *IDX Stock Screener Bot*\n\n` +
      `Welcome! I help you find oversold Indonesian stocks using Stochastic analysis.\n\n` +
      `*Quick Commands:*\n` +
      `/screen - Browse sectors\n` +
      `/oversold - Full IDX scan\n` +
      `/momentum - Find momentum stocks\n` +
      `/subscribe - Auto notifications\n` +
      `/help - Full command list\n\n` +
      `Let's find some opportunities! 📈`;
    
    await this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  }
  
  async handleHelp(msg) {
    const chatId = msg.chat.id;
    
    if (!this.hasAccess(chatId)) {
      await this.bot.sendMessage(chatId, '🚫 Access denied.');
      return;
    }
    
    const helpMessage =
      `📚 *IDX Stock Screener - Help*\n\n` +
      `*Screening Commands:*\n` +
      `/screen - Select sector to scan\n` +
      `/oversold - Scan all IDX stocks\n` +
      `/momentum - Find momentum leaders\n\n` +
      `*Subscription:*\n` +
      `/subscribe - Get auto updates\n` +
      `/unsubscribe - Stop auto updates\n` +
      `/status - Check your settings\n\n` +
      `*Analysis Criteria:*\n` +
      `• Stochastic K & D < 20 (oversold)\n` +
      `• Bullish crossover (K > D)\n` +
      `• Volume confirmation\n` +
      `• Rising momentum\n\n` +
      `_Data source: idx.co.id_`;
    
    await this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  }
  
  async handleScreen(msg) {
    const chatId = msg.chat.id;
    
    if (!this.hasAccess(chatId)) {
      await this.bot.sendMessage(chatId, '🚫 Access denied.');
      return;
    }
    
    const keyboard = {
      inline_keyboard: Object.keys(IDX_SECTORS).map(sector => [{
        text: `${sector} (${IDX_SECTORS[sector].length} stocks)`,
        callback_data: `screen_${sector}`
      }])
    };
    
    await this.bot.sendMessage(
      chatId,
      `📊 *Select a sector to screen:*`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }
  
  async handleOversold(msg) {
    const chatId = msg.chat.id;
    
    if (!this.hasAccess(chatId)) {
      await this.bot.sendMessage(chatId, '🚫 Access denied.');
      return;
    }
    
    const cacheAge = this.dataStore.cachedFullScan.lastOversoldUpdate 
      ? Math.round((Date.now() - this.dataStore.cachedFullScan.lastOversoldUpdate) / 60000)
      : null;
    
    if (cacheAge && cacheAge < CONSTANTS.CACHE_TTL_MINUTES) {
      const keyboard = {
        inline_keyboard: [
          [{ text: `📋 Use cached (${cacheAge}m old)`, callback_data: 'oversold_cached' }],
          [{ text: '🔄 Scan fresh data', callback_data: 'oversold_fresh' }]
        ]
      };
      
      await this.bot.sendMessage(
        chatId,
        `🔍 *Full IDX Oversold Scan*\n\n` +
        `Cached results available from ${cacheAge} minutes ago.\n` +
        `Fresh scan will take ~${Math.ceil(this.getAllStocks().length * 0.3 / 60)} minutes.`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
    } else {
      await this.performFullOversoldScan(chatId);
    }
  }
  
  async handleMomentum(msg) {
    const chatId = msg.chat.id;
    
    if (!this.hasAccess(chatId)) {
      await this.bot.sendMessage(chatId, '🚫 Access denied.');
      return;
    }
    
    const cacheAge = this.dataStore.cachedFullScan.lastMomentumUpdate 
      ? Math.round((Date.now() - this.dataStore.cachedFullScan.lastMomentumUpdate) / 60000)
      : null;
    
    if (cacheAge && cacheAge < CONSTANTS.CACHE_TTL_MINUTES) {
      const keyboard = {
        inline_keyboard: [
          [{ text: `📋 Use cached (${cacheAge}m old)`, callback_data: 'momentum_cached' }],
          [{ text: '🔄 Scan fresh data', callback_data: 'momentum_fresh' }]
        ]
      };
      
      await this.bot.sendMessage(
        chatId,
        `🚀 *Full IDX Momentum Scan*\n\n` +
        `Cached results available from ${cacheAge} minutes ago.\n` +
        `Fresh scan will take ~${Math.ceil(this.getAllStocks().length * 0.3 / 60)} minutes.`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
    } else {
      await this.performMomentumScan(chatId);
    }
  }
  
  async handleSubscribe(msg) {
    const chatId = msg.chat.id;
    
    if (!this.hasAccess(chatId)) {
      await this.bot.sendMessage(chatId, '🚫 Access denied.');
      return;
    }
    
    if (this.dataStore.subscribers.has(chatId)) {
      await this.bot.sendMessage(chatId, '✅ You are already subscribed!');
      return;
    }
    
    this.dataStore.subscribers.add(chatId);
    this.dataStore.markDirty();
    
    await this.bot.sendMessage(
      chatId,
      `🔔 *Subscribed!*\n\n` +
      `You'll receive:\n` +
      `• Morning scan at 10:00\n` +
      `• Momentum scan at 15:30\n` +
      `• Evening summary at 16:00\n\n` +
      `Use /unsubscribe to stop.`,
      { parse_mode: 'Markdown' }
    );
  }
  
  async handleUnsubscribe(msg) {
    const chatId = msg.chat.id;
    
    this.dataStore.subscribers.delete(chatId);
    this.dataStore.markDirty();
    
    await this.bot.sendMessage(chatId, '🔕 Unsubscribed from auto notifications.');
  }
  
  async handleStatus(msg) {
    const chatId = msg.chat.id;
    
    if (!this.hasAccess(chatId)) {
      await this.bot.sendMessage(chatId, '🚫 Access denied.');
      return;
    }
    
    const isSubscribed = this.dataStore.subscribers.has(chatId);
    const cacheStats = this.cache.getStats();
    
    const statusMessage =
      `📊 *Your Status*\n\n` +
      `Notifications: ${isSubscribed ? '🔔 ON' : '🔕 OFF'}\n` +
      `Access Level: ${this.isAdmin(chatId) ? '👑 Admin' : '👤 User'}\n\n` +
      `*System Stats:*\n` +
      `Cache entries: ${cacheStats.size}\n` +
      `Total subscribers: ${this.dataStore.subscribers.size}\n` +
      `Signal history: ${this.dataStore.signalHistory.length}\n`;
    
    await this.bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
  }
  
  async handleAdmin(msg) {
    const chatId = msg.chat.id;
    
    if (!this.isAdmin(chatId)) {
      await this.bot.sendMessage(chatId, '🚫 Admin access required.');
      return;
    }
    
    const pendingCount = this.dataStore.pendingApprovals.size;
    const blockedCount = this.dataStore.blockedUsers.size;
    
    const adminMessage =
      `👑 *Admin Panel*\n\n` +
      `*Access Control:*\n` +
      `Mode: ${CONSTANTS.ACCESS_MODE}\n` +
      `Allowed: ${this.dataStore.allowedUsers.size}\n` +
      `Pending: ${pendingCount}\n` +
      `Blocked: ${blockedCount}\n\n` +
      `*Commands:*\n` +
      `/stats - Detailed statistics\n` +
      `View pending in /stats panel`;
    
    await this.bot.sendMessage(chatId, adminMessage, { parse_mode: 'Markdown' });
  }
  
  async handleStats(msg) {
    const chatId = msg.chat.id;
    
    if (!this.isAdmin(chatId)) {
      await this.bot.sendMessage(chatId, '🚫 Admin access required.');
      return;
    }
    
    const cacheStats = this.cache.getStats();
    const recentAccess = this.dataStore.accessHistory.slice(-10);
    
    let statsMessage =
      `📈 *Bot Statistics*\n\n` +
      `*Users:*\n` +
      `Subscribers: ${this.dataStore.subscribers.size}\n` +
      `Allowed: ${this.dataStore.allowedUsers.size}\n` +
      `Pending: ${this.dataStore.pendingApprovals.size}\n` +
      `Blocked: ${this.dataStore.blockedUsers.size}\n\n` +
      `*Data:*\n` +
      `Cache: ${cacheStats.size} entries\n` +
      `Signals: ${this.dataStore.signalHistory.length}\n` +
      `Access logs: ${this.dataStore.accessHistory.length}\n\n`;
    
    if (recentAccess.length > 0) {
      statsMessage += `*Recent Activity:*\n`;
      recentAccess.reverse().slice(0, 5).forEach(log => {
        statsMessage += `${log.username}: ${log.command} (${log.result})\n`;
      });
    }
    
    await this.bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
  }
  
  // Callback handler
  async handleCallback(query) {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    if (!this.hasAccess(chatId)) {
      await this.bot.answerCallbackQuery(query.id, { text: 'Access denied' });
      return;
    }
    
    try {
      if (data === 'oversold_cached') {
        await this.bot.answerCallbackQuery(query.id);
        await this.bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        const message = MessageFormatter.formatResults(
          this.dataStore.cachedFullScan.oversold.filter(s => s.signal !== 'HOLD'),
          'Full IDX'
        );
        await this.sendLongMessage(chatId, message);
      } 
      else if (data === 'oversold_fresh') {
        await this.bot.answerCallbackQuery(query.id);
        await this.bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        await this.performFullOversoldScan(chatId);
      }
      else if (data === 'momentum_cached') {
        await this.bot.answerCallbackQuery(query.id);
        await this.bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        const message = MessageFormatter.formatMomentumResults(
          this.dataStore.cachedFullScan.momentum
        );
        await this.sendLongMessage(chatId, message);
      }
      else if (data === 'momentum_fresh') {
        await this.bot.answerCallbackQuery(query.id);
        await this.bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        await this.performMomentumScan(chatId);
      }
      else if (data.startsWith('screen_')) {
        await this.bot.answerCallbackQuery(query.id);
        const sectorName = data.replace('screen_', '');
        await this.screenSector(chatId, sectorName);
      }
    } catch (error) {
      console.error('Callback error:', error);
      await this.bot.answerCallbackQuery(query.id, { 
        text: 'Error occurred', 
        show_alert: true 
      });
    }
  }
  
  // Scanning methods
  async screenSector(chatId, sectorName) {
    const stocks = IDX_SECTORS[sectorName];
    if (!stocks) {
      await this.bot.sendMessage(chatId, '❌ Sector not found.');
      return;
    }
    
    const estimatedMinutes = Math.ceil(stocks.length * 0.3 / 60);
    
    const progressMsg = await this.bot.sendMessage(
      chatId,
      `🔍 *Scanning ${sectorName}*\n\n` +
      `Stocks: ${stocks.length}\n` +
      `Estimated: ${estimatedMinutes} min\n\n` +
      `Progress: 0%`,
      { parse_mode: 'Markdown' }
    );
    
    try {
      const results = await this.batchProcessor.processBatch(
        stocks,
        async (symbol) => {
          const data = await this.apiClient.getStockData(symbol);
          return TechnicalAnalysis.analyzeStock(data, symbol);
        },
        async (processed, total) => {
          if (processed % 20 === 0 || processed === total) {
            await this.bot.editMessageText(
              `🔍 *Scanning ${sectorName}*\n\n` +
              `Progress: ${Math.round(processed/total*100)}%`,
              {
                chat_id: chatId,
                message_id: progressMsg.message_id,
                parse_mode: 'Markdown'
              }
            ).catch(() => {});
          }
        }
      );
      
      const signals = results.filter(r => r && r.signal !== 'HOLD');
      const message = MessageFormatter.formatResults(signals, sectorName);
      
      await this.bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
      await this.sendLongMessage(chatId, message);
      
      // Store signals
      signals.forEach(stock => {
        if (stock.signal === 'BUY' || stock.signal === 'POTENTIAL') {
          this.dataStore.addSignal({
            symbol: stock.symbol,
            signalDate: new Date().toISOString().split('T')[0],
            signalType: stock.signal,
            entryPrice: stock.price,
            stochK: stock.stochK,
            stochD: stock.stochD
          });
        }
      });
      
    } catch (error) {
      await this.bot.editMessageText(
        `❌ Error: ${error.message}`,
        { chat_id: chatId, message_id: progressMsg.message_id }
      );
    }
  }
  
  async performFullOversoldScan(chatId) {
    const allStocks = this.getAllStocks();
    const estimatedMinutes = Math.ceil(allStocks.length * 0.3 / 60);
    
    const progressMsg = await this.bot.sendMessage(
      chatId,
      `🔍 *Full IDX Oversold Scan*\n\n` +
      `Scanning ${allStocks.length} stocks\n` +
      `Estimated: ${estimatedMinutes} min\n\n` +
      `Progress: 0%`,
      { parse_mode: 'Markdown' }
    );
    
    try {
      const results = await this.batchProcessor.processBatch(
        allStocks,
        async (symbol) => {
          const data = await this.apiClient.getStockData(symbol);
          return TechnicalAnalysis.analyzeStock(data, symbol);
        },
        async (processed, total) => {
          if (processed % 50 === 0 || processed === total) {
            await this.bot.editMessageText(
              `🔍 *Full IDX Oversold Scan*\n\n` +
              `Progress: ${Math.round(processed/total*100)}%\n` +
              `(${processed}/${total})`,
              {
                chat_id: chatId,
                message_id: progressMsg.message_id,
                parse_mode: 'Markdown'
              }
            ).catch(() => {});
          }
        }
      );
      
      const signals = results.filter(r => r && r.signal !== 'HOLD');
      this.dataStore.cachedFullScan.oversold = signals;
      this.dataStore.cachedFullScan.lastOversoldUpdate = Date.now();
      this.dataStore.markDirty();
      
      const message = MessageFormatter.formatResults(signals, 'Full IDX');
      
      await this.bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
      await this.sendLongMessage(chatId, message);
      
    } catch (error) {
      await this.bot.editMessageText(
        `❌ Error: ${error.message}`,
        { chat_id: chatId, message_id: progressMsg.message_id }
      );
    }
  }
  
  async performMomentumScan(chatId) {
    const allStocks = this.getAllStocks();
    const estimatedMinutes = Math.ceil(allStocks.length * 0.3 / 60);
    
    const progressMsg = await this.bot.sendMessage(
      chatId,
      `🚀 *Full IDX Momentum Scan*\n\n` +
      `Scanning ${allStocks.length} stocks\n` +
      `Estimated: ${estimatedMinutes} min\n\n` +
      `Progress: 0%`,
      { parse_mode: 'Markdown' }
    );
    
    try {
      const results = await this.batchProcessor.processBatch(
        allStocks,
        async (symbol) => {
          const data = await this.apiClient.getStockData(symbol);
          if (!data || data.length < 30) return null;
          
          const prices = data.map(d => ({
            Close: parseFloat(d.Close) || 0,
            High: parseFloat(d.High) || 0,
            Low: parseFloat(d.Low) || 0,
            Volume: parseFloat(d.Volume) || 0
          })).reverse();
          
          const momentum = TechnicalAnalysis.calculateMomentum(prices);
          if (!momentum || !momentum.isStrong) return null;
          
          return {
            symbol,
            price: prices[prices.length - 1].Close,
            ...momentum
          };
        },
        async (processed, total) => {
          if (processed % 50 === 0 || processed === total) {
            await this.bot.editMessageText(
              `🚀 *Full IDX Momentum Scan*\n\n` +
              `Progress: ${Math.round(processed/total*100)}%\n` +
              `(${processed}/${total})`,
              {
                chat_id: chatId,
                message_id: progressMsg.message_id,
                parse_mode: 'Markdown'
              }
            ).catch(() => {});
          }
        }
      );
      
      const sorted = results
        .filter(r => r !== null)
        .sort((a, b) => b.momentum10D - a.momentum10D);
      
      this.dataStore.cachedFullScan.momentum = sorted;
      this.dataStore.cachedFullScan.lastMomentumUpdate = Date.now();
      this.dataStore.markDirty();
      
      const message = MessageFormatter.formatMomentumResults(sorted);
      
      await this.bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
      await this.sendLongMessage(chatId, message);
      
    } catch (error) {
      await this.bot.editMessageText(
        `❌ Error: ${error.message}`,
        { chat_id: chatId, message_id: progressMsg.message_id }
      );
    }
  }
  
  // Utility methods
  getAllStocks() {
    return Object.values(IDX_SECTORS).flat();
  }
  
  async sendLongMessage(chatId, message) {
    const chunks = MessageFormatter.splitMessage(message);
    for (const chunk of chunks) {
      await this.bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
    }
  }
  
  // Auto-scan setup
  setupAutoScans() {
    if (!AUTO_SCAN_CONFIG.ENABLED) return;
    
    // Morning scan
    cron.schedule(`0 ${AUTO_SCAN_CONFIG.SCHEDULE.MORNING_SCAN.split(':')[1]} ${AUTO_SCAN_CONFIG.SCHEDULE.MORNING_SCAN.split(':')[0]} * * 1-5`, async () => {
      console.log('🌅 Running morning auto-scan...');
      await this.runAutoScan('morning');
    }, { timezone: CONSTANTS.TIMEZONE });
    
    // Momentum scan
    cron.schedule(`0 ${AUTO_SCAN_CONFIG.SCHEDULE.MOMENTUM_SCAN.split(':')[1]} ${AUTO_SCAN_CONFIG.SCHEDULE.MOMENTUM_SCAN.split(':')[0]} * * 1-5`, async () => {
      console.log('⚡ Running momentum auto-scan...');
      await this.runAutoScan('momentum');
    }, { timezone: CONSTANTS.TIMEZONE });
    
    console.log('✅ Auto-scans scheduled');
  }
  
  async runAutoScan(type) {
    const subscribers = Array.from(this.dataStore.subscribers);
    
    if (subscribers.length === 0) return;
    
    try {
      if (type === 'morning') {
        // Scan default sectors
        for (const sector of AUTO_SCAN_CONFIG.DEFAULT_SECTORS) {
          // Implementation similar to screenSector but broadcast to subscribers
        }
      } else if (type === 'momentum') {
        // Run momentum scan
        await this.performMomentumScan(subscribers[0]); // Simplified
      }
    } catch (error) {
      console.error('Auto-scan error:', error);
    }
  }
  
  // Start the bot
  async start() {
    try {
      // Clear webhook
      await this.bot.deleteWebHook();
      console.log('✅ Webhook deleted');
      
      // Load data
      await this.persistence.loadData();
      
      // Setup auto-save
      this.persistence.setupAutoSave();
      
      // Setup auto-scans
      this.setupAutoScans();
      
      console.log('🤖 Bot is running!');
      console.log(`📊 Subscribers: ${this.dataStore.subscribers.size}`);
      console.log(`👥 Users: ${this.dataStore.allowedUsers.size} allowed`);
      console.log(`🔧 Mode: ${CONSTANTS.ACCESS_MODE}`);
      
    } catch (error) {
      console.error('Startup error:', error);
      process.exit(1);
    }
  }
}

// ============================================================================
// INITIALIZE AND START BOT
// ============================================================================

const bot = new StockScreenerBot();
bot.start();
