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
    MOMENTUM_SCAN: '15:30',
    EVENING_SCAN: '16:00',
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

// Cached results for full IDX scans
const cachedFullScan = {
  oversold: [],
  momentum: [],
  lastOversoldUpdate: null,
  lastMomentumUpdate: null
};

// Access history tracking
const accessHistory = []; // Array of {userId, username, timestamp, command, result}
// Structure: {
//   userId: 123456789,
//   username: '@user',
//   name: 'John Doe',
//   timestamp: '2025-11-03T10:30:00Z',
//   command: '/start',
//   result: 'APPROVED' | 'DENIED' | 'BLOCKED' | 'PENDING'
// }

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
      if (data.accessHistory) accessHistory.push(...data.accessHistory);
      
      console.log('✅ Data loaded successfully');
      console.log(`   Users: ${allowedUsers.size} allowed, ${pendingApprovals.size} pending, ${blockedUsers.size} blocked`);
      console.log(`   Signal History: ${signalHistory.length} records`);
      console.log(`   Access History: ${accessHistory.length} records`);
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
      accessHistory: accessHistory.slice(-1000), // Keep last 1000 records
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

// IDX Sectors (Updated: 955 stocks in 11 sectors)
const IDX_SECTORS = {
  'Basic Materials': ['ADMG', 'AGII', 'AKPI', 'ALDO', 'ALKA', 'ALMI', 'ANTM', 'APLI', 'BAJA', 'BMSR', 'BRMS', 'BRNA', 'BRPT', 'BTON', 'CITA', 'CLPI', 'CTBN', 'DKFT', 'DPNS', 'EKAD', 'ESSA', 'ETWA', 'FASW', 'FPNI', 'GDST', 'IGAR', 'INAI', 'INCI', 'INCO', 'INKP', 'INRU', 'INTD', 'INTP', 'IPOL', 'ISSP', 'KBRI', 'KDSI', 'KRAS', 'LMSH', 'LTLS', 'MDKA', 'NIKL', 'OKAS', 'PICO', 'PSAB', 'SIMA', 'SMBR', 'SMCB', 'SMGR', 'SPMA', 'SQMI', 'SRSN', 'SULI', 'TALF', 'TBMS', 'TINS', 'TIRT', 'TKIM', 'TPIA', 'TRST', 'UNIC', 'WTON', 'YPAS', 'INCF', 'WSBP', 'KMTR', 'MDKI', 'ZINC', 'PBID', 'TDPM', 'SWAT', 'MOLI', 'HKMU', 'KAYU', 'SMKL', 'GGRP', 'OPMS', 'PURE', 'ESIP', 'IFSH', 'IFII', 'SAMF', 'EPAC', 'BEBS', 'NPGF', 'ARCI', 'NICL', 'SBMA', 'CMNT', 'OBMD', 'AVIA', 'CHEM', 'KKES', 'PDPP', 'FWCT', 'PACK', 'AMMN', 'PPRI', 'SMGA', 'SOLA', 'BATR', 'BLES', 'PTMR', 'DAAZ', 'DGWG', 'MINE', 'ASPR', 'EMAS', 'AYLS', 'NCKL', 'MBMA', 'NICE', 'SMLE'],
  'Consumer Cyclicals': ['ABBA', 'ACES', 'AKKU', 'ARGO', 'ARTA', 'AUTO', 'BATA', 'BAYU', 'BIMA', 'BLTZ', 'BMTR', 'BOLT', 'BRAM', 'BUVA', 'CINT', 'CNTX', 'CSAP', 'ECII', 'ERAA', 'ERTX', 'ESTI', 'FAST', 'FORU', 'GDYR', 'GEMA', 'GJTL', 'GLOB', 'GWSA', 'HOME', 'HOTL', 'IIKP', 'IMAS', 'INDR', 'INDS', 'JIHD', 'JSPT', 'KICI', 'KPIG', 'LMPI', 'LPIN', 'LPPF', 'MAPI', 'MDIA', 'MGNA', 'MICE', 'MNCN', 'MPMX', 'MSKY', 'MYTX', 'PANR', 'PBRX', 'PDES', 'PGLI', 'PJAA', 'PNSE', 'POLY', 'PSKT', 'PTSP', 'RALS', 'RICY', 'SCMA', 'SHID', 'SMSM', 'SONA', 'SRIL', 'SSTM', 'TELE', 'TFCO', 'TMPO', 'TRIO', 'TRIS', 'UNIT', 'VIVA', 'JGLE', 'MARI', 'MKNT', 'BOGA', 'CARS', 'MINA', 'MAPB', 'WOOD', 'HRTA', 'MABA', 'BELL', 'DFAM', 'PZZA', 'MSIN', 'MAPA', 'NUSA', 'FILM', 'DIGI', 'DUCK', 'YELO', 'SOTS', 'ZONE', 'CLAY', 'NATO', 'HRME', 'FITT', 'BOLA', 'POLU', 'IPTV', 'EAST', 'KOTA', 'INOV', 'SLIS', 'PMJS', 'SBAT', 'CBMF', 'CSMI', 'SOFA', 'TOYS', 'SCNP', 'PLAN', 'SNLK', 'LFLO', 'LUCY', 'MGLV', 'IDEA', 'DEPO', 'DRMA', 'ASLC', 'NETV', 'BAUT', 'ENAK', 'BIKE', 'OLIV', 'SWID', 'RAFI', 'KLIN', 'TOOL', 'KDTN', 'ZATA', 'ISAP', 'BMBL', 'FUTR', 'HAJJ', 'TYRE', 'VKTR', 'CNMA', 'ERAL', 'LMAX', 'BABY', 'AEGS', 'GRPH', 'UNTD', 'MEJA', 'LIVE', 'BAIK', 'SPRE', 'PART', 'GOLF', 'DOSS', 'VERN', 'MDIY', 'MERI', 'PMUI', 'KAQI', 'ESTA', 'RAAM', 'DOOH', 'ACRO', 'UFOE'],
  'Consumer Non-Cyclicals': ['AALI', 'ADES', 'AISA', 'ALTO', 'AMRT', 'ANJT', 'BISI', 'BTEK', 'BUDI', 'BWPT', 'CEKA', 'CPIN', 'CPRO', 'DLTA', 'DSFI', 'DSNG', 'EPMT', 'FISH', 'GGRM', 'GOLL', 'GZCO', 'HERO', 'HMSP', 'ICBP', 'INDF', 'JAWA', 'JPFA', 'LAPD', 'LSIP', 'MAGP', 'MAIN', 'MBTO', 'MIDI', 'MLBI', 'MLPL', 'MPPA', 'MRAT', 'MYOR', 'PSDN', 'RANC', 'ROTI', 'SDPC', 'SGRO', 'SIMP', 'SIPD', 'SKBM', 'SKLT', 'SMAR', 'SSMS', 'STTP', 'TBLA', 'TCID', 'TGKA', 'ULTJ', 'UNSP', 'UNVR', 'WAPO', 'WICO', 'WIIM', 'DAYA', 'DPUM', 'KINO', 'CLEO', 'HOKI', 'CAMP', 'PCAR', 'MGRO', 'ANDI', 'GOOD', 'FOOD', 'BEEF', 'COCO', 'ITIC', 'KEJU', 'PSGO', 'AGAR', 'UCID', 'CSRA', 'DMND', 'IKAN', 'PGUN', 'PNGO', 'KMDS', 'ENZO', 'VICI', 'PMMP', 'WMUU', 'TAPG', 'FLMC', 'OILS', 'BOBA', 'CMRY', 'TAYS', 'WMPP', 'IPPE', 'NASI', 'STAA', 'NANO', 'TLDN', 'IBOS', 'ASHA', 'TRGU', 'DEWI', 'GULA', 'JARR', 'AMMS', 'EURO', 'BUAH', 'CRAB', 'CBUT', 'MKTR', 'SOUL', 'BEER', 'WINE', 'NAYZ', 'NSSS', 'MAXI', 'GRPM', 'TGUK', 'PTPS', 'STRK', 'UDNG', 'AYAM', 'ISEA', 'GUNA', 'NEST', 'BRRC', 'RLCO', 'YUPI', 'FORE', 'MSJA', 'FAPA'],
  'Energy': ['ABMM', 'ADRO', 'AIMS', 'AKRA', 'APEX', 'ARII', 'ARTI', 'BBRM', 'BIPI', 'BSSR', 'BULL', 'BUMI', 'BYAN', 'CANI', 'CNKO', 'DEWA', 'DOID', 'DSSA', 'ELSA', 'ENRG', 'GEMS', 'GTBO', 'HITS', 'HRUM', 'IATA', 'INDY', 'ITMA', 'ITMG', 'KKGI', 'KOPI', 'LEAD', 'MBAP', 'MBSS', 'MEDC', 'MTFN', 'MYOH', 'PGAS', 'PKPK', 'PTBA', 'PTIS', 'PTRO', 'RAJA', 'RIGS', 'RUIS', 'SMMT', 'SMRU', 'SOCI', 'SUGI', 'TOBA', 'TPMA', 'TRAM', 'WINS', 'SHIP', 'TAMU', 'FIRE', 'PSSI', 'DWGL', 'BOSS', 'JSKY', 'INPS', 'TCPI', 'SURE', 'WOWS', 'TEBE', 'SGER', 'UNIQ', 'MCOL', 'GTSI', 'RMKE', 'BSML', 'ADMR', 'SEMA', 'SICO', 'COAL', 'SUNI', 'CBRE', 'HILL', 'CUAN', 'MAHA', 'RMKO', 'HUMI', 'RGAS', 'ALII', 'MKAP', 'ATLA', 'BOAT', 'AADI', 'RATU', 'PSAT', 'BESS', 'CGAS'],
  'Financials': ['ABDA', 'ADMF', 'AGRO', 'AGRS', 'AHAP', 'AMAG', 'APIC', 'ARTO', 'ASBI', 'ASDM', 'ASJT', 'ASMI', 'ASRM', 'BABP', 'BACA', 'BBCA', 'BBHI', 'BBKP', 'BBLD', 'BBMD', 'BBNI', 'BBRI', 'BBTN', 'BBYB', 'BCAP', 'BCIC', 'BDMN', 'BEKS', 'BFIN', 'BGTG', 'BINA', 'BJBR', 'BJTM', 'BKSW', 'BMAS', 'BMRI', 'BNBA', 'BNGA', 'BNII', 'BNLI', 'BPFI', 'BPII', 'BSIM', 'BSWD', 'BTPN', 'BVIC', 'CFIN', 'DEFI', 'DNAR', 'DNET', 'GSMF', 'HDFA', 'INPC', 'LPGI', 'LPPS', 'MAYA', 'MCOR', 'MEGA', 'MREI', 'NISP', 'NOBU', 'OCAP', 'PADI', 'PALM', 'PANS', 'PEGE', 'PLAS', 'PNBN', 'PNBS', 'PNIN', 'PNLF', 'POOL', 'RELI', 'SDRA', 'SMMA', 'SRTG', 'STAR', 'TIFA', 'TRIM', 'TRUS', 'VICO', 'VINS', 'VRNA', 'WOMF', 'YULE', 'CASA', 'BRIS', 'MTWI', 'JMAS', 'NICK', 'BTPS', 'TUGU', 'POLA', 'SFAN', 'LIFE', 'FUJI', 'AMAR', 'AMOR', 'BHAT', 'BBSI', 'BANK', 'MASB', 'VTNY', 'YOII', 'COIN'],
  'Healthcare': ['BMHS', 'CARE', 'CHEK', 'DGNS', 'DKHH', 'DVLA', 'HALO', 'HEAL', 'IKPM', 'INAF', 'IRRA', 'KAEF', 'KLBF', 'LABS', 'MDLA', 'MEDS', 'MERK', 'MIKA', 'MMIX', 'MTMH', 'OBAT', 'OMED', 'PEHA', 'PEVE', 'PRAY', 'PRDA', 'PRIM', 'PYFA', 'RSCH', 'RSGK', 'SAME', 'SCPI', 'SIDO', 'SILO', 'SOHO', 'SRAJ', 'SURI', 'TSPC'],
  'Industrials': ['AMFG', 'AMIN', 'APII', 'ARNA', 'ASGR', 'ASII', 'BHIT', 'BNBR', 'CTTH', 'DYAN', 'HEXA', 'IBFN', 'ICON', 'IKAI', 'IKBI', 'IMPC', 'INDX', 'INTA', 'JECC', 'JTPE', 'KBLI', 'KBLM', 'KIAS', 'KOBX', 'KOIN', 'KONI', 'LION', 'MDRN', 'MFMI', 'MLIA', 'SCCO', 'TIRA', 'TOTO', 'TRIL', 'UNTR', 'VOKS', 'ZBRA', 'MARK', 'SPTO', 'SKRN', 'CAKK', 'SOSS', 'CCSI', 'BLUE', 'ARKA', 'SINI', 'HOPE', 'LABA', 'GPSO', 'KUAS', 'BINO', 'NTBK', 'PADA', 'KING', 'PTMP', 'SMIL', 'CRSN', 'WIDI', 'FOLK', 'MUTU', 'HYGN', 'VISI', 'MHKI', 'NAIK', 'PIPA'],
  'Infrastructures': ['ACST', 'ADHI', 'BALI', 'BTEL', 'BUKK', 'CASS', 'CENT', 'CMNP', 'DGIK', 'EXCL', 'GOLD', 'HADE', 'IBST', 'ISAT', 'JKON', 'JSMR', 'KARW', 'KBLV', 'LINK', 'META', 'NRCA', 'PTPP', 'SSIA', 'SUPR', 'TBIG', 'TLKM', 'TOTL', 'TOWR', 'WIKA', 'WSKT', 'IDPR', 'MTRA', 'OASA', 'POWR', 'PBSA', 'PORT', 'TGRA', 'TOPS', 'MPOW', 'GMFI', 'PPRE', 'WEGE', 'MORA', 'IPCM', 'LCKM', 'GHON', 'IPCC', 'MTPS', 'JAST', 'KEEN', 'PTPW', 'TAMA', 'RONY', 'PTDU', 'FIMP', 'MTEL', 'SMKM', 'ARKO', 'KRYA', 'PGEO', 'BDKR', 'INET', 'BREN', 'KOKA', 'ASLI', 'DATA', 'HGII', 'CDIA', 'MANG', 'KETR'],
  'Properties & Real Estate': ['APLN', 'ASRI', 'BAPA', 'BCIP', 'BEST', 'BIKA', 'BIPP', 'BKDP', 'BKSL', 'BSDE', 'COWL', 'CTRA', 'DART', 'DILD', 'DMAS', 'DUTI', 'ELTY', 'EMDE', 'FMII', 'GAMA', 'GMTD', 'GPRA', 'INPP', 'JRPT', 'KIJA', 'LCGP', 'LPCK', 'LPKR', 'LPLI', 'MDLN', 'MKPI', 'MMLP', 'MTLA', 'MTSM', 'NIRO', 'OMRE', 'PLIN', 'PPRO', 'PUDP', 'PWON', 'RBMS', 'RDTX', 'RIMO', 'RODA', 'SMDM', 'SMRA', 'TARA', 'CSIS', 'ARMY', 'NASA', 'RISE', 'POLL', 'LAND', 'PANI', 'CITY', 'MPRO', 'SATU', 'URBN', 'POLI', 'CPRI', 'POSA', 'PAMG', 'BAPI', 'NZIA', 'REAL', 'INDO', 'TRIN', 'KBAG', 'BBSS', 'UANG', 'PURI', 'HOMI', 'ROCK', 'ATAP', 'ADCP', 'TRUE', 'IPAC', 'WINR', 'BSBK', 'CBPE', 'VAST', 'SAGE', 'RELF', 'HBAT', 'GRIA', 'MSIE', 'KOCI', 'KSIX', 'CBDK', 'DADA', 'ASPI', 'AMAN'],
  'Technology': ['ATIC', 'EMTK', 'KREN', 'LMAS', 'MLPT', 'MTDL', 'PTSN', 'SKYB', 'KIOS', 'MCAS', 'NFCX', 'DIVA', 'LUCK', 'ENVY', 'HDIT', 'TFAS', 'DMMX', 'GLVA', 'PGJO', 'CASH', 'TECH', 'EDGE', 'ZYRX', 'UVCR', 'BUKA', 'RUNS', 'WGSH', 'WIRG', 'GOTO', 'AXIO', 'BELI', 'NINE', 'ELIT', 'IRSX', 'CHIP', 'TRON', 'JATI', 'CYBR', 'IOTF', 'MSTI', 'TOSK', 'MPIX', 'AREA', 'MENN', 'AWAN', 'WIFI', 'DCII'],
  'Transportation & Logistic': ['AKSI', 'ASSA', 'BIRD', 'BLTA', 'CMPP', 'GIAA', 'IMJS', 'LRNA', 'MIRA', 'MITI', 'NELY', 'SAFE', 'SDMU', 'SMDR', 'TAXI', 'TMAS', 'WEHA', 'HELI', 'TRUK', 'TNCA', 'BPTR', 'SAPX', 'DEAL', 'JAYA', 'KJEN', 'PURA', 'PPGL', 'TRJA', 'HAIS', 'HATM', 'RCCC', 'ELPI', 'LAJU', 'GTRA', 'MPXL', 'KLAS', 'LOPI', 'BLOG', 'PJHB'],
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

// CRITICAL: Wrap bot.onText to add automatic blocking check to ALL commands
const originalOnText = bot.onText.bind(bot);
bot.onText = function(regexp, callback) {
  originalOnText(regexp, (msg, match) => {
    const chatId = msg.chat.id;
    
    // Always allow admin
    if (isAdmin(chatId)) {
      return callback(msg, match);
    }
    
    // Check if user is blocked
    if (blockedUsers.has(chatId)) {
      console.log(`[BLOCKED] User ${chatId} tried command: ${msg.text}`);
      
      // Allow only /requestunblock for blocked users
      if (msg.text && msg.text.startsWith('/requestunblock')) {
        return callback(msg, match);
      }
      
      // Block everything else
      if (pendingApprovals.has(chatId)) {
        bot.sendMessage(chatId, 
          '🚫 You are blocked from using this bot.\n\n' +
          '⏳ Your unblock request is pending admin review.\n\n' +
          'Please wait for the administrator.'
        );
      } else {
        bot.sendMessage(chatId, 
          '🚫 You have been blocked from using this bot.\n\n' +
          '📝 Type /requestunblock to request access again.'
        );
      }
      return; // Stop execution - command will NOT run
    }
    
    // User not blocked, proceed with command
    callback(msg, match);
  });
};

console.log('✅ Universal blocking protection enabled for ALL commands');

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

// Format IDR value (for value traded)
function formatIDR(value) {
  if (value >= 1e12) {
    return (value / 1e12).toFixed(2) + 'T';  // Trillion
  } else if (value >= 1e9) {
    return (value / 1e9).toFixed(2) + 'B';   // Billion (Miliar)
  } else if (value >= 1e6) {
    return (value / 1e6).toFixed(2) + 'M';   // Million (Juta)
  } else if (value >= 1e3) {
    return (value / 1e3).toFixed(2) + 'K';
  } else {
    return value.toLocaleString();
  }
}

// Format volume (shares)
function formatVolume(value) {
  if (value >= 1e9) {
    return (value / 1e9).toFixed(2) + 'B';
  } else if (value >= 1e6) {
    return (value / 1e6).toFixed(2) + 'M';
  } else if (value >= 1e3) {
    return (value / 1e3).toFixed(2) + 'K';
  } else {
    return value.toLocaleString();
  }
}

// Minimum average daily value for liquidity check (Rp 1 billion)
const MIN_AVG_VALUE_IDR = 1e9;

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
    
    // Calculate average volume (20-day)
    const recentData = data.slice(-20);
    const avgVolume = recentData.reduce((sum, d) => sum + d.volume, 0) / recentData.length;
    
    // Volume in IDR (value traded)
    const volumeIDR = lastData.volume * lastData.close;
    const avgVolumeIDR = avgVolume * lastData.close;
    
    // Liquidity check
    const isLiquid = avgVolumeIDR >= MIN_AVG_VALUE_IDR;
    
    return {
      symbol,
      price: lastData.close,
      k: stoch.k.toFixed(2),
      d: stoch.d.toFixed(2),
      signal,
      volume: lastData.volume,
      avgVolume: Math.round(avgVolume),
      volumeIDR: volumeIDR,
      avgVolumeIDR: avgVolumeIDR,
      isLiquid: isLiquid,
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
  
  let message = `📊 *${sectorName || 'Screening'} - ${withSignals.length} Signals*\n\n`;
  
  if (withSignals.length > 0) {
    // Sort by signal type (BUY first) then by value traded
    withSignals.sort((a, b) => {
      if (a.signal.includes('BUY') && !b.signal.includes('BUY')) return -1;
      if (!a.signal.includes('BUY') && b.signal.includes('BUY')) return 1;
      return (b.avgVolumeIDR || 0) - (a.avgVolumeIDR || 0);
    });
    
    withSignals.forEach(r => {
      const liquidityIcon = r.isLiquid ? '✅' : '⚠️';
      const priceFormatted = typeof r.price === 'number' ? r.price.toLocaleString() : r.price;
      const valueFormatted = formatIDR(r.avgVolumeIDR || 0);
      
      message += `${r.signal} *${r.symbol}* | ${priceFormatted} | K:${r.k} D:${r.d} | ${valueFormatted} ${liquidityIcon}\n`;
    });
  } else {
    message += `No stocks with buy signals found.\n`;
  }
  
  message += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  message += `📈 Screened: ${results.length} | ✅ Signals: ${withSignals.length}`;
  if (errors.length > 0) {
    message += ` | ❌ Errors: ${errors.length}`;
  }
  message += `\n\n⚠️ _Not financial advice_`;
  
  return message;
}

// ============================================
// FULL IDX SCAN FUNCTIONS
// ============================================

// Get all IDX stocks from all sectors
function getAllIDXStocks() {
  const allStocks = new Set();
  Object.values(IDX_SECTORS).forEach(stocks => {
    stocks.forEach(stock => allStocks.add(stock));
  });
  return Array.from(allStocks);
}

// Enhanced stock screening with momentum data
async function screenStockFull(symbol) {
  try {
    const data = await getStockData(symbol);
    const stoch = calculateStochastic(data);
    
    if (!stoch) {
      return { symbol, error: 'Calculation failed' };
    }
    
    const signal = analyzeStochastic(stoch);
    const lastData = data[data.length - 1];
    const prevData = data[data.length - 2];
    
    // Calculate average volume (20-day)
    const recentData = data.slice(-20);
    const avgVolume = recentData.reduce((sum, d) => sum + d.volume, 0) / recentData.length;
    
    // Volume in IDR (value traded)
    const volumeIDR = lastData.volume * lastData.close;
    const avgVolumeIDR = avgVolume * lastData.close;
    
    // Liquidity check
    const isLiquid = avgVolumeIDR >= MIN_AVG_VALUE_IDR;
    
    // 1-day price change
    const priceChange = prevData ? ((lastData.close - prevData.close) / prevData.close) * 100 : 0;
    
    // 52-week high calculation
    const high52w = Math.max(...data.map(d => d.high));
    const near52w = lastData.close / high52w;
    
    // MA5 calculation
    const last5 = data.slice(-5);
    const ma5 = last5.reduce((sum, d) => sum + d.close, 0) / 5;
    
    return {
      symbol,
      price: lastData.close,
      priceChange: priceChange,
      k: stoch.k.toFixed(2),
      d: stoch.d.toFixed(2),
      signal,
      volume: lastData.volume,
      avgVolume: Math.round(avgVolume),
      volumeIDR: volumeIDR,
      avgVolumeIDR: avgVolumeIDR,
      isLiquid: isLiquid,
      near52w: near52w,
      ma5: ma5,
      date: lastData.date.toISOString().split('T')[0]
    };
  } catch (error) {
    return { symbol, error: error.message };
  }
}

// Full IDX scan for oversold signals
async function performFullOversoldScan(progressCallback = null) {
  console.log('Starting full IDX oversold scan...');
  const allStocks = getAllIDXStocks();
  const total = allStocks.length;
  let processed = 0;
  const results = [];
  
  for (let i = 0; i < allStocks.length; i += CONFIG.MAX_CONCURRENT) {
    const batch = allStocks.slice(i, i + CONFIG.MAX_CONCURRENT);
    
    const batchPromises = batch.map(symbol => 
      screenStockFull(symbol).catch(error => ({
        symbol,
        error: error.message || 'Unknown error'
      }))
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    processed += batchResults.length;
    
    if (progressCallback && (processed % 50 === 0 || processed === total)) {
      await progressCallback(processed, total);
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, CONFIG.WAIT_TIME));
  }
  
  // Filter only stocks with signals
  const withSignals = results.filter(r => r.signal && !r.error);
  
  // Cache the results
  cachedFullScan.oversold = withSignals;
  cachedFullScan.lastOversoldUpdate = new Date();
  
  console.log(`Full oversold scan complete. Found ${withSignals.length} signals from ${total} stocks.`);
  return results;
}

// Full IDX scan for momentum (top movers)
async function performMomentumScan(progressCallback = null) {
  console.log('Starting full IDX momentum scan...');
  const allStocks = getAllIDXStocks();
  const total = allStocks.length;
  let processed = 0;
  const results = [];
  
  for (let i = 0; i < allStocks.length; i += CONFIG.MAX_CONCURRENT) {
    const batch = allStocks.slice(i, i + CONFIG.MAX_CONCURRENT);
    
    const batchPromises = batch.map(symbol => 
      screenStockFull(symbol).catch(error => ({
        symbol,
        error: error.message || 'Unknown error'
      }))
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    processed += batchResults.length;
    
    if (progressCallback && (processed % 50 === 0 || processed === total)) {
      await progressCallback(processed, total);
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, CONFIG.WAIT_TIME));
  }
  
  // Filter valid results based on screener rules:
  // 1. 1 Day Price Returns (%) > 1
  // 2. Price > 50
  // 3. Near 52 Week High > 0.7
  // 4. Value > 5,000,000,000 (5B IDR)
  // 5. Price > 1 x Price MA 5
  // 6. Volume > 2 x Volume MA 20
  const validResults = results.filter(r => {
    if (r.error) return false;
    if (r.priceChange === undefined) return false;
    
    // Rule 1: 1 Day Price Returns > 1%
    if (r.priceChange <= 1) return false;
    
    // Rule 2: Price > 50
    if (r.price <= 50) return false;
    
    // Rule 3: Near 52 Week High > 0.7
    if (!r.near52w || r.near52w <= 0.7) return false;
    
    // Rule 4: Value > 5B IDR
    if (!r.avgVolumeIDR || r.avgVolumeIDR <= 5e9) return false;
    
    // Rule 5: Price > MA5 (uptrend)
    if (!r.ma5 || r.price <= r.ma5) return false;
    
    // Rule 6: Volume > 2x avg volume (volume spike)
    if (!r.volume || !r.avgVolume || r.volume <= (r.avgVolume * 2)) return false;
    
    return true;
  });
  
  // Sort lowest to highest change
  validResults.sort((a, b) => a.priceChange - b.priceChange);
  
  // Take up to 30 movers
  const topMovers = validResults.slice(0, 30);
  
  // Cache the results
  cachedFullScan.momentum = topMovers;
  cachedFullScan.lastMomentumUpdate = new Date();
  
  console.log(`Momentum scan complete. Top ${topMovers.length} movers from ${total} stocks.`);
  return topMovers;
}

// Format full oversold scan results
function formatFullOversoldResults(results) {
  const withSignals = results.filter(r => r.signal && !r.error);
  const buySignals = withSignals.filter(r => r.signal.includes('BUY'));
  const potentialSignals = withSignals.filter(r => r.signal.includes('POTENTIAL'));
  
  let message = `📊 *IDX Full Scan - Oversold Signals*\n\n`;
  
  if (buySignals.length > 0) {
    message += `🟢 *BUY SIGNALS (${buySignals.length})*\n\n`;
    
    // Sort by liquidity
    buySignals.sort((a, b) => (b.avgVolumeIDR || 0) - (a.avgVolumeIDR || 0));
    
    buySignals.forEach(r => {
      const liquidityIcon = r.isLiquid ? '✅' : '⚠️';
      const priceFormatted = typeof r.price === 'number' ? r.price.toLocaleString() : r.price;
      const valueFormatted = formatIDR(r.avgVolumeIDR || 0);
      
      message += `*${r.symbol}* ${liquidityIcon}\n`;
      message += `Rp ${priceFormatted} | K:${r.k} D:${r.d} | ${valueFormatted}\n\n`;
    });
  }
  
  if (potentialSignals.length > 0) {
    message += `🟡 *POTENTIAL (${potentialSignals.length})*\n\n`;
    
    potentialSignals.sort((a, b) => (b.avgVolumeIDR || 0) - (a.avgVolumeIDR || 0));
    
    potentialSignals.forEach(r => {
      const liquidityIcon = r.isLiquid ? '✅' : '⚠️';
      const priceFormatted = typeof r.price === 'number' ? r.price.toLocaleString() : r.price;
      const valueFormatted = formatIDR(r.avgVolumeIDR || 0);
      
      message += `*${r.symbol}* ${liquidityIcon}\n`;
      message += `Rp ${priceFormatted} | K:${r.k} D:${r.d} | ${valueFormatted}\n\n`;
    });
  }
  
  if (withSignals.length === 0) {
    message += `No oversold signals found.\n`;
  }
  
  const updateTime = cachedFullScan.lastOversoldUpdate 
    ? cachedFullScan.lastOversoldUpdate.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
    : 'N/A';
  
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `📈 Scanned: IDX stocks\n`;
  message += `🟢 BUY: ${buySignals.length} | 🟡 POTENTIAL: ${potentialSignals.length}\n`;
  message += `⏱️ Updated: ${updateTime} WIB\n\n`;
  message += `⚠️ _Not financial advice_`;
  
  return message;
}

// Format momentum scan results
function formatMomentumResults(results) {
  let message = `🚀 *IDX Momentum - Gainers (Low to High)*\n\n`;
  
  results.forEach((r, index) => {
    const changeFormatted = r.priceChange >= 0 ? `+${r.priceChange.toFixed(2)}%` : `${r.priceChange.toFixed(2)}%`;
    const priceFormatted = typeof r.price === 'number' ? r.price.toLocaleString() : r.price;
    const ma5Formatted = typeof r.ma5 === 'number' ? Math.round(r.ma5).toLocaleString() : r.ma5;
    const near52wFormatted = r.near52w ? r.near52w.toFixed(2) : 'N/A';
    const valueFormatted = formatIDR(r.avgVolumeIDR || 0);
    
    // Icons
    let icon = '✅';
    if (r.near52w >= 1.0) {
      icon = '🔥'; // Breaking 52W high
    } else if (!r.isLiquid) {
      icon = '⚠️'; // Low liquidity
    }
    
    message += `*${r.symbol}* ${icon}\n`;
    message += `${changeFormatted} | Rp ${priceFormatted}\n`;
    message += `MA5: ${ma5Formatted} | 52W: ${near52wFormatted} | ${valueFormatted}\n\n`;
  });
  
  const updateTime = cachedFullScan.lastMomentumUpdate 
    ? cachedFullScan.lastMomentumUpdate.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
    : 'N/A';
  
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `🔥 52W breakout | ✅ Liquid | ⚠️ Low liquidity\n`;
  message += `📈 Scanned: IDX stocks | Showing: Top 30\n`;
  message += `⏱️ Updated: ${updateTime} WIB\n\n`;
  message += `⚠️ _Not financial advice_`;
  
  return message;
}

// Scheduled full oversold scan (runs at 10:00, 13:00, 16:00)
async function performScheduledFullOversoldScan(scanName) {
  console.log(`Running scheduled oversold scan: ${scanName}`);
  
  try {
    await performFullOversoldScan();
    
    // Notify subscribers if there are signals
    if (cachedFullScan.oversold.length > 0) {
      const message = formatFullOversoldResults(cachedFullScan.oversold);
      
      for (const chatId of subscribers) {
        try {
          // Split message if too long
          if (message.length > 4096) {
            const chunks = message.match(/[\s\S]{1,4096}/g);
            for (const chunk of chunks) {
              await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
            }
          } else {
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
          }
        } catch (error) {
          console.error(`Failed to send oversold scan to ${chatId}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error(`Scheduled oversold scan failed:`, error.message);
  }
}

// Scheduled momentum scan (runs at 15:30)
async function performScheduledMomentumScan() {
  console.log('Running scheduled momentum scan (15:30 WIB)');
  
  try {
    await performMomentumScan();
    
    // Notify subscribers
    if (cachedFullScan.momentum.length > 0) {
      const message = formatMomentumResults(cachedFullScan.momentum);
      
      for (const chatId of subscribers) {
        try {
          await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
          console.error(`Failed to send momentum scan to ${chatId}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error(`Scheduled momentum scan failed:`, error.message);
  }
}

// ============================================
// END FULL IDX SCAN FUNCTIONS
// ============================================

// Get user's sectors or default
function getUserSectors(chatId) {
  return userSectors.get(chatId) || AUTO_SCAN_CONFIG.DEFAULT_SECTORS;
}

// Signal History Tracking Functions
function recordSignal(symbol, signalType, price, volumeIDR = null) {
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
      volumeIDR: volumeIDR,
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
        recordSignal(result.symbol, signalType, result.price, result.avgVolumeIDR);
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
  
  // Morning full IDX oversold scan (10:00 WIB)
  const [morningHour, morningMin] = AUTO_SCAN_CONFIG.SCHEDULE.MORNING_SCAN.split(':');
  cron.schedule(`${morningMin} ${morningHour} * * 1-5`, () => {
    performScheduledFullOversoldScan('Morning Scan (10:00 WIB)');
  }, { timezone: CONFIG.TIMEZONE });
  
  // Afternoon full IDX oversold scan (13:00 WIB)
  const [afternoonHour, afternoonMin] = AUTO_SCAN_CONFIG.SCHEDULE.AFTERNOON_SCAN.split(':');
  cron.schedule(`${afternoonMin} ${afternoonHour} * * 1-5`, () => {
    performScheduledFullOversoldScan('Afternoon Scan (13:00 WIB)');
  }, { timezone: CONFIG.TIMEZONE });
  
  // Momentum scan (15:30 WIB - near market close)
  const [momentumHour, momentumMin] = AUTO_SCAN_CONFIG.SCHEDULE.MOMENTUM_SCAN.split(':');
  cron.schedule(`${momentumMin} ${momentumHour} * * 1-5`, () => {
    performScheduledMomentumScan();
  }, { timezone: CONFIG.TIMEZONE });
  
  // Evening full IDX oversold scan (16:00 WIB)
  const [eveningHour, eveningMin] = AUTO_SCAN_CONFIG.SCHEDULE.EVENING_SCAN.split(':');
  cron.schedule(`${eveningMin} ${eveningHour} * * 1-5`, () => {
    performScheduledFullOversoldScan('Evening Scan (16:00 WIB)');
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
  console.log(`   • Morning Oversold (Full IDX): ${AUTO_SCAN_CONFIG.SCHEDULE.MORNING_SCAN} WIB`);
  console.log(`   • Afternoon Oversold (Full IDX): ${AUTO_SCAN_CONFIG.SCHEDULE.AFTERNOON_SCAN} WIB`);
  console.log(`   • Momentum Scan (Full IDX): ${AUTO_SCAN_CONFIG.SCHEDULE.MOMENTUM_SCAN} WIB`);
  console.log(`   • Evening Oversold (Full IDX): ${AUTO_SCAN_CONFIG.SCHEDULE.EVENING_SCAN} WIB`);
  console.log(`   • Watchlist checks: Every hour during market hours`);
  console.log(`   • Performance update: 17:00 WIB (daily)`);
}

// Admin check
function isAdmin(chatId) {
  return CONFIG.ADMIN_ID && chatId.toString() === CONFIG.ADMIN_ID.toString();
}

// Log access attempts
function logAccess(userId, username, name, command, result) {
  const entry = {
    userId,
    username,
    name,
    timestamp: new Date().toISOString(),
    command,
    result // 'APPROVED', 'DENIED', 'BLOCKED', 'PENDING'
  };
  
  accessHistory.push(entry);
  
  // Keep only last 1000 records in memory
  if (accessHistory.length > 1000) {
    accessHistory.shift();
  }
  
  saveData();
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
  const user = msg.from;
  const userName = user.username ? `@${user.username}` : user.first_name || 'Unknown';
  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  const command = msg.text || '[non-text]';
  
  console.log(`[ACCESS CHECK] User ${chatId} (${userName}) trying to access`);
  console.log(`[ACCESS CHECK] Command: ${command}`);
  
  // CRITICAL: Check blocked status FIRST, before anything else
  if (blockedUsers.has(chatId)) {
    console.log(`[ACCESS CHECK] ❌ User ${chatId} is BLOCKED - denying ALL access`);
    
    // Log blocked access attempt
    logAccess(chatId, userName, fullName, command, 'BLOCKED');
    
    // Check if user has already requested unblock
    if (pendingApprovals.has(chatId)) {
      bot.sendMessage(chatId, 
        '🚫 You are blocked from using this bot.\n\n' +
        '⏳ Your unblock request is pending admin review.\n\n' +
        'Please wait for the administrator to review your request.'
      );
    } else {
      // Offer to request unblock
      bot.sendMessage(chatId, 
        '🚫 You have been blocked from using this bot.\n\n' +
        '📝 Would you like to request access again?\n\n' +
        'Type /requestunblock to send an unblock request to the administrator.'
      );
    }
    return false; // Return false to stop execution
  }
  
  console.log(`[ACCESS CHECK] Has access: ${hasAccess(chatId)}`);
  console.log(`[ACCESS CHECK] Mode: ${CONFIG.ACCESS_MODE}`);
  console.log(`[ACCESS CHECK] In allowedUsers: ${allowedUsers.has(chatId)}`);
  console.log(`[ACCESS CHECK] In pendingApprovals: ${pendingApprovals.has(chatId)}`);
  
  if (hasAccess(chatId)) {
    console.log(`[ACCESS CHECK] ✅ User ${chatId} (${userName}) has access - allowing`);
    
    // Log successful access
    logAccess(chatId, userName, fullName, command, 'APPROVED');
    
    callback();
    return true;
  }
  
  // User doesn't have access
  console.log(`[ACCESS CHECK] ❌ User ${chatId} (${userName}) does NOT have access`);
  
  if (CONFIG.ACCESS_MODE === 'whitelist') {
    console.log(`[ACCESS CHECK] Whitelist mode - user not in whitelist`);
    
    // Log denied access
    logAccess(chatId, userName, fullName, command, 'DENIED');
    
    bot.sendMessage(chatId, 
      '🔒 Access Restricted\n\n' +
      'This bot is private and requires authorization.\n\n' +
      'Your Telegram ID: ' + chatId + '\n\n' +
      'Please contact the bot administrator to request access.'
    );
    return false;
  }
  
  if (CONFIG.ACCESS_MODE === 'approval') {
    if (pendingApprovals.has(chatId)) {
      console.log(`[ACCESS CHECK] User ${chatId} already has pending approval`);
      
      // Log pending access
      logAccess(chatId, userName, fullName, command, 'PENDING');
      
      bot.sendMessage(chatId, 
        '⏳ Access Pending\n\n' +
        'Your access request is waiting for admin approval.\n\n' +
        'Please wait for the administrator to approve your request.'
      );
    } else {
      console.log(`[ACCESS CHECK] Adding user ${chatId} to pending approvals`);
      pendingApprovals.add(chatId);
      
      // Log new pending request
      logAccess(chatId, userName, fullName, command, 'PENDING');
      
      saveData();
      
      bot.sendMessage(chatId,
        '📝 Access Request Submitted\n\n' +
        'Your request has been sent to the administrator.\n\n' +
        'You will be notified once approved.'
      );
      
      // Notify admin
      if (CONFIG.ADMIN_ID) {
        console.log(`[ACCESS CHECK] Notifying admin about user ${chatId}`);
        bot.sendMessage(CONFIG.ADMIN_ID,
          `🔔 New Access Request\n\n` +
          `User: ${userName}\n` +
          `Name: ${fullName}\n` +
          `ID: ${chatId}\n\n` +
          `Use /approve ${chatId} to grant access\n` +
          `Use /deny ${chatId} to deny access`
        ).catch(err => console.error('Failed to notify admin:', err.message));
      }
    }
    return false;
  }
  
  console.log(`[ACCESS CHECK] Unknown access mode or no access - denying`);
  
  // Log denied access
  logAccess(chatId, userName, fullName, command, 'DENIED');
  
  return false;
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

*Full IDX Scans:*
• /scanall - Full IDX oversold scan
• /momentum - Top 30 movers (full IDX)

*Auto-Scan Alerts:*
• /subscribe - Get auto alerts
• /unsubscribe - Stop alerts

*Watchlist:*
• /watchlist - View watched stocks
• /watch BBCA - Add BBCA to watchlist
• /unwatch BBCA - Remove BBCA

*Performance & Analysis:*
• /performance - Signal accuracy (last 30 days)
• /backtest BBCA - BBCA's signal history
• /topstocks - Best performing stocks

*Settings:*
• K Period: ${CONFIG.STOCH_K_PERIOD}
• Oversold: ${CONFIG.OVERSOLD_LEVEL}

*Signals:*
🟢 BUY - Strong buy signal
🟡 POTENTIAL - Potential buy

*Scheduled Scans (WIB):*
☀️ 10:00 - Oversold (Full IDX)
🌤️ 13:00 - Oversold (Full IDX)
🚀 15:30 - Momentum (Full IDX)
🌆 16:00 - Oversold (Full IDX)
🔄 17:00 - Performance Update
  `, { parse_mode: 'Markdown' });
});

bot.onText(/\/subscribe/, (msg) => {
  const chatId = msg.chat.id;
  
  if (subscribers.has(chatId)) {
    bot.sendMessage(chatId, '✅ You are already subscribed to auto-scan alerts!');
  } else {
    subscribers.add(chatId);
    saveData();
    
    bot.sendMessage(chatId, `
🔔 *Subscribed to Auto-Scan Alerts!*

You will receive Full IDX scans at:
☀️ 10:00 WIB - Oversold Scan
🌤️ 13:00 WIB - Oversold Scan
🚀 15:30 WIB - Momentum Scan
🌆 16:00 WIB - Oversold Scan

📈 All scans cover ~900 IDX stocks

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
  
  bot.sendMessage(chatId, `✅ Added ${matchedSector} to your monitored sectors!\n\nYou now monitor ${currentSectors.length} sectors.\nUse /mysectors to view all.`);
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
    bot.sendMessage(chatId, `✅ Removed ${matchedSector} from your monitored sectors.\n\nYou now monitor ${currentSectors.length} sectors.`);
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
  
  let message = `📊 Bot Statistics\n\n`;
  message += `👥 Total Users: ${userSectors.size}\n`;
  message += `🔔 Subscribers: ${subscribers.size}\n`;
  message += `👀 Total Watchlist Stocks: ${totalWatchedStocks}\n`;
  message += `📂 Avg Sectors/User: ${(Array.from(userSectors.values()).reduce((sum, sectors) => sum + sectors.length, 0) / userSectors.size || 0).toFixed(1)}\n`;
  message += `📊 Signal History: ${signalHistory.length} records\n\n`;
  
  message += `Top 5 Monitored Sectors:\n`;
  topSectors.forEach(([sector, count], index) => {
    message += `${index + 1}. ${sector}: ${count} users\n`;
  });
  
  if (subscribers.size > 0) {
    message += `\nSubscriber Management:\n`;
    message += `/unsubscribeall - Unsubscribe all users\n`;
    message += `/unsubscribeall_silent - Unsubscribe without notification\n`;
  }
  
  bot.sendMessage(chatId, message);
});

// NEW: View access history
bot.onText(/\/accesshistory(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const limit = match[1] ? parseInt(match[1]) : 20;
  const recentHistory = accessHistory.slice(-limit).reverse();
  
  if (recentHistory.length === 0) {
    bot.sendMessage(chatId, 'ℹ️ No access history recorded yet.');
    return;
  }
  
  let message = `📜 Access History (Last ${recentHistory.length} records)\n\n`;
  
  recentHistory.forEach((entry, index) => {
    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta'
    });
    
    const resultEmoji = {
      'APPROVED': '✅',
      'DENIED': '❌',
      'BLOCKED': '🚫',
      'PENDING': '⏳'
    }[entry.result] || '❓';
    
    message += `${resultEmoji} ${timeStr}\n`;
    message += `   User: ${entry.username || 'Unknown'}\n`;
    message += `   ID: ${entry.userId}\n`;
    message += `   Cmd: ${entry.command}\n`;
    message += `   Result: ${entry.result}\n\n`;
  });
  
  message += `\nTotal records: ${accessHistory.length}\n`;
  message += `Use /accesshistory 50 to see more`;
  
  // Split if too long
  if (message.length > 4000) {
    const chunks = [];
    let chunk = '';
    const lines = message.split('\n');
    
    for (const line of lines) {
      if ((chunk + line + '\n').length > 4000) {
        chunks.push(chunk);
        chunk = line + '\n';
      } else {
        chunk += line + '\n';
      }
    }
    if (chunk) chunks.push(chunk);
    
    for (const c of chunks) {
      await bot.sendMessage(chatId, c);
    }
  } else {
    bot.sendMessage(chatId, message);
  }
});

// Filter access history by user
bot.onText(/\/userhistory (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const userId = parseInt(match[1]);
  
  if (isNaN(userId)) {
    bot.sendMessage(chatId, '❌ Invalid user ID. Use: /userhistory 123456789');
    return;
  }
  
  const userHistory = accessHistory.filter(entry => entry.userId === userId);
  
  if (userHistory.length === 0) {
    bot.sendMessage(chatId, `ℹ️ No access history for user ${userId}.`);
    return;
  }
  
  let message = `📜 Access History for User ${userId}\n\n`;
  
  const recent = userHistory.slice(-20).reverse();
  
  recent.forEach((entry, index) => {
    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta'
    });
    
    const resultEmoji = {
      'APPROVED': '✅',
      'DENIED': '❌',
      'BLOCKED': '🚫',
      'PENDING': '⏳'
    }[entry.result] || '❓';
    
    message += `${resultEmoji} ${timeStr}\n`;
    message += `   ${entry.command} → ${entry.result}\n\n`;
  });
  
  message += `\nUser: ${userHistory[0].username || 'Unknown'}\n`;
  message += `Name: ${userHistory[0].name || 'Unknown'}\n`;
  message += `Total attempts: ${userHistory.length}\n`;
  message += `First seen: ${new Date(userHistory[0].timestamp).toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })}`;
  
  bot.sendMessage(chatId, message);
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

// NEW: Remove ALL users and their data (except admin)
bot.onText(/\/kickall/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const totalUsers = new Set([
    ...subscribers,
    ...userSectors.keys(),
    ...watchlist.keys(),
    ...allowedUsers,
    ...pendingApprovals
  ]).size;
  
  if (totalUsers === 0) {
    bot.sendMessage(chatId, '✅ No users to remove.');
    return;
  }
  
  const message = 
    `⚠️ CONFIRM KICK ALL USERS\n\n` +
    `This will REMOVE ALL USER DATA:\n` +
    `• ${subscribers.size} subscribers\n` +
    `• ${userSectors.size} custom sector configs\n` +
    `• ${watchlist.size} watchlists\n` +
    `• ${allowedUsers.size} allowed users\n` +
    `• ${pendingApprovals.size} pending approvals\n` +
    `• Total unique users: ${totalUsers}\n\n` +
    `⚠️ This will:\n` +
    `✓ Remove all subscriptions\n` +
    `✓ Delete all custom sectors\n` +
    `✓ Clear all watchlists\n` +
    `✓ Clear whitelist/approvals\n` +
    `✓ Notify users (optional)\n\n` +
    `🛡️ Admin (you) will be preserved\n\n` +
    `Choose an option:\n` +
    `/confirmkickall - Remove & notify users\n` +
    `/confirmkickall_silent - Remove without notification\n` +
    `/cancel - Cancel operation`;
  
  bot.sendMessage(chatId, message);
});

bot.onText(/\/confirmkickall$/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const statusMsg = await bot.sendMessage(chatId, '🔄 Removing all users...');
  
  // Collect all unique user IDs (except admin)
  const allUserIds = new Set([
    ...subscribers,
    ...userSectors.keys(),
    ...watchlist.keys()
  ]);
  
  // Remove admin from the list
  allUserIds.delete(chatId);
  
  const totalUsers = allUserIds.size;
  let notified = 0;
  let failed = 0;
  
  // Notify users
  for (const userId of allUserIds) {
    try {
      await bot.sendMessage(userId,
        `📢 Bot Access Removed\n\n` +
        `Your access to this bot has been removed by the administrator.\n\n` +
        `All your data (subscriptions, watchlists, settings) has been cleared.\n\n` +
        `If you believe this is an error, please contact the bot administrator.`
      );
      notified++;
    } catch (error) {
      failed++;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Clear all data (except admin)
  const adminSectors = userSectors.get(chatId);
  const adminWatchlist = watchlist.get(chatId);
  const isAdminSubscribed = subscribers.has(chatId);
  
  subscribers.clear();
  userSectors.clear();
  watchlist.clear();
  allowedUsers.clear();
  pendingApprovals.clear();
  blockedUsers.clear();
  
  // Restore admin data
  if (isAdminSubscribed) subscribers.add(chatId);
  if (adminSectors) userSectors.set(chatId, adminSectors);
  if (adminWatchlist) watchlist.set(chatId, adminWatchlist);
  allowedUsers.add(chatId);
  
  saveData();
  
  bot.editMessageText(
    `✅ KICK ALL COMPLETE!\n\n` +
    `Removed: ${totalUsers} users\n` +
    `Notified: ${notified} users\n` +
    `Failed: ${failed} users\n\n` +
    `All user data has been cleared.\n` +
    `Your admin data has been preserved.\n\n` +
    `The bot is now clean!`,
    {
      chat_id: chatId,
      message_id: statusMsg.message_id
    }
  );
  
  console.log(`Admin kicked all ${totalUsers} users from the bot`);
});

bot.onText(/\/confirmkickall_silent/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  // Collect stats before clearing
  const stats = {
    subscribers: subscribers.size,
    sectors: userSectors.size,
    watchlists: watchlist.size,
    allowed: allowedUsers.size,
    pending: pendingApprovals.size,
    blocked: blockedUsers.size
  };
  
  const allUserIds = new Set([
    ...subscribers,
    ...userSectors.keys(),
    ...watchlist.keys()
  ]);
  allUserIds.delete(chatId);
  const totalUsers = allUserIds.size;
  
  // Save admin data
  const adminSectors = userSectors.get(chatId);
  const adminWatchlist = watchlist.get(chatId);
  const isAdminSubscribed = subscribers.has(chatId);
  
  // Clear everything
  subscribers.clear();
  userSectors.clear();
  watchlist.clear();
  allowedUsers.clear();
  pendingApprovals.clear();
  blockedUsers.clear();
  
  // Restore admin data
  if (isAdminSubscribed) subscribers.add(chatId);
  if (adminSectors) userSectors.set(chatId, adminSectors);
  if (adminWatchlist) watchlist.set(chatId, adminWatchlist);
  allowedUsers.add(chatId);
  
  saveData();
  
  bot.sendMessage(chatId,
    `✅ SILENT KICK ALL COMPLETE!\n\n` +
    `Removed ${totalUsers} users WITHOUT notification\n\n` +
    `Cleared:\n` +
    `• ${stats.subscribers} subscribers\n` +
    `• ${stats.sectors} custom configs\n` +
    `• ${stats.watchlists} watchlists\n` +
    `• ${stats.allowed} allowed users\n` +
    `• ${stats.pending} pending approvals\n` +
    `• ${stats.blocked} blocked users\n\n` +
    `Your admin data has been preserved.\n` +
    `The bot is now clean!`
  );
  
  console.log(`Admin silently kicked all ${totalUsers} users from the bot`);
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

// NEW: Approve all pending users at once
bot.onText(/\/approveall/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  if (pendingApprovals.size === 0) {
    bot.sendMessage(chatId, 'ℹ️ No pending approval requests.');
    return;
  }
  
  // Show confirmation with user list
  const pendingList = Array.from(pendingApprovals);
  let confirmMsg = `⚠️ *Batch Approval Confirmation*\n\n`;
  confirmMsg += `You are about to approve *${pendingList.length} users*:\n\n`;
  
  // Show first 10 users
  const displayCount = Math.min(10, pendingList.length);
  for (let i = 0; i < displayCount; i++) {
    confirmMsg += `${i + 1}. User ID: ${pendingList[i]}\n`;
  }
  
  if (pendingList.length > 10) {
    confirmMsg += `\n... and ${pendingList.length - 10} more\n`;
  }
  
  confirmMsg += `\n⚠️ This will give access to ALL pending users.\n\n`;
  confirmMsg += `Reply with:\n`;
  confirmMsg += `• /confirmapproveall - to proceed\n`;
  confirmMsg += `• /cancel - to cancel`;
  
  bot.sendMessage(chatId, confirmMsg, { parse_mode: 'Markdown' });
});

// Confirm batch approval
bot.onText(/\/confirmapproveall/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  if (pendingApprovals.size === 0) {
    bot.sendMessage(chatId, 'ℹ️ No pending approvals to process.');
    return;
  }
  
  const pendingList = Array.from(pendingApprovals);
  const total = pendingList.length;
  
  const statusMsg = await bot.sendMessage(chatId, 
    `⏳ Approving ${total} users...\n\nThis may take a moment...`
  );
  
  let approved = 0;
  let failed = 0;
  
  for (const userId of pendingList) {
    try {
      // Add to allowed users
      allowedUsers.add(userId);
      pendingApprovals.delete(userId);
      blockedUsers.delete(userId); // Remove from blocked if was blocked
      
      console.log(`[BATCH APPROVE] Approved user ${userId}`);
      
      // Notify user
      await bot.sendMessage(userId,
        '✅ *Access Approved!*\n\n' +
        'You can now use the bot.\n\n' +
        'Type /start to begin.',
        { parse_mode: 'Markdown' }
      ).catch(err => {
        console.log(`Could not notify user ${userId}: ${err.message}`);
      });
      
      approved++;
      
      // Update progress every 5 users
      if (approved % 5 === 0) {
        await bot.editMessageText(
          `⏳ Approving users...\n\nProgress: ${approved}/${total}`,
          {
            chat_id: chatId,
            message_id: statusMsg.message_id
          }
        ).catch(() => {});
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`Failed to approve user ${userId}:`, error.message);
      failed++;
    }
  }
  
  saveData();
  
  let resultMsg = `✅ *Batch Approval Complete*\n\n`;
  resultMsg += `✅ Approved: ${approved}\n`;
  if (failed > 0) {
    resultMsg += `❌ Failed: ${failed}\n`;
  }
  resultMsg += `\nAll approved users have been notified.`;
  
  await bot.editMessageText(resultMsg, {
    chat_id: chatId,
    message_id: statusMsg.message_id,
    parse_mode: 'Markdown'
  });
  
  console.log(`[BATCH APPROVE] Completed: ${approved} approved, ${failed} failed`);
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

// NEW: Deny all pending requests at once
bot.onText(/\/denyall/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  if (pendingApprovals.size === 0) {
    bot.sendMessage(chatId, 'ℹ️ No pending approval requests.');
    return;
  }
  
  // Show confirmation
  const pendingList = Array.from(pendingApprovals);
  let confirmMsg = `⚠️ *Batch Denial Confirmation*\n\n`;
  confirmMsg += `You are about to deny *${pendingList.length} users*:\n\n`;
  
  // Show first 10 users
  const displayCount = Math.min(10, pendingList.length);
  for (let i = 0; i < displayCount; i++) {
    confirmMsg += `${i + 1}. User ID: ${pendingList[i]}\n`;
  }
  
  if (pendingList.length > 10) {
    confirmMsg += `\n... and ${pendingList.length - 10} more\n`;
  }
  
  confirmMsg += `\n⚠️ This will deny access to ALL pending users.\n\n`;
  confirmMsg += `Reply with:\n`;
  confirmMsg += `• /confirmdenyall - to proceed\n`;
  confirmMsg += `• /cancel - to cancel`;
  
  bot.sendMessage(chatId, confirmMsg, { parse_mode: 'Markdown' });
});

// Confirm batch denial
bot.onText(/\/confirmdenyall/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  if (pendingApprovals.size === 0) {
    bot.sendMessage(chatId, 'ℹ️ No pending requests to process.');
    return;
  }
  
  const pendingList = Array.from(pendingApprovals);
  const total = pendingList.length;
  
  const statusMsg = await bot.sendMessage(chatId, 
    `⏳ Denying ${total} requests...\n\nThis may take a moment...`
  );
  
  let denied = 0;
  let failed = 0;
  
  for (const userId of pendingList) {
    try {
      // Remove from pending and allowed
      pendingApprovals.delete(userId);
      allowedUsers.delete(userId);
      
      console.log(`[BATCH DENY] Denied user ${userId}`);
      
      // Notify user
      await bot.sendMessage(userId,
        '❌ *Access Denied*\n\n' +
        'Your access request has been denied by the administrator.',
        { parse_mode: 'Markdown' }
      ).catch(err => {
        console.log(`Could not notify user ${userId}: ${err.message}`);
      });
      
      denied++;
      
      // Update progress every 5 users
      if (denied % 5 === 0) {
        await bot.editMessageText(
          `⏳ Denying requests...\n\nProgress: ${denied}/${total}`,
          {
            chat_id: chatId,
            message_id: statusMsg.message_id
          }
        ).catch(() => {});
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`Failed to deny user ${userId}:`, error.message);
      failed++;
    }
  }
  
  saveData();
  
  let resultMsg = `✅ *Batch Denial Complete*\n\n`;
  resultMsg += `❌ Denied: ${denied}\n`;
  if (failed > 0) {
    resultMsg += `⚠️ Failed: ${failed}\n`;
  }
  resultMsg += `\nAll denied users have been notified.`;
  
  await bot.editMessageText(resultMsg, {
    chat_id: chatId,
    message_id: statusMsg.message_id,
    parse_mode: 'Markdown'
  });
  
  console.log(`[BATCH DENY] Completed: ${denied} denied, ${failed} failed`);
});

bot.onText(/\/block (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const userId = parseInt(match[1]);
  
  if (isNaN(userId)) {
    bot.sendMessage(chatId, '❌ Invalid user ID. Use: /block 123456789');
    return;
  }
  
  if (userId === chatId) {
    bot.sendMessage(chatId, '❌ You cannot block yourself!');
    return;
  }
  
  // Add to blocked list
  blockedUsers.add(userId);
  
  // Remove from all access lists
  allowedUsers.delete(userId);
  subscribers.delete(userId);
  pendingApprovals.delete(userId);
  userSectors.delete(userId);
  watchlist.delete(userId);
  
  saveData();
  
  console.log(`[BLOCK] Admin blocked user ${userId}`);
  console.log(`[BLOCK] User removed from all lists`);
  
  bot.sendMessage(chatId, 
    `🚫 User Blocked\n\n` +
    `User ID: ${userId}\n` +
    `Status: Blocked and removed from all lists\n\n` +
    `The user will not be able to use the bot.`
  );
  
  // Notify the user
  bot.sendMessage(userId,
    '🚫 Access Blocked\n\n' +
    'You have been blocked from using this bot.\n\n' +
    'All your data has been removed.'
  ).catch(err => {
    console.log(`[BLOCK] Could not notify user ${userId}: ${err.message}`);
  });
});

bot.onText(/\/unblock (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  const userId = parseInt(match[1]);
  
  if (isNaN(userId)) {
    bot.sendMessage(chatId, '❌ Invalid user ID. Use: /unblock 123456789');
    return;
  }
  
  if (!blockedUsers.has(userId)) {
    bot.sendMessage(chatId, `ℹ️ User ${userId} is not blocked.`);
    return;
  }
  
  // Remove from blocked list
  blockedUsers.delete(userId);
  
  // Remove from pending approvals (they were blocked)
  pendingApprovals.delete(userId);
  
  // In approval mode, they need to request access again
  // In open mode, give them access immediately
  if (CONFIG.ACCESS_MODE === 'open') {
    allowedUsers.add(userId);
  }
  
  saveData();
  
  console.log(`[UNBLOCK] Admin unblocked user ${userId}`);
  
  const message = CONFIG.ACCESS_MODE === 'approval' 
    ? `✅ User Unblocked\n\nUser ID: ${userId}\nStatus: Unblocked\n\nThey can now request access again.`
    : `✅ User Unblocked\n\nUser ID: ${userId}\nStatus: Unblocked and granted access\n\nThey can use the bot immediately.`;
  
  bot.sendMessage(chatId, message);
  
  // Notify the user
  const userMessage = CONFIG.ACCESS_MODE === 'approval'
    ? '✅ You have been unblocked!\n\n' +
      'You can now request access to the bot again.\n\n' +
      'Type /start to request access.'
    : '✅ Access Restored\n\n' +
      'You have been unblocked and can now use the bot.\n\n' +
      'Type /start to begin.';
  
  bot.sendMessage(userId, userMessage)
    .catch(err => console.log(`Could not notify user ${userId}: ${err.message}`));
});

// NEW: Allow blocked users to request unblock
bot.onText(/\/requestunblock/, (msg) => {
  const chatId = msg.chat.id;
  
  // Only works for blocked users
  if (!blockedUsers.has(chatId)) {
    bot.sendMessage(chatId, 'ℹ️ You are not blocked. Use /start to access the bot.');
    return;
  }
  
  // Check if already requested
  if (pendingApprovals.has(chatId)) {
    bot.sendMessage(chatId,
      '⏳ Unblock Request Pending\n\n' +
      'Your unblock request has already been sent to the administrator.\n\n' +
      'Please wait for admin review.'
    );
    return;
  }
  
  // Add to pending approvals
  pendingApprovals.add(chatId);
  saveData();
  
  console.log(`[UNBLOCK REQUEST] User ${chatId} requested unblock`);
  
  bot.sendMessage(chatId,
    '📝 Unblock Request Submitted\n\n' +
    'Your request to be unblocked has been sent to the administrator.\n\n' +
    'You will be notified once the admin reviews your request.'
  );
  
  // Notify admin
  if (CONFIG.ADMIN_ID) {
    const user = msg.from;
    const userName = user.username ? `@${user.username}` : user.first_name || 'Unknown';
    
    bot.sendMessage(CONFIG.ADMIN_ID,
      `🔓 Unblock Request\n\n` +
      `A blocked user is requesting to be unblocked:\n\n` +
      `User: ${userName}\n` +
      `Name: ${user.first_name} ${user.last_name || ''}\n` +
      `ID: ${chatId}\n` +
      `Status: Currently BLOCKED\n\n` +
      `Options:\n` +
      `/unblock ${chatId} - Unblock user\n` +
      `/deny ${chatId} - Deny request (keep blocked)`
    ).catch(err => console.error('Failed to notify admin:', err.message));
  }
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
  
  let message = `⏳ Pending Access Requests (${pendingApprovals.size})\n\n`;
  
  Array.from(pendingApprovals).forEach((userId, index) => {
    message += `${index + 1}. User ID: ${userId}\n`;
    message += `   /approve ${userId}\n`;
    message += `   /deny ${userId}\n\n`;
  });
  
  bot.sendMessage(chatId, message);
});

bot.onText(/\/listusers/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  let message = `👥 Bot Users Summary\n\n`;
  
  // Subscribers
  message += `🔔 Subscribers: ${subscribers.size}\n`;
  if (subscribers.size > 0) {
    message += `Subscribed User IDs:\n`;
    Array.from(subscribers).forEach((id, index) => {
      message += `${index + 1}. ${id}\n`;
    });
    message += `\n`;
  }
  
  // Users with custom sectors
  message += `⚙️ Users with Custom Sectors: ${userSectors.size}\n`;
  if (userSectors.size > 0) {
    message += `User IDs:\n`;
    Array.from(userSectors.keys()).forEach((id, index) => {
      const sectors = userSectors.get(id);
      message += `${index + 1}. ${id} (${sectors.length} sectors)\n`;
    });
    message += `\n`;
  }
  
  // Watchlist users
  const watchlistUsers = watchlist.size;
  message += `👀 Users with Watchlists: ${watchlistUsers}\n`;
  if (watchlistUsers > 0) {
    message += `User IDs:\n`;
    Array.from(watchlist.keys()).forEach((id, index) => {
      const stocks = watchlist.get(id);
      message += `${index + 1}. ${id} (${stocks.length} stocks)\n`;
    });
    message += `\n`;
  }
  
  // Access control
  if (CONFIG.ACCESS_MODE === 'whitelist' || CONFIG.ACCESS_MODE === 'approval') {
    message += `✅ Allowed Users: ${allowedUsers.size}\n`;
    if (allowedUsers.size > 0) {
      message += `Allowed User IDs:\n`;
      Array.from(allowedUsers).forEach((id, index) => {
        message += `${index + 1}. ${id}\n`;
      });
      message += `\n`;
    }
  }
  
  // Pending approvals
  if (CONFIG.ACCESS_MODE === 'approval') {
    message += `⏳ Pending Approvals: ${pendingApprovals.size}\n`;
    if (pendingApprovals.size > 0) {
      message += `Use /pending to see details\n\n`;
    }
  }
  
  // Blocked users
  message += `🚫 Blocked Users: ${blockedUsers.size}\n`;
  if (blockedUsers.size > 0) {
    message += `Blocked User IDs:\n`;
    Array.from(blockedUsers).forEach((id, index) => {
      message += `${index + 1}. ${id}\n`;
    });
  }
  
  // Split message if too long
  if (message.length > 4000) {
    const chunks = message.match(/[\s\S]{1,4000}/g) || [];
    chunks.forEach(chunk => {
      bot.sendMessage(chatId, chunk);
    });
  } else {
    bot.sendMessage(chatId, message);
  }
});

bot.onText(/\/accessmode/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin only command');
    return;
  }
  
  let message = `🔐 Access Control Status\n\n`;
  message += `Mode: ${CONFIG.ACCESS_MODE.toUpperCase()}\n\n`;
  
  if (CONFIG.ACCESS_MODE === 'open') {
    message += `🟢 Open Mode - Anyone can use (except blocked)\n`;
  } else if (CONFIG.ACCESS_MODE === 'whitelist') {
    message += `🟡 Whitelist Mode - Only whitelisted users\n`;
  } else if (CONFIG.ACCESS_MODE === 'approval') {
    message += `🔴 Approval Mode - Requires admin approval\n`;
  }
  
  message += `\n📊 Statistics:\n`;
  message += `Allowed Users: ${allowedUsers.size}\n`;
  message += `Pending Approvals: ${pendingApprovals.size}\n`;
  message += `Blocked Users: ${blockedUsers.size}\n`;
  
  message += `\nChange mode in Railway:\n`;
  message += `ACCESS_MODE=open\n`;
  message += `ACCESS_MODE=whitelist\n`;
  message += `ACCESS_MODE=approval\n`;
  
  bot.sendMessage(chatId, message);
});

