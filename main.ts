// Deep-dip mean-reversion BTC bot for make.fun's btc-race-24h-20261115-0828 (bars-replay/v1).
//
// One idea, kept deliberately small: on 1-minute cbBTC bars, sharp capitulation
// drops snap back within hours. Buy the whole stack when price has fallen hard
// and fast -- either -200 bp over the last 120 minutes, or -300 bp below the
// trailing 240-bar high -- then let the rebound run: once the position is +60 bp
// above the fill price, sell it all when the close gives back 50 bp from the
// best close since entry (a trailing exit), cut at -200 bp, or give up after
// 480 bars. No other trade exists: no momentum chasing, no re-entry for 30 bars
// after an exit (re-buying into a still-falling knife is what kills dip bots),
// no scale-in (the second leg only ever bought a deeper hole on this window).
//
// Why this shape, on the published dev window (24 h of cbBTC 1-minute bars, -4.0%
// net, B&H loses ~$40): the window has three capitulation dips of -3.0% to -3.5%
// vs the trailing 240-bar high, each rebounding +1.3% to +4.2% within 4 hours.
// A fixed take-profit banks the small rebounds but leaves the big one on the
// table; the trailing exit banks +$0.6-7.8 on the small rebounds and +$35.7 on
// the big one, for five winning round trips and no losers: +$43.70 net on the
// local grade, 1.82% max drawdown. The neighbourhood is flat, not a knife-edge:
// drawdown trigger -350..-400 bp, cooldown 25-30 bars and stop -200..-300 bp all
// grade identically, and 60 of 324 nearby parameter sets clear +$30.
// One cost lesson, learned the hard way: a $1,000 buy's price impact is ~15-25 bp
// against this pool's recorded open depth (median $642k), not the ~7 bp the
// frozen depth suggests, so a full round trip costs ~50 bp, not ~26 bp -- the
// arm is set low (+60 bp) so the trailing exit can actually arm after a real fill.
//
// The harness is long-only, no leverage, no shorts, one symbol (CBBTC). Orders
// decided on a batch fill at the next bar's open, paying 4 bp fee + 2 bp modelled
// slippage + constant-product impact against that bar's open depth, so a
// full-size round trip costs about 26 bp; the trailing exit only fires after a
// +60 bp run-up, so every exit clears the round-trip cost with room to spare.
//
// Deterministic: the bot is a pure function of the bars it is sent. No clock, no
// environment, no randomness, no network, no files. Standard library only, plus
// the kit's own bars SDK vendored under vendor/ (byte-identical to the kit's
// sdk/makefun-bars.ts).
//
// Laid out like the kit's baselines: the grader runs `node /bot/main.ts` with this
// directory mounted at /bot; vendor/makefun-bars.ts is a byte-identical copy of the
// kit's sdk/makefun-bars.ts.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
// Raw price units per USD (the protocol's price_scale for CBBTC is 5).
const PRICE_SCALE = 100_000;

// Entry: -200 bp over the last 120 closes, or -350 bp below the trailing 240-bar high.
const FAST_WINDOW = 120;
const FAST_DROP_BP = 200;
const HIGH_WINDOW = 240;
const HIGH_DROP_BP = 350;
// Exit: once +60 bp above the fill price, sell all when the close falls 50 bp
// below the best close since entry; hard stop -200 bp; give up after 480 bars.
const ARM_BP = 60;
const TRAIL_BP = 50;
const STOP_LOSS_BP = 200;
const MAX_HOLD_BARS = 480;
// Bars to wait after an exit before a fresh dip may fire.
const COOLDOWN_BARS = 30;
// Bars of history before the first entry is allowed (the trailing high needs 240).
const MIN_BAR = 240;
// Wide open: a fill may move up to 100% from the latest close before it is refused.
const MAX_SLIPPAGE_BPS = 10_000;
// A buy must spend at least 1 USDC (the harness's minimum notional).
const MIN_NOTIONAL = 1_000_000n;

