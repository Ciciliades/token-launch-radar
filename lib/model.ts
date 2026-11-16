// Token launch radar: the scoring model.
//
// The board ranks every protocol in the snapshot that could still launch a token of its own:
// pre-token, not an exchange, not a versioned pool, and not a wrapped, staked or bridged product
// of an asset that already exists. The watchlist is always covered in full; the rest of the board
// is every other candidate the same rule admits, whatever its TVL.
//
// Implied value is derived from the snapshot alone, in four steps:
//
//   multiple   the median market-cap-to-TVL ratio of the live-token protocols in this same
//              snapshot (clamped to a sane band), so the multiple is the market's own, not a guess
//   growth     1 + clamp(change_7d, -50, 100) / 100 x 0.4
//   maturity   0.70 + min(age_days, 730) / 730 x 0.30   (age unknown: 365 days)
//   breadth    1 + min(chains - 1, 4) x 0.03            (a footprint on more chains counts, capped)
//   implied    max(1, round(tvl_usd x multiple x growth x maturity x breadth))
//
// No protocol name is ever special-cased: one function scores every row, and the farm plan for a
// row is derived from that row's category, chains, TVL and age only.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
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

/** The tunable parameters of the model. The multiple itself is calibrated, not tuned. */
export interface ModelParams {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_weight: number;
  breadth_cap_chains: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL_PARAMS: ModelParams = {
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 730,
  unknown_age_days: 365,
  breadth_weight: 0.03,
  breadth_cap_chains: 5,
  multiple_floor: 0.1,
  multiple_cap: 0.5,
};

/** The model's version label, shown by the dashboard. */
export const MODEL_VERSION = 'radar-2-calibrated';

/** How many live-token protocols the dashboard's comparables view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The calibration: the market multiple the snapshot itself implies, and its spread. */
export interface Calibration {
  multiple: number;
  protocols: number;
  p25: number;
  p75: number;
}

/** One farm step before it is flattened to a string: action, cost, time. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One board row as the dashboard receives it, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A protocol that already trades: the dashboard shows the market's value, never a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** A pre-token protocol set aside from the ranking, with the rule that set it aside. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  calibration: Calibration;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
}

/** Why a snapshot cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The watchlist's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that mark a wrapped, staked or bridged product rather than a standalone protocol. */
const SET_ASIDE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange brands whose products carry the exchange's name. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word that marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Why a pre-token protocol is set aside from the ranking, or null when it is a launch candidate.
 * The rule follows the watchlist's own definition: a wrapped or bridged product of an asset that
 * already exists is not a protocol still waiting on a launch of its own.
 */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category === 'CEX') return 'Centralised exchange: any token would be an exchange decision, not a protocol launch.';
  if (VERSIONED.test(p.name)) return 'Versioned pool: a release of another protocol, not a standalone launch.';
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return 'Wrapped, staked or bridged product: it wraps an asset that already exists.';
  if (WRAPPED_WORD.test(p.name)) return 'Wrapped or staked product: the name marks it as another asset in a wrapper.';
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return 'Exchange product: issued under an exchange brand.';
  return null;
}

/** Whether a protocol belongs on the ranked board. */
export function isCandidate(p: SnapshotProtocol): boolean {
  return isPreToken(p) && setAsideReason(p) === null;
}

/**
 * The market multiple: the median market-cap-to-TVL ratio of the snapshot's live-token
 * protocols (exchanges and versioned pools excluded), clamped to the model's band. With no
 * live protocols to learn from, the neutral midpoint of the band is used.
 */
