// The five factions of the Shattered Reach.

export const FACTIONS = [
  {
    id: 'concord', name: 'The Brass Concord', short: 'Concord', color: '#e8b45a',
    motto: 'Order, forged.', aggression: 0.55, tax: 0.05,
    exports: ['ore', 'alloys'], personality: 'Industrial syndicate of foundries and ledgers. Pays well, trusts slowly, and regards free captains as useful chaos.',
  },
  {
    id: 'verdant', name: 'The Verdant Compact', short: 'Compact', color: '#7bc96f',
    motto: 'The harvest provides.', aggression: 0.30, tax: 0.04,
    exports: ['grain', 'spice'], personality: 'A communion of terrace-farmers. Feeds half the Reach and never lets anyone forget it.',
  },
  {
    id: 'choir', name: 'The Tidebound Choir', short: 'Choir', color: '#4fd8c8',
    motto: 'All waters return.', aggression: 0.20, tax: 0.04,
    exports: ['water', 'medicine'], personality: 'Healers and storm-readers who believe the Shroud is a tide that will one day ebb.',
  },
  {
    id: 'union', name: 'Free Captains\u2019 Union', short: 'Union', color: '#8f9dff',
    motto: 'No flag but the wind.', aggression: 0.40, tax: 0.02,
    exports: ['textiles', 'embers'], personality: 'A mutual-insurance guild of skyfarers. Low taxes, loose rules, loud harbors.',
  },
  {
    id: 'syndicate', name: 'The Ashen Syndicate', short: 'Syndicate', color: '#e0596e',
    motto: 'Everything is for sale.', aggression: 0.70, tax: 0.06,
    exports: ['armaments', 'relics'], personality: 'Smuggler-armsmen who monetize every war they did not start. Probably several they did.',
  },
];

export const FACTION_MAP = Object.fromEntries(FACTIONS.map((f) => [f.id, f]));

// Starting tensions. Pairs under −30 are one bad week away from war.
export const BASE_RELATIONS = {
  'concord|syndicate': -45,
  'verdant|syndicate': -30,
  'choir|concord': 10,
  'choir|verdant': 25,
  'union|concord': 15,
  'union|verdant': 20,
  'union|choir': 15,
  'union|syndicate': -10,
};

export function relKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

export const REP_TIERS = [
  { min: -100, name: 'Hostile', color: '#ff5d6c' },
  { min: -40, name: 'Wary', color: '#ff9d5c' },
  { min: -10, name: 'Neutral', color: '#c8c2b4' },
  { min: 20, name: 'Friendly', color: '#8fd18a' },
  { min: 50, name: 'Trusted', color: '#4fd8c8' },
  { min: 80, name: 'Exalted', color: '#ffd75e' },
];

export function repTier(v) {
  let t = REP_TIERS[0];
  for (const tier of REP_TIERS) if (v >= tier.min) t = tier;
  return t;
}
