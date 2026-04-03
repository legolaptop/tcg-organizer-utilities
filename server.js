'use strict';

const express = require('express');
const path = require('path');
const { parseLines } = require('./src/parser');
const { convertSetName } = require('./src/setConverter');
const { formatToCSV } = require('./src/csvFormatter');
const { validateCardNames } = require('./src/cardValidator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'docs')));

/**
 * POST /api/convert
 * Body: { "text": "<raw TCGPlayer order text>" }
 * Response: { "csv": "<csv string>", "cards": [...] }
 */
app.post('/api/convert', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Request body must include a non-empty "text" field.' });
  }

  try {
    // 1. Parse raw text into card objects
    const parsed = parseLines(text);

    if (parsed.length === 0) {
      return res.status(422).json({
        error: 'No cards could be parsed from the provided text. Please check the format.',
      });
    }

    // 2. Resolve set names → set codes (may call Scryfall API, cached after first call)
    const resolved = await Promise.all(
      parsed.map(async (card) => ({
        ...card,
        setCode: await convertSetName(card.setName),
      }))
    );

    // 3. Validate card names against Scryfall (batch lookup, cached after first call)
    const validityMap = await validateCardNames(resolved.map((c) => c.name));
    const cards = resolved.filter((c) => validityMap.get(c.name) !== false);

    if (cards.length === 0) {
      return res.status(422).json({
        error: 'No cards could be parsed from the provided text. Please check the format.',
      });
    }

    // 4. Format as CSV
    const csv = formatToCSV(cards);

    return res.json({ csv, cards });
  } catch (err) {
    console.error('Conversion error:', err);
    return res.status(500).json({ error: 'Internal server error during conversion.' });
  }
});

// Start the server only when this file is run directly (not required by tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`TCG Organizer running at http://localhost:${PORT}`);
  });
}

module.exports = app;
