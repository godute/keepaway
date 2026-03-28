const CHARACTERS = {
  poodle: {
    id: 'poodle',
    name: '푸들',
    emoji: '🐩',
    body: 0xf5deb3,
    bodyHighlight: 0xfaebd7,
    ear: 0xe8d5b7,
    eyeColor: 0x222222,
    noseColor: 0x444444,
    earType: 'round',
    features: ['curlyFur'],
  },
  shiba: {
    id: 'shiba',
    name: '시바',
    emoji: '🐕',
    body: 0xf4a460,
    bodyHighlight: 0xffdab9,
    ear: 0xd2691e,
    eyeColor: 0x222222,
    noseColor: 0x333333,
    earType: 'pointy',
    features: ['whiteCheeks', 'whiteBelly'],
  },
  husky: {
    id: 'husky',
    name: '허스키',
    emoji: '🐺',
    body: 0xa0aab4,
    bodyHighlight: 0xc0c8d0,
    ear: 0x808890,
    eyeColor: 0x4488cc,
    noseColor: 0x333333,
    earType: 'pointy',
    features: ['faceMask'],
  },
  samoyed: {
    id: 'samoyed',
    name: '사모예드',
    emoji: '🐻‍❄️',
    body: 0xfff8f0,
    bodyHighlight: 0xffffff,
    ear: 0xf0e8e0,
    eyeColor: 0x222222,
    noseColor: 0x333333,
    earType: 'round',
    features: ['fluffyFur'],
  },
  dachshund: {
    id: 'dachshund',
    name: '닥스훈트',
    emoji: '🌭',
    body: 0x8b4513,
    bodyHighlight: 0xa0522d,
    ear: 0x6b3410,
    eyeColor: 0x222222,
    noseColor: 0x222222,
    earType: 'floppy',
    features: ['longNose'],
  },
  dalmatian: {
    id: 'dalmatian',
    name: '달마시안',
    emoji: '🐾',
    body: 0xffffff,
    bodyHighlight: 0xf8f8f8,
    ear: 0xe0e0e0,
    eyeColor: 0x222222,
    noseColor: 0x111111,
    earType: 'round',
    features: ['spots'],
  },
};

const CHARACTER_IDS = Object.keys(CHARACTERS);
const DEFAULT_CHARACTER = 'poodle';

function isValidCharacter(id) {
  return CHARACTER_IDS.includes(id);
}

module.exports = { CHARACTERS, CHARACTER_IDS, DEFAULT_CHARACTER, isValidCharacter };