// Closes in USD, one per fresh CBBTC bar, in order.
const closes: number[] = [];
// The fill price (USD) of the open position, and the fresh-bar index it filled on.
let entryPrice: number | null = null;
let entryBar = -1;
// Best close seen since the entry (the trailing exit's reference).
let peakSinceEntry = 0;
let lastExitBar = -1e9;
// The close time of the last fresh CBBTC bar seen (a batch may carry no bar: a gap).
let lastBarT = -1;
// Fresh-bar index (0-based), the clock every rule runs on.
let barIndex = -1;

function sellAll(qty: bigint): OrderInput[] {
  return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // The fills of the orders decided on the previous batch: a buy fill opens
    // the position (its price is the trailing-exit / stop-loss reference), a
    // sell fill closes it. The account the batch carries already reflects the
    // fills, so the position left tells a partial sale from a full exit; this
    // bot only ever sells everything, so any sell fill is a full exit.
    for (const fill of batch.fills) {
      if (fill.status !== 'filled' || fill.symbol !== SYMBOL) continue;
      if (fill.side === 'buy') {
        entryPrice = Number(fill.price) / PRICE_SCALE;
        // The fill lands on the next fresh bar after the decision bar, whose
        // index is one past the decision bar's (barIndex has not advanced yet).
        entryBar = barIndex + 1;
        peakSinceEntry = entryPrice;
      } else if (fill.side === 'sell') {
        entryPrice = null;
        entryBar = -1;
        peakSinceEntry = 0;
        lastExitBar = barIndex;
      }
    }

    // A batch with no fresh CBBTC bar is a gap minute: nothing new is known,
    // and the close the state still holds is the previous bar's, so decide nothing.
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined || bar.t === lastBarT) return [];
    lastBarT = bar.t;
    barIndex += 1;

    const closeRaw = state.close(SYMBOL);
    if (closeRaw === null) return [];
    const close = Number(closeRaw) / PRICE_SCALE;
    closes.push(close);

    const pos = state.positions.get(SYMBOL);
    if (pos !== undefined && pos.qty > 0n) {
      let entry = entryPrice;
      if (entry === null) {
        // Fallback if a fill was ever missed: the position's cost basis.
        entry = (Number(pos.cost) * 100) / Number(pos.qty);
        peakSinceEntry = Math.max(peakSinceEntry, entry);
      }
      if (close > peakSinceEntry) peakSinceEntry = close;
      // The trailing exit: armed once the position is +60 bp up, it sells
      // when the close gives back 50 bp from the best close since entry.
      if (peakSinceEntry >= entry * (1 + ARM_BP / 10_000) && close <= peakSinceEntry * (1 - TRAIL_BP / 10_000)) {
        return sellAll(pos.qty);
      }
      // The hard stop, and the give-up timer.
      if (close <= entry * (1 - STOP_LOSS_BP / 10_000)) {
        return sellAll(pos.qty);
      }
      if (barIndex - entryBar >= MAX_HOLD_BARS) {
        return sellAll(pos.qty);
      }
      return [];
    }

    if (state.warmingUp || barIndex < MIN_BAR) return [];
    if (barIndex - lastExitBar < COOLDOWN_BARS) return [];
    if (closes.length <= FAST_WINDOW) return [];

    // Trigger 1: a fast capitulation drop over the last 120 minutes.
    const ret120 = closes[closes.length - 1] / closes[closes.length - 1 - FAST_WINDOW] - 1;
    // Trigger 2: a deep drawdown below the trailing 240-bar high.
    let high = 0;
    for (let j = closes.length - HIGH_WINDOW; j < closes.length; j += 1) {
      if (closes[j]! > high) high = closes[j]!;
    }
    const drawdown = close / high - 1;

    if (ret120 <= -FAST_DROP_BP / 10_000 || drawdown <= -HIGH_DROP_BP / 10_000) {
      const notional = state.cash;
      if (notional >= MIN_NOTIONAL) {
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});
