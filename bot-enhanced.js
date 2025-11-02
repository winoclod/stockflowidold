require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  STOCH_K_PERIOD: 10,
  STOCH_K_SMOOTH: 5,
  STOCH_D_PERIOD: 5,
  OVERSOLD_LEVEL: 20,
  DAYS_TO_FETCH: 100,
  BATCH_SIZE: 20,
  WAIT_TIME: 200,
  MAX_CONCURRENT: 10,
  TIMEZONE: 'Asia/Jakarta',
  ADMIN_ID: process.env.ADMIN_TELEGRAM_ID || '', // Set your Telegram user ID here
  DATA_DIR: './data',
  
  // ACCESS CONTROL
  ACCESS_MODE: process.env.ACCESS_MODE || 'open', // 'open', 'whitelist', or 'approval'
  WHITELIST_USERS: (process.env.WHITELIST_USERS || '').split(',').map(id => id.trim()).filter(Boolean),
  // Example: WHITELIST_USERS=123456789,987654321,555555555
};

// Create data directory if it doesn't exist
if (!fs.existsSync(CONFIG.DATA_DIR)) {
  fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
}

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
    AFTERNOON_SCAN: '13:00',
    EVENING_SCAN: '16:00',
    DAILY_SUMMARY: '08:00', // New: Daily summary time
  }
};

// Data storage
const subscribers = new Set();
const userSectors = new Map(); // chatId -> [sectors]
const watchlist = new Map(); // chatId -> [symbols]
const priceAlerts = new Map(); // chatId -> [{symbol, condition, price}]
const lastScanResults = new Map(); // Store last scan results for daily summary
const allowedUsers = new Set(); // Whitelist of allowed user IDs
const pendingApprovals = new Set(); // Users waiting for approval
const blockedUsers = new Set(); // Blocked users

// Signal history tracking
const signalHistory = []; // Array of {symbol, date, signal, entryPrice, currentPrice, result, days}
// Structure: {
//   symbol: 'BBCA',
//   signalDate: '2024-10-25',
//   signalType: 'BUY' or 'POTENTIAL',
//   entryPrice: 9250,
//   checkDate: '2024-10-30',
//   exitPrice: 9500,
//   returnPct: 2.7,
//   result: 'PROFIT' or 'LOSS',
//   days: 5
// }

// Load persistent data
function loadData() {
  try {
    const dataFile = path.join(CONFIG.DATA_DIR, 'bot-data.json');
    if (fs.existsSync(dataFile)) {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      
      if (data.subscribers) data.subscribers.forEach(id => subscribers.add(id));
      if (data.userSectors) Object.entries(data.userSectors).forEach(([id, sectors]) => 
        userSectors.set(parseInt(id), sectors)
      );
      if (data.watchlist) Object.entries(data.watchlist).forEach(([id, stocks]) => 
        watchlist.set(parseInt(id), stocks)
      );
      if (data.priceAlerts) Object.entries(data.priceAlerts).forEach(([id, alerts]) => 
        priceAlerts.set(parseInt(id), alerts)
      );
      if (data.allowedUsers) data.allowedUsers.forEach(id => allowedUsers.add(id));
      if (data.pendingApprovals) data.pendingApprovals.forEach(id => pendingApprovals.add(id));
      if (data.blockedUsers) data.blockedUsers.forEach(id => blockedUsers.add(id));
      if (data.signalHistory) signalHistory.push(...data.signalHistory);
      
      console.log('✅ Data loaded successfully');
      console.log(`   Users: ${allowedUsers.size} allowed, ${pendingApprovals.size} pending, ${blockedUsers.size} blocked`);
      console.log(`   Signal History: ${signalHistory.length} records`);
    }
    
    // Load whitelist from environment variable
    if (CONFIG.ACCESS_MODE === 'whitelist' && CONFIG.WHITELIST_USERS.length > 0) {
      CONFIG.WHITELIST_USERS.forEach(id => allowedUsers.add(parseInt(id)));
      console.log(`✅ Whitelist loaded: ${CONFIG.WHITELIST_USERS.length} users`);
    }
  } catch (error) {
    console.error('Error loading data:', error.message);
  }
}

