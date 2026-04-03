'use strict';

const {
  cardKey,
  parseOrdersFromHtml,
  extractOrderMeta,
  parsePartialRefund,
  isCanceled,
} = require('../src/orderParser');

// ── cardKey ───────────────────────────────────────────────────────────────────

describe('cardKey', () => {
  const card = {
    name: 'Bloodstained Mire',
    set: 'Modern Horizons 3',
    condition: 'Near Mint',
    price: 18.76,
    quantity: 1,
    foil: false,
    cardSeller: 'SuperGamesInc',
  };

  test('returns pipe-separated composite key', () => {
    expect(cardKey(card)).toBe(
      'Bloodstained Mire|Modern Horizons 3|Near Mint|18.76|SuperGamesInc'
    );
  });

  test('two cards with same name/set/condition but different price produce different keys', () => {
    const card2 = { ...card, price: 20.00 };
    expect(cardKey(card)).not.toBe(cardKey(card2));
  });

  test('two cards with same name/set/condition/price but different seller produce different keys', () => {
    const card2 = { ...card, cardSeller: 'OtherSeller' };
    expect(cardKey(card)).not.toBe(cardKey(card2));
  });

  test('two identical cards produce the same key', () => {
    expect(cardKey(card)).toBe(cardKey({ ...card }));
  });
});

// ── parsePartialRefund ────────────────────────────────────────────────────────

describe('parsePartialRefund', () => {
  test('returns null when no partial-refund alert', () => {
    expect(parsePartialRefund('<div>no refund here</div>')).toBeNull();
  });

  test('extracts dollar amount from partial-refund alert', () => {
    const html = `<div data-aid="div-sellerorderwidget-partialrefund">
      A partial refund of $0.43 was issued.
    </div>`;
    expect(parsePartialRefund(html)).toBe(0.43);
  });

  test('returns null when amount cannot be parsed', () => {
    const html = `<div data-aid="div-sellerorderwidget-partialrefund">
      Some text without a dollar amount.
    </div>`;
    expect(parsePartialRefund(html)).toBeNull();
  });

  test('single-quoted data-aid is also detected', () => {
    const html = `<div data-aid='div-sellerorderwidget-partialrefund'>Refund $1.25</div>`;
    expect(parsePartialRefund(html)).toBe(1.25);
  });
});

// ── isCanceled ────────────────────────────────────────────────────────────────

describe('isCanceled', () => {
  test('returns false for HTML with no cancel indicator', () => {
    expect(isCanceled('<div>normal order</div>')).toBe(false);
  });

  test('returns true when canceledorder data-aid is present', () => {
    const html = `<div data-aid="div-sellerorderwidget-canceledorder">Canceled</div>`;
    expect(isCanceled(html)).toBe(true);
  });

  test('returns true for single-quoted data-aid', () => {
    const html = `<div data-aid='div-sellerorderwidget-canceledorder'>Canceled</div>`;
    expect(isCanceled(html)).toBe(true);
  });
});

// ── extractOrderMeta ──────────────────────────────────────────────────────────

describe('extractOrderMeta', () => {
  function makeMetaHtml(overrides = {}) {
    const {
      orderId = 'D15EE6BF-9B4455-9D46F',
      seller = 'TCGplayer Direct',
      date = 'March 31, 2026',
      delivery = 'April 14, 2026',
      total = '$5.98',
      tracking = null,
      shippingNotConfirmed = false,
      partialRefund = null,
    } = overrides;

    return `
      <div data-orderid="${orderId}">
        <div data-aid="div-sellerorderwidget-sellerinfo">${seller}</div>
        <div data-aid="div-sellerorderwidget-orderdate">${date}</div>
        <div data-aid="div-sellerorderwidget-estimateddelivery">${delivery}</div>
        <div data-aid="div-sellerorderwidget-ordertotal">${total}</div>
        ${tracking ? `<div data-aid="div-sellerorderwidget-tracking">${tracking}</div>` : ''}
        ${shippingNotConfirmed ? `<div data-aid="div-sellerorderwidget-shippingnotconfirmed">Shipping Not Confirmed</div>` : ''}
        ${partialRefund ? `<div data-aid="div-sellerorderwidget-partialrefund">Partial refund of $${partialRefund}</div>` : ''}
      </div>
    `;
  }

  test('extracts order ID from data-orderid attribute', () => {
    const meta = extractOrderMeta(makeMetaHtml());
    expect(meta.id).toBe('D15EE6BF-9B4455-9D46F');
  });

  test('extracts seller name', () => {
    const meta = extractOrderMeta(makeMetaHtml({ seller: 'TC\'s Rockets' }));
    expect(meta.seller).toBe("TC's Rockets");
  });

  test('extracts order date', () => {
    const meta = extractOrderMeta(makeMetaHtml());
    expect(meta.date).toBe('March 31, 2026');
  });

  test('extracts estimated delivery', () => {
    const meta = extractOrderMeta(makeMetaHtml());
    expect(meta.estimatedDelivery).toBe('April 14, 2026');
  });

  test('extracts total as number', () => {
    const meta = extractOrderMeta(makeMetaHtml({ total: '$5.98' }));
    expect(meta.total).toBe(5.98);
  });

  test('trackingNumber is null when tracking element is absent', () => {
    const meta = extractOrderMeta(makeMetaHtml());
    expect(meta.trackingNumber).toBeNull();
  });

  test('extracts tracking number when present', () => {
    const meta = extractOrderMeta(makeMetaHtml({ tracking: '1Z999AA10123456784' }));
    expect(meta.trackingNumber).toBe('1Z999AA10123456784');
  });

  test('shippingConfirmed is true by default', () => {
    const meta = extractOrderMeta(makeMetaHtml());
    expect(meta.shippingConfirmed).toBe(true);
  });

  test('shippingConfirmed is false when not-confirmed element is present', () => {
    const meta = extractOrderMeta(makeMetaHtml({ shippingNotConfirmed: true }));
    expect(meta.shippingConfirmed).toBe(false);
  });

  test('partialRefund is null when no partial-refund element', () => {
    const meta = extractOrderMeta(makeMetaHtml());
    expect(meta.partialRefund).toBeNull();
  });

  test('extracts partial refund amount', () => {
    const meta = extractOrderMeta(makeMetaHtml({ partialRefund: '0.43' }));
    expect(meta.partialRefund).toBe(0.43);
  });

  test('falls back to deterministic UNKNOWN-<index> id when no id found', () => {
    const meta = extractOrderMeta('<div>no order data here</div>', 3);
    expect(meta.id).toBe('UNKNOWN-3');
  });
});

