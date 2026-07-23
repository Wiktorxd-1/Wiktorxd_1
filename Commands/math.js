const { SlashCommandBuilder } = require('discord.js');
const { fork, execFile } = require('child_process');

process.env.NODE_NO_WARNINGS = '1';

const MemoryLimit = 3 * 1024 * 1024; 
const TimeLimitMs = 6000;

function formatShortNumber(nStr) {
  try {
    if (typeof nStr !== 'string') nStr = String(nStr);
    if (nStr.length > 25) return nStr;
    const n = Number(nStr);
    if (!isFinite(n)) return nStr;
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    const units = [
      { value: 1e12, symbol: 'T' },
      { value: 1e9, symbol: 'B' },
      { value: 1e6, symbol: 'M' },
      { value: 1e3, symbol: 'K' },
    ];
    for (const u of units) {
      if (abs >= u.value) {
        const v = (abs / u.value);
        return `${sign}${(Math.round(v * 100) / 100).toLocaleString()}${u.symbol}`;
      }
    }
    return sign + (Math.round(abs * 1000) / 1000 === 0 ? '0' : abs.toLocaleString());
  } catch {
    return nStr;
  }
}

function truncateDigits(str, maxDigits = 100) {
  let digits = 0;
  let out = '';
  for (const ch of str) {
    if (/[0-9]/.test(ch)) {
      digits++;
      if (digits > maxDigits) {
        out += '...';
        break;
      }
    }
    out += ch;
  }
  return out;
}