function saveData() {
  try {
    const data = {
      subscribers: Array.from(subscribers),
      userSectors: Object.fromEntries(userSectors),
      watchlist: Object.fromEntries(watchlist),
      priceAlerts: Object.fromEntries(priceAlerts),
      allowedUsers: Array.from(allowedUsers),
      pendingApprovals: Array.from(pendingApprovals),
      blockedUsers: Array.from(blockedUsers),
      signalHistory: signalHistory,
      lastUpdate: new Date().toISOString()
    };
    
    fs.writeFileSync(
      path.join(CONFIG.DATA_DIR, 'bot-data.json'),
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error('Error saving data:', error.message);
  }
}

// IDX Sectors
const IDX_SECTORS = {
  'Finance': ['BBCA', 'BBNI', 'BRIS', 'BNGA', 'NISP', 'BINA', 'ARTO', 'BDMN', 'BTPN', 'BSIM', 'BBTN', 'BNII', 'BBKP', 'BMAS', 'BTPS', 'BBMD', 'BJBR', 'BJTM', 'AGRO', 'BBYB', 'NOBU', 'BWSD', 'BCIC', 'MCOR', 'BGTG', 'BKSW', 'PNBS', 'DNAR', 'BBRI', 'BMRI', 'BNLI', 'MEGA', 'BBHI', 'PNBN', 'BBSI', 'BANK', 'MAYA', 'MASB', 'AMAR', 'SDRA', 'AGRS', 'INPC', 'BACA', 'BABP', 'BCAP', 'BNBA', 'BVIC', 'BEKS', 'INDO', 'MPRO', 'RISE', 'TBIG', 'CBDK', 'MKPI', 'BKSL', 'BSDE', 'PWON', 'CTRA', 'KPIG', 'JRPT', 'DUTI', 'DMAS', 'SMRA', 'LPKR', 'SMDM', 'MMLP', 'KIJA', 'UANG', 'MTLA', 'ASRI', 'RDTX', 'LPCK', 'NIRO', 'FMII', 'APLN', 'GMTD', 'BSBK', 'JIHD', 'DILD', 'ADCP', 'TRIN', 'GWSA', 'ROCK', 'ELTY', 'TRUE', 'GRIA', 'ASPI', 'MDLN', 'CITY', 'HOMI', 'AMAN', 'DADA', 'SWID', 'VAST', 'URBN', 'NASA', 'PUDP', 'REAL', 'JGLE', 'BKDP', 'SATU', 'KBAG', 'IPAC', 'EMDE', 'CBPE', 'KOTA', 'TARA', 'SAGE', 'PURI', 'CSIS', 'NZIA', 'RELF', 'BIPP', 'PAMG', 'BCIP', 'BAPI', 'ATAP', 'KOCI', 'HBAT', 'WINR', 'MSIE', 'SMMA', 'AMAG', 'ABDA', 'GSMF', 'MREI', 'ASRM', 'VINS', 'ASBI', 'CASA', 'LIFE', 'ASMI', 'JMAS', 'TOWR', 'BFIN', 'ADMF', 'SMIL', 'SKRN', 'IMJS', 'TIFA', 'BBLD', 'FUJI', 'CFIN', 'WOMF', 'HDFA', 'BPFI', 'VRNA', 'GOLD', 'TRUS', 'BPTR', 'TRJA', 'MGNA', 'DEFI', 'POLA', 'WIDI', 'IBFN', 'MENN', 'APIC', 'YULE', 'VICO', 'RELI', 'PANS', 'PADI', 'PEGE', 'KREN', 'SRTG', 'NICK', 'MTFN', 'AKSI', 'TRIM', 'SFAN', 'AMOR', 'STAR', 'LPPS', 'TUGU', 'LPGI', 'MTWI', 'AHAP', 'ASDM', 'ASJT', 'YOII'],
  'Energy Minerals': ['DSSA', 'BYAN', 'UNTR', 'AADI', 'GEMS', 'ADMR', 'BUMI', 'ADRO', 'PTBA', 'ITMG', 'HRUM', 'INDY', 'MCOL', 'BSSR', 'TOBA', 'DWGL', 'ABMM', 'DEWA', 'BIPI', 'SMMT', 'MYOH', 'DOID', 'MAHA', 'MBAP', 'KKGI', 'ITMA', 'ARII', 'CNKO', 'GTBO', 'COAL', 'RMKO', 'FIRE', 'MEDC', 'ENRG', 'ELSA', 'SUNI', 'SICO', 'ESSA', 'SURE'],
  'Non-Energy Minerals': ['AMMN', 'BRMS', 'ANTM', 'EMAS', 'MDKA', 'ARCI', 'PSAB', 'NICL', 'HILL', 'OKAS', 'MINE', 'CUAN', 'NCKL', 'MBMA', 'INCO', 'TINS', 'SGER', 'DKFT', 'NICE', 'MARK', 'IFSH', 'BRPT', 'DSNG', 'IFII', 'SULI', 'FWCT', 'INTP', 'SMGR', 'CMNT', 'SMBR', 'WSBP', 'BLES', 'CTTH', 'PIPA', 'BATR', 'KRAS', 'ISSP', 'GGRP', 'GDST', 'ZINC', 'BAJA', 'BTON', 'ALKA', 'INAI'],
  'Utilities': ['BREN', 'CDIA', 'POWR', 'KEEN', 'HGII', 'LAPD', 'MPOW', 'PGAS', 'RAJA', 'INPS', 'CGAS', 'PGEO'],
  'Technology Services': ['DCII', 'MLPT', 'ASII', 'GOTO', 'WIFI', 'EDGE', 'CYBR', 'MSTI', 'ASGR', 'IRSX', 'AREA', 'CHIP', 'NFCX', 'ATIC', 'LPLI', 'PGJO', 'AWAN', 'GPSO', 'MCAS', 'VTNY', 'TFAS', 'ELIT', 'JATI', 'TOSK', 'DIVA', 'WGSH', 'TRON', 'CASH', 'UVCR', 'RUNS', 'EPAC', 'INDX', 'DIGI', 'TRGU', 'TRST', 'ALDO', 'PDPP', 'SPMA', 'FPNI', 'INRU', 'NIKL', 'SPID', 'BUDI', 'MOLI', 'IPOL', 'BTEK', 'KDSI', 'HOKI', 'AYAM', 'PBRX', 'BRNA', 'APLI', 'EKAD', 'SMKL', 'TALF', 'ADMG', 'IGAR', 'MDKI', 'WMUU', 'CLPI', 'ASHA', 'AKPI', 'SSTM', 'YPAS', 'ESTI', 'ERTX', 'ANDI', 'OBMD', 'NPGF', 'INOV', 'AYLS', 'PSDN', 'CHEM', 'PICO', 'INCI', 'FLMC', 'SBMA', 'DPNS', 'OILS', 'POLY', 'AMMS', 'PTPS', 'GULA', 'ACRO', 'LMAX'],
  'Process Industries': ['TPIA', 'PGUN', 'CPIN', 'JARR', 'INKP', 'TAPG', 'JPFA', 'AVIA', 'TKIM', 'STAA', 'SSMS', 'AALI', 'SMAR', 'NSSS', 'TLDN', 'LSIP', 'SGRO', 'ANJT', 'PALM', 'AGII', 'BWPT', 'TBLA', 'UDNG', 'PACK', 'PBID', 'CPRO', 'SAMF', 'ARGO', 'PNGO', 'MGRO', 'BISI', 'JAWA', 'TFCO', 'BRAM', 'MLIA', 'DGWG', 'GZCO', 'CSRA', 'INDR', 'MSJA', 'MAIN', 'AMFG', 'NEST'],
  'Consumer Non-Durables': ['PANI', 'ICBP', 'HMSP', 'UNVR', 'INDF', 'MYOR', 'FAPA', 'GGRM', 'POLU', 'YUPI', 'ULTJ', 'GOOD', 'STTP', 'MLBI', 'CLEO', 'FISH', 'SIMP', 'ADES', 'BEEF', 'DMND', 'PSGO', 'ROTI', 'CBUT', 'VICI', 'KEJU', 'UNIC', 'WIIM', 'UCID', 'KINO', 'STRK', 'DLTA', 'CEKA', 'EURO', 'SKLT', 'CAMP', 'TCID', 'AISA', 'COCO', 'SKBM', 'SURI', 'GUNA', 'TRIS', 'MAXI', 'WINE', 'CRAB', 'ZONE', 'BEER', 'BELL', 'SRSN', 'NAYZ', 'MBTO', 'ITIC', 'BOBA', 'WAPO', 'DSFI', 'IKAN', 'SOUL', 'NASI', 'ENZO', 'BATA', 'BIMA', 'RICY', 'PCAR', 'BRRC', 'KLIN', 'ISEA', 'TAYS'],
  'Communications': ['TLKM', 'ISAT', 'MTEL', 'EXCL', 'MORA', 'DATA', 'LINK', 'CENT', 'INET', 'GHON', 'MSKY', 'JAST', 'DNET'],
  'Consumer Services': ['EMTK', 'FILM', 'MSIN', 'SCMA', 'BUVA', 'CNMA', 'ALII', 'JSPT', 'CLAY', 'INPP', 'FORE', 'MAPB', 'PNIN', 'BHIT', 'SINI', 'BMTR', 'BLTZ', 'FAST', 'RAAM', 'IPTV', 'MINA', 'ENAK', 'OMRE', 'ARTA', 'MDIA', 'PKST', 'NATO', 'BOLA', 'FITT', 'SHID', 'PANR', 'PJAA', 'PZZA', 'PNSE', 'VERN', 'ESTA', 'VIVA', 'BAYU', 'IBOS', 'PDES', 'KBLV', 'EAST', 'SOTS', 'HAJJ', 'HRME', 'ABBA', 'CSMI', 'PTSP', 'MARI', 'SNLK', 'TMPO', 'DFAM', 'PGLI', 'RBMS', 'ICON', 'PLAN', 'GRPH', 'BAIK', 'KDTN', 'RAFI', 'KAQI'],
  'Retail Trade': ['AMRT', 'BELI', 'MDIY', 'MAPI', 'BUKA', 'MAPA', 'MIDI', 'ACES', 'LPPF', 'RALS', 'DAYA', 'MLPL', 'HERO', 'SONA', 'BOGA', 'CARS', 'DEPO', 'PMJS', 'ERAL', 'RANC', 'BABY', 'MPPA', 'KONI', 'UFOE', 'ZATA', 'MDRN', 'DEWI', 'ECII', 'GLOB', 'KIOS', 'DOSS'],
  'Health Services': ['SRAJ', 'MIKA', 'SILO', 'HEAL', 'PRAY', 'CARE', 'SAME', 'MTMH', 'PRDA', 'WIRG', 'BMHS', 'RSCH', 'PRIM', 'DGNS', 'DKHH'],
  'Producer Manufacturing': ['IMPC', 'AUTO', 'SMSM', 'DRMA', 'ARNA', 'TOTO', 'BOLT', 'BUKK', 'KMTR', 'SCCO', 'INDS', 'KBLI', 'MKAP', 'VOKS', 'TBMS', 'JECC', 'HALO', 'CCSI', 'KBLM', 'AMIN', 'BINO', 'KRYA', 'HOPE', 'LION', 'PSSI', 'IKAI', 'APII', 'GEMA', 'CINT', 'ESIP', 'SEMA', 'KUAS', 'PART', 'INCF', 'OBAT', 'ASPR', 'ISAP', 'AEGS', 'SAPX', 'KARW', 'BSML', 'PTIS', 'HELI', 'PURA'],
  'Transportation': ['TCPI', 'JSMR', 'SHIP', 'RMKE', 'GIAA', 'CMNP', 'TMAS', 'CBRE', 'SMDR', 'CASS', 'BIRD', 'PORT', 'BESS', 'GMFI', 'ELPI', 'BULL', 'MBSS', 'HATM', 'HUMI', 'TPMA', 'IPCC', 'WINS', 'SOCI', 'GTSI', 'IPCM', 'CMPP', 'MITI', 'TAMU', 'BLTA', 'NELY', 'BBRM', 'GTRA', 'HAIS', 'RIGS', 'KLAS', 'WEHA', 'TAXI', 'LAJU', 'SAFE', 'TRUK', 'TNCA', 'KJEN', 'PPGL', 'SDMY', 'JAYA', 'LRNA', 'ARKA', 'CANI', 'PSAT', 'MPXL', 'LOPI', 'BOAT', 'BLOG'],
  'Industrial Services': ['PTRO', 'SSIA', 'BNBR', 'IBST', 'BALI', 'CTBN', 'ARKO', 'RONY', 'TEBE', 'TOTL', 'PBSA', 'ACST', 'PTPP', 'ADHI', 'NRCA', 'KETR', 'BBSS', 'ASLI', 'JKON', 'UNIQ', 'MHKI', 'IDPR', 'BEST', 'WTON', 'PPRE', 'PTPW', 'BDKR', 'PKPK', 'WEGE', 'DGIK', 'LEAD', 'APEX', 'ATLA', 'SMKM', 'LCKM', 'MIRA', 'WOWS', 'RUIS', 'MTPS', 'RGAS', 'KOKA', 'SOLA', 'INTA'],
  'Distribution Services': ['CMRY', 'AKRA', 'TSPC', 'ERAA', 'EPMT', 'TGKA', 'MPMX', 'HEXA', 'MDLA', 'IATA', 'CSAP', 'SPTO', 'BUAH', 'LTLS', 'BIKE', 'MMIX', 'ASLC', 'SMGA'],
  'Health Technology': ['KLBF', 'SIDO', 'SOHO', 'PYFA', 'OMED', 'KAEF', 'DVLA', 'MERK', 'IKPM', 'MEDS', 'CHEK', 'SQBI'],
  'Consumer Durables': ['CITA', 'VKTR', 'HRTA', 'IMAS', 'GJTL', 'WOOD', 'POLI', 'MGLV', 'RODA', 'GPRA', 'UNTD', 'KSIX', 'DART', 'SCNP', 'GDYR', 'TYRE', 'NTBK', 'MANG', 'OLIV', 'CAKK', 'LMPI', 'INTD', 'LAND', 'KICI', 'BAPA', 'TAMA', 'SPRE'],
  'Commercial Services': ['PNLF', 'BPII', 'MNCN', 'BHAT', 'FUTR', 'DMMX', 'JTPE', 'OASA', 'MKTR', 'NETV', 'DOOH', 'SOSS', 'KING', 'LFLO', 'FORU', 'GOLF', 'DYAN', 'MUTU', 'NANO', 'LUCY', 'HDIT', 'IDEA', 'BMBL', 'NAIK', 'HYGN', 'CSRN', 'MERI', 'TOOL', 'PADA', 'MPIX'],
  'Miscellaneous': ['RATU', 'COIN'],
  'Electronic Technology': ['MTDL', 'PTSN', 'AXIO', 'IKBI', 'LPIN', 'ZYRX', 'RCCC']
};

// Initialize bot with robust polling
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set!');
  process.exit(1);
}