// ── parseOrdersFromHtml ───────────────────────────────────────────────────────

function makeOrderHtml({
  orderId = 'ORD-001',
  seller = 'TCGplayer Direct',
  date = 'March 31, 2026',
  delivery = 'April 14, 2026',
  total = '$5.98',
  tracking = null,
  shippingNotConfirmed = false,
  partialRefund = null,
  canceled = false,
  cardSeller = null,
  cardTitle = 'Cranial Ram',
  cardSet = 'Modern Horizons 3',
  cardCondition = 'Lightly Played',
  cardPrice = '$0.25',
  tcgId = '552718',
} = {}) {
  const preHtml = `
    <div data-orderid="${orderId}">
      <div data-aid="div-sellerorderwidget-sellerinfo">${seller}</div>
      <div data-aid="div-sellerorderwidget-orderdate">${date}</div>
      <div data-aid="div-sellerorderwidget-estimateddelivery">${delivery}</div>
      <div data-aid="div-sellerorderwidget-ordertotal">${total}</div>
      ${tracking ? `<div data-aid="div-sellerorderwidget-tracking">${tracking}</div>` : ''}
      ${shippingNotConfirmed ? `<div data-aid="div-sellerorderwidget-shippingnotconfirmed">Shipping Not Confirmed</div>` : ''}
      ${partialRefund ? `<div data-aid="div-sellerorderwidget-partialrefund">Partial refund of $${partialRefund}</div>` : ''}
      ${canceled ? `<div data-aid="div-sellerorderwidget-canceledorder">Order Canceled</div>` : ''}
    </div>
  `;

  const detailCell = cardSeller
    ? `Rarity: C\n<br>\nCondition: ${cardCondition}\n<br>\nSold by ${cardSeller}`
    : `Rarity: C\n<br>\nCondition: ${cardCondition}`;

  const tableHtml = `
    <table class="orderTable" data-aid="tbl-sellerorderwidget-ordertable">
      <thead>
        <tr>
          <th class="orderHistoryItems">ITEMS</th>
          <th class="orderHistoryDetail">DETAILS</th>
          <th class="orderHistoryPrice">PRICE</th>
          <th class="orderHistoryQuantity">QUANTITY</th>
        </tr>
      </thead>
      <tbody>
        <tr class="trOdd">
          <td class="orderHistoryItems">
            <img data-original="https://tcgplayer-cdn.tcgplayer.com/product/${tcgId}_25w.jpg" width="21">
            <span>
              <a title="${cardTitle}">${cardTitle}</a>
              <br>
              ${cardSet}
            </span>
          </td>
          <td class="orderHistoryDetail">${detailCell}</td>
          <td class="orderHistoryPrice">${cardPrice}</td>
          <td class="orderHistoryQuantity">1</td>
        </tr>
      </tbody>
    </table>
  `;

  return preHtml + tableHtml;
}

