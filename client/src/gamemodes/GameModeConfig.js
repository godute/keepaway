export const GAME_MODES = {
  keepaway:  { id: 'keepaway',  name: 'Keepaway',   nameKo: '뼈다귀 쟁탈전', emoji: '🦴', desc: '뼈를 잡고 30점 먼저!', minPlayers: 2 },
  tag:       { id: 'tag',       name: 'Tag',        nameKo: '술래잡기',       emoji: '🏃', desc: '술래 시간이 짧으면 승리!', minPlayers: 2 },
  hotpotato: { id: 'hotpotato', name: 'Hot Potato', nameKo: '폭탄 돌리기',    emoji: '💣', desc: '폭탄 터지기 전에 넘겨라!', minPlayers: 3 },
  territory: { id: 'territory', name: 'Territory',  nameKo: '영역 칠하기',    emoji: '🎨', desc: '가장 넓은 영역 차지!', minPlayers: 2 },
  sumo:      { id: 'sumo',      name: 'Sumo',       nameKo: '씨름',           emoji: '🤼', desc: '링 밖으로 밀어내라!', minPlayers: 2 },
  dodgeball: { id: 'dodgeball', name: 'Dodgeball',  nameKo: '피구',           emoji: '🏐', desc: '공을 피해 살아남아라!', minPlayers: 2 },
  hideseek:  { id: 'hideseek',  name: 'Hide & Seek', nameKo: '숨바꼭질',      emoji: '🙈', desc: '숨어라! 술래가 찾는다!', minPlayers: 3 },
  random:    { id: 'random',    name: 'Random',     nameKo: '랜덤',           emoji: '🎲', desc: '무작위 게임!',       minPlayers: 2 },
};

export const GAME_MODE_IDS = Object.keys(GAME_MODES);

export const DEFAULT_GAME_MODE = 'keepaway';