console.log('📡 Initializing bot in POLLING mode...');

const bot = new TelegramBot(token, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// Handle polling errors
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.code, error.message);
  if (error.code === 'EFATAL') {
    console.error('Fatal polling error - bot may need restart');
  }
});

// Handle webhook errors (shouldn't happen in polling mode)
bot.on('webhook_error', (error) => {
  console.error('❌ Webhook error:', error);
});

console.log('✅ Bot initialized successfully in POLLING mode');

// Helper Functions
function calculateStochastic(data) {
  const k = CONFIG.STOCH_K_PERIOD;
  const kSmooth = CONFIG.STOCH_K_SMOOTH;
  const d = CONFIG.STOCH_D_PERIOD;
  
  if (data.length < k + kSmooth + d) {
    return null;
  }
  
  const rawK = [];
  for (let i = k - 1; i < data.length; i++) {
    const slice = data.slice(i - k + 1, i + 1);
    const highestHigh = Math.max(...slice.map(x => x.high));
    const lowestLow = Math.min(...slice.map(x => x.low));
    
    const currentClose = data[i].close;
    const k_val = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    rawK.push(k_val);
  }
  
  const smoothK = [];
  for (let i = kSmooth - 1; i < rawK.length; i++) {
    const slice = rawK.slice(i - kSmooth + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    smoothK.push(avg);
  }
  
  const dLine = [];
  for (let i = d - 1; i < smoothK.length; i++) {
    const slice = smoothK.slice(i - d + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    dLine.push(avg);
  }
  
  if (smoothK.length === 0 || dLine.length === 0) {
    return null;
  }
  
  return {
    k: smoothK[smoothK.length - 1],
    d: dLine[dLine.length - 1],
    prevK: smoothK.length > 1 ? smoothK[smoothK.length - 2] : null,
    prevD: dLine.length > 1 ? dLine[dLine.length - 2] : null
  };
}

function analyzeStochastic(stoch) {
  if (!stoch || stoch.prevK === null || stoch.prevD === null) {
    return '';
  }
  
  const oversold = CONFIG.OVERSOLD_LEVEL;
  const k = stoch.k;
  const d = stoch.d;
  const prevK = stoch.prevK;
  const prevD = stoch.prevD;
  
  const kCrossedAboveD = prevK <= prevD && k > d;
  const inOversold = k < oversold || d < oversold;
  
  if (kCrossedAboveD && inOversold) {
    return '🟢 BUY';
  } else if (kCrossedAboveD) {
    return '🟡 POTENTIAL';
  }
  
  return '';
}

async function getStockData(symbol) {
  try {
    const ticker = `${symbol}.JK`;
    const endDate = Math.floor(Date.now() / 1000);
    const startDate = endDate - (CONFIG.DAYS_TO_FETCH * 24 * 60 * 60);
    
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${startDate}&period2=${endDate}&interval=1d`;
    
    const response = await axios.get(url);
    const result = response.data.chart.result[0];
    
    if (!result || !result.timestamp) {
      throw new Error('No data available');
    }
    
    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];
    
    const data = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.open[i] && quote.high[i] && quote.low[i] && quote.close[i]) {
        data.push({
          date: new Date(timestamps[i] * 1000),
          open: quote.open[i],
          high: quote.high[i],
          low: quote.low[i],
          close: quote.close[i],
          volume: quote.volume[i] || 0
        });
      }
    }
    
    if (data.length < 30) {
      throw new Error('Insufficient data');
    }
    
    return data;
  } catch (error) {
    throw new Error(`Failed to fetch data: ${error.message}`);
  }
}

async function screenStock(symbol) {
  try {
    const data = await getStockData(symbol);
    const stoch = calculateStochastic(data);
    
    if (!stoch) {
      return { symbol, error: 'Calculation failed' };
    }
    
    const signal = analyzeStochastic(stoch);
    const lastData = data[data.length - 1];
    
    return {
      symbol,
      price: lastData.close.toFixed(2),
      k: stoch.k.toFixed(2),
      d: stoch.d.toFixed(2),
      signal,
      date: lastData.date.toISOString().split('T')[0]
    };
  } catch (error) {
    return { symbol, error: error.message };
  }
}

async function screenStocksBatch(symbols) {
  const results = [];
  
  for (let i = 0; i < symbols.length; i += CONFIG.MAX_CONCURRENT) {
    const batch = symbols.slice(i, i + CONFIG.MAX_CONCURRENT);
    
    const batchPromises = batch.map(symbol => 
      screenStock(symbol).catch(error => ({
        symbol,
        error: error.message || 'Unknown error'
      }))
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    if (i + CONFIG.MAX_CONCURRENT < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.WAIT_TIME));
    }
  }
  
  return results;
}

async function screenSector(sectorName, chatId, progressCallback) {
  const stocks = IDX_SECTORS[sectorName];
  if (!stocks) {
    throw new Error('Sector not found');
  }
  
  const total = stocks.length;
  let processed = 0;
  
  const results = [];
  
  for (let i = 0; i < stocks.length; i += CONFIG.MAX_CONCURRENT) {
    const batch = stocks.slice(i, i + CONFIG.MAX_CONCURRENT);
    const batchResults = await screenStocksBatch(batch);
    
    results.push(...batchResults);
    processed += batchResults.length;
    
    if (progressCallback && (processed % 10 === 0 || processed === total)) {
      await progressCallback(processed, total);
    }
  }
  
  return results;
}

function formatResults(results, sectorName = '') {
  const withSignals = results.filter(r => r.signal && !r.error);
  const errors = results.filter(r => r.error);
  
  let message = `📊 *Screening Results${sectorName ? ' - ' + sectorName : ''}*\n\n`;
  
  if (withSignals.length > 0) {
    message += `🎯 *Stocks with Signals (${withSignals.length})*\n\n`;
    
    withSignals.forEach(r => {
      message += `*${r.symbol}*\n`;
      message += `Price: Rp ${r.price}\n`;
      message += `%K: ${r.k} | %D: ${r.d}\n`;
      message += `Signal: ${r.signal}\n`;
      message += `Date: ${r.date}\n\n`;
    });
  } else {
    message += `No stocks with buy signals found.\n\n`;
  }
  
  message += `\n📈 Total screened: ${results.length}\n`;
  message += `✅ With signals: ${withSignals.length}\n`;
  if (errors.length > 0) {
    message += `❌ Errors: ${errors.length}\n`;
  }
  
  return message;
}

// Get user's sectors or default
function getUserSectors(chatId) {
  return userSectors.get(chatId) || AUTO_SCAN_CONFIG.DEFAULT_SECTORS;
}

// Signal History Tracking Functions
function recordSignal(symbol, signalType, price) {
  const today = new Date().toISOString().split('T')[0];
  
  // Check if we already have this signal today
  const exists = signalHistory.some(s => 
    s.symbol === symbol && 
    s.signalDate === today && 
    s.signalType === signalType
  );
  
  if (!exists) {
    signalHistory.push({
      symbol,
      signalDate: today,
      signalType,
      entryPrice: parseFloat(price),
      recorded: new Date().toISOString()
    });
    
    // Keep only last 90 days of history
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const cutoff = ninetyDaysAgo.toISOString().split('T')[0];
    
    const filtered = signalHistory.filter(s => s.signalDate >= cutoff);
    signalHistory.length = 0;
    signalHistory.push(...filtered);
    
    saveData();
  }
}

async function updateSignalPerformance() {
  console.log('Updating signal performance...');
  
  // Check performance of signals from 7, 14, 30 days ago
  const today = new Date();
  const periods = [7, 14, 30];
  let updated = 0;
  
  for (const signal of signalHistory) {
    // Skip if already evaluated for all periods
    if (signal.evaluated30d) continue;
    
    const signalDate = new Date(signal.signalDate);
    const daysOld = Math.floor((today - signalDate) / (1000 * 60 * 60 * 24));
    
    // Evaluate at 7, 14, 30 days
    for (const days of periods) {
      const key = `evaluated${days}d`;
      
      if (daysOld >= days && !signal[key]) {
        try {
          // Fetch current price
          const data = await getStockData(signal.symbol);
          if (data && data.length > 0) {
            const latestPrice = data[data.length - 1].close;
            const returnPct = ((latestPrice - signal.entryPrice) / signal.entryPrice) * 100;
            
            signal[`price${days}d`] = latestPrice;
            signal[`return${days}d`] = returnPct;
            signal[key] = true;
            updated++;
            
            console.log(`  ${signal.symbol}: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}% after ${days}d`);
          }
        } catch (error) {
          console.error(`  Error evaluating ${signal.symbol}:`, error.message);
        }
        
        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
  
  if (updated > 0) {
    saveData();
    console.log(`✅ Updated ${updated} signal evaluations`);
  } else {
    console.log('✅ No signals to update');
  }
}

function calculatePerformanceStats(days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().split('T')[0];
  
  // Get signals from specified period
  const recentSignals = signalHistory.filter(s => s.signalDate >= cutoff);
  
  if (recentSignals.length === 0) {
    return null;
  }
  
  // Calculate stats for different holding periods
  const stats = {
    totalSignals: recentSignals.length,
    buySignals: recentSignals.filter(s => s.signalType === 'BUY').length,
    potentialSignals: recentSignals.filter(s => s.signalType === 'POTENTIAL').length,
    periods: {}
  };
  
  // Stats for each period (7d, 14d, 30d)
  for (const period of [7, 14, 30]) {
    const key = `return${period}d`;
    const evaluated = recentSignals.filter(s => s[key] !== undefined);
    
    if (evaluated.length > 0) {
      const returns = evaluated.map(s => s[key]);
      const profitable = returns.filter(r => r > 0).length;
      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const maxReturn = Math.max(...returns);
      const minReturn = Math.min(...returns);
      
      stats.periods[`${period}d`] = {
        evaluated: evaluated.length,
        profitable,
        unprofitable: evaluated.length - profitable,
        winRate: (profitable / evaluated.length * 100).toFixed(1),
        avgReturn: avgReturn.toFixed(2),
        maxReturn: maxReturn.toFixed(2),
        minReturn: minReturn.toFixed(2)
      };
    }
  }
  
  return stats;
}

function getStockPerformance(symbol, days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().split('T')[0];
  
  const stockSignals = signalHistory.filter(s => 
    s.symbol === symbol && s.signalDate >= cutoff
  );
  
  if (stockSignals.length === 0) {
    return null;
  }
  
  const stats = {
    symbol,
    totalSignals: stockSignals.length,
    signals: []
  };
  
  for (const signal of stockSignals) {
    const signalInfo = {
      date: signal.signalDate,
      type: signal.signalType,
      entryPrice: signal.entryPrice,
      returns: {}
    };
    
    for (const period of [7, 14, 30]) {
      const key = `return${period}d`;
      if (signal[key] !== undefined) {
        signalInfo.returns[`${period}d`] = {
          return: signal[key],
          price: signal[`price${period}d`]
        };
      }
    }
    
    stats.signals.push(signalInfo);
  }
  
  return stats;
}

function getTopPerformers(days = 30, limit = 10) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().split('T')[0];
  
  // Group by symbol
  const bySymbol = new Map();
  
  for (const signal of signalHistory) {
    if (signal.signalDate >= cutoff && signal.return30d !== undefined) {
      if (!bySymbol.has(signal.symbol)) {
        bySymbol.set(signal.symbol, []);
      }
      bySymbol.get(signal.symbol).push(signal);
    }
  }
  
  // Calculate average return per symbol
  const symbolStats = [];
  
  for (const [symbol, signals] of bySymbol) {
    const returns = signals.map(s => s.return30d || 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const profitable = returns.filter(r => r > 0).length;
    
    symbolStats.push({
      symbol,
      signalCount: signals.length,
      avgReturn: avgReturn.toFixed(2),
      winRate: (profitable / signals.length * 100).toFixed(1),
      lastSignal: signals[signals.length - 1].signalDate
    });
  }
  
  // Sort by average return
  symbolStats.sort((a, b) => parseFloat(b.avgReturn) - parseFloat(a.avgReturn));
  
  return symbolStats.slice(0, limit);
}


// FEATURE 1: Custom Sector Selection
async function performAutoScan(sessionName) {
  if (!AUTO_SCAN_CONFIG.ENABLED || subscribers.size === 0) {
    return;
  }
  
  console.log(`[${new Date().toLocaleString('id-ID', { timeZone: CONFIG.TIMEZONE })}] Starting auto-scan for ${sessionName}`);
  
  // Scan all default sectors and store results
  const allSectorResults = new Map();
  
  const sectorPromises = AUTO_SCAN_CONFIG.DEFAULT_SECTORS.map(async (sectorName) => {
    try {
      console.log(`  Scanning ${sectorName}...`);
      const results = await screenSector(sectorName, null, null);
      const withSignals = results.filter(r => r.signal && !r.error);
      allSectorResults.set(sectorName, withSignals);
      
      if (withSignals.length > 0) {
        return { sector: sectorName, results: withSignals };
      }
      return null;
    } catch (error) {
      console.error(`Error scanning ${sectorName}:`, error.message);
      return null;
    }
  });
  
  await Promise.all(sectorPromises);
  
  // Record all signals in history
  for (const [sectorName, withSignals] of allSectorResults) {
    for (const result of withSignals) {
      if (result.signal && result.price) {
        // Extract signal type from emoji
        let signalType = 'POTENTIAL';
        if (result.signal.includes('🟢')) {
          signalType = 'BUY';
        }
        recordSignal(result.symbol, signalType, result.price);
      }
    }
  }
  
  // Store for daily summary
  lastScanResults.set('time', new Date());
  lastScanResults.set('results', allSectorResults);
  
  console.log(`Auto-scan completed.`);
  
  // Send personalized results to each subscriber
  for (const chatId of subscribers) {
    try {
      const userSelectedSectors = getUserSectors(chatId);
      const relevantResults = [];
      
      for (const sector of userSelectedSectors) {
        const sectorResults = allSectorResults.get(sector);
        if (sectorResults && sectorResults.length > 0) {
          relevantResults.push({ sector, results: sectorResults });
        }
      }
      
      let message = `🔔 *Auto-Scan Alert - ${sessionName}*\n`;
      message += `⏰ Time: ${new Date().toLocaleTimeString('id-ID', { timeZone: CONFIG.TIMEZONE, hour: '2-digit', minute: '2-digit' })} WIB\n\n`;
      
      if (relevantResults.length === 0) {
        message += `No signals found in your monitored sectors.\n\n`;
        message += `Your sectors: ${userSelectedSectors.join(', ')}`;
      } else {
        for (const { sector, results } of relevantResults) {
          message += `📂 *${sector}* (${results.length} signals)\n`;
          
          results.forEach(r => {
            message += `• ${r.symbol}: Rp ${r.price} ${r.signal}\n`;
          });
          message += `\n`;
        }
      }
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error(`Error sending to ${chatId}:`, error.message);
      if (error.response && error.response.statusCode === 403) {
        subscribers.delete(chatId);
        saveData();
      }
    }
  }
  
  console.log(`Auto-scan notifications sent to ${subscribers.size} subscribers.`);
}

// FEATURE 3: Daily Summary
async function sendDailySummary() {
  if (subscribers.size === 0) return;
  
  console.log('Generating daily summary...');
  
  // Get top signals from last scan
  const results = lastScanResults.get('results');
  if (!results || results.size === 0) {
    console.log('No recent scan results for daily summary');
    return;
  }
  
  // Collect all signals and sort by strength
  const allSignals = [];
  for (const [sector, signals] of results.entries()) {
    signals.forEach(s => allSignals.push({ ...s, sector }));
  }
  
  // Sort: Buy signals first, then by K value (lower = more oversold)
  allSignals.sort((a, b) => {
    if (a.signal === '🟢 BUY' && b.signal !== '🟢 BUY') return -1;
    if (a.signal !== '🟢 BUY' && b.signal === '🟢 BUY') return 1;
    return parseFloat(a.k) - parseFloat(b.k);
  });
  
  const top10 = allSignals.slice(0, 10);
  
  for (const chatId of subscribers) {
    try {
      let message = `☀️ *Daily Summary - Top Opportunities*\n`;
      message += `📅 ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;
      
      if (top10.length === 0) {
        message += `No strong signals found yesterday.\n`;
      } else {
        message += `🎯 *Top ${top10.length} Signals*\n\n`;
        
        top10.forEach((s, index) => {
          message += `${index + 1}. *${s.symbol}* (${s.sector})\n`;
          message += `   Price: Rp ${s.price} | Signal: ${s.signal}\n`;
          message += `   %K: ${s.k} | %D: ${s.d}\n\n`;
        });
      }
      
      message += `\n💡 Use /watchlist to track your favorites`;
      message += `\n⚙️ Use /mysectors to customize alerts`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error(`Error sending daily summary to ${chatId}:`, error.message);
    }
  }
  
  console.log('Daily summary sent');
}