export function calibrateMultiple(snapshot: Snapshot, params: ModelParams): Calibration {
  const ratios = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && p.tvl_usd > 0 && (p.mcap_usd ?? 0) > 0)
    .map((p) => (p.mcap_usd as number) / p.tvl_usd)
    .sort((a, b) => a - b);
  if (ratios.length === 0) {
    const mid = (params.multiple_floor + params.multiple_cap) / 2;
    return { multiple: round4(mid), protocols: 0, p25: round4(mid), p75: round4(mid) };
  }
  const mid = ratios.length % 2 === 1 ? ratios[(ratios.length - 1) / 2]! : (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2;
  const clamped = Math.min(params.multiple_cap, Math.max(params.multiple_floor, mid));
  return {
    multiple: round4(clamped),
    protocols: ratios.length,
    p25: round4(ratios[Math.floor(ratios.length * 0.25)]!),
    p75: round4(ratios[Math.floor(ratios.length * 0.75)]!),
  };
}

/** The multipliers and implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  params: ModelParams,
  multiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(params.growth_cap, Math.max(params.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * params.growth_weight;
  const ageForModel = age ?? params.unknown_age_days;
  const maturityMult = params.maturity_floor + (Math.min(Math.max(ageForModel, 0), params.maturity_days) / params.maturity_days) * params.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), params.breadth_cap_chains - 1);
  const breadthMult = 1 + extraChains * params.breadth_weight;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** The ranked board: every watchlist slug, plus every other candidate, strongest first. */
export function buildBoard(snapshot: Snapshot, params: ModelParams = MODEL_PARAMS): { board: BoardRow[]; calibration: Calibration } {
  const calibration = calibrateMultiple(snapshot, params);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isCandidate(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, params, calibration.multiple);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: calibration.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { board, calibration };
}

/** A step as one string: action, cost and time, inside the gate's 20 to 600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, scaled to the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 45;
}

/** Rough gas for the setup transaction, scaled to the position size. */
function gasFor(capital: number): number {
  if (capital >= 200) return 10;
  if (capital >= 120) return 6;
  return 4;
}

type ActionRule = { test: (category: string) => boolean; make: (name: string, capital: number, chain: string) => string };

