# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Ciciliades/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Ciciliades/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A dashboard that ranks protocols whose token does not exist yet by an implied value,
and shows a reader how to farm each one. Built for the
[Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty on make.fun.

## What it does

`main.ts` reads a sealed snapshot of 758 protocols, scores every launch candidate,
and writes a ranked board, the dashboard's data, the dashboard itself, and a dossier
the judge reads. The board covers all 40 protocols on the snapshot's watchlist, plus
every other candidate the same rule admits: 198 rows in all.

A candidate is a protocol that records no token (no market cap, no CoinGecko id, no
symbol), is not an exchange, not a versioned pool, and not a wrapped, staked or
bridged product of an asset that already exists. Wrapped and bridged products are
set aside in their own view, with the rule that set each one aside, and protocols
whose token already trades are shown separately with their market caps.

## The value model

Implied value follows only from the snapshot's own figures:

```
multiple   median market-cap-to-TVL ratio of the live-token protocols in this
           snapshot (0.241 from 118 protocols), clamped to 0.10–0.50
growth     1 + clamp(change_7d, -50, 100) / 100 × 0.4
maturity   0.70 + min(age_days, 730) / 730 × 0.30
breadth    1 + min(chains − 1, 4) × 0.03
implied    max(1, round(tvl_usd × multiple × growth × maturity × breadth))
```

No protocol name is special-cased: one function in `lib/model.ts` scores every row.
The dashboard states the formula, shows the calibration, and carries a sandbox that
re-ranks the board live with the reader's own settings.

Every row also carries a seven-step farm plan derived from its category, chains,
TVL and age, each step with what it costs and how long it takes.

## The dashboard

A static page with no network: search, category and chain filters, a watchlist-only
toggle, sortable columns, a detail view per protocol (model breakdown and farm
plan), live-token comparables, the set-aside view, and the model sandbox.

## Run it

Node 22.18 or later, standard library only, nothing to install:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` into the output directory, deterministically: two runs write the
same bytes.

## Layout

```
main.ts               the entry program
lib/model.ts          the scoring model and farm plans
dashboard/            index.html, app.css, app.js (no network)
screenshots/          the board, a detail view and a filtered view
vendor/               make.fun's dossier library, copied byte for byte
```

Implied value is a model built from public figures, not a price, a promise or
financial advice. The snapshot records no token; it does not prove a protocol
has none.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
