'use strict';

const { parseOrderTableHtml } = require('../src/htmlParser');

// Sample HTML extracted from a TCGPlayer order-history .mht file.
const SAMPLE_HTML = `
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
    <div>
     <img alt="Cranial Ram" class="orderThumbnail lazy" data-original="https://tcgplayer-cdn.tcgplayer.com/product/552718_25w.jpg" src="https://tcgplayer-cdn.tcgplayer.com/product/552718_25w.jpg" width="21">
    </div>
    <span style="display: block; padding-left: 30px;">
     <a class="nocontext" href="https://store.tcgplayer.com/magic/modern-horizons-3/cranial-ram" target="_blank" title="Cranial Ram">
      Cranial Ram
     </a>
     <br>
     Modern Horizons 3
    </span>
   </td>
   <td class="orderHistoryDetail">
    Rarity: C
    <br>
    Condition: Lightly Played
   </td>
   <td class="orderHistoryPrice" style="vertical-align:middle;">$0.25</td>
   <td class="orderHistoryQuantity" style="vertical-align:middle;">1</td>
  </tr>
  <tr class="trEven">
   <td class="orderHistoryItems">
    <div>
     <img alt="K'rrik, Son of Yawgmoth (Phyrexian)" class="orderThumbnail lazy" data-original="https://tcgplayer-cdn.tcgplayer.com/product/480567_25w.jpg" src="https://tcgplayer-cdn.tcgplayer.com/product/480567_25w.jpg" width="21">
    </div>
    <span style="display: block; padding-left: 30px;">
     <a class="nocontext" href="https://store.tcgplayer.com/magic/secret-lair-drop-series/krrik-son-of-yawgmoth-phyrexian" target="_blank" title="K'rrik, Son of Yawgmoth (Phyrexian)">
      K'rrik, Son of Yawgmoth (Phyrexian)
     </a>
     <br>
     Secret Lair Drop Series
    </span>
   </td>
   <td class="orderHistoryDetail">
    Rarity: R
    <br>
    Condition: Lightly Played Foil
   </td>
   <td class="orderHistoryPrice" style="vertical-align:middle;">$4.51</td>
   <td class="orderHistoryQuantity" style="vertical-align:middle;">1</td>
  </tr>
  <tr class="trOdd">
   <td class="orderHistoryItems">
    <div>
     <img alt="Sewer-veillance Cam" class="orderThumbnail lazy" data-original="https://tcgplayer-cdn.tcgplayer.com/product/679787_25w.jpg" src="https://tcgplayer-cdn.tcgplayer.com/product/679787_25w.jpg" width="21">
    </div>
    <span style="display: block; padding-left: 30px;">
     <a class="nocontext" href="https://store.tcgplayer.com/magic/teenage-mutant-ninja-turtles/sewer-veillance-cam" target="_blank" title="Sewer-veillance Cam">
      Sewer-veillance Cam
     </a>
     <br>
     Teenage Mutant Ninja Turtles
    </span>
   </td>
   <td class="orderHistoryDetail">
    Rarity: C
    <br>
    Condition: Near Mint Foil
   </td>
   <td class="orderHistoryPrice" style="vertical-align:middle;">$0.79</td>
   <td class="orderHistoryQuantity" style="vertical-align:middle;">1</td>
  </tr>
 </tbody>
</table>
`;

