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

    hideError();
    setLoading(true);
    parseFilesBtn.disabled = true;

    try {
      const reads = Array.from(files).map(
        (f) =>
          new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result || ''));
            r.onerror = () => resolve('');
            r.readAsText(f);
          })
      );

      const texts = await Promise.all(reads);

      const globalCounts = new Map();
      for (const t of texts) {
        const map = extractTcgplayerIdsFromText(t);
        for (const [id, cnt] of map.entries()) {
          globalCounts.set(id, (globalCounts.get(id) || 0) + cnt);
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
        cards.push({
          name: scry.name,
          setCode: scry.setCode || '',
          setName: scry.setName || '',
          collectorNumber: scry.collectorNumber || '',
          foil: false,
          rarity: scry.rarity || '',
          quantity: globalCounts.get(id) || 1,
          scryfallId: scry.scryfallId || '',
          price: undefined,
          condition: 'Near Mint',
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
