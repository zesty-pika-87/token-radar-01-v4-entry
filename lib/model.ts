// Token Radar, model radar-2.2.
//
// The entry reads one frozen DefiLlama snapshot, ranks every pre-token protocol
// the snapshot can still find, and hands the dashboard everything it needs to
// show the ranking, the live-token evidence behind it, and a farm plan per row.
//
// How a protocol is valued, in one line:
//   implied = TVL x category multiple x growth x maturity x chains
// The category multiple is the median market-cap/TVL of the live tokens in
// that category, shrunk toward the global median with a prior of 3, and rounded
// to four decimals before it is used. A category with fewer than three live
// tokens has not earned its own multiple, so it borrows the global one.

/** One protocol entry of the sealed snapshot: exactly the ten fields it carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Every number the model runs on, so the dashboard can state them all. */
export interface ModelConstants {
  shrink_prior: number;
  min_live_for_category: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_counted: number;
  implied_min: number;
  implied_max: number;
}

export const MODEL: ModelConstants = {
  shrink_prior: 3,
  min_live_for_category: 3,
  multiple_floor: 0.02,
  multiple_cap: 1.0,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_max_counted: 5,
  implied_min: 1,
  implied_max: 100_000_000_000_000,
};

/** The model's version label, shown in the dashboard header and methodology. */
export const MODEL_VERSION = 'radar-2.2';

/** One farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The model's working, kept beside each board row for the drawer to show. */
export interface RowBreakdown {
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  age_days: number | null;
}

/** One row of board.json: a ranked pre-token protocol with its farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  token_status: 'no token on record';
  watchlist: boolean;
  breakdown: RowBreakdown;
  farm_steps: string[];
}

/** One live-token protocol: the market's own value, shown as evidence. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
}

/** One category's multiple, with the three biggest live tokens behind it. */
export interface CategoryMultiple {
  category: string;
  live_n: number;
  live_median: number | null;
  multiple: number;
  top: { name: string; ratio: number }[];
}

/** Everything the dashboard renders, written to data.js as one global. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  multiples: { global_median: number; live_count: number; by_category: CategoryMultiple[] };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The middle value of a sorted list; the mean of the two middles when even. */
function medianOf(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when unknown or bad. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** A protocol whose token already trades: a positive market cap and TVL, not a CEX. */
export function isLive(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX';
}

/** A protocol that records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a release marker, such as "V2" or "2.0": a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Exchange names a protocol name must not start with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Categories the board never ranks from the early discovery. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Restaked BTC', 'CEX']);

/** Whether a pre-token protocol survives the board's exclusion rules. */
export function passesExclusion(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  const words = p.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 0);
  if (words.some((w) => w === 'wrapped' || w === 'staked' || w === 'staking')) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** The live set, the global median, and every category's multiple. */
export function computeMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): {
  live: SnapshotProtocol[];
  globalMedian: number;
  byCategory: CategoryMultiple[];
} {
  const live = snapshot.protocols.filter(isLive);
  const ratios = live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const globalMedian = medianOf(ratios);

  const categories = [...new Set(snapshot.protocols.map((p) => p.category ?? 'Uncategorized'))].sort();
  const byCategory: CategoryMultiple[] = categories.map((category) => {
    const inCategory = live
      .filter((p) => (p.category ?? 'Uncategorized') === category)
      .sort((a, b) => b.mcap_usd! - a.mcap_usd!);
    const catRatios = inCategory.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
    const liveMedian = catRatios.length > 0 ? medianOf(catRatios) : null;
    let multiple: number;
    if (inCategory.length >= model.min_live_for_category && liveMedian !== null) {
      multiple = (inCategory.length * liveMedian + model.shrink_prior * globalMedian) / (inCategory.length + model.shrink_prior);
    } else {
      multiple = globalMedian;
    }
    multiple = round4(clamp(multiple, model.multiple_floor, model.multiple_cap));
    return {
      category,
      live_n: inCategory.length,
      live_median: liveMedian === null ? null : round4(liveMedian),
      multiple,
      top: inCategory.slice(0, 3).map((p) => ({ name: p.name, ratio: round4(p.mcap_usd! / p.tvl_usd) })),
    };
  });
  return { live, globalMedian, byCategory };
}

