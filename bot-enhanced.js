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
      
      console.log('✅ Data loaded successfully');
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

// Initialize bot
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

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
  
  console.log('✅ Auto-scan schedules set up:');
  console.log(`   • Daily Summary: ${AUTO_SCAN_CONFIG.SCHEDULE.DAILY_SUMMARY} WIB`);
  console.log(`   • Morning Scan: ${AUTO_SCAN_CONFIG.SCHEDULE.MORNING_SCAN} WIB`);
  console.log(`   • Afternoon Scan: ${AUTO_SCAN_CONFIG.SCHEDULE.AFTERNOON_SCAN} WIB`);
  console.log(`   • Evening Scan: ${AUTO_SCAN_CONFIG.SCHEDULE.EVENING_SCAN} WIB`);
  console.log(`   • Watchlist checks: Every hour during market hours`);
}

// Admin check
function isAdmin(chatId) {
  return CONFIG.ADMIN_ID && chatId.toString() === CONFIG.ADMIN_ID.toString();
}

// Bot Commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
🤖 *IDX Stock Screener Bot*

Welcome! I can help you screen Indonesian stocks using Stochastic Oscillator (10,5,5).

*🆕 NEW FEATURES:*
✨ Custom sector selection
✨ Personal watchlist
✨ Daily summary alerts

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

*📊 Summary:*
/today - Today's top opportunities

/help - Show detailed help
  `;
  
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
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

*Summary:*
• /today - Top 10 opportunities today

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
  message += `📂 Avg Sectors/User: ${(Array.from(userSectors.values()).reduce((sum, sectors) => sum + sectors.length, 0) / userSectors.size || 0).toFixed(1)}\n\n`;
  
  message += `*Top 5 Monitored Sectors:*\n`;
  topSectors.forEach(([sector, count], index) => {
    message += `${index + 1}. ${sector}: ${count} users\n`;
  });
  
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
loadData();
setupAutoScans();
console.log('🤖 Bot is running with enhanced features!');
console.log(`📊 Loaded: ${subscribers.size} subscribers, ${userSectors.size} custom configs, ${watchlist.size} watchlists`);

// Save data periodically
setInterval(() => {
  saveData();
}, 5 * 60 * 1000); // Every 5 minutes
