'use strict';

(function () {

  // ── Bundled sets data (set name lowercase → set code uppercase) ──────────
  const BUNDLED_SETS = {
    // ── Core sets ──────────────────────────────────────────────
    'limited edition alpha':                  'LEA',
    'limited edition beta':                   'LEB',
    'unlimited edition':                      '2ED',
    'revised edition':                        '3ED',
    'fourth edition':                         '4ED',
    'fifth edition':                          '5ED',
    'classic sixth edition':                  '6ED',
    'seventh edition':                        '7ED',
    'eighth edition':                         '8ED',
    'ninth edition':                          '9ED',
    'tenth edition':                          '10E',
    'magic 2010':                             'M10',
    'magic 2011':                             'M11',
    'magic 2012':                             'M12',
    'magic 2013':                             'M13',
    'magic 2014 core set':                    'M14',
    'magic 2015 core set':                    'M15',
    'magic origins':                          'ORI',
    'core set 2019':                          'M19',
    'core set 2020':                          'M20',
    'core set 2021':                          'M21',
    'magic: the gathering foundations':       'FDN',

    // ── Old expansions ─────────────────────────────────────────
    'arabian nights':                         'ARN',
    'antiquities':                            'ATQ',
    'legends':                                'LEG',
    'the dark':                               'DRK',
    'fallen empires':                         'FEM',
    'ice age':                                'ICE',
    'homelands':                              'HML',
    'alliances':                              'ALL',
    'mirage':                                 'MIR',
    'visions':                                'VIS',
    'weatherlight':                           'WTH',
    'tempest':                                'TMP',
    'stronghold':                             'STH',
    'exodus':                                 'EXO',
    "urza's saga":                            'USG',
    "urza's legacy":                          'ULG',
    "urza's destiny":                         'UDS',
    'mercadian masques':                      'MMQ',
    'nemesis':                                'NMS',
    'prophecy':                               'PCY',
    'invasion':                               'INV',
    'planeshift':                             'PLS',
    'apocalypse':                             'APC',
    'odyssey':                                'ODY',
    'torment':                                'TOR',
    'judgment':                               'JUD',
    'onslaught':                              'ONS',
    'legions':                                'LGN',
    'scourge':                                'SCG',
    'mirrodin':                               'MRD',
    'darksteel':                              'DST',
    'fifth dawn':                             '5DN',
    'champions of kamigawa':                  'CHK',
    'betrayers of kamigawa':                  'BOK',
    'saviors of kamigawa':                    'SOK',
    'ravnica: city of guilds':                'RAV',
    'guildpact':                              'GPT',
    'dissension':                             'DIS',
    'coldsnap':                               'CSP',
    'time spiral':                            'TSP',
    'planar chaos':                           'PLC',
    'future sight':                           'FUT',
    'lorwyn':                                 'LRW',
    'morningtide':                            'MOR',
    'shadowmoor':                             'SHM',
    'eventide':                               'EVE',
    'shards of alara':                        'ALA',
    'conflux':                                'CON',
    'alara reborn':                           'ARB',
    'zendikar':                               'ZEN',
    'worldwake':                              'WWK',
    'rise of the eldrazi':                    'ROE',
    'scars of mirrodin':                      'SOM',
    'mirrodin besieged':                      'MBS',
    'new phyrexia':                           'NPH',
    'innistrad':                              'ISD',
    'dark ascension':                         'DKA',
    'avacyn restored':                        'AVR',
    'return to ravnica':                      'RTR',
    'gatecrash':                              'GTC',
    "dragon's maze":                          'DGM',
    'theros':                                 'THS',
    'born of the gods':                       'BNG',
    'journey into nyx':                       'JOU',
    'khans of tarkir':                        'KTK',
    'fate reforged':                          'FRF',
    'dragons of tarkir':                      'DTK',
    'battle for zendikar':                    'BFZ',
    'oath of the gatewatch':                  'OGW',
    'shadows over innistrad':                 'SOI',
    'eldritch moon':                          'EMN',
    'kaladesh':                               'KLD',
    'aether revolt':                          'AER',
    'amonkhet':                               'AKH',
    'hour of devastation':                    'HOU',
    'ixalan':                                 'XLN',
    'rivals of ixalan':                       'RIX',
    'dominaria':                              'DOM',
    'guilds of ravnica':                      'GRN',
    'ravnica allegiance':                     'RNA',
    'war of the spark':                       'WAR',
    'throne of eldraine':                     'ELD',
    'theros beyond death':                    'THB',
    'ikoria: lair of behemoths':              'IKO',
    'zendikar rising':                        'ZNR',
    'kaldheim':                               'KHM',
    'strixhaven: school of mages':            'STX',
    'adventures in the forgotten realms':     'AFR',
    'innistrad: midnight hunt':               'MID',
    'innistrad: crimson vow':                 'VOW',
    'kamigawa: neon dynasty':                 'NEO',
    'streets of new capenna':                 'SNC',
    'dominaria united':                       'DMU',
    "the brothers' war":                      'BRO',
    'phyrexia: all will be one':              'ONE',
    'march of the machine':                   'MOM',
    'march of the machine: the aftermath':    'MAT',
    'wilds of eldraine':                      'WOE',
    'the lost caverns of ixalan':             'LCI',
    'murders at karlov manor':                'MKM',
    'outlaws of thunder junction':            'OTJ',
    'bloomburrow':                            'BLB',
    'duskmourn: house of horror':             'DSK',
    'foundations':                            'FDN',
    'aetherdrift':                            'AEI',
    'tarkir: dragonstorm':                    'TDM',

    // ── Masters / Reprint sets ──────────────────────────────────
    'modern masters':                         'MMA',
    'modern masters 2015 edition':            'MM2',
    'modern masters 2017 edition':            'MM3',
    'iconic masters':                         'IMA',
    'masters 25':                             'A25',
    'ultimate masters':                       'UMA',
    'double masters':                         '2XM',
    'double masters 2022':                    '2X2',
    'eternal masters':                        'EMA',
    'time spiral remastered':                 'TSR',
    'innistrad: double feature':              'DBL',
    'dominaria remastered':                   'DMR',
    'ravnica remastered':                     'RVR',

    // ── Conspiracy ─────────────────────────────────────────────
    'conspiracy':                             'CNS',
    'conspiracy: take the crown':             'CN2',

    // ── Commander ──────────────────────────────────────────────
    'commander 2011':                         'CMD',
    'commander 2013':                         'C13',
    'commander 2014':                         'C14',
    'commander 2015':                         'C15',
    'commander 2016':                         'C16',
    'commander 2017':                         'C17',
    'commander 2018':                         'C18',
    'commander 2019':                         'C19',
    'commander 2020':                         'C20',
    'commander 2021':                         'C21',
    'commander anthology':                    'CMA',
    'commander anthology volume ii':          'CM2',
    'commander legends':                      'CMR',
    'commander legends: battle for baldur\'s gate': 'CLB',
    'the lord of the rings: tales of middle-earth commander': 'LTC',
    'commander masters':                      'CMM',
    "doctor who":                             'WHO',
    'murders at karlov manor commander':      'MKC',
    'outlaws of thunder junction commander':  'OTC',
    'bloomburrow commander':                  'BLC',
    'duskmourn: house of horror commander':   'DSC',
    'foundations commander':                  'FDC',

    // ── Special / Supplemental ─────────────────────────────────
    'the lord of the rings: tales of middle-earth': 'LTR',
    'the list':                               'LIST',
    'mystery booster':                        'MB1',
    'mystery booster 2':                      'MB2',
    'jumpstart':                              'JMP',
    'jumpstart 2022':                         'J22',
    'foundations jumpstart':                  'FJB',
    'historic anthology 1':                   'HA1',
    'historic anthology 2':                   'HA2',
    'historic anthology 3':                   'HA3',
    'historic anthology 4':                   'HA4',
    'historic anthology 5':                   'HA5',
    'pioneer masters':                        'PIO',
    'starter commander decks':                'SCD',
    'special guests':                         'SPG',
    'breaking news':                          'OTP',
    'the big score':                          'BIG',

    // ── Promo / Misc ───────────────────────────────────────────
    'prerelease cards':                       'PTC',
    'judge gift cards':                       'JGP',
    'world championship decks':               'WC',
    'anthologies':                            'ATH',
    'battle royale box set':                  'BRB',
    'beatdown box set':                       'BTD',
    'deckmasters':                            'DKM',
    'portal':                                 'POR',
    'portal second age':                      'P02',
    'portal three kingdoms':                  'PTK',
    'starter 1999':                           'S99',
    'starter 2000':                           'S00',
    'unglued':                                'UGL',
    'unhinged':                               'UNH',
    'unstable':                               'UST',
    'unsanctioned':                           'UND',
    'unfinity':                               'UNF',
  };

  // ── Set converter (Scryfall API + bundled fallback) ──────────────────────
  const SCRYFALL_SETS_URL = 'https://api.scryfall.com/sets';

  /** @type {Map<string, string> | null} */
  let _setsCache = null;

  async function loadSets() {
    if (_setsCache) return _setsCache;

    _setsCache = new Map(Object.entries(BUNDLED_SETS));

    try {
      const res = await fetch(SCRYFALL_SETS_URL, {
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        throw new Error(`Scryfall API returned status ${res.status}`);
      }

      const json = await res.json();

      for (const set of json.data) {
        _setsCache.set(set.name.toLowerCase(), set.code.toUpperCase());
      }
    } catch {
      // Network unavailable or Scryfall unreachable – bundled list is sufficient.
    }

    return _setsCache;
  }

  function _matchCandidate(map, candidate) {
    if (map.has(candidate)) {
      return map.get(candidate);
    }
    let bestCode = null;
    let bestLen = 0;
    for (const [name, code] of map) {
      if (
        (candidate.includes(name) || name.includes(candidate)) &&
        name.length > bestLen
      ) {
        bestCode = code;
        bestLen = name.length;
      }
    }
    return bestCode;
  }

  async function convertSetName(setName, cardName) {
    const map = await loadSets();
    const normalized = setName.toLowerCase().trim();

    // 1. Exact match
    if (map.has(normalized)) {
      return map.get(normalized);
    }

    // 2. Commander format heuristics (runs before general partial matching to avoid
    //    matching the base set instead of the Commander variant)
    if (/^commander:/i.test(setName)) {
      const colonIdx = setName.indexOf(':');
      const nameAfterCommander = setName.slice(colonIdx + 1).trim();
      if (nameAfterCommander) {
        const candidates = [
          `${nameAfterCommander} Commander`.toLowerCase(),
          `${nameAfterCommander.replace(/[^a-z0-9 ]/gi, ' ').replace(/  +/g, ' ').trim()} Commander`.toLowerCase(),
        ];
        for (const candidate of candidates) {
          const code = _matchCandidate(map, candidate);
          if (code) return code;
        }
      }
    }

    // 3. Partial match – prefer longer set names to reduce false positives
    const partialCode = _matchCandidate(map, normalized);
    if (partialCode) return partialCode;

    // 4. Scryfall card prints lookup
    if (cardName) {
      try {
        const encodedQuery = encodeURIComponent(`!"${cardName}"`);
        const url = `https://api.scryfall.com/cards/search?q=${encodedQuery}&unique=prints`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const json = await res.json();
          for (const card of json.data) {
            const printSetName = card.set_name.toLowerCase().trim();
            if (
              printSetName === normalized ||
              normalized.includes(printSetName) ||
              printSetName.includes(normalized)
            ) {
              return card.set.toUpperCase();
            }
          }
        }
      } catch {
        // Scryfall unreachable or card not found – fall through
      }
    }

    // 5. No match – return original value
    return setName;
  }

  // ── Parser ───────────────────────────────────────────────────────────────

  function parseCondition(text) {
    if (!text) return { condition: 'Near Mint', foil: false };

    const foil = /foil/i.test(text);
    const cleaned = text.replace(/foil/i, '').trim().toLowerCase();

    const map = [
      [/^nm\b|near\s*mint/, 'Near Mint'],
      [/^lp\b|lightly\s*played/, 'Lightly Played'],
      [/^mp\b|moderately\s*played/, 'Moderately Played'],
      [/^hp\b|heavily\s*played/, 'Heavily Played'],
      [/^d\b|damaged/, 'Damaged'],
    ];

    for (const [re, label] of map) {
      if (re.test(cleaned)) return { condition: label, foil };
    }

    return { condition: 'Near Mint', foil };
  }

  function looksLikeSetName(text) {
    if (!text || text.length === 0 || text.length > 80) return false;
    if (/\t/.test(text)) return false;
    if (/^\$[\d.]+/.test(text)) return false;
    if (/^(Near Mint|Lightly Played|Moderately Played|Heavily Played|Damaged|NM|LP|MP|HP)\b/i.test(text)) return false;
    if (/^(English|French|German|Spanish|Italian|Portuguese|Japanese|Korean|Chinese)\b/i.test(text)) return false;
    if (/^\d+$/.test(text)) return false;
    if (/^Rarity:/i.test(text)) return false;
    if (/^Condition:/i.test(text)) return false;
    if (/^Sold by\b/i.test(text)) return false;
    return true;
  }

  function isRarityLine(text) {
    return /^Rarity:/i.test(text);
  }

  function isSoldByLine(text) {
    return /^Sold by\b/i.test(text);
  }

  function parseConditionLine(text) {
    const re = /^Condition:\s+(.+?)\s+\$([\d.]+)\s+(\d+)$/i;
    const m = text.match(re);
    if (!m) return null;
    const { condition, foil } = parseCondition(m[1].trim());
    const price = parseFloat(m[2]);
    const quantity = parseInt(m[3], 10);
    return { condition, foil, price, quantity };
  }

  function parseSingleLine(line) {
    const bracketRe = /^(?:(\d+)\s*[xX]\s*)?(.+?)\s*\[(.+?)\](?:\s+(.+?))?$/;
    const bm = line.match(bracketRe);
    if (bm) {
      const { condition, foil } = parseCondition(bm[4] || '');
      return {
        quantity: bm[1] ? parseInt(bm[1], 10) : 1,
        name: bm[2].trim(),
        setName: bm[3].trim(),
        condition,
        foil,
      };
    }

    const dashRe = /^(\d+)\s*[xX]?\s*(.+?)\s+-\s+(.+?)(?:\s+-\s+(.+?))?$/;
    const dm = line.match(dashRe);
    if (dm) {
      const conditionStr = dm[4] || '';
      const { condition, foil } = parseCondition(conditionStr);
      if (!dm[3].trim().match(/^\$[\d.]+$/)) {
        return {
          quantity: parseInt(dm[1], 10),
          name: dm[2].trim(),
          setName: dm[3].trim(),
          condition,
          foil,
        };
      }
    }

    return null;
  }

  function parseMultiLine(cardLine, setLine) {
    if (!looksLikeSetName(setLine)) return null;
    if (/\[/.test(setLine)) return null;
    if (/^\$[\d.]+/.test(cardLine)) return null;
    if (/\t/.test(cardLine)) return null;

    const qtyPrefixRe = /^(\d+)\s*[xX]\s*(.+)$/;
    const qm = cardLine.match(qtyPrefixRe);

    const quantity = qm ? parseInt(qm[1], 10) : 1;
    const name = qm ? qm[2].trim() : cardLine.trim();

    return {
      quantity,
      name,
      setName: setLine.trim(),
      condition: 'Near Mint',
      foil: false,
    };
  }

  function parseExtendedMultiLineBlock(lines, startIdx) {
    if (startIdx + 2 >= lines.length) return null;

    const cardLine = lines[startIdx];

    if (/^\$[\d.]+/.test(cardLine)) return null;
    if (isRarityLine(cardLine)) return null;
    if (isSoldByLine(cardLine)) return null;
    if (parseConditionLine(cardLine)) return null;
    if (/\t/.test(cardLine)) return null;

    let setLineIdx = startIdx + 1;
    if (lines[setLineIdx] === cardLine) {
      setLineIdx = startIdx + 2;
      if (setLineIdx >= lines.length) return null;
    }

    const setLine = lines[setLineIdx];

    if (!looksLikeSetName(setLine)) return null;
    if (/\[/.test(setLine)) return null;

    let j = setLineIdx + 1;

    while (j < lines.length && isSoldByLine(lines[j])) {
      j++;
    }

    while (j < lines.length && isRarityLine(lines[j])) {
      j++;
    }

    if (j >= lines.length) return null;
    const condData = parseConditionLine(lines[j]);
    if (!condData) return null;

    let consumed = j - startIdx + 1;

    while (startIdx + consumed < lines.length && isSoldByLine(lines[startIdx + consumed])) {
      consumed++;
    }

    return {
      card: {
        quantity: condData.quantity,
        name: cardLine.trim(),
        setName: setLine.trim(),
        condition: condData.condition,
        foil: condData.foil,
        price: condData.price,
      },
      consumed,
    };
  }

  function parseLines(text) {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const cards = [];
    let i = 0;

    while (i < lines.length) {
      const single = parseSingleLine(lines[i]);
      if (single) {
        cards.push(single);
        i += 1;
        continue;
      }

      const extended = parseExtendedMultiLineBlock(lines, i);
      if (extended) {
        cards.push(extended.card);
        i += extended.consumed;
        continue;
      }

      if (i + 1 < lines.length) {
        const multi = parseMultiLine(lines[i], lines[i + 1]);
        if (multi) {
          cards.push(multi);
          i += 2;
          continue;
        }
      }

      i += 1;
    }

    return cards;
  }

  // ── Card validator (Scryfall collection API) ─────────────────────────────

  const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
  const VALIDATOR_BATCH_SIZE = 75;
  const _validatorCache = new Map();

  function normalizeCardName(name) {
    return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  async function _validateBatch(keys) {
    const identifiers = keys.map((k) => ({ name: k }));
    try {
      const res = await fetch(SCRYFALL_COLLECTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Scryfall returned ${res.status}`);
      const json = await res.json();
      const notFoundKeys = new Set(
        (json.not_found || []).map((nf) => (nf.name || '').toLowerCase()).filter(Boolean)
      );
      for (const k of keys) {
        _validatorCache.set(k, !notFoundKeys.has(k));
      }
    } catch {
      for (const k of keys) {
        if (!_validatorCache.has(k)) {
          _validatorCache.set(k, true);
        }
      }
    }
  }

  async function validateCardNames(names) {
    const normalizedNames = names.map(normalizeCardName);
    const uncachedKeys = [
      ...new Set(
        normalizedNames.map((n) => n.toLowerCase()).filter((k) => !_validatorCache.has(k))
      ),
    ];
    if (uncachedKeys.length > 0) {
      const batches = [];
      for (let i = 0; i < uncachedKeys.length; i += VALIDATOR_BATCH_SIZE) {
        batches.push(uncachedKeys.slice(i, i + VALIDATOR_BATCH_SIZE));
      }
      await Promise.all(batches.map((batch) => _validateBatch(batch)));
    }
    const result = new Map();
    for (let i = 0; i < names.length; i++) {
      const key = normalizedNames[i].toLowerCase();
      result.set(names[i], _validatorCache.get(key) ?? true);
    }
    return result;
  }

  // ── CSV formatter ────────────────────────────────────────────────────────

  function csvField(value) {
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function formatToCSV(cards) {
    const header = 'Count,Name,Edition,Condition,Language,Foil,Purchase Price';
    const rows = cards.map((c) => {
      const foilValue = c.foil ? 'foil' : '';
      const priceValue = c.price != null ? c.price.toFixed(2) : '';
      return [
        c.quantity,
        csvField(c.name),
        csvField(c.setCode),
        csvField(c.condition),
        'English',
        foilValue,
        priceValue,
      ].join(',');
    });
    return [header, ...rows].join('\n');
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  const rawInput      = document.getElementById('raw-input');
  const convertBtn    = document.getElementById('convert-btn');
  const clearBtn      = document.getElementById('clear-btn');
  const errorMsg      = document.getElementById('error-msg');
  const outputSection = document.getElementById('output-section');
  const csvOutput     = document.getElementById('csv-output');
  const copyBtn       = document.getElementById('copy-btn');
  const downloadBtn   = document.getElementById('download-btn');
  const cardCount     = document.getElementById('card-count');

  // ── Convert ─────────────────────────────────────────────────
  convertBtn.addEventListener('click', async () => {
    const text = rawInput.value.trim();
    if (!text) {
      showError('Please paste some order text before converting.');
      return;
    }

    hideError();
    setLoading(true);

    try {
      const parsed = parseLines(text);

      if (parsed.length === 0) {
        showError('No cards could be parsed from the provided text. Please check the format.');
        return;
      }

      const resolved = await Promise.all(
        parsed.map(async (card) => ({
          ...card,
          setCode: await convertSetName(card.setName, card.name),
        }))
      );

      const validityMap = await validateCardNames(resolved.map((c) => c.name));
      const cards = resolved.filter((c) => validityMap.get(c.name) !== false);

      if (cards.length === 0) {
        showError('No cards could be parsed from the provided text. Please check the format.');
        return;
      }

      const csv = formatToCSV(cards);

      csvOutput.value = csv;
      const total = cards.reduce((sum, c) => sum + c.quantity, 0);
      cardCount.textContent = `${cards.length} unique card${cards.length !== 1 ? 's' : ''} · ${total} total cop${total !== 1 ? 'ies' : 'y'}`;
      outputSection.hidden = false;
      outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError('An unexpected error occurred during conversion.');
    } finally {
      setLoading(false);
    }
  });

  // ── Clear ────────────────────────────────────────────────────
  clearBtn.addEventListener('click', () => {
    rawInput.value = '';
    csvOutput.value = '';
    outputSection.hidden = true;
    hideError();
    rawInput.focus();
  });

  // ── Copy CSV ─────────────────────────────────────────────────
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(csvOutput.value);
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    } catch {
      csvOutput.select();
      document.execCommand('copy');
    }
  });

  // ── Download CSV ─────────────────────────────────────────────
  downloadBtn.addEventListener('click', () => {
    const blob = new Blob([csvOutput.value], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'tcg-order.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Helpers ──────────────────────────────────────────────────
  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
  }

  function hideError() {
    errorMsg.hidden = true;
    errorMsg.textContent = '';
  }

  function setLoading(loading) {
    convertBtn.disabled = loading;
    if (loading) {
      convertBtn.classList.add('loading');
    } else {
      convertBtn.classList.remove('loading');
    }
  }

})();