// FEATURE 2: Watchlist & Price Alerts
async function checkWatchlist() {
  for (const [chatId, stocks] of watchlist.entries()) {
    if (stocks.length === 0) continue;
    
    try {
      const results = await screenStocksBatch(stocks);
      const withSignals = results.filter(r => r.signal && !r.error);
      
      if (withSignals.length > 0) {
        let message = `👀 *Watchlist Alert*\n\n`;
        
        withSignals.forEach(r => {
          message += `*${r.symbol}*\n`;
          message += `Price: Rp ${r.price}\n`;
          message += `Signal: ${r.signal}\n`;
          message += `%K: ${r.k} | %D: ${r.d}\n\n`;
        });
        
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      console.error(`Error checking watchlist for ${chatId}:`, error.message);
    }
  }
}

// Schedule all scans
function setupAutoScans() {
  if (!AUTO_SCAN_CONFIG.ENABLED) {
    console.log('Auto-scan is disabled');
    return;
  }
  
  // Morning scan (10:00 WIB)
  const [morningHour, morningMin] = AUTO_SCAN_CONFIG.SCHEDULE.MORNING_SCAN.split(':');
  cron.schedule(`${morningMin} ${morningHour} * * 1-5`, () => {
    performAutoScan('Morning Scan (10:00 WIB)');
  }, { timezone: CONFIG.TIMEZONE });
  
  // Afternoon scan (13:00 WIB)
  const [afternoonHour, afternoonMin] = AUTO_SCAN_CONFIG.SCHEDULE.AFTERNOON_SCAN.split(':');
  cron.schedule(`${afternoonMin} ${afternoonHour} * * 1-5`, () => {
    performAutoScan('Afternoon Scan (13:00 WIB)');
  }, { timezone: CONFIG.TIMEZONE });
  
  // Evening scan (16:00 WIB)
  const [eveningHour, eveningMin] = AUTO_SCAN_CONFIG.SCHEDULE.EVENING_SCAN.split(':');
  cron.schedule(`${eveningMin} ${eveningHour} * * 1-5`, () => {
    performAutoScan('Evening Scan (16:00 WIB)');
  }, { timezone: CONFIG.TIMEZONE });
  
  // Daily summary (08:00 WIB)
  const [summaryHour, summaryMin] = AUTO_SCAN_CONFIG.SCHEDULE.DAILY_SUMMARY.split(':');
  cron.schedule(`${summaryMin} ${summaryHour} * * 1-5`, () => {
    sendDailySummary();
  }, { timezone: CONFIG.TIMEZONE });
  
  // Watchlist check (every hour during market hours)
  cron.schedule('0 9-15 * * 1-5', () => {
    checkWatchlist();
  }, { timezone: CONFIG.TIMEZONE });
  
  // Update signal performance (daily at 17:00 WIB - after market closes)
  cron.schedule('0 17 * * 1-5', () => {
    updateSignalPerformance();
  }, { timezone: CONFIG.TIMEZONE });
  
  console.log('✅ Auto-scan schedules set up:');
  console.log(`   • Daily Summary: ${AUTO_SCAN_CONFIG.SCHEDULE.DAILY_SUMMARY} WIB`);
  console.log(`   • Morning Scan: ${AUTO_SCAN_CONFIG.SCHEDULE.MORNING_SCAN} WIB`);
  console.log(`   • Afternoon Scan: ${AUTO_SCAN_CONFIG.SCHEDULE.AFTERNOON_SCAN} WIB`);
  console.log(`   • Evening Scan: ${AUTO_SCAN_CONFIG.SCHEDULE.EVENING_SCAN} WIB`);
  console.log(`   • Watchlist checks: Every hour during market hours`);
  console.log(`   • Performance update: 17:00 WIB (daily)`);
}

// Admin check
function isAdmin(chatId) {
  return CONFIG.ADMIN_ID && chatId.toString() === CONFIG.ADMIN_ID.toString();
}

// Access control functions
function hasAccess(chatId) {
  // Admin always has access
  if (isAdmin(chatId)) return true;
  
  // Check access mode
  if (CONFIG.ACCESS_MODE === 'open') {
    // Open mode - everyone has access except blocked
    return !blockedUsers.has(chatId);
  } else if (CONFIG.ACCESS_MODE === 'whitelist') {
    // Whitelist mode - only allowed users
    return allowedUsers.has(chatId) && !blockedUsers.has(chatId);
  } else if (CONFIG.ACCESS_MODE === 'approval') {
    // Approval mode - needs admin approval
    return allowedUsers.has(chatId) && !blockedUsers.has(chatId);
  }
  
  return false;
}

function checkAccess(msg, callback) {
  const chatId = msg.chat.id;
  
  if (hasAccess(chatId)) {
    callback();
    return true;
  }
  
  // User doesn't have access
  if (blockedUsers.has(chatId)) {
    bot.sendMessage(chatId, '🚫 You have been blocked from using this bot.');
    return false;
  }
  
  if (CONFIG.ACCESS_MODE === 'whitelist') {
    bot.sendMessage(chatId, 
      '🔒 *Access Restricted*\n\n' +
      'This bot is private and requires authorization.\n\n' +
      'Your Telegram ID: `' + chatId + '`\n\n' +
      'Please contact the bot administrator to request access.',
      { parse_mode: 'Markdown' }
    );
    return false;
  }
  
  if (CONFIG.ACCESS_MODE === 'approval') {
    if (pendingApprovals.has(chatId)) {
      bot.sendMessage(chatId, 
        '⏳ *Access Pending*\n\n' +
        'Your access request is waiting for admin approval.\n\n' +
        'Please wait for the administrator to approve your request.',
        { parse_mode: 'Markdown' }
      );
    } else {
      pendingApprovals.add(chatId);
      saveData();
      
      bot.sendMessage(chatId,
        '📝 *Access Request Submitted*\n\n' +
        'Your request has been sent to the administrator.\n\n' +
        'You will be notified once approved.',
        { parse_mode: 'Markdown' }
      );
      
      // Notify admin
      if (CONFIG.ADMIN_ID) {
        const user = msg.from;
        const userName = user.username ? `@${user.username}` : user.first_name || 'Unknown';
        bot.sendMessage(CONFIG.ADMIN_ID,
          `🔔 *New Access Request*\n\n` +
          `User: ${userName}\n` +
          `Name: ${user.first_name} ${user.last_name || ''}\n` +
          `ID: \`${chatId}\`\n\n` +
          `Use /approve ${chatId} to grant access\n` +
          `Use /deny ${chatId} to deny access`,
          { parse_mode: 'Markdown' }
        );
      }
    }
    return false;
  }
  
  return false;
}

// Access control check
function hasAccess(chatId) {
  // If whitelist is disabled, everyone has access
  if (!CONFIG.WHITELIST_ENABLED) {
    return true;
  }
  
  // Admin always has access
  if (isAdmin(chatId)) {
    return true;
  }
  
  // Check if user is in whitelist
  return CONFIG.WHITELIST_USERS.includes(chatId.toString());
}

// Middleware to check access before processing commands
function checkAccess(msg, callback) {
  const chatId = msg.chat.id;
  
  if (!hasAccess(chatId)) {
    bot.sendMessage(chatId, 
      '🔒 *Access Restricted*\n\n' +
      'This bot is private and requires authorization.\n\n' +
      'Your Telegram ID: `' + chatId + '`\n\n' +
      'Please contact the bot administrator to request access.',
      { parse_mode: 'Markdown' }
    );
    
    // Notify admin of access attempt
    if (CONFIG.ADMIN_ID) {
      bot.sendMessage(CONFIG.ADMIN_ID,
        `⚠️ *Unauthorized Access Attempt*\n\n` +
        `User ID: ${chatId}\n` +
        `Username: @${msg.from.username || 'N/A'}\n` +
        `Name: ${msg.from.first_name || ''} ${msg.from.last_name || ''}\n\n` +
        `To add this user:\n` +
        `Add \`${chatId}\` to WHITELIST_USERS`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
    
    return false;
  }
  
  callback();
  return true;
}

// Bot Commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!checkAccess(msg, () => {
    const welcomeMessage = `
🤖 *IDX Stock Screener Bot*

Welcome! I can help you screen Indonesian stocks using Stochastic Oscillator (10,5,5).

*🆕 NEW FEATURES:*
✨ Custom sector selection
✨ Personal watchlist
✨ Daily summary alerts
✨ Historical performance tracking 📊

*Available Commands:*
/sectors - View all available sectors
/screen - Start screening a sector
/stock <SYMBOL> - Check a single stock

*🎯 Personal Features:*
/subscribe - Subscribe to auto-scan alerts
/unsubscribe - Unsubscribe from alerts
/mysectors - Manage your sectors
/addsector - Add sector to your alerts
/removesector - Remove sector from alerts

*👀 Watchlist:*
/watchlist - View your watchlist
/watch <SYMBOL> - Add stock to watchlist
/unwatch <SYMBOL> - Remove from watchlist

*📊 Performance & Analysis:*
/today - Today's top opportunities
/performance - Bot's signal accuracy
/backtest <SYMBOL> - Stock's signal history
/topstocks - Best performing stocks

/help - Show detailed help
    `;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  })) return;
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
📚 *How to use this bot:*