// Existing commands (sectors, screen, stock, etc.)
bot.onText(/\/sectors/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!checkAccess(msg, () => {
    let message = '📋 Available Sectors:\n\n';
    
    const userSelectedSectors = getUserSectors(chatId);
    
    Object.keys(IDX_SECTORS).sort().forEach((sector, index) => {
      const count = IDX_SECTORS[sector].length;
      const isMonitored = userSelectedSectors.includes(sector) ? '✅' : '⚪';
      message += `${isMonitored} ${index + 1}. ${sector} (${count} stocks)\n`;
    });
    
    message += '\n✅ = Your monitored sectors';
    message += '\n\nUse /screen to start screening';
    message += '\nUse /addsector to customize';
    
    bot.sendMessage(chatId, message);
  })) return;
});

// ============================================
// FULL IDX SCAN COMMANDS
// ============================================

// /scanall - Full IDX oversold scan
bot.onText(/\/scanall/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!checkAccess(msg, async () => {
    const allStocks = getAllIDXStocks();
    
    // Check if we have cached results
    if (cachedFullScan.oversold.length > 0 && cachedFullScan.lastOversoldUpdate) {
      const ageMinutes = (Date.now() - cachedFullScan.lastOversoldUpdate.getTime()) / 1000 / 60;
      
      // If cache is less than 30 minutes old, offer to use it
      if (ageMinutes < 30) {
        const keyboard = [
          [{ text: '📋 Show Cached Results', callback_data: 'scanall_cached' }],
          [{ text: '🔄 Run Fresh Scan', callback_data: 'scanall_fresh' }]
        ];
        
        const updateTime = cachedFullScan.lastOversoldUpdate.toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' 
        });
        
        bot.sendMessage(chatId, 
          `📊 *Full IDX Oversold Scan*\n\n` +
          `Cached results available from ${updateTime} WIB (${Math.round(ageMinutes)} min ago)\n` +
          `Found: ${cachedFullScan.oversold.length} signals\n\n` +
          `Total stocks to scan: ${allStocks.length}\n` +
          `Estimated time for fresh scan: ~${Math.ceil(allStocks.length * 0.4 / 60)} minutes\n\n` +
          `Choose an option:`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
        );
        return;
      }
    }
    
    // No cache or cache too old - start fresh scan
    const processingMsg = await bot.sendMessage(chatId, 
      `📊 *Full IDX Oversold Scan*\n\n` +
      `🔍 Scanning IDX stocks...\n` +
      `⏱️ Estimated time: ~${Math.ceil(allStocks.length * 0.4 / 60)} minutes\n\n` +
      `Progress: Starting...`,
      { parse_mode: 'Markdown' }
    );
    
    try {
      await performFullOversoldScan(async (processed, total) => {
        if (processed % 100 === 0 || processed === total) {
          await bot.editMessageText(
            `📊 *Full IDX Oversold Scan*\n\n` +
            `🔍 Scanning IDX stocks...\n\n` +
            `Progress: ${Math.round(processed/total*100)}%`,
            { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      });
      
      const message = formatFullOversoldResults(cachedFullScan.oversold);
      
      // Delete processing message and send results
      await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      
      if (message.length > 4096) {
        const chunks = message.match(/[\s\S]{1,4096}/g);
        for (const chunk of chunks) {
          await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        }
      } else {
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      bot.editMessageText(`❌ Error: ${error.message}`, {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });
    }
  })) return;
});