function formatWithCommas(str) {
  if (!str) return str;
  str = String(str).trim();
  const asNum = Number(str);
  if (isFinite(asNum) && Math.abs(asNum) < 1e21) {
    try {
      const parts = str.split(/[eE]/);
      if (parts.length === 1) {
        const [intPart, frac] = str.split('.');
        const signed = intPart.startsWith('-') || intPart.startsWith('+') ? intPart[0] : '';
        const unsignedInt = signed ? intPart.slice(1) : intPart;
        const withCommas = unsignedInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return `${signed}${withCommas}${frac ? '.' + frac : ''}`;
      }
    } catch {}
  }
  const m = str.match(/^([+-]?)(\d+)(\.\d+)?(e[+-]?\d+)?$/i);
  if (m) {
    const sign = m[1] || '';
    const intPart = m[2] || '0';
    const frac = m[3] || '';
    const exp = m[4] || '';
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}${withCommas}${frac}${exp}`;
  }
  return str;
}

function normalizeExpression(input) {
  if (typeof input !== 'string') return input;
  let s = input.trim();


  s = s.replace(/\b(\d{1,3}(?:\.\d{3})+),(\d+)\b/g, (_, intPart, frac) => {
    return intPart.replace(/\./g, '') + '.' + frac;
  });


  s = s.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (m) => m.replace(/,/g, ''));


  s = s.replace(/\b(\d+),(\d+)\b/g, (m, a, b) => `${a}.${b}`);


  s = s.replace(/\b(\d+(?:\.\d+)?)([kKmMbBtT])\b/g, (m, num, suffix) => {
    const map = { k: '1e3', K: '1e3', m: '1e6', M: '1e6', b: '1e9', B: '1e9', t: '1e12', T: '1e12' };
    const mul = map[suffix] || map[suffix.toLowerCase()];
    return `(${num}*${mul})`;
  });

  const replacements = [
    ['×', '*'],['✕', '*'],['∙', '*'],['·', '*'],
    ['÷', '/'],['⁄', '/'],['−', '-'],['‑', '-'],
    ['—', '-'],['–', '-'],['π', 'pi'],['Π', 'pi'],
    ['√', 'sqrt'],['‰', '/1000']
  ];
  for (const [a, b] of replacements) s = s.split(a).join(b);
  const vulgar = {
    '½': '1/2','⅓':'1/3','⅔':'2/3','¼':'1/4','¾':'3/4',
    '⅕':'1/5','⅖':'2/5','⅗':'3/5','⅘':'4/5','⅙':'1/6',
    '⅚':'5/6','⅛':'1/8','⅜':'3/8','⅝':'5/8','⅞':'7/8',
    '⅐':'1/7','⅑':'1/9','⅒':'1/10'
  };
  s = s.replace(/[\u00BC-\u00BE\u2150-\u215E]/g, match => '(' + (vulgar[match] || '') + ')');
  s = s.replace(/([0-9])²/g, '$1^2').replace(/([0-9])³/g, '$1^3');
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');
  s = s.replace(/(\d|\))\s*(pi|e(?!\d)|E(?!\d)|\(|[a-df-zA-DF-Z])/g, (m, a, b) => `${a}*${b}`);
  s = s.replace(/(pi|e(?!\d)|E(?!\d)|\))\s*(\d|\()/g, (m, a, b) => `${a}*${b}`);
  s = s.replace(/[\u200B-\u200F\uFEFF]/g, '');
  return s;
}

function expandExponentialIfShort(str, limit = 100) {

  if (typeof str !== 'string') str = String(str);
  const m = str.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!m) return str;
  const sign = m[1] || '';
  const intPart = m[2] || '0';
  const fracPart = m[3] || '';
  const exp = parseInt(m[4], 10);

  const mant = intPart + fracPart;
  let decPos = intPart.length;
  decPos += exp;

  if (decPos <= 0) {
    const zeros = '0'.repeat(Math.abs(decPos));
    const out = sign + '0.' + zeros + mant.replace(/^0+/, '');
    if (out.length > limit) return str;
    return out;
  } else if (decPos >= mant.length) {
    const zeros = '0'.repeat(decPos - mant.length);
    const out = sign + mant.replace(/^0+/, '') + zeros;
    if (out.length > limit) return str;
    return out;
  } else {

    const intPartNew = mant.slice(0, decPos);
    const fracNew = mant.slice(decPos);
    const out = sign + (intPartNew.replace(/^0+/, '') || '0') + (fracNew ? '.' + fracNew : '');
    if (out.length > limit) return str;
    return out;
  }
}


function isSafeSimpleExpr(s) {
  if (typeof s !== 'string') return false;
  s = s.trim();
  if (!s || s.length > 200) return false;
  
  if (!/^[0-9eE+\-*/%^().\s]+$/.test(s)) return false;
  
  if (/\.\./.test(s)) return false;
  
  if (/\(\s*\)/.test(s)) return false;
  return true;
}

function simpleEvaluate(s) {
  try {
    
    const jsExpr = s.replace(/\^/g, '**');
    
    const fn = new Function(`"use strict"; return (${jsExpr})`);
    const v = fn();
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return null;
  } catch (e) {
    return null;
  }
}


if (process.env.MATH_CHILD === '1') {
  const math = require('mathjs');
 
  let lastApprox = null;

  function preValidateExpression(raw) {
    if (!raw || typeof raw !== 'string') return false;
    const s = raw;


    if (/(^|[^a-zA-Z0-9_])0\s*\/\s*0([^0-9.]|$)/.test(s)) return 'silly';

    if (/\/\s*\(?\s*0+(\.0+)?\s*\)?/.test(s)) return 'silly';

    if(/%\s*\(?\s*0+(\.0+)?\s*\)?/.test(s)) return 'silly';

    if (/(^|[^a-zA-Z0-9_])0\s*(\^|\*\*)\s*0([^0-9.]|$)/.test(s)) return 'silly';

    if (/(?:\^|\*\*)\s*[+-]?\d{4,}/.test(s)) return 'silly';

    if (/(?:\b(?:log|ln|log10)\b)\s*\(\s*-/i.test(s)) return 'silly';
    if (/\bsqrt\s*\(\s*-/i.test(s)) return 'silly';

    return false;
  }
 
  process.on('message', async (msg) => {
    try {
      if (!msg) return;
      if (msg.cmd === 'ping') { return; }
      if (msg.cmd === 'eval') {
        try {
          const rawExpr = String(msg.expr || '');


          const pre = preValidateExpression(rawExpr);
          if (pre === 'silly') {
            if (process.send) process.send({ type: 'silly' });
            return;
          }
          const expr = normalizeExpression(rawExpr);
          const wantsPi = /(^|[^a-zA-Z0-9_])pi([^a-zA-Z0-9_]|$)|π/.test(rawExpr);
          const cfg = { number: 'BigNumber', precision: wantsPi ? 1024 : 256 };
          const m = math.create(math.all, cfg);
          const result = m.evaluate(expr);
          let resultStr;
          const meta = {};
          if (wantsPi) {
            resultStr = m.format(result, { notation: 'fixed', precision: 400 });
            meta.isPi = true;
          } else {
            try {
              resultStr = result && typeof result.toString === 'function' ? result.toString() : m.format(result, { notation: 'auto' });
            } catch {
              resultStr = m.format(result, { notation: 'auto' });
            }
          }

          const isBad = (() => {
            if (result == null) return true;
            if (typeof result === 'number') return !isFinite(result) || Number.isNaN(result);
            if (result && typeof result.isNaN === 'function' && result.isNaN()) return true;
            if (result && typeof result.isFinite === 'function' && !result.isFinite()) return true;
            const s = String(resultStr || '');
            if (/^(?:NaN|Infinity|undefined|-?Infinity)$/i.test(s)) return true;
            if (s.includes('NaN') || s.includes('Infinity')) return true;
            return false;
          })();
          if (isBad) {
            if (process.send) process.send({ type: 'silly' });
            return;
          }
           
            lastApprox = resultStr;
            if (process.send) process.send({ type: 'result', result: resultStr, resultRaw: resultStr, meta });
          } catch (err) {
            if (process.send) process.send({ type: 'error', error: String(err && err.message ? err.message : err) });
          }
        } else if (msg.cmd === 'shorten') {
          try {
            const rawExpr = String(msg.expr || '');
            const expr = normalizeExpression(rawExpr);
            const cfg = { number: 'BigNumber', precision: 40 };
            const m = math.create(math.all, cfg);
            if (lastApprox) {
              if (process.send) process.send({ type: 'short', short: lastApprox });
              return;
            }
            const fast = m.evaluate(expr);
            let fastStr;
            try {
              fastStr = fast && typeof fast.toString === 'function' ? fast.toString() : m.format(fast, { notation: 'auto' });
            } catch {
              fastStr = m.format(fast, { notation: 'auto' });
            }


            if (/\bNaN\b|Infinity|undefined/.test(String(fastStr || ''))) {
              if (process.send) process.send({ type: 'silly' });
              return;
            }
            
            if (process.send) process.send({ type: 'short', short: fastStr });
          } catch (e) {
            if (process.send) process.send({ type: 'short', short: lastApprox || 'too big' });
          }
        }
      } catch (e) {
        if (process.send) process.send({ type: 'error', error: String(e) });
      }
    });
 
    process.on('disconnect', () => process.exit(0));
    return;
  }
 
  module.exports = {
    data: new SlashCommandBuilder()
      .setName('math')
      .setDescription('Do math')
      .setIntegrationTypes([0, 1])
      .setContexts([0, 1, 2])
      .addStringOption(opt => opt.setName('problem').setDescription('the thing you\'re too lazy to solve yourself').setRequired(true))
      .addStringOption(opt => opt
        .setName('format')
        .setDescription('Output style')
        .addChoices(
          { name: 'Formatted (Short, use letters)', value: 'short' },
          { name: 'Formatted (Use commas to separate numbers)', value: 'commas' },
          { name: 'Raw (Just raw number)', value: 'raw' }
        )
        .setRequired(false)
      ),
 
     async execute(interaction) {
       const exprRaw = interaction.options.getString('problem', true);
      const format = interaction.options.getString('format') || 'commas';

    
      try {
        const normalized = normalizeExpression(exprRaw);
        if (isSafeSimpleExpr(normalized)) {
          const val = simpleEvaluate(normalized);
          if (typeof val === 'number') {
            let raw = String(val);
            let display;
            if (format === 'raw') {
              display = /[eE]/.test(raw) ? expandExponentialIfShort(raw, 100) : raw.replace(/,/g, '');
            } else if (format === 'commas') {
              display = formatWithCommas(raw);
            } else {
              display = formatShortNumber(raw);
            }
            
            await interaction.reply(`Result is: ${display}`);
            return;
          }
        }
      } catch (e) {
        
      }

    await interaction.deferReply();
 
    const child = fork(__filename, [], { env: { ...process.env, MATH_CHILD: '1' }, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
 
    let replied = false;
    let finishTimer = null;
    let memPoll = null;
    let killed = false;
 
   
    function readRss(pid) {
      return new Promise((res) => {
        if (!pid) return res(0);
        execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 500 }, (err, stdout) => {
          if (err || !stdout) return res(0);
          const v = parseInt(stdout.trim(), 10);
          if (isNaN(v)) return res(0);
          return res(v * 1024);
        });
      });
    }
 
    async function checkMemoryAndAct() {
      try {
        const rss = await readRss(child.pid);
        if (rss && rss > MemoryLimit && !killed) {
          killed = true;
          child.send({ cmd: 'shorten', expr: exprRaw });
          setTimeout(async () => {
            if (replied) return;
            try { child.kill('SIGKILL'); } catch {}
            replied = true;
            await interaction.editReply(`Result is: N/A`).catch(()=>{});
          }, 800);
        }
      } catch (e) {}
    }
 
    child.on('message', async (msg) => {
      try {
        if (!msg) return;
        if (msg.type === 'mem') return;

        if (msg.type === 'silly') {
          if (replied) return;
          replied = true;
          clearTimeout(finishTimer);
          clearInterval(memPoll);
          await interaction.editReply(`Don't be silly!`).catch(()=>{});
          try { child.kill('SIGKILL'); } catch {}
          return;
        }
 
        if (msg.type === 'result') {
          if (replied) return;
          replied = true;
          clearTimeout(finishTimer);
          clearInterval(memPoll);
          const raw = String(msg.resultRaw ?? msg.result ?? '');
 
 
          if (msg.meta && msg.meta.isPi) {
            const trimmed = raw.slice(0, 100);
            await interaction.editReply(`Result is: ${trimmed}`).catch(()=>{});
            try { child.kill('SIGKILL'); } catch {}
            return;
          }
 
         
          if (format === 'raw') {
            if (/[eE]/.test(raw)) {
              const expanded = expandExponentialIfShort(raw, 100);
              display = expanded;
            } else {
              display = raw.replace(/,/g, '');
            }
          } else if (format === 'commas') {
            display = formatWithCommas(raw);
          } else {
            display = formatShortNumber(raw);
          }
 
          await interaction.editReply(`Result is: ${display}`).catch(()=>{});
          try { child.kill('SIGKILL'); } catch {}
          return;
        }
 
        if (msg.type === 'short') {
          if (replied) return;
          replied = true;
          clearTimeout(finishTimer);
          clearInterval(memPoll);
          const raw = String(msg.short ?? msg.result ?? '');
          let displayShort;
          if (format === 'raw') {
            displayShort = /[eE]/.test(raw) ? expandExponentialIfShort(raw, 100) : raw.replace(/,/g,'');
          } else if (format === 'commas') {
            displayShort = formatWithCommas(raw);
          } else {
            displayShort = formatShortNumber(raw);
          }
          await interaction.editReply(`Result is: ${displayShort}`).catch(()=>{});
          try { child.kill('SIGKILL'); } catch {}
          return;
        }
 
        if (msg.type === 'error') {
          if (replied) return;
          replied = true;
          clearTimeout(finishTimer);
          clearInterval(memPoll);
          await interaction.editReply(`Result is: N/A`).catch(()=>{});
          try { child.kill('SIGKILL'); } catch {}
          return;
        }
      } catch (e) {}
    });
 
    child.on('error', async (err) => {
      if (!replied) {
        replied = true;
        clearTimeout(finishTimer);
        clearInterval(memPoll);
        await interaction.editReply(`Result is: N/A`).catch(()=>{});
        try { child.kill('SIGKILL'); } catch {}
      }
    });
 
    child.on('exit', (code) => {
      clearTimeout(finishTimer);
      clearInterval(memPoll);
      if (!replied) {
        replied = true;
        interaction.editReply('Result is: N/A').catch(()=>{});
      }
    });
 
    child.send({ cmd: 'eval', expr: exprRaw });
 
    memPoll = setInterval(checkMemoryAndAct, 500);
 
    finishTimer = setTimeout(() => {
      if (replied) return;
      killed = true;
      try { child.send({ cmd: 'shorten', expr: exprRaw }); } catch {}
      setTimeout(async () => {
        if (!replied) {
          replied = true;
          try { child.kill('SIGKILL'); } catch {}
          await interaction.editReply(`Result is: N/A`).catch(()=>{});
        }
      }, 900);
    }, TimeLimitMs);
  }
};