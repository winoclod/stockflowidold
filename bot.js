require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Configuration
const CONFIG = {
  STOCH_K_PERIOD: 10,
  STOCH_K_SMOOTH: 5,
  STOCH_D_PERIOD: 5,
  OVERSOLD_LEVEL: 20,
  DAYS_TO_FETCH: 100,
  BATCH_SIZE: 10,
  WAIT_TIME: 500,
};

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

// Store user screening states
const userStates = {};

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
    // Using Yahoo Finance API (free alternative)
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

async function screenSector(sectorName, chatId, progressCallback) {
  const stocks = IDX_SECTORS[sectorName];
  if (!stocks) {
    throw new Error('Sector not found');
  }
  
  const results = [];
  const total = stocks.length;
  let processed = 0;
  
  for (const symbol of stocks) {
    const result = await screenStock(symbol);
    results.push(result);
    processed++;
    
    if (processed % 5 === 0 || processed === total) {
      await progressCallback(processed, total);
    }
    
    await new Promise(resolve => setTimeout(resolve, CONFIG.WAIT_TIME));
  }
  
  return results;
}

function formatResults(results) {
  const withSignals = results.filter(r => r.signal && !r.error);
  const errors = results.filter(r => r.error);
  
  let message = `📊 *Screening Results*\n\n`;
  
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

// Bot Commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
🤖 *IDX Stock Screener Bot*

Welcome! I can help you screen Indonesian stocks using Stochastic Oscillator (10,5,5).

*Available Commands:*
/sectors - View all available sectors
/screen - Start screening a sector
/stock <SYMBOL> - Check a single stock
/help - Show this help message

*Example:*
\`/stock BBCA\` - Check BBCA stock
  `;
  
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
📚 *How to use this bot:*

1️⃣ Use /sectors to see all available sectors
2️⃣ Use /screen to start screening
3️⃣ Use /stock SYMBOL to check individual stock

*Stochastic Settings:*
• K Period: ${CONFIG.STOCH_K_PERIOD}
• K Smooth: ${CONFIG.STOCH_K_SMOOTH}
• D Period: ${CONFIG.STOCH_D_PERIOD}
• Oversold Level: ${CONFIG.OVERSOLD_LEVEL}

*Signals:*
🟢 BUY - K crossed above D in oversold zone
🟡 POTENTIAL - K crossed above D (not oversold)
  `, { parse_mode: 'Markdown' });
});

bot.onText(/\/sectors/, (msg) => {
  const chatId = msg.chat.id;
  
  let message = '📋 *Available Sectors:*\n\n';
  
  Object.keys(IDX_SECTORS).sort().forEach((sector, index) => {
    const count = IDX_SECTORS[sector].length;
    message += `${index + 1}. ${sector} (${count} stocks)\n`;
  });
  
  message += '\nUse /screen to start screening a sector.';
  
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
    const estimatedMinutes = Math.ceil(stockCount * 0.5 / 60);
    
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
        ).catch(() => {}); // Ignore edit errors
      });
      
      const resultMessage = formatResults(results);
      
      // Send results in chunks if too long
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

console.log('🤖 Bot is running...');
