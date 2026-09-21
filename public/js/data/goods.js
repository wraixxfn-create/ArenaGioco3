// The ten trade goods. Every economic number in the sim hangs off this table.

export const GOODS = {
  water:     { id: 'water',     name: 'Water',     icon: '💧', base: 6,   tier: 0, restricted: false, blurb: 'Life itself, bottled. Every mooring drinks, few moorings rain.' },
  grain:     { id: 'grain',     name: 'Grain',     icon: '🌾', base: 9,   tier: 0, restricted: false, blurb: 'Sky-wheat grown on tethered terraces. The Reach runs on it.' },
  embers:    { id: 'embers',    name: 'Embers',    icon: '🔥', base: 18,  tier: 0, restricted: false, fuel: true, blurb: 'Slow-burning cinder-crystal. Fuel for ships and forges alike.' },
  ore:       { id: 'ore',       name: 'Raw Ore',   icon: '⛏️', base: 14,  tier: 0, restricted: false, blurb: 'Unrefined star-iron, heavy and cheap. Smiths pay for it.' },
  textiles:  { id: 'textiles',  name: 'Textiles',  icon: '🧵', base: 28,  tier: 1, restricted: false, blurb: 'Cloudsilk and canvas. Sails, coats, and status.' },
  spice:     { id: 'spice',     name: 'Spice',     icon: '🌶️', base: 34,  tier: 1, restricted: false, blurb: 'Wake-pepper and ghost-anise. Small holds, fat margins.' },
  alloys:    { id: 'alloys',    name: 'Alloys',    icon: '⚙️', base: 46,  tier: 1, restricted: false, blurb: 'Brass and voidsteel ingots. The Concord\u2019s pride.' },
  medicine:  { id: 'medicine',  name: 'Medicine',  icon: '💊', base: 62,  tier: 2, restricted: false, blurb: 'Choir-blessed tinctures. Worth any price during a fever season.' },
  armaments: { id: 'armaments', name: 'Armaments', icon: '🗡️', base: 88,  tier: 2, restricted: true,  blurb: 'Cannons, shot, and boarding steel. Legal only with a faction license.' },
  relics:    { id: 'relics',    name: 'Relics',    icon: '🏺', base: 140, tier: 3, restricted: true,  blurb: 'Salvage from the old world. Collectors and the Syndicate pay absurd sums.' },
};

export const GOOD_ORDER = ['water', 'grain', 'embers', 'ore', 'textiles', 'spice', 'alloys', 'medicine', 'armaments', 'relics'];

export const CONSUMABLES = ['water', 'grain', 'spice', 'medicine', 'textiles'];

export function goodById(id) { return GOODS[id]; }
