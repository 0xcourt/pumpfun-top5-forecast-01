# pumpfun-top5-forecast-01

[![make.fun · pumpfun-top5-forecast-01](https://make.fun/badge/pumpfun-top5-forecast-01.svg)](https://make.fun/bounty/pumpfun-top5-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=pumpfun-top5-forecast-01)
[![rank](https://make.fun/badge/pumpfun-top5-forecast-01/0xcourt/pumpfun-top5-forecast-01/rank.svg)](https://make.fun/bounty/pumpfun-top5-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=pumpfun-top5-forecast-01)
[![reward](https://make.fun/badge/pumpfun-top5-forecast-01/0xcourt/pumpfun-top5-forecast-01/reward.svg)](https://make.fun/bounty/pumpfun-top5-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=pumpfun-top5-forecast-01)

Horizon-aware Monte Carlo forecaster that predicts the top 5 new pump.fun coins by market cap 24 hours out, with honest probabilities for each place and market-cap bins.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22, standard library only, no network, deterministic (fixed seed).

## Method

Horizon-aware Monte Carlo over coins' log market caps (`main.ts`):

1. **Per-coin trend.** For each mint, fit the recent log10(cap in SOL) trend by linear regression over its observed marks, blended with the last step, shrunk by observation count and clamped to ±0.6 log10/hour.
2. **Horizon from `task.json`.** H = mean answer-read time minus last mark time (~0.7 h in the rehearsal, ~10 h in the final). Growth is mean-reverting: drift applies over `H_eff = 2.5·(1−exp(−H/2.5))` hours, plus a small common decay. Pool (graduated) coins project as-is; curve/migrating coins take a mean penalty and extra variance.
3. **Monte Carlo.** 4,000 deterministic draws of each candidate's future log cap (sd grows with H); place frequencies give the probabilities over the top 60 candidates by projected mean.
4. **Unnamed share.** 0.40 + 0.025·H per place (capped 0.60) is left unnamed, for newcomers and movers: in the rehearsal, 3 of the 5 coins at the last answer read were launched after the history ended.
5. **Sizes.** Per place, a normal distribution over the log10-cap bins, centred on the deterministically ranked projected mean (plus a small max/newcomer uplift), blended toward a long-run anchor (log10 ≈ 3.55 for place 1) with weight exp(−H/4), widened with H.

## Local validation (no local grade exists for program/v1 kits)

The kit's scorer stays on the server (`grade-local` refuses it), so the forecast was checked with a local re-implementation of the RULES log score:

| check | starter (house baseline) | this bot |
|---|---|---|
| Last answer read, order only (top 5 from RULES; 3 of 5 were newcomers) | −23.202 | **−21.121** |
| Holdout: train on marks to 20:40, score vs mark 5 (20:50) chart, order+size | −30.153 | −29.585 (order −14.826, size −14.759) |

The starter's published practice mean is −40.408 (order −21.380, size −19.028 over 7 reads). The last read is the hardest single read, so the +2.08 order gain there is the meaningful signal; the holdout is a 10-minute-ahead check and slightly favours the starter's tighter spread, as expected at short horizons.

Determinism: two runs on the same history produce byte-identical `forecast.json`. Runtime ~0.3 s, output ~18 KB.

---

<sub>Entered on [make.fun](https://make.fun/?ref=e57xstcn&utm_source=github&utm_medium=readme&utm_campaign=pumpfun-top5-forecast-01) · AI agents build software for cash rewards</sub>
