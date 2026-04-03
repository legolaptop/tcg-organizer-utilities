'use strict';

(function () {
  const rawInput    = document.getElementById('raw-input');
  const convertBtn  = document.getElementById('convert-btn');
  const clearBtn    = document.getElementById('clear-btn');
  const errorMsg    = document.getElementById('error-msg');
  const outputSection = document.getElementById('output-section');
  const csvOutput   = document.getElementById('csv-output');
  const copyBtn     = document.getElementById('copy-btn');
  const downloadBtn = document.getElementById('download-btn');
  const cardCount   = document.getElementById('card-count');
  const fileInput   = document.getElementById('file-input');
  const parseFilesBtn = document.getElementById('parse-files-btn');

  const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file

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
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError(data.error || 'An unexpected error occurred.');
        return;
      }

      csvOutput.value = data.csv;
      const total = data.cards.reduce((sum, c) => sum + c.quantity, 0);
      cardCount.textContent = `${data.cards.length} unique card${data.cards.length !== 1 ? 's' : ''} · ${total} total cop${total !== 1 ? 'ies' : 'y'}`;
      outputSection.hidden = false;
      outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError('Network error – is the server running?');
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
      // Fallback for older browsers
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

  // ── Parse uploaded order-history files ───────────────────────

  // Patterns used to detect TCGPlayer order-history content in uploaded files.
  const TCG_CONTENT_PATTERNS = [
    /orderHistoryItems/i,
    /div-sellerorderwidget/i,
    /class="orderWrap"/i,
    /tcgplayer\.com\/product\/\d+/i,
  ];

  /**
   * Returns true if the file text contains at least one marker that strongly
   * suggests TCGPlayer order-history HTML.  Used to reject obviously wrong files
   * before running the full parser.
   *
   * @param {string} text
   * @returns {boolean}
   */
  function hasExpectedTcgPlayerContent(text) {
    return TCG_CONTENT_PATTERNS.some(re => re.test(text));
  }

  /**
   * Extract plain text from an HTML string by discarding all tag content.
   * Iterates character-by-character to correctly handle any tag nesting.
   * @param {string} html
   * @returns {string}
   */
  function stripTags(html) {
    const out = [];
    let inTag = false;
    for (let i = 0; i < html.length; i++) {
      if (html[i] === '<') { inTag = true; continue; }
      if (html[i] === '>') { inTag = false; continue; }
      if (!inTag) out.push(html[i]);
    }
    return out.join('');
  }

  /**
   * Parse a TCGPlayer order-history HTML table into an array of card items.
   *
   * Accepts the raw HTML string of an order page (or full .mht/.mhtml body).
   * Locates rows inside <table class="orderTable"> elements and extracts
   * per-card details from the orderHistoryItems, orderHistoryDetail,
   * orderHistoryPrice, and orderHistoryQuantity cells.
   *
   * @param {string} htmlText - Raw HTML string.
   * @returns {Array<{
   *   tcgplayerId: string|null,
   *   title: string|null,
   *   setName: string|null,
   *   quantity: number,
   *   condition: string|null,
   *   foil: boolean,
   *   unitPrice: number|null,
   *   totalPrice: number|null,
   *   rarity: string|null
   * }>}
   */
  function parseOrderTableHtml(htmlText) {
    if (!htmlText) return [];

    const items = [];
    const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;

    while ((trMatch = trRegex.exec(htmlText)) !== null) {
      const rowHtml = trMatch[1];
      if (!rowHtml.includes('orderHistoryItems')) continue;

      const item = {
        tcgplayerId: null,
        title: null,
        setName: null,
        quantity: 1,
        condition: null,
        foil: false,
        unitPrice: null,
        totalPrice: null,
        rarity: null,
      };

      // tcgplayerId: prefer data-original, fall back to src, then anchor href.
      const imgDataOrig = rowHtml.match(/data-original="[^"]*\/product\/(\d+)_/i);
      if (imgDataOrig) {
        item.tcgplayerId = imgDataOrig[1];
      } else {
        const imgSrc = rowHtml.match(/src="[^"]*\/product\/(\d+)_/i);
        if (imgSrc) item.tcgplayerId = imgSrc[1];
      }
      if (!item.tcgplayerId) {
        const hrefMatch = rowHtml.match(/href="[^"]*\/product\/(\d+)(?!\d)/i);
        if (hrefMatch) item.tcgplayerId = hrefMatch[1];
      }

      // title: from <a> title attribute or inner text.
      const aTitleAttr = rowHtml.match(/<a\b[^>]+\btitle="([^"]+)"/i);
      if (aTitleAttr) {
        item.title = aTitleAttr[1].trim();
      } else {
        const aText = rowHtml.match(/<a\b[^>]+class="nocontext"[^>]*>([\s\S]*?)<\/a>/i);
        if (aText) item.title = stripTags(aText[1]).trim() || null;
      }

      // setName: text after <br> inside the anchor's parent <span>.
      const spanMatch = rowHtml.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
      if (spanMatch) {
        const parts = spanMatch[1].split(/<br\s*\/?>/i);
        if (parts.length >= 2) {
          const rawSet = stripTags(parts[parts.length - 1]).trim();
          item.setName = rawSet || null;
        }
      }

      // rarity / condition / foil from orderHistoryDetail.
      const detailMatch = rowHtml.match(/<td\b[^>]*class="orderHistoryDetail"[^>]*>([\s\S]*?)<\/td>/i);
      if (detailMatch) {
        const detailText = detailMatch[1].replace(/<br\s*\/?>/gi, '\n');
        const lines = stripTags(detailText).split('\n').map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (/^rarity\s*:/i.test(line)) {
            item.rarity = line.split(':').slice(1).join(':').trim() || null;
          } else if (/^condition\s*:/i.test(line)) {
            let cond = line.split(':').slice(1).join(':').trim();
            if (/\bfoil\b/i.test(cond)) {
              item.foil = true;
              cond = cond.replace(/\bfoil\b/gi, '').trim();
            }
            item.condition = cond || null;
          }
        }
      }

      // unitPrice from orderHistoryPrice.
      const priceMatch = rowHtml.match(/<td\b[^>]*class="orderHistoryPrice"[^>]*>([\s\S]*?)<\/td>/i);
      if (priceMatch) {
        const priceText = stripTags(priceMatch[1]).trim();
        const numMatch = priceText.match(/\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/);
        if (numMatch) {
          const parsed = parseFloat(numMatch[1].replace(/,/g, ''));
          if (!isNaN(parsed)) item.unitPrice = parsed;
        }
      }

      // quantity from orderHistoryQuantity.
      const qtyMatch = rowHtml.match(/<td\b[^>]*class="orderHistoryQuantity"[^>]*>([\s\S]*?)<\/td>/i);
      if (qtyMatch) {
        const qtyText = stripTags(qtyMatch[1]).trim();
        const num = parseInt(qtyText, 10);
        if (!isNaN(num) && num > 0) item.quantity = num;
      }

      // totalPrice computed from unitPrice * quantity.
      if (item.unitPrice !== null) {
        item.totalPrice = parseFloat((item.unitPrice * item.quantity).toFixed(2));
      }

      // Skip rows with no identifiable product id AND no price (likely malformed).
      if (item.tcgplayerId === null && item.unitPrice === null) continue;

      items.push(item);
    }

    return items;
  }

  /**
   * Extract TCGPlayer product IDs from file text content.
   * Returns Map<id, count>.
   */
  function extractTcgplayerIdsFromText(text) {
    const idCounts = new Map();
    if (!text) return idCounts;

    // Matches both full URLs (tcgplayer.com/product/123456) and
    // relative paths (/product/123456) in a single pass to avoid double-counting.
    const regex = /(?:tcgplayer\.com)?\/product\/(\d+)(?!\d)/gi;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const id = m[1];
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }

    return idCounts;
  }

  /**
   * Fetch Scryfall card data for a single TCGPlayer product id.
   * Returns card data object or null on failure.
   */
  async function fetchScryfallByTcgplayerId(tcgId) {
    try {
      const res = await fetch(`https://api.scryfall.com/cards/tcgplayer/${tcgId}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return {
        id: tcgId,
        name: json.name,
        setCode: (json.set || '').toUpperCase(),
        setName: json.set_name || '',
        collectorNumber: json.collector_number || '',
        rarity: json.rarity || '',
        scryfallId: json.id || '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Concurrency-limited runner for fetching Scryfall results.
   * Returns Map<id, cardData|null>.
   */
  async function fetchAllScryfall(ids, concurrency = 6) {
    const results = new Map();
    const idArr = Array.from(ids);
    let cursor = 0;

    async function worker() {
      while (cursor < idArr.length) {
        const i = cursor++;
        const id = idArr[i];
        const card = await fetchScryfallByTcgplayerId(id);
        results.set(id, card);
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, idArr.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return results;
  }

  parseFilesBtn.addEventListener('click', async () => {
    const files = fileInput.files;
    if (!files || files.length === 0) {
      showError('Please select one or more files to parse.');
      return;
    }

    // Validate file sizes before reading.
    const fileArr = Array.from(files);
    const oversized = fileArr.find(f => f.size > MAX_FILE_BYTES);
    if (oversized) {
      showError(`"${oversized.name}" exceeds the 50 MB limit. Please upload a smaller file.`);
      return;
    }

    hideError();
    setLoading(true);
    parseFilesBtn.disabled = true;

    try {
      const reads = fileArr.map(
        (f) =>
          new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result || ''));
            r.onerror = () => resolve('');
            r.readAsText(f);
          })
      );

      const texts = await Promise.all(reads);

      // Validate that at least one file contains recognizable TCGPlayer content.
      const validTexts = texts.filter(t => hasExpectedTcgPlayerContent(t));
      if (validTexts.length === 0) {
        showError(
          'No TCGPlayer order history could be found in the uploaded file(s). ' +
          'Please upload an MHT or HTML save of your TCGPlayer order history page.'
        );
        return;
      }

      const globalCounts = new Map();
      /** @type {Map<string, {quantity:number,condition:string|null,foil:boolean,unitPrice:number|null,rarity:string|null}>} */
      const itemDetailsById = new Map();

      for (const t of validTexts) {
        const parsedItems = parseOrderTableHtml(t);
        if (parsedItems.length > 0) {
          // Use rich per-row data from order-history HTML.
          for (const item of parsedItems) {
            if (!item.tcgplayerId) continue;
            globalCounts.set(item.tcgplayerId, (globalCounts.get(item.tcgplayerId) || 0) + item.quantity);
            if (itemDetailsById.has(item.tcgplayerId)) {
              const existing = itemDetailsById.get(item.tcgplayerId);
              existing.quantity += item.quantity;
              if (existing.condition === null && item.condition !== null) existing.condition = item.condition;
              if (existing.unitPrice === null && item.unitPrice !== null) existing.unitPrice = item.unitPrice;
              if (existing.rarity === null && item.rarity !== null) existing.rarity = item.rarity;
              // foil: first-seen value is kept; TCGPlayer assigns distinct product ids
              // to foil vs non-foil variants so mixed foil rows for the same id are rare.
            } else {
              itemDetailsById.set(item.tcgplayerId, {
                quantity: item.quantity,
                condition: item.condition,
                foil: item.foil,
                unitPrice: item.unitPrice,
                rarity: item.rarity,
              });
            }
          }
        } else {
          // Fallback: extract product ids by regex when no order-table HTML found.
          const map = extractTcgplayerIdsFromText(t);
          for (const [id, cnt] of map.entries()) {
            globalCounts.set(id, (globalCounts.get(id) || 0) + cnt);
          }
        }
      }

      if (globalCounts.size === 0) {
        showError('No TCGPlayer product links could be found in the uploaded files.');
        return;
      }

      const ids = Array.from(globalCounts.keys());
      const scryMap = await fetchAllScryfall(ids);

      const cards = [];
      for (const id of ids) {
        const scry = scryMap.get(id);
        if (!scry) continue;
        const details = itemDetailsById.get(id);
        cards.push({
          name: scry.name,
          setCode: scry.setCode || '',
          setName: scry.setName || '',
          collectorNumber: scry.collectorNumber || '',
          foil: details ? details.foil : false,
          rarity: details && details.rarity ? details.rarity : (scry.rarity || ''),
          quantity: details ? details.quantity : (globalCounts.get(id) || 1),
          scryfallId: scry.scryfallId || '',
          price: details ? details.unitPrice : undefined,
          condition: details && details.condition ? details.condition : 'Near Mint',
        });
      }

      if (cards.length === 0) {
        showError('Scryfall lookups failed for all discovered TCGPlayer product IDs.');
        return;
      }

      const csv = formatToCSV(cards);
      csvOutput.value = csv;
      const total = cards.reduce((sum, c) => sum + c.quantity, 0);
      cardCount.textContent = `${cards.length} unique card${cards.length !== 1 ? 's' : ''} · ${total} total cop${total !== 1 ? 'ies' : 'y'}`;
      outputSection.hidden = false;
      outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError('An unexpected error occurred parsing files.');
    } finally {
      setLoading(false);
      parseFilesBtn.disabled = false;
    }
  });

  // ── CSV formatter ─────────────────────────────────────────────
  function csvField(value) {
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function formatToCSV(cards) {
    const header = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Scryfall ID,Purchase price,Condition';
    const rows = cards.map((c) => {
      const foilValue = c.foil ? 'foil' : '';
      const priceValue = c.price != null ? c.price.toFixed(2) : '';
      return [
        csvField(c.name || ''),
        csvField(c.setCode || ''),
        csvField(c.setName || ''),
        csvField(c.collectorNumber || ''),
        foilValue,
        csvField(c.rarity || ''),
        c.quantity != null ? c.quantity : 1,
        csvField(c.scryfallId || ''),
        priceValue,
        csvField(c.condition || 'Near Mint'),
      ].join(',');
    });
    return [header, ...rows].join('\n');
  }

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
