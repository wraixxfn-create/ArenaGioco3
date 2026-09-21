// Procedural naming + flavor pools. Seeded generators live in world/gen.js.

const MOOR_PRE = [
  'Lantern', 'Vesper', 'Salt', 'Ember', 'Kiln', 'Wind', 'Aster', 'Morrow', 'Cinder', 'Gloam',
  'Hallow', 'Brass', 'Thorn', 'Pale', 'Kestrel', 'Anchor', 'Solace', 'Rime', 'Aurel', 'Dusk',
  'Bell', 'Cairn', 'Sable', 'Fennon', 'Gilded', 'Hollow', 'Iron', 'Juniper', 'Lark', 'Mist',
];

const MOOR_SUF = [
  'haven', 'rest', 'watch', 'spire', 'moor', 'gate', 'reach', 'fall', 'strand', 'hollow',
  'terrace', 'anchor', 'wharf', 'ledge', 'port', 'crown', 'point', 'shoal', 'bastion', 'step',
];

export function genMooringName(rng, used) {
  for (let i = 0; i < 400; i++) {
    const name = MOOR_PRE[Math.floor(rng() * MOOR_PRE.length)] + MOOR_SUF[Math.floor(rng() * MOOR_SUF.length)];
    if (!used.has(name)) { used.add(name); return name; }
  }
  return `Waypoint ${used.size + 1}`;
}

const P_FIRST = ['Mira', 'Cass', 'Dorn', 'Yev', 'Sable', 'Ines', 'Toma', 'Rell', 'Osha', 'Bram', 'Kessa', 'Ulric', 'Nym', 'Petra', 'Jorun', 'Vex', 'Halda', 'Seren'];
const P_LAST = ['Vane', 'Ockle', 'Dray', 'of the Choir', 'Saltborn', 'Kilnwright', 'Moonpier', 'Ashgrove', 'the Younger', 'Tidecaller', 'Ferrous', 'of the Compact', 'Whisperwind', 'Coppervein'];

export function genPassengerName(rng) {
  return `${P_FIRST[Math.floor(rng() * P_FIRST.length)]} ${P_LAST[Math.floor(rng() * P_LAST.length)]}`;
}

export const PASSENGER_FLAVOR = [
  'Carries a sealed letter and refuses to say for whom.',
  'Hums old harbor hymns, slightly off-key.',
  'Pays double if you do not ask about the cage.',
  'Claims to have seen the far side of the Shroud. Twice.',
  'Wears a Concord officer\u2019s coat with the insignia cut off.',
  'Reads the clouds aloud like scripture.',
  'Smells faintly of spice and gunpowder.',
  'Insists on being addressed as \u201cCaptain\u201d, then laughs.',
];

export const VEX_LINES = {
  welcome: 'Quartermaster Vex, retired. I keep the ledger; you keep us alive. Buy cheap, sell dear, and never trust a calm sky.',
  firstBuy: 'Good. Now the trick: grain is worth twice as much anywhere it does not grow. Watch the spread column.',
  firstSell: 'That margin pays for fuel, repairs, and eventually a bigger hold. This is the whole game, captain.',
  firstContract: 'Contract boards are where factions admit what they need. Deadlines are real — the sea does not renegotiate.',
  lowFuel: 'The tank is thin. Embers are cheaper at Union wells; running dry mid-lane means drifting, and drifting means pirates.',
  warStart: 'War. Terrible business, wonderful margins. Armaments and grain will spike on both sides of that lane.',
  storm: 'The Shroud is restless. Stormed lanes take longer and bite harder. Plan around them or profit from them.',
  relic: 'An old-world relic. The Choir will bless it, the Syndicate will price it, and you will keep it. Wise.',
  broke: 'Coffers are nearly dry. Relief work always pays an advance — pride is expensive, grain is cheap.',
};

export const LOG_FLAVOR = [
  'Caravan bells heard on the southern lanes.',
  'A choir procession passes without docking.',
  'Fishers report ember-light beneath the clouds.',
];
