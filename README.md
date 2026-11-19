[![Token Radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/zesty-pika-87/token-radar-01-v4-entry/rank.svg)](https://make.fun/competitions/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/zesty-pika-87/token-radar-01-v4-entry/reward.svg)](https://make.fun/competitions/token-radar-01)

# Token Radar — radar-2.2

What would a protocol's token be worth if it launched today — and how would you farm it?

Token Radar ranks every pre-token protocol in a frozen DefiLlama snapshot
(2026-11-14) by an **implied launch value** and gives each row a seven-step
farm plan. The board covers the whole 40-protocol watchlist plus 185 early
protocols found below the $50M floor — 225 rows in all — and learns its
multiples from 119 live-token comparables kept apart on their own tab.

## The model

```
implied = TVL × category multiple × growth × maturity × chains
```

- **Category multiple:** the median market-cap/TVL ratio of a category's live
  tokens, shrunk toward the global median (0.246×) with a prior of 3, clamped
  to [0.02, 1.0]. A category needs at least 3 live tokens to earn its own
  multiple; with fewer, it borrows the global median.
- **Growth:** 7-day TVL change clamped to [−50, 100]%, multiplier
  1 + (growth / 100) × 0.5.
- **Maturity:** 0.6 + min(age in days, 1095) / 1095 × 0.4; unknown age counts
  as 365 days.
- **Chains:** 1 + min(chains − 1, 4) × 0.02 (at most 1.08).
- Implied value is rounded to the nearest dollar, between $1 and $10¹⁴.

Bridges, wrapped/staked products, exchange-branded names and versioned pools
are excluded. Liquid-staking and liquid-restaking protocols are ranked.

## The dashboard

A static page with no network requests, built from `data.js`:

- **Board** — sortable columns, search, category/chain filters, watchlist-only,
  pins kept on top, compare (up to 3), CSV export, and a detail drawer with
  Model / Farm plan / Evidence tabs.
- **Live tokens** — all 119 comparables with their mcap/TVL ratios.
- **Sandbox** — change the multiple, growth, age and chain count and watch the
  implied value move; the knobs start at each protocol's own numbers.
- **Methodology** — every formula, every category multiple, and the honesty
  notes.
- Press **Ctrl/⌘K** for the command palette.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out ~/node22/bin/node main.ts --input /path/to/snapshot.json
```

Node 22, standard library only. The program writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` to the output directory,
deterministically: two runs write identical bytes.

## Layout

- `main.ts` — entrypoint: reads the snapshot, validates the board, writes the outputs.
- `lib/model.ts` — the radar-2.2 model, farm plans and dashboard data.
- `vendor/makefun-board.ts` — make.fun's vendored dossier library.
- `dashboard/` — `index.html`, `app.css`, `app.js` (the static page).
- `screenshots/` — four 1440×900 views of the dashboard.