/** The implied value of one protocol, with the working shown in the drawer. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants = MODEL,
): { implied: number; breakdown: RowBreakdown } {
  const growthPct = clamp(p.change_7d ?? 0, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageInDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(ageForModel, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), model.chain_max_counted - 1) * model.chain_step;
  const implied = clamp(Math.round(p.tvl_usd * multiple * growthMult * maturityMult * chainMult), model.implied_min, model.implied_max);
  return {
    implied,
    breakdown: {
      category_multiple: multiple,
      growth_pct: round2(growthPct),
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      chain_multiplier: round4(chainMult),
      age_days: age,
    },
  };
}

// ---------------------------------------------------------------- farm plans

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get longer. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Cheap chains, where a setup transaction costs well under a dollar. */
const CHEAP_CHAINS = new Set([
  'Arbitrum', 'Base', 'Optimism', 'Polygon', 'Binance', 'Avalanche', 'Linea', 'Scroll',
  'zkSync Era', 'Blast', 'Mantle', 'Unichain', 'Sonic', 'Berachain', 'Sei', 'Sui', 'Aptos',
  'Celo', 'xDai', 'Fantom', 'Cronos', 'Kava', 'Starknet', 'Mode', 'Zora', 'Fraxtal',
  'Metis', 'Gnosis', 'Moonbeam', 'Moonriver', 'Aurora', 'opBNB', 'Manta', 'Taiko',
  'Zircuit', 'Soneium', 'Abstract', 'Ink', 'World Chain', 'Lisk', 'Redstone', 'BOB',
]);

/** What one transaction costs on a chain, as a setup cost and a weekly cost. */
function gasFor(chain: string): { setup: string; weekly: string } {
  if (chain === 'Solana') return { setup: '$0.01', weekly: '$0.05' };
  if (chain === 'Ethereum') return { setup: '$5–$15', weekly: '$5' };
  if (CHEAP_CHAINS.has(chain)) return { setup: '$0.10–$1', weekly: '$0.50' };
  return { setup: '$1–$3', weekly: '$2' };
}

/** Which kind of qualifying move a category asks for. */
function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c === 'chain') return 'chain';
  if (c === 'risk curators' || c === 'onchain capital allocator') return 'vault';
  if (c === 'basis trading') return 'basis';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lend';
  if (c === 'dexs' || c === 'leveraged farming' || c === 'farm' || c === 'liquidity manager') return 'liquidity';
  if (c === 'rwa') return 'rwa';
  if (c.includes('stak')) return 'stake';
  if (c === 'insurance') return 'insurance';
  if (c === 'payments') return 'payment';
  if (c.includes('governance')) return 'governance';
  if (c === 'prediction market') return 'prediction';
  if (c.includes('derivative') || c === 'options' || c === 'options vault' || c === 'synthetics') return 'derivative';
  if (c === 'cedefi') return 'cedefi';
  if (c.includes('stablecoin') || c === 'algo-stables' || c === 'dual-token stablecoin') return 'stable';
  if (c === 'launchpad') return 'launchpad';
  if (c === 'anchor btc' || c === 'decentralized btc') return 'btc';
  if (c === 'indexes') return 'index';
  if (c === 'crypto card issuer') return 'card';
  if (c === 'yield' || c === 'yield aggregator') return 'yield';
  return 'deposit';
}