*Basic Screening:*
• /sectors - See all sectors
• /screen - Screen a sector
• /stock BBCA - Check single stock

*Auto-Scan Alerts:*
• /subscribe - Get auto alerts
• /unsubscribe - Stop alerts
• /mysectors - Your current sectors
• /addsector Finance - Add Finance to alerts
• /removesector Tech - Remove Tech

*Watchlist:*
• /watchlist - View watched stocks
• /watch BBCA - Add BBCA to watchlist
• /unwatch BBCA - Remove BBCA

*Performance & Analysis:*
• /today - Top 10 opportunities today
• /performance - Signal accuracy (last 30 days)
• /backtest BBCA - BBCA's signal history
• /topstocks - Best performing stocks

*Settings:*
• K Period: ${CONFIG.STOCH_K_PERIOD}
• Oversold: ${CONFIG.OVERSOLD_LEVEL}

*Signals:*
🟢 BUY - Strong buy signal
🟡 POTENTIAL - Potential buy

*Scan Times (WIB):*
☀️ 08:00 - Daily Summary
☀️ 10:00 - Morning Scan
🌤️ 13:00 - Afternoon Scan
🌆 16:00 - Evening Scan
🔄 17:00 - Performance Update
  `, { parse_mode: 'Markdown' });
});

bot.onText(/\/subscribe/, (msg) => {
  const chatId = msg.chat.id;
  
  if (subscribers.has(chatId)) {
    bot.sendMessage(chatId, '✅ You are already subscribed to auto-scan alerts!');
  } else {
    subscribers.add(chatId);
    
    // Set default sectors if user doesn't have any
    if (!userSectors.has(chatId)) {
      userSectors.set(chatId, AUTO_SCAN_CONFIG.DEFAULT_SECTORS);
    }
    
    saveData();
    
    const userSelectedSectors = getUserSectors(chatId);
    
    bot.sendMessage(chatId, `
🔔 *Subscribed to Auto-Scan Alerts!*

You will receive alerts at:
☀️ 08:00 WIB - Daily Summary
☀️ 10:00 WIB - Morning Scan
🌤️ 13:00 WIB - Afternoon Scan
🌆 16:00 WIB - Evening Scan