describe('parseOrderTableHtml', () => {
  let items;

  beforeAll(() => {
    items = parseOrderTableHtml(SAMPLE_HTML);
  });

  test('returns three items for the sample HTML', () => {
    expect(items).toHaveLength(3);
  });

  describe('Cranial Ram (row 1)', () => {
    let item;
    beforeAll(() => { item = items[0]; });

    test('tcgplayerId is "552718"', () => expect(item.tcgplayerId).toBe('552718'));
    test('title is "Cranial Ram"', () => expect(item.title).toBe('Cranial Ram'));
    test('setName is "Modern Horizons 3"', () => expect(item.setName).toBe('Modern Horizons 3'));
    test('quantity is 1', () => expect(item.quantity).toBe(1));
    test('condition is "Lightly Played"', () => expect(item.condition).toBe('Lightly Played'));
    test('foil is false', () => expect(item.foil).toBe(false));
    test('unitPrice is 0.25', () => expect(item.unitPrice).toBe(0.25));
    test('totalPrice is 0.25', () => expect(item.totalPrice).toBe(0.25));
    test('rarity is "C"', () => expect(item.rarity).toBe('C'));
  });

  describe("K'rrik (row 2)", () => {
    let item;
    beforeAll(() => { item = items[1]; });

    test('tcgplayerId is "480567"', () => expect(item.tcgplayerId).toBe('480567'));
    test("title is \"K'rrik, Son of Yawgmoth (Phyrexian)\"", () =>
      expect(item.title).toBe("K'rrik, Son of Yawgmoth (Phyrexian)"));
    test('setName is "Secret Lair Drop Series"', () => expect(item.setName).toBe('Secret Lair Drop Series'));
    test('quantity is 1', () => expect(item.quantity).toBe(1));
    test('condition is "Lightly Played" (foil stripped)', () => expect(item.condition).toBe('Lightly Played'));
    test('foil is true', () => expect(item.foil).toBe(true));
    test('unitPrice is 4.51', () => expect(item.unitPrice).toBe(4.51));
    test('totalPrice is 4.51', () => expect(item.totalPrice).toBe(4.51));
    test('rarity is "R"', () => expect(item.rarity).toBe('R'));
  });

  describe('Sewer-veillance Cam (row 3)', () => {
    let item;
    beforeAll(() => { item = items[2]; });

    test('tcgplayerId is "679787"', () => expect(item.tcgplayerId).toBe('679787'));
    test('title is "Sewer-veillance Cam"', () => expect(item.title).toBe('Sewer-veillance Cam'));
    test('setName is "Teenage Mutant Ninja Turtles"', () =>
      expect(item.setName).toBe('Teenage Mutant Ninja Turtles'));
    test('quantity is 1', () => expect(item.quantity).toBe(1));
    test('condition is "Near Mint" (foil stripped)', () => expect(item.condition).toBe('Near Mint'));
    test('foil is true', () => expect(item.foil).toBe(true));
    test('unitPrice is 0.79', () => expect(item.unitPrice).toBe(0.79));
    test('totalPrice is 0.79', () => expect(item.totalPrice).toBe(0.79));
    test('rarity is "C"', () => expect(item.rarity).toBe('C'));
  });

  describe('edge cases', () => {
    test('returns empty array for empty string', () => {
      expect(parseOrderTableHtml('')).toEqual([]);
    });

    test('returns empty array for null/undefined', () => {
      expect(parseOrderTableHtml(null)).toEqual([]);
      expect(parseOrderTableHtml(undefined)).toEqual([]);
    });

    test('returns empty array for non-order HTML', () => {
      expect(parseOrderTableHtml('<p>hello world</p>')).toEqual([]);
    });

    test('skips rows with no tcgplayerId and no price', () => {
      const html = `
        <tr>
          <td class="orderHistoryItems"><span><a title="No Id Card">No Id Card</a><br>Some Set</span></td>
          <td class="orderHistoryDetail">Rarity: R<br>Condition: Near Mint</td>
          <td class="orderHistoryPrice"></td>
          <td class="orderHistoryQuantity">1</td>
        </tr>`;
      expect(parseOrderTableHtml(html)).toEqual([]);
    });

    test('parses quantity greater than 1 and computes totalPrice correctly', () => {
      const html = `
        <tr>
          <td class="orderHistoryItems">
            <img data-original="https://tcgplayer-cdn.tcgplayer.com/product/552718_25w.jpg">
            <span><a title="Cranial Ram">Cranial Ram</a><br>MH3</span>
          </td>
          <td class="orderHistoryDetail">Rarity: C<br>Condition: Near Mint</td>
          <td class="orderHistoryPrice">$0.25</td>
          <td class="orderHistoryQuantity">3</td>
        </tr>`;
      const result = parseOrderTableHtml(html);
      expect(result).toHaveLength(1);
      expect(result[0].tcgplayerId).toBe('552718');
      expect(result[0].quantity).toBe(3);
      expect(result[0].totalPrice).toBe(0.75);
    });

    test('totalPrice equals unitPrice * quantity', () => {
      const html = `
        <tr>
          <td class="orderHistoryItems">
            <img data-original="https://tcgplayer-cdn.tcgplayer.com/product/100001_25w.jpg">
            <span><a title="Test Card">Test Card</a><br>Test Set</span>
          </td>
          <td class="orderHistoryDetail">Rarity: U<br>Condition: Near Mint</td>
          <td class="orderHistoryPrice">$2.50</td>
          <td class="orderHistoryQuantity">4</td>
        </tr>`;
      const [result] = parseOrderTableHtml(html);
      expect(result.unitPrice).toBe(2.5);
      expect(result.quantity).toBe(4);
      expect(result.totalPrice).toBe(10.0);
    });
  });
});
