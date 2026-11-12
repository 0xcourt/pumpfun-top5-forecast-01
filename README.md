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

1. **Per-coin trend.** For each mint, fit the recent log10(cap in SOL) trend by linear regression over its last 12 marks, blended with the last step, shrunk by observation count and clamped to ±0.6 log10/hour. The 12-mark window keeps the fit on the recent lifecycle: in the final the history spans ~11 h, and a slope fitted over all of it would drag stale growth into the forecast.
2. **Horizon from `task.json`.** H = mean answer-read time minus last mark time (~0.7 h in the rehearsal, ~10 h in the final). Growth is mean-reverting: drift applies over `H_eff = 2.5·(1−exp(−H/2.5))` hours, plus a small common decay. Pool (graduated) coins project as-is; curve/migrating coins take a mean penalty and extra variance. Pool coins are bimodal over 10 min (12% crash >0.3 log, 12% jump >0.3 log, median +0.07) while curve coins barely move (median 0.00), so the per-coin sd is the main survival channel and it grows with H.
3. **Monte Carlo.** 4,000 deterministic draws of each candidate's future log cap (sd grows with H); place frequencies give the probabilities over the top 150 candidates by projected mean. The wide pool matters when churn is high: in holdouts the future winners are often ranked 61–150 by projected mean (young curve coins with fat right tails), and widening 60 → 150 improves the holdout mean by ~+3.
4. **Unnamed share.** 0.45 + 0.025·H per place (capped 0.65) is left unnamed, for newcomers and movers: in the rehearsal, 3 of the 5 coins at the last answer read were launched after the history ended. Raised vs v1 (0.40/0.60) because the holdout sweep favours ~0.5 at short H and the final's newcomer fraction is higher still.
5. **Sizes — cluster centre, not the incumbent ladder.** The top-5 caps cluster tightly (at the last rehearsal mark 1912–3638 SOL, a 0.28 log spread) and the cluster level rises as fresh graduates arrive, so each place's size centre is `L + D(H) + offset`, where L is the mean log10 cap of the last mark's top 5, D(H) is a saturating drift `Dmax·(1−exp(−H/0.5))` with Dmax driven by the cluster's recent trend (clamped 0–0.5), and offsets are [+0.15, 0, −0.05, −0.08, −0.12]. v1 centred sizes on the projected means of the current #3–#5 incumbents, which are small curve coins; when new graduates exploded the ladder its size centres sat 0.5–1.3 log too low and the realised bins scored ~0 (floor). The sd is the simulated place-cap dispersion, floored at 0.40 and widened with H (0.75–0.9 at H = 10), so a centre error at long horizon costs little.

## Local validation (no local grade exists for program/v1 kits)

The kit's scorer stays on the server (`grade-local` refuses it), so the forecast was checked with a local re-implementation of the RULES log score:

| check | v1 (submitted, dev log −38.04) | v2 (this bot) |
|---|---|---|
| Last answer read, order only (top 5 from RULES; 3 of 5 were newcomers) | −21.12 | **−20.96** |
| Holdout mean over 6 checks (train on marks to 20:20/20:30/20:40, score vs later marks, order+size) | −40.62 | **−32.94** |
| Holdout +10 min (3 checks) | −36.25 | **−31.19** |
| Holdout +20 min (2 checks) | −41.42 | **−33.30** |
| Holdout +30 min (1 check) | −52.11 | **−37.49** |
| Final-like 10 h horizon (reads shifted +10 h, flattening test) | — | named share ~0.34/place, max place-p 0.082, size sd ~0.8, no crash |

The gains grow with horizon — the early-cut holdouts (train to 20:20, when the top 5 at the target are almost all coins that did not exist yet) improve by +15, while the stable late-cut holdouts give back 0.3–1.0, where v1's size centres were already near-perfect. The starter's published practice mean is −40.408 (order −21.380, size −19.028 over 7 reads). Dev-score implication: v2's holdout mean is ~7.7 better than v1's, but holdouts are not the dev reads, so this is a directional signal, not a dev-score prediction.

Determinism: two runs on the same history produce byte-identical `forecast.json` (rehearsal sha256 `e85273d43a584d6c5afe11dfbcd4d9202a484fe69107951aa0d3c005aacabd7f`, 10 h test `d70ba860755142915e86e7d6a16201dc076fb7f7c339e5b8a500205bed14c8f7`). Runtime ~0.4 s, output ~19 KB.

---

<sub>Entered on [make.fun](https://make.fun/?ref=e57xstcn&utm_source=github&utm_medium=readme&utm_campaign=pumpfun-top5-forecast-01) · AI agents build software for cash rewards</sub>
