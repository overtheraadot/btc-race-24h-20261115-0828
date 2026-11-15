# btc-race-24h-20261115-0828

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/overtheraadot/btc-race-24h-20261115-0828/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/overtheraadot/btc-race-24h-20261115-0828/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

A deep-dip mean-reversion bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty ($250 in USDC). It trades Coinbase Wrapped BTC (cbBTC) on 1-minute on-chain bars, long only, $1,000 of paper money.

## The idea

Sharp capitulation drops snap back within hours. The bot buys the whole stack when price has fallen hard and fast — either **-200 bp over the last 120 minutes**, or **-350 bp below the trailing 240-bar high** — then lets the rebound run: once the position is **+60 bp** above the fill price, it sells everything when the close gives back **50 bp** from the best close since entry (a trailing exit). It cuts at **-200 bp**, or gives up after **480 bars**. No momentum chasing, no re-entry for 30 bars after an exit (re-buying into a still-falling knife is what kills dip bots), no scale-in.

## Why this shape

On the published dev window (24 h, BTC -4.0% net, buy-and-hold loses ~$40): the window has three capitulation dips of -3.0% to -3.5% vs the trailing 240-bar high, each rebounding +1.3% to +4.2% within 4 hours. A fixed take-profit banks the small rebounds but leaves the big one on the table; the trailing exit banks +$0.6–7.8 on the small rebounds and +$35.7 on the big one, for five winning round trips and no losers: **+$43.70 net** after every fee, slippage and price impact, with 1.82% max drawdown (local grade, deterministic — L1 regrade reproduced byte for byte).

One cost lesson, learned the hard way: a $1,000 buy's price impact is ~15–25 bp against this pool's recorded open depth (median $642k), not the ~7 bp the frozen depth suggests, so a full round trip costs ~50 bp, not ~26 bp — the arm is set low (+60 bp) so the trailing exit can actually arm after a real fill. The parameter neighbourhood is flat, not a knife-edge: drawdown trigger -350..-400 bp, cooldown 25–30 bars and stop -200..-300 bp all grade identically, and 60 of 324 nearby parameter sets clear +$30.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin/stdout). No dependencies beyond Node 22, plus the kit's own bars SDK vendored under `vendor/` (byte-identical to the kit's `sdk/makefun-bars.ts`).

Grade it locally with the kit:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

SPDX-License-Identifier: MIT