*Your monitored sectors (${userSelectedSectors.length}):*
${userSelectedSectors.map(s => `• ${s}`).join('\n')}

Use /mysectors to customize
Use /unsubscribe to stop alerts
    `, { parse_mode: 'Markdown' });
  }
});

bot.onText(/\/unsubscribe/, (msg) => {
  const chatId = msg.chat.id;
  
  if (subscribers.has(chatId)) {
    subscribers.delete(chatId);
    saveData();
    bot.sendMessage(chatId, '❌ You have been unsubscribed from auto-scan alerts.\n\nUse /subscribe to re-enable.');
  } else {
    bot.sendMessage(chatId, 'You are not currently subscribed to alerts.\n\nUse /subscribe to enable alerts.');
  }
});

// FEATURE 1: Custom Sectors Commands
bot.onText(/\/mysectors/, (msg) => {
  const chatId = msg.chat.id;
  const userSelectedSectors = getUserSectors(chatId);
  
  let message = `⚙️ *Your Monitored Sectors (${userSelectedSectors.length})*\n\n`;
  
  userSelectedSectors.forEach((sector, index) => {
    const count = IDX_SECTORS[sector]?.length || 0;
    message += `${index + 1}. ${sector} (${count} stocks)\n`;
  });
  
  message += `\n*Commands:*\n`;
  message += `/addsector <name> - Add a sector\n`;
  message += `/removesector <name> - Remove a sector\n`;
  message += `/sectors - See all available sectors`;
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/addsector (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const sectorName = match[1].trim();
  
  // Find matching sector (case-insensitive)
  const matchedSector = Object.keys(IDX_SECTORS).find(
    s => s.toLowerCase() === sectorName.toLowerCase()
  );
  
  if (!matchedSector) {
    bot.sendMessage(chatId, `❌ Sector "${sectorName}" not found.\n\nUse /sectors to see all available sectors.`);
    return;
  }
  
  const currentSectors = getUserSectors(chatId);
  
  if (currentSectors.includes(matchedSector)) {
    bot.sendMessage(chatId, `✅ ${matchedSector} is already in your monitored sectors.`);
    return;
  }
  
  currentSectors.push(matchedSector);
  userSectors.set(chatId, currentSectors);
  saveData();
  
  bot.sendMessage(chatId, `✅ Added *${matchedSector}* to your monitored sectors!\n\nYou now monitor ${currentSectors.length} sectors.\nUse /mysectors to view all.`, { parse_mode: 'Markdown' });
});

bot.onText(/\/removesector (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const sectorName = match[1].trim();
  
  const matchedSector = Object.keys(IDX_SECTORS).find(
    s => s.toLowerCase() === sectorName.toLowerCase()
  );
  
  if (!matchedSector) {
    bot.sendMessage(chatId, `❌ Sector "${sectorName}" not found.`);
    return;
  }
  
  const currentSectors = getUserSectors(chatId);
  const index = currentSectors.indexOf(matchedSector);
  
  if (index === -1) {
    bot.sendMessage(chatId, `❌ ${matchedSector} is not in your monitored sectors.`);
    return;
  }
  
  currentSectors.splice(index, 1);
  
  if (currentSectors.length === 0) {
    // Reset to default if removing all
    userSectors.set(chatId, AUTO_SCAN_CONFIG.DEFAULT_SECTORS);
    bot.sendMessage(chatId, `⚠️ Cannot remove all sectors. Reset to default sectors.\n\nUse /mysectors to view.`);
  } else {
    userSectors.set(chatId, currentSectors);
    bot.sendMessage(chatId, `✅ Removed *${matchedSector}* from your monitored sectors.\n\nYou now monitor ${currentSectors.length} sectors.`, { parse_mode: 'Markdown' });
  }
  
  saveData();
});

// FEATURE 2: Watchlist Commands
bot.onText(/\/watchlist/, (msg) => {
  const chatId = msg.chat.id;
  const watched = watchlist.get(chatId) || [];
  
  if (watched.length === 0) {
    bot.sendMessage(chatId, `👀 *Your Watchlist is Empty*\n\nAdd stocks with:\n/watch BBCA\n/watch TLKM`, { parse_mode: 'Markdown' });
    return;
  }
  
  let message = `👀 *Your Watchlist (${watched.length})*\n\n`;
  watched.forEach((symbol, index) => {
    message += `${index + 1}. ${symbol}\n`;
  });
  
  message += `\n*Commands:*\n`;
  message += `/watch <SYMBOL> - Add stock\n`;
  message += `/unwatch <SYMBOL> - Remove stock\n`;
  message += `/stock <SYMBOL> - Check signal`;
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/watch (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const symbol = match[1].toUpperCase().trim();
  
  const watched = watchlist.get(chatId) || [];
  
  if (watched.includes(symbol)) {
    bot.sendMessage(chatId, `✅ ${symbol} is already in your watchlist.`);
    return;
  }
  
  if (watched.length >= 20) {
    bot.sendMessage(chatId, `⚠️ Watchlist limit reached (20 stocks).\n\nRemove a stock first with /unwatch`);
    return;
  }
  
  watched.push(symbol);
  watchlist.set(chatId, watched);
  saveData();
  
  bot.sendMessage(chatId, `✅ Added *${symbol}* to your watchlist!\n\nYou're watching ${watched.length} stocks.\nUse /watchlist to view all.`, { parse_mode: 'Markdown' });
});

bot.onText(/\/unwatch (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const symbol = match[1].toUpperCase().trim();
  
  const watched = watchlist.get(chatId) || [];
  const index = watched.indexOf(symbol);
  
  if (index === -1) {
    bot.sendMessage(chatId, `❌ ${symbol} is not in your watchlist.`);
    return;
  }
  
  watched.splice(index, 1);
  watchlist.set(chatId, watched);
  saveData();
  
  bot.sendMessage(chatId, `✅ Removed *${symbol}* from your watchlist.\n\nYou're watching ${watched.length} stocks.`, { parse_mode: 'Markdown' });
});

// FEATURE 3: Daily Summary Command
bot.onText(/\/today/, async (msg) => {
  const chatId = msg.chat.id;
  
  const processingMsg = await bot.sendMessage(chatId, `📊 Generating today's top opportunities...`);
  
  try {
    // Quick scan of user's sectors
    const userSelectedSectors = getUserSectors(chatId);
    const allSignals = [];
    
    for (const sector of userSelectedSectors.slice(0, 5)) { // Limit to 5 sectors for speed
      try {
        const results = await screenSector(sector, chatId, null);
        const withSignals = results.filter(r => r.signal && !r.error);
        withSignals.forEach(s => allSignals.push({ ...s, sector }));
      } catch (error) {
        console.error(`Error scanning ${sector}:`, error.message);
      }
    }
    
    // Sort by signal strength
    allSignals.sort((a, b) => {
      if (a.signal === '🟢 BUY' && b.signal !== '🟢 BUY') return -1;
      if (a.signal !== '🟢 BUY' && b.signal === '🟢 BUY') return 1;
      return parseFloat(a.k) - parseFloat(b.k);
    });
    
    const top10 = allSignals.slice(0, 10);
    
    let message = `☀️ *Today's Top Opportunities*\n\n`;
    
    if (top10.length === 0) {
      message += `No strong signals found in your sectors.\n\n`;
      message += `Scanned: ${userSelectedSectors.slice(0, 5).join(', ')}`;
    } else {
      message += `🎯 *Top ${top10.length} Signals*\n\n`;
      
      top10.forEach((s, index) => {
        message += `${index + 1}. *${s.symbol}* (${s.sector})\n`;
        message += `   Price: Rp ${s.price} | ${s.signal}\n`;
        message += `   %K: ${s.k} | %D: ${s.d}\n\n`;
      });
    }
    
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: processingMsg.message_id,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    bot.editMessageText(`❌ Error: ${error.message}`, {
      chat_id: chatId,
      message_id: processingMsg.message_id
    });
  }
});

