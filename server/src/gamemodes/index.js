const KeepawayMode = require('./KeepawayMode');
const TagMode = require('./TagMode');
const SumoMode = require('./SumoMode');
const HotPotatoMode = require('./HotPotatoMode');
const TerritoryMode = require('./TerritoryMode');

const GAME_MODES = {
  keepaway:  { Mode: KeepawayMode,  name: 'Keepaway',     nameKo: '뼈다귀 쟁탈전', emoji: '🦴', minPlayers: 2 },
  tag:       { Mode: TagMode,       name: 'Tag',          nameKo: '술래잡기',       emoji: '🏃', minPlayers: 2 },
  hotpotato: { Mode: HotPotatoMode, name: 'Hot Potato',   nameKo: '폭탄 돌리기',    emoji: '💣', minPlayers: 3 },
  territory: { Mode: TerritoryMode, name: 'Territory',    nameKo: '영역 칠하기',    emoji: '🎨', minPlayers: 2 },
  sumo:      { Mode: SumoMode,      name: 'Sumo',         nameKo: '씨름',           emoji: '🤼', minPlayers: 2 },
};

function createGameMode(gameType, room) {
  const entry = GAME_MODES[gameType];
  if (!entry) return new KeepawayMode(room);
  return new entry.Mode(room);
}

function isValidGameType(type) {
  return type === 'random' || type in GAME_MODES;
}

function getRandomGameType(playerCount) {
  const eligible = Object.keys(GAME_MODES).filter(key => GAME_MODES[key].minPlayers <= playerCount);
  return eligible[Math.floor(Math.random() * eligible.length)] || 'keepaway';
}

module.exports = { GAME_MODES, createGameMode, isValidGameType, getRandomGameType };