// /momentum - Full IDX momentum scan (top movers)
bot.onText(/\/momentum/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!checkAccess(msg, async () => {
    const allStocks = getAllIDXStocks();
    
    // Check if we have cached results
    if (cachedFullScan.momentum.length > 0 && cachedFullScan.lastMomentumUpdate) {
      const ageMinutes = (Date.now() - cachedFullScan.lastMomentumUpdate.getTime()) / 1000 / 60;
      
      // If cache is less than 30 minutes old, offer to use it
      if (ageMinutes < 30) {
        const keyboard = [
          [{ text: '📋 Show Cached Results', callback_data: 'momentum_cached' }],
          [{ text: '🔄 Run Fresh Scan', callback_data: 'momentum_fresh' }]
        ];
        
        const updateTime = cachedFullScan.lastMomentumUpdate.toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' 
        });
        
        bot.sendMessage(chatId, 
          `🚀 *IDX Momentum Scan*\n\n` +
          `Cached results available from ${updateTime} WIB (${Math.round(ageMinutes)} min ago)\n\n` +
          `Total stocks to scan: ${allStocks.length}\n` +
          `Estimated time for fresh scan: ~${Math.ceil(allStocks.length * 0.4 / 60)} minutes\n\n` +
          `Choose an option:`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
        );
        return;
      }
    }
    
    // No cache or cache too old - start fresh scan
    const processingMsg = await bot.sendMessage(chatId, 
      `🚀 *IDX Momentum Scan*\n\n` +
      `🔍 Scanning IDX stocks...\n` +
      `⏱️ Estimated time: ~${Math.ceil(allStocks.length * 0.4 / 60)} minutes\n\n` +
      `Progress: Starting...`,
      { parse_mode: 'Markdown' }
    );
    
    try {
      await performMomentumScan(async (processed, total) => {
        if (processed % 100 === 0 || processed === total) {
          await bot.editMessageText(
            `🚀 *IDX Momentum Scan*\n\n` +
            `🔍 Scanning IDX stocks...\n\n` +
            `Progress: ${Math.round(processed/total*100)}%`,
            { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      });
      
      const message = formatMomentumResults(cachedFullScan.momentum);
      
      // Delete processing message and send results
      await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      bot.editMessageText(`❌ Error: ${error.message}`, {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });
    }
  })) return;
});