/** The category's core action, most specific category first. No protocol name is ever matched. */
const ACTIONS: ActionRule[] = [
  { test: (c) => c.includes('curator') || c.includes('allocator') || c.includes('aggregator'), make: (n, k, ch) => `Deposit $${k} into a ${n} vault on ${ch} and keep the vault shares in the farm wallet.` },
  { test: (c) => c.includes('lend') || c.includes('uncollateralized') || c.includes('cdp') || c.includes('collateral'), make: (n, k, ch) => `Supply $${k} of USDC to ${n} on ${ch}, borrow a small amount against it, and repay the borrow within the week.` },
  { test: (c) => c.includes('dex') || c.includes('liquidity') || c.includes('farm'), make: (n, k, ch) => `Provide $${k} of liquidity to ${n}'s largest pool on ${ch} and keep the position open.` },
  { test: (c) => c.includes('bridge'), make: (n, k, ch) => `Bridge $${k} of USDC into ${ch} through ${n} and use the bridged funds inside its app.` },
  { test: (c) => c.includes('staking') || c.includes('restak'), make: (n, k, ch) => `Stake $${k} of the chain's staking asset through ${n} on ${ch} and keep the receipt token.` },
  { test: (c) => c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic') || c.includes('basis'), make: (n, k, ch) => `Deposit $${k} of USDC as margin on ${n}, open one small hedged position, and close it after a day.` },
  { test: (c) => c.includes('prediction'), make: (n, k, ch) => `Fund $${k} on ${n} and place one prediction position on ${ch}, then leave the funds staked in the market.` },
  { test: (c) => c.includes('stable'), make: (n, k, ch) => `Mint or deposit $${k} of the stable asset through ${n} on ${ch} and hold the balance.` },
  { test: (c) => c.includes('rwa'), make: (n, k, ch) => `Mint $${k} of the protocol's yield-bearing asset on ${ch} through ${n} and hold it.` },
  { test: (c) => c.includes('insurance'), make: (n, k, ch) => `Buy $${k} of cover from ${n} on ${ch} and keep the policy active.` },
  { test: (c) => c.includes('launchpad'), make: (n, k, ch) => `Stake or commit $${k} through ${n}'s launchpad on ${ch} to qualify for an allocation.` },
  { test: (c) => c.includes('index'), make: (n, k, ch) => `Buy $${k} of the ${n} index token on ${ch} and hold it in the farm wallet.` },
  { test: (c) => c.includes('payment') || c.includes('card'), make: (n, k, ch) => `Load $${k} through ${n} on ${ch} and make one real payment with it.` },
  { test: (c) => c.includes('nft'), make: (n, k, ch) => `List or buy one item worth about $${k} on ${n} on ${ch} and keep the receipt.` },
  { test: (c) => c.includes('privacy'), make: (n, k, ch) => `Make one shielded deposit of $${k} through ${n} on ${ch} and keep the proof.` },
  { test: (c) => c.includes('governance'), make: (n, k, ch) => `Deposit $${k} with ${n} on ${ch} and cast one governance vote or delegation.` },
  { test: (c) => c.includes('locker'), make: (n, k, ch) => `Lock $${k} of tokens through ${n} on ${ch} for the shortest lock it offers.` },
  { test: (c) => c.includes('chain'), make: (n, k, ch) => `Bridge $${k} to ${n} and use two of its native apps, keeping a balance on the chain.` },
  { test: (c) => c.includes('ai') || c.includes('agent'), make: (n, k, ch) => `Run one paid task or stake $${k} for compute through ${n} on ${ch}.` },
  { test: (c) => c.includes('otc'), make: (n, k, ch) => `Place one OTC order of about $${k} through ${n} on ${ch} and settle it.` },
  { test: (c) => c.includes('btc') || c.includes('anchor'), make: (n, k, ch) => `Deposit $${k} of BTC-backed collateral through ${n} on ${ch} and keep the position.` },
  { test: (c) => c.includes('cede') || c.includes('reserve') || c.includes('dor'), make: (n, k, ch) => `Deposit $${k} into the ${n} vault on ${ch} and keep the receipt.` },
  { test: (c) => c.includes('yield'), make: (n, k, ch) => `Deposit $${k} into ${n}'s largest yield vault on ${ch} and keep the shares.` },
];

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of ACTIONS) if (rule.test(c)) return rule.make(p.name, capital, chain);
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. Derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = primaryChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(capital);
  return [
    { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas`, time: '20 minutes to set up' },
    { text: `Return after 48 hours and make a second qualifying action on ${p.name}, so the wallet shows repeat activity rather than a single visit.`, cost: 'about $2 of gas', time: '10 minutes' },
    { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot window.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Open ${p.name}'s own points or rewards page once a week and record the balance, so a missing snapshot is noticed early.`, cost: 'no fee to check', time: '10 minutes a week' },
    { text: 'When you unwind, claim only from the link the protocol itself publishes, never pay anyone to claim, and write the wallet, the dates and every transaction in a farm log.', cost: 'gas to unwind, and nothing to claim', time: '20 minutes' },
  ];
}

/** The live-token comparables, by market cap, with each protocol's own market multiple. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The pre-token protocols set aside from the ranking, largest TVL first, with their reasons. */
export function setAsideRows(snapshot: Snapshot): SetAsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && setAsideReason(p) !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: setAsideReason(p) as string,
    }));
}

/** A board row's dashboard form, with its farm plan and its watchlist flag. */
export function radarRow(row: BoardRow, watchlist: ReadonlySet<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, params: ModelParams = MODEL_PARAMS): { board: BoardRow[]; radar: RadarData } {
  const { board, calibration } = buildBoard(snapshot, params);
  const live = liveRows(snapshot);
  const setAside = setAsideRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: params,
    calibration,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside.length,
    rows: board.map((r) => radarRow(r, watch)),
    live,
    set_aside: setAside,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape this model scores. */
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
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: size, coverage, ranks, order, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside the 100 to 4000 the gate takes`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share implied value $${board[0]!.implied_value_usd}`;
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.name.trim().length === 0) return `${r.slug} has an empty name`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network, the page reads it directly. */
export function dataScript(radar: RadarData): string {
  return `window.TOKEN_RADAR=${JSON.stringify(radar)};\n`;
}