/** The family's first qualifying move on a chain. */
function qualifyFirst(family: string, name: string, capital: number, chain: string): string {
  switch (family) {
    case 'chain':
      return `Bridge $${capital} of USDC to ${chain} through ${name}, then put the bridged funds to work inside an application on ${chain}.`;
    case 'vault':
      return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
    case 'basis':
      return `Deposit $${capital} into the ${name} basis vault on ${chain} and hold the position.`;
    case 'lend':
      return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against the supply and keep both legs open.`;
    case 'liquidity':
      return `Add $${capital} of liquidity to the main pool of ${name} on ${chain} and keep the position open.`;
    case 'rwa':
      return `Mint $${capital} of the yield-bearing asset ${name} offers on ${chain} and hold it.`;
    case 'stake':
      return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
    case 'payment':
      return `Top up $${capital} through ${name} on ${chain} and make one real payment with it.`;
    case 'governance':
      return `Lock $${capital} with ${name} on ${chain} and cast a vote on a live proposal.`;
    case 'prediction':
      return `Fund ${name} with $${capital} on ${chain} and place one position on a live market.`;
    case 'derivative':
      return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedge.`;
    case 'cedefi':
      return `Deposit $${capital} into a ${name} CeDeFi vault on ${chain} and hold the shares.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
    case 'launchpad':
      return `Stake $${capital} through ${name} on ${chain} and register for an allocation.`;
    case 'btc':
      return `Deposit $${capital} of the BTC-backed asset into ${name} on ${chain} and hold it.`;
    case 'index':
      return `Buy $${capital} of the ${name} index token on ${chain} and hold it.`;
    case 'card':
      return `Order the ${name} card, top it up with $${capital} on ${chain}, and pay for one real purchase.`;
    case 'yield':
      return `Deposit $${capital} into a ${name} yield vault on ${chain} and hold the shares.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/** The family's second, different qualifying move on the same chain. */
function qualifySecond(family: string, name: string, chain: string): string {
  switch (family) {
    case 'chain':
      return `Swap a small amount of the bridged USDC for the native token of ${chain} inside the chain's own application.`;
    case 'vault':
      return `Deposit a second, smaller amount into a different vault run by ${name} on ${chain}.`;
    case 'basis':
      return `Deposit a second, smaller amount into a different basis vault of ${name} on ${chain}.`;
    case 'lend':
      return `Borrow a second, smaller amount against the supply and leave it open.`;
    case 'liquidity':
      return `Swap a small amount through the main pool of ${name} on ${chain}.`;
    case 'rwa':
      return `Mint a second, smaller tranche of the yield-bearing asset on ${chain}.`;
    case 'stake':
      return `Stake a second, smaller amount of the staking asset through ${name} on ${chain}.`;
    case 'insurance':
      return `Buy a second, smaller cover from ${name} for a different risk on ${chain}.`;
    case 'payment':
      return `Make a second real payment through ${name} for a different purchase.`;
    case 'governance':
      return `Vote on a second live proposal with ${name} on ${chain}.`;
    case 'prediction':
      return `Place a second position on a different market on ${name}.`;
    case 'derivative':
      return `Open a second small hedge on a different pair on ${name}.`;
    case 'cedefi':
      return `Deposit a second, smaller amount into a different CeDeFi vault of ${name} on ${chain}.`;
    case 'stable':
      return `Mint a second, smaller amount of the stable asset through ${name} on ${chain}.`;
    case 'launchpad':
      return `Register for a second allocation through ${name} on ${chain}.`;
    case 'btc':
      return `Deposit a second, smaller amount of the BTC-backed asset into ${name} on ${chain}.`;
    case 'index':
      return `Buy a second, smaller amount of the ${name} index token on ${chain}.`;
    case 'card':
      return `Pay for a second real purchase with the ${name} card.`;
    case 'yield':
      return `Deposit a second, smaller amount into a different yield vault of ${name} on ${chain}.`;
    default:
      return `Make a second, smaller deposit into ${name} on ${chain}.`;
  }
}

/** One step as a single string: the action, then its cost and its time. */
function stepString(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A protocol's seven-step farm plan, from its own record alone. */
export function farmPlan(p: SnapshotProtocol, age: number | null): string[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const family = familyOf(p.category);
  const first = qualifyFirst(family, p.name, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that you use only for farming ${p.name}, and write its seed phrase on paper and keep it offline.`,
      cost: 'nothing',
      time: '5 minutes',
    },
    { text: first, cost: `$${capital} of capital and about ${gas.setup} of gas to set up`, time: '15 minutes' },
  ];
  if (p.chains.length > 1) {
    const chain2 = p.chains[1]!;
    const gas2 = gasFor(chain2);
    steps.push({
      text: `Repeat the qualifying move on ${chain2}: ${qualifyFirst(family, p.name, capital, chain2)}`,
      cost: `about ${gas2.setup} of gas to set up`,
      time: '10 minutes',
    });
  } else {
    steps.push({
      text: qualifySecond(family, p.name, chain),
      cost: `about ${gas.setup} of gas`,
      time: '10 minutes',
    });
  }
  steps.push(
    {
      text: `Once a week, make one qualifying move on ${p.name} and leave the position open.`,
      cost: `about ${gas.weekly} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity is counted across more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from a link that page itself publishes; never pay anyone to claim for you.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps.map(stepString);
}

// ---------------------------------------------------------------- the board

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The ranked board: the whole watchlist plus every pre-token protocol that survives. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { globalMedian, byCategory } = computeMultiples(snapshot, model);
  const multipleByCategory = new Map(byCategory.map((c) => [c.category, c.multiple]));
  const globalMultiple = round4(clamp(globalMedian, model.multiple_floor, model.multiple_cap));

  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isPreToken(p) && passesExclusion(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const multiple = multipleByCategory.get(p.category ?? 'Uncategorized') ?? globalMultiple;
    const { implied, breakdown } = scoreProtocol(p, snapshot.as_of, multiple, model);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.breakdown.age_days,
    implied_value_usd: s.implied,
    token_status: 'no token on record' as const,
    watchlist: snapshot.watchlist.includes(s.p.slug),
    breakdown: s.breakdown,
    farm_steps: farmPlan(s.p, s.breakdown.age_days),
  }));
}

/** Every live-token protocol, by market cap, for the dashboard's Live view. */
export function buildLive(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter(isLive)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      ratio: round4(p.mcap_usd! / p.tvl_usd),
    }));
}

/** Everything the dashboard needs, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = buildLive(snapshot);
  const { globalMedian, byCategory } = computeMultiples(snapshot, model);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    multiples: { global_median: round4(globalMedian), live_count: live.length, by_category: byCategory },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board has ${board.length} rows, fewer than 100`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: a single global, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