// ============================================
// END FULL IDX SCAN COMMANDS
// ============================================

bot.onText(/\/screen/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!checkAccess(msg, () => {
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
  })) return;
});

bot.onText(/\/stock (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!checkAccess(msg, async () => {
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
      
      const priceFormatted = typeof result.price === 'number' ? result.price.toLocaleString() : result.price;
      const liquidityStatus = result.isLiquid ? '✅ Liquid' : '⚠️ Low liquidity';
      
      let message = `📊 *${symbol} Analysis*\n\n`;
      message += `💰 Price: Rp ${priceFormatted}\n`;
      message += `📈 Stoch: %K ${result.k} | %D ${result.d}\n`;
      message += `📊 Volume: ${formatVolume(result.volume)} (Avg: ${formatVolume(result.avgVolume)})\n`;
      message += `💵 Value: Rp ${formatIDR(result.volumeIDR)} (Avg: Rp ${formatIDR(result.avgVolumeIDR)})\n`;
      message += `🏷️ Liquidity: ${liquidityStatus}\n`;
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
  })) return;
});

// Handle sector screening callback
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;
  
  // Check if user is blocked
  if (blockedUsers.has(chatId)) {
    bot.answerCallbackQuery(callbackQuery.id, {
      text: '🚫 You have been blocked from using this bot.',
      show_alert: true
    });
    return;
  }
  
  // Handle scanall cached/fresh callbacks
  if (data === 'scanall_cached') {
    bot.answerCallbackQuery(callbackQuery.id);
    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    
    const message = formatFullOversoldResults(cachedFullScan.oversold);
    if (message.length > 4096) {
      const chunks = message.match(/[\s\S]{1,4096}/g);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
      }
    } else {
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
    return;
  }
  
  if (data === 'scanall_fresh') {
    bot.answerCallbackQuery(callbackQuery.id);
    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    
    const allStocks = getAllIDXStocks();
    const processingMsg = await bot.sendMessage(chatId, 
      `📊 *Full IDX Oversold Scan*\n\n` +
      `🔍 Scanning IDX stocks...\n` +
      `⏱️ Estimated time: ~${Math.ceil(allStocks.length * 0.4 / 60)} minutes\n\n` +
      `Progress: Starting...`,
      { parse_mode: 'Markdown' }
    );
    
    try {
      await performFullOversoldScan(async (processed, total) => {
        if (processed % 100 === 0 || processed === total) {
          await bot.editMessageText(
            `📊 *Full IDX Oversold Scan*\n\n` +
            `🔍 Scanning IDX stocks...\n\n` +
            `Progress: ${Math.round(processed/total*100)}%`,
            { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      });
      
      const message = formatFullOversoldResults(cachedFullScan.oversold);
      await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      
      if (message.length > 4096) {
        const chunks = message.match(/[\s\S]{1,4096}/g);
        for (const chunk of chunks) {
          await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        }
      } else {
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      bot.editMessageText(`❌ Error: ${error.message}`, {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });
    }
    return;
  }
  
  // Handle momentum cached/fresh callbacks
  if (data === 'momentum_cached') {
    bot.answerCallbackQuery(callbackQuery.id);
    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    
    const message = formatMomentumResults(cachedFullScan.momentum);
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    return;
  }
  
  if (data === 'momentum_fresh') {
    bot.answerCallbackQuery(callbackQuery.id);
    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    
    const allStocks = getAllIDXStocks();
    const processingMsg = await bot.sendMessage(chatId, 
      `🚀 *IDX Momentum Scan*\n\n` +
      `🔍 Scanning IDX stocks...\n` +
      `⏱️ Estimated time: ~${Math.ceil(allStocks.length * 0.4 / 60)} minutes\n\n` +
      `Progress: Starting...`,
      { parse_mode: 'Markdown' }
    );
    
    try {
      await performMomentumScan(async (processed, total) => {
        if (processed % 100 === 0 || processed === total) {
          await bot.editMessageText(
            `🚀 *IDX Momentum Scan*\n\n` +
            `🔍 Scanning IDX stocks...\n\n` +
            `Progress: ${Math.round(processed/total*100)}%`,
            { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      });
      
      const message = formatMomentumResults(cachedFullScan.momentum);
      await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      bot.editMessageText(`❌ Error: ${error.message}`, {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });
    }
    return;
  }
  
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
          `Progress: ${Math.round(processed/total*100)}%`,
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

// Global message handler to block users at the earliest point
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  
  // Skip if it's the admin
  if (isAdmin(chatId)) {
    return;
  }
  
  // Check if user is blocked
  if (blockedUsers.has(chatId)) {
    console.log(`[GLOBAL BLOCK] Blocked user ${chatId} tried to send: ${msg.text || '[media]'}`);
    bot.sendMessage(chatId, '🚫 You have been blocked from using this bot.')
      .catch(err => console.error(`Failed to notify blocked user ${chatId}:`, err.message));
    // Don't process further - message is blocked
    return;
  }
});

loadData();
setupAutoScans();
console.log('🤖 Bot is running with enhanced features!');
console.log(`📊 Loaded: ${subscribers.size} subscribers, ${userSectors.size} custom configs, ${watchlist.size} watchlists`);

// Save data periodically
setInterval(() => {
  saveData();
}, 5 * 60 * 1000); // Every 5 minutes