describe('parseOrdersFromHtml', () => {
  test('returns empty array for empty string', () => {
    expect(parseOrdersFromHtml('')).toEqual([]);
  });

  test('returns empty array for null/undefined', () => {
    expect(parseOrdersFromHtml(null)).toEqual([]);
    expect(parseOrdersFromHtml(undefined)).toEqual([]);
  });

  test('parses a single order with card', () => {
    const html = makeOrderHtml();
    const orders = parseOrdersFromHtml(html);
    expect(orders).toHaveLength(1);
  });

  test('sets order-level fields correctly', () => {
    const html = makeOrderHtml({
      orderId: 'D15EE6BF-9B4455-9D46F',
      seller: 'TCGplayer Direct',
      date: 'March 31, 2026',
      delivery: 'April 14, 2026',
      total: '$5.98',
    });
    const [order] = parseOrdersFromHtml(html);
    expect(order.id).toBe('D15EE6BF-9B4455-9D46F');
    expect(order.seller).toBe('TCGplayer Direct');
    expect(order.date).toBe('March 31, 2026');
    expect(order.estimatedDelivery).toBe('April 14, 2026');
    expect(order.total).toBe(5.98);
    expect(order.canceled).toBe(false);
  });

  test('shippingConfirmed is true when no not-confirmed indicator', () => {
    const [order] = parseOrdersFromHtml(makeOrderHtml());
    expect(order.shippingConfirmed).toBe(true);
  });

  test('shippingConfirmed is false when not-confirmed indicator is present', () => {
    const [order] = parseOrdersFromHtml(makeOrderHtml({ shippingNotConfirmed: true }));
    expect(order.shippingConfirmed).toBe(false);
  });

  test('trackingNumber is null when absent', () => {
    const [order] = parseOrdersFromHtml(makeOrderHtml());
    expect(order.trackingNumber).toBeNull();
  });

  test('trackingNumber is populated when present', () => {
    const [order] = parseOrdersFromHtml(makeOrderHtml({ tracking: '1Z999AA10123456784' }));
    expect(order.trackingNumber).toBe('1Z999AA10123456784');
  });

  test('partialRefund is null when absent', () => {
    const [order] = parseOrdersFromHtml(makeOrderHtml());
    expect(order.partialRefund).toBeNull();
  });

  test('partialRefund is populated when present', () => {
    const [order] = parseOrdersFromHtml(makeOrderHtml({ partialRefund: '0.43' }));
    expect(order.partialRefund).toBe(0.43);
  });

  test('canceled order is included with canceled: true', () => {
    const [order] = parseOrdersFromHtml(makeOrderHtml({ canceled: true }));
    expect(order.canceled).toBe(true);
  });

  test('fully-refunded order is skipped entirely', () => {
    const refundAlert = `<div data-aid="div-sellerorderwidget-singlerefund">Full refund</div>`;
    const html = refundAlert + makeOrderHtml().split('<table')[1];
    // Prepend the refund alert right before the table
    const fullHtml =
      `<div data-orderid="ORD-REFUNDED">` + refundAlert + `</div>` +
      makeOrderHtml().match(/<table[\s\S]*$/)[0];
    const orders = parseOrdersFromHtml(fullHtml);
    expect(orders).toHaveLength(0);
  });

  test('maps card items with correct CardItem shape', () => {
    const html = makeOrderHtml({
      cardTitle: 'Cranial Ram',
      cardSet: 'Modern Horizons 3',
      cardCondition: 'Lightly Played',
      cardPrice: '$0.25',
    });
    const [order] = parseOrdersFromHtml(html);
    expect(order.cards).toHaveLength(1);
    const card = order.cards[0];
    expect(card.name).toBe('Cranial Ram');
    expect(card.set).toBe('Modern Horizons 3');
    expect(card.condition).toBe('Lightly Played');
    expect(card.price).toBe(0.25);
    expect(card.quantity).toBe(1);
    expect(card.foil).toBe(false);
  });

  test('cardSeller falls back to order-level seller for regular marketplace orders', () => {
    const html = makeOrderHtml({ seller: "TC's Rockets", cardSeller: null });
    const [order] = parseOrdersFromHtml(html);
    expect(order.cards[0].cardSeller).toBe("TC's Rockets");
  });

  test('cardSeller is per-card seller for Direct orders with Sold by in detail cell', () => {
    const html = makeOrderHtml({
      seller: 'TCGplayer Direct',
      cardSeller: 'SuperGamesInc',
    });
    const [order] = parseOrdersFromHtml(html);
    expect(order.cards[0].cardSeller).toBe('SuperGamesInc');
  });

  test('parses two orders from a single HTML page', () => {
    const order1 = makeOrderHtml({ orderId: 'ORD-001', cardTitle: 'Forest' });
    const order2 = makeOrderHtml({ orderId: 'ORD-002', cardTitle: 'Island' });
    const orders = parseOrdersFromHtml(order1 + order2);
    expect(orders).toHaveLength(2);
    expect(orders[0].cards[0].name).toBe('Forest');
    expect(orders[1].cards[0].name).toBe('Island');
  });
});