// Historical Performance Commands
bot.onText(/\/performance/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!checkAccess(msg, () => {
    const stats30 = calculatePerformanceStats(30);
    
    if (!stats30 || Object.keys(stats30.periods).length === 0) {
      bot.sendMessage(chatId, 
        `📊 *Historical Performance*\n\n` +
        `Not enough data yet. The bot needs to run for at least 7 days to show performance statistics.\n\n` +
        `Current signals tracked: ${signalHistory.length}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    let message = `📊 *Signal Performance - Last 30 Days*\n\n`;
    message += `📈 Total Signals: ${stats30.totalSignals}\n`;
    message += `🟢 Buy Signals: ${stats30.buySignals}\n`;
    message += `🟡 Potential Signals: ${stats30.potentialSignals}\n\n`;
    
    // Show stats for each period
    for (const [period, data] of Object.entries(stats30.periods)) {
      message += `*${period.toUpperCase()} Performance:*\n`;
      message += `Evaluated: ${data.evaluated} signals\n`;
      message += `✅ Profitable: ${data.profitable} (${data.winRate}%)\n`;
      message += `❌ Unprofitable: ${data.unprofitable}\n`;
      message += `📊 Avg Return: ${data.avgReturn > 0 ? '+' : ''}${data.avgReturn}%\n`;
      message += `📈 Best: +${data.maxReturn}%\n`;
      message += `📉 Worst: ${data.minReturn}%\n\n`;
    }
    
    message += `💡 *Tip:* Use /backtest BBCA to see performance for a specific stock`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  })) return;
});

bot.onText(/\/backtest (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const symbol = match[1].toUpperCase().trim();
  
  if (!checkAccess(msg, async () => {
    const processingMsg = await bot.sendMessage(chatId, `🔍 Analyzing ${symbol} historical signals...`);
    
    try {
      const stockPerf = getStockPerformance(symbol, 90);
      
      if (!stockPerf) {
        bot.editMessageText(
          `📊 *${symbol} Backtest*\n\n` +
          `No historical signals found for this stock in the last 90 days.\n\n` +
          `The bot will start tracking signals from now on.`,
          {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'Markdown'
          }
        );
        return;
      }
      
      let message = `📊 *${symbol} Historical Performance*\n\n`;
      message += `Total Signals (90 days): ${stockPerf.totalSignals}\n\n`;
      
      // Show each signal
      stockPerf.signals.forEach((sig, index) => {
        message += `${index + 1}. ${sig.date} - ${sig.type}\n`;
        message += `   Entry: Rp ${sig.entryPrice.toFixed(0)}\n`;
        
        if (Object.keys(sig.returns).length > 0) {
          for (const [period, data] of Object.entries(sig.returns)) {
            const returnPct = data.return;
            const emoji = returnPct > 0 ? '✅' : '❌';
            message += `   ${emoji} ${period}: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}% (Rp ${data.price.toFixed(0)})\n`;
          }
        } else {
          message += `   ⏳ Still tracking...\n`;
        }
        message += `\n`;
      });
      
      // Calculate averages if we have returns
      const allReturns7d = stockPerf.signals
        .filter(s => s.returns['7d'])
        .map(s => s.returns['7d'].return);
      
      const allReturns30d = stockPerf.signals
        .filter(s => s.returns['30d'])
        .map(s => s.returns['30d'].return);
      
      if (allReturns7d.length > 0 || allReturns30d.length > 0) {
        message += `📈 *Summary:*\n`;
        
        if (allReturns7d.length > 0) {
          const avg7d = allReturns7d.reduce((a, b) => a + b, 0) / allReturns7d.length;
          const profitable7d = allReturns7d.filter(r => r > 0).length;
          message += `7d: ${avg7d > 0 ? '+' : ''}${avg7d.toFixed(2)}% avg (${profitable7d}/${allReturns7d.length} profitable)\n`;
        }
        
        if (allReturns30d.length > 0) {
          const avg30d = allReturns30d.reduce((a, b) => a + b, 0) / allReturns30d.length;
          const profitable30d = allReturns30d.filter(r => r > 0).length;
          message += `30d: ${avg30d > 0 ? '+' : ''}${avg30d.toFixed(2)}% avg (${profitable30d}/${allReturns30d.length} profitable)\n`;
        }
      }
      
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: processingMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      bot.editMessageText(`❌ Error: ${error.message}`, {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });
    }
  })) return;
});

bot.onText(/\/topstocks/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!checkAccess(msg, () => {
    const topPerformers = getTopPerformers(30, 10);
    
    if (topPerformers.length === 0) {
      bot.sendMessage(chatId,
        `📊 *Top Performing Stocks*\n\n` +
        `Not enough data yet. The bot needs at least 30 days of data to show top performers.\n\n` +
        `Check back in a few weeks!`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    let message = `🏆 *Top 10 Stocks - Last 30 Days*\n\n`;
    message += `Based on average returns from signals\n\n`;
    
    topPerformers.forEach((stock, index) => {
      const returnNum = parseFloat(stock.avgReturn);
      const emoji = returnNum > 0 ? '📈' : '📉';
      
      message += `${index + 1}. ${emoji} *${stock.symbol}*\n`;
      message += `   Avg Return: ${returnNum > 0 ? '+' : ''}${stock.avgReturn}%\n`;
      message += `   Win Rate: ${stock.winRate}%\n`;
      message += `   Signals: ${stock.signalCount}\n`;
      message += `   Last: ${stock.lastSignal}\n\n`;
    });
    
    message += `💡 Use /backtest SYMBOL to see detailed history`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  })) return;
});

// FEATURE 4: Admin Commands
bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  let totalWatchedStocks = 0;
  watchlist.forEach(stocks => totalWatchedStocks += stocks.length);
  
  let sectorDistribution = {};
  userSectors.forEach(sectors => {
    sectors.forEach(s => {
      sectorDistribution[s] = (sectorDistribution[s] || 0) + 1;
    });
  });
  
  const topSectors = Object.entries(sectorDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  let message = `📊 *Bot Statistics*\n\n`;
  message += `👥 Total Users: ${userSectors.size}\n`;
  message += `🔔 Subscribers: ${subscribers.size}\n`;
  message += `👀 Total Watchlist Stocks: ${totalWatchedStocks}\n`;
  message += `📂 Avg Sectors/User: ${(Array.from(userSectors.values()).reduce((sum, sectors) => sum + sectors.length, 0) / userSectors.size || 0).toFixed(1)}\n`;
  message += `📊 Signal History: ${signalHistory.length} records\n\n`;
  
  message += `*Top 5 Monitored Sectors:*\n`;
  topSectors.forEach(([sector, count], index) => {
    message += `${index + 1}. ${sector}: ${count} users\n`;
  });
  
  if (subscribers.size > 0) {
    message += `\n*Subscriber Management:*\n`;
    message += `/unsubscribeall - Unsubscribe all users\n`;
    message += `/unsubscribeall_silent - Unsubscribe without notification\n`;
  }
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const message = match[1];
  let sent = 0;
  let failed = 0;
  
  const statusMsg = await bot.sendMessage(chatId, `📢 Broadcasting to ${subscribers.size} subscribers...`);
  
  for (const userId of subscribers) {
    try {
      await bot.sendMessage(userId, `📢 *Announcement*\n\n${message}`, { parse_mode: 'Markdown' });
      sent++;
    } catch (error) {
      failed++;
      console.error(`Failed to send to ${userId}:`, error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit protection
  }
  
  bot.editMessageText(`✅ Broadcast complete!\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}`, {
    chat_id: chatId,
    message_id: statusMsg.message_id
  });
});

bot.onText(/\/unsubscribeall/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const subscriberCount = subscribers.size;
  
  if (subscriberCount === 0) {
    bot.sendMessage(chatId, '✅ No subscribers to remove.');
    return;
  }
  
  // Ask for confirmation
  const confirmMsg = await bot.sendMessage(chatId,
    `⚠️ *Confirm Unsubscribe All*\n\n` +
    `This will unsubscribe *${subscriberCount} users* from auto-scan alerts.\n\n` +
    `They will need to /subscribe again to receive alerts.\n\n` +
    `Type /confirmunsubscribeall to proceed\n` +
    `Type /cancel to cancel`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/confirmunsubscribeall/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const subscriberCount = subscribers.size;
  
  if (subscriberCount === 0) {
    bot.sendMessage(chatId, '✅ No subscribers to remove.');
    return;
  }
  
  const statusMsg = await bot.sendMessage(chatId, `🔄 Unsubscribing ${subscriberCount} users...`);
  
  // Store subscriber list for notification
  const subscriberList = Array.from(subscribers);
  let notified = 0;
  let failed = 0;
  
  // Clear all subscribers
  subscribers.clear();
  saveData();
  
  // Notify each user (optional - can be disabled if you don't want to notify)
  for (const userId of subscriberList) {
    try {
      await bot.sendMessage(userId,
        `📢 *Subscription Update*\n\n` +
        `You have been unsubscribed from auto-scan alerts by the administrator.\n\n` +
        `Use /subscribe to re-enable alerts if you wish to continue.`,
        { parse_mode: 'Markdown' }
      );
      notified++;
    } catch (error) {
      failed++;
      console.error(`Failed to notify ${userId}:`, error.message);
    }
    
    // Rate limit protection
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  bot.editMessageText(
    `✅ *Unsubscribe Complete!*\n\n` +
    `Unsubscribed: ${subscriberCount} users\n` +
    `Notified: ${notified}\n` +
    `Failed to notify: ${failed}\n\n` +
    `All users have been removed from auto-scan alerts.`,
    {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    }
  );
  
  console.log(`Admin unsubscribed all ${subscriberCount} users`);
});

bot.onText(/\/unsubscribeall_silent/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const subscriberCount = subscribers.size;
  
  if (subscriberCount === 0) {
    bot.sendMessage(chatId, '✅ No subscribers to remove.');
    return;
  }
  
  // Ask for confirmation
  await bot.sendMessage(chatId,
    `⚠️ *Confirm Silent Unsubscribe All*\n\n` +
    `This will unsubscribe *${subscriberCount} users* WITHOUT notifying them.\n\n` +
    `Users will simply stop receiving alerts.\n\n` +
    `Type /confirmsilent to proceed\n` +
    `Type /cancel to cancel`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/confirmsilent/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const subscriberCount = subscribers.size;
  
  if (subscriberCount === 0) {
    bot.sendMessage(chatId, '✅ No subscribers to remove.');
    return;
  }
  
  // Clear all subscribers silently
  subscribers.clear();
  saveData();
  
  bot.sendMessage(chatId,
    `✅ *Silent Unsubscribe Complete!*\n\n` +
    `Removed ${subscriberCount} subscribers without notification.\n\n` +
    `They will no longer receive auto-scan alerts.`,
    { parse_mode: 'Markdown' }
  );
  
  console.log(`Admin silently unsubscribed all ${subscriberCount} users`);
});

bot.onText(/\/cancel/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    return;
  }
  
  bot.sendMessage(chatId, '✅ Operation cancelled.');
});

// Access Control Commands (Admin Only)
bot.onText(/\/approve (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const userId = parseInt(match[1]);
  
  if (isNaN(userId)) {
    bot.sendMessage(chatId, '❌ Invalid user ID');
    return;
  }
  
  allowedUsers.add(userId);
  pendingApprovals.delete(userId);
  blockedUsers.delete(userId);
  saveData();
  
  bot.sendMessage(chatId, `✅ User ${userId} has been approved and can now use the bot.`);
  
  // Notify the user
  bot.sendMessage(userId, 
    '✅ *Access Approved!*\n\n' +
    'You can now use the bot.\n\n' +
    'Type /start to begin.',
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

bot.onText(/\/deny (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const userId = parseInt(match[1]);
  
  if (isNaN(userId)) {
    bot.sendMessage(chatId, '❌ Invalid user ID');
    return;
  }
  
  pendingApprovals.delete(userId);
  allowedUsers.delete(userId);
  saveData();
  
  bot.sendMessage(chatId, `❌ User ${userId}'s access request has been denied.`);
  
  // Notify the user
  bot.sendMessage(userId,
    '❌ *Access Denied*\n\n' +
    'Your access request has been denied by the administrator.',
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

bot.onText(/\/block (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const userId = parseInt(match[1]);
  
  if (isNaN(userId)) {
    bot.sendMessage(chatId, '❌ Invalid user ID');
    return;
  }
  
  blockedUsers.add(userId);
  allowedUsers.delete(userId);
  subscribers.delete(userId);
  pendingApprovals.delete(userId);
  saveData();
  
  bot.sendMessage(chatId, `🚫 User ${userId} has been blocked.`);
  
  // Notify the user
  bot.sendMessage(userId,
    '🚫 *Access Blocked*\n\n' +
    'You have been blocked from using this bot.',
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

bot.onText(/\/unblock (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const userId = parseInt(match[1]);
  
  if (isNaN(userId)) {
    bot.sendMessage(chatId, '❌ Invalid user ID');
    return;
  }
  
  blockedUsers.delete(userId);
  
  if (CONFIG.ACCESS_MODE === 'open') {
    allowedUsers.add(userId);
  }
  
  saveData();
  
  bot.sendMessage(chatId, `✅ User ${userId} has been unblocked.`);
  
  // Notify the user
  bot.sendMessage(userId,
    '✅ *Access Restored*\n\n' +
    'You have been unblocked and can now use the bot.\n\n' +
    'Type /start to begin.',
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

bot.onText(/\/adduser (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const userId = parseInt(match[1]);
  
  if (isNaN(userId)) {
    bot.sendMessage(chatId, '❌ Invalid user ID');
    return;
  }
  
  allowedUsers.add(userId);
  blockedUsers.delete(userId);
  saveData();
  
  bot.sendMessage(chatId, `✅ User ${userId} has been added to whitelist.`);
});

bot.onText(/\/removeuser (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const userId = parseInt(match[1]);
  
  if (isNaN(userId)) {
    bot.sendMessage(chatId, '❌ Invalid user ID');
    return;
  }
  
  allowedUsers.delete(userId);
  subscribers.delete(userId);
  saveData();
  
  bot.sendMessage(chatId, `✅ User ${userId} has been removed from whitelist.`);
});

bot.onText(/\/pending/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  if (pendingApprovals.size === 0) {
    bot.sendMessage(chatId, '✅ No pending access requests.');
    return;
  }
  
  let message = `⏳ *Pending Access Requests (${pendingApprovals.size})*\n\n`;
  
  Array.from(pendingApprovals).forEach((userId, index) => {
    message += `${index + 1}. User ID: \`${userId}\`\n`;
    message += `   /approve ${userId}\n`;
    message += `   /deny ${userId}\n\n`;
  });
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/accessmode/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  let message = `🔐 *Access Control Status*\n\n`;
  message += `Mode: *${CONFIG.ACCESS_MODE.toUpperCase()}*\n\n`;
  
  if (CONFIG.ACCESS_MODE === 'open') {
    message += `🟢 Open Mode - Anyone can use (except blocked)\n`;
  } else if (CONFIG.ACCESS_MODE === 'whitelist') {
    message += `🟡 Whitelist Mode - Only whitelisted users\n`;
  } else if (CONFIG.ACCESS_MODE === 'approval') {
    message += `🔴 Approval Mode - Requires admin approval\n`;
  }
  
  message += `\n📊 *Statistics:*\n`;
  message += `Allowed Users: ${allowedUsers.size}\n`;
  message += `Pending Approvals: ${pendingApprovals.size}\n`;
  message += `Blocked Users: ${blockedUsers.size}\n`;
  
  message += `\n*Change mode in Railway:*\n`;
  message += `ACCESS_MODE=open\n`;
  message += `ACCESS_MODE=whitelist\n`;
  message += `ACCESS_MODE=approval\n`;
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Existing commands (sectors, screen, stock, etc.)
bot.onText(/\/sectors/, (msg) => {
  const chatId = msg.chat.id;
  
  let message = '📋 *Available Sectors:*\n\n';
  
  const userSelectedSectors = getUserSectors(chatId);
  
  Object.keys(IDX_SECTORS).sort().forEach((sector, index) => {
    const count = IDX_SECTORS[sector].length;
    const isMonitored = userSelectedSectors.includes(sector) ? '✅' : '⚪';
    message += `${isMonitored} ${index + 1}. ${sector} (${count} stocks)\n`;
  });
  
  message += '\n✅ = Your monitored sectors';
  message += '\n\nUse /screen to start screening';
  message += '\nUse /addsector to customize';
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/screen/, (msg) => {
  const chatId = msg.chat.id;
  
  const sectors = Object.keys(IDX_SECTORS).sort();
  const keyboard = sectors.map(sector => [{
    text: `${sector} (${IDX_SECTORS[sector].length})`,
    callback_data: `screen_${sector}`
  }]);
  
  bot.sendMessage(chatId, 'Select a sector to screen:', {
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
});

bot.onText(/\/stock (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const symbol = match[1].toUpperCase().trim();
  
  const processingMsg = await bot.sendMessage(chatId, `🔍 Analyzing ${symbol}...`);
  
  try {
    const result = await screenStock(symbol);
    
    if (result.error) {
      bot.editMessageText(`❌ Error analyzing ${symbol}: ${result.error}`, {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });
      return;
    }
    
    let message = `📊 *${symbol} Analysis*\n\n`;
    message += `💰 Price: Rp ${result.price}\n`;
    message += `📈 %K: ${result.k}\n`;
    message += `📉 %D: ${result.d}\n`;
    message += `📅 Date: ${result.date}\n`;
    
    if (result.signal) {
      message += `\n🎯 Signal: ${result.signal}`;
    } else {
      message += `\n⚪ No signal`;
    }
    
    const watched = watchlist.get(chatId) || [];
    const isWatched = watched.includes(symbol);
    
    if (!isWatched) {
      message += `\n\n💡 Use /watch ${symbol} to add to watchlist`;
    } else {
      message += `\n\n👀 In your watchlist`;
    }
    
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: processingMsg.message_id,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    bot.editMessageText(`❌ Error: ${error.message}`, {
      chat_id: chatId,
      message_id: processingMsg.message_id
    });
  }
});

// Handle sector screening callback
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;
  
  if (data.startsWith('screen_')) {
    const sectorName = data.replace('screen_', '');
    
    bot.answerCallbackQuery(callbackQuery.id);
    
    const stockCount = IDX_SECTORS[sectorName].length;
    const estimatedMinutes = Math.ceil(stockCount * 0.3 / 60);
    
    const confirmMsg = await bot.sendMessage(
      chatId,
      `Starting to screen ${sectorName} sector...\n\n` +
      `📊 Stocks: ${stockCount}\n` +
      `⏱ Estimated time: ${estimatedMinutes} minutes\n\n` +
      `Progress: 0/${stockCount}`
    );
    
    try {
      const results = await screenSector(sectorName, chatId, async (processed, total) => {
        await bot.editMessageText(
          `Screening ${sectorName}...\n\n` +
          `Progress: ${processed}/${total} (${Math.round(processed/total*100)}%)`,
          {
            chat_id: chatId,
            message_id: confirmMsg.message_id
          }
        ).catch(() => {});
      });
      
      const resultMessage = formatResults(results, sectorName);
      
      if (resultMessage.length > 4096) {
        const chunks = resultMessage.match(/[\s\S]{1,4096}/g);
        for (const chunk of chunks) {
          await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        }
      } else {
        await bot.sendMessage(chatId, resultMessage, { parse_mode: 'Markdown' });
      }
      
      await bot.deleteMessage(chatId, confirmMsg.message_id);
      
    } catch (error) {
      bot.editMessageText(`❌ Error: ${error.message}`, {
        chat_id: chatId,
        message_id: confirmMsg.message_id
      });
    }
  }
});

// Start the bot
console.log('🤖 Bot is starting...');

// Delete any existing webhook to ensure polling works
bot.deleteWebHook()
  .then(() => {
    console.log('✅ Webhook deleted (if any existed)');
    console.log('📡 Bot is now in pure POLLING mode');
  })
  .catch(err => {
    console.log('ℹ️  No webhook to delete (or error deleting):', err.message);
  });

loadData();
setupAutoScans();
console.log('🤖 Bot is running with enhanced features!');
console.log(`📊 Loaded: ${subscribers.size} subscribers, ${userSectors.size} custom configs, ${watchlist.size} watchlists`);

// Save data periodically
setInterval(() => {
  saveData();
}, 5 * 60 * 1000); // Every 5 minutes
