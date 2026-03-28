const STORAGE_KEY = 'keepaway_stats';

function getDefaultStats() {
  return {
    totalGames: 0,
    totalWins: 0,
    byMode: {},
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultStats();
    return JSON.parse(raw);
  } catch {
    return getDefaultStats();
  }
}

function save(stats) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch { /* storage full or unavailable */ }
}

export const StatsManager = {
  recordGame(gameType, didWin) {
    if (!gameType || gameType === 'random') return; // random resolved before this
    const stats = load();
    stats.totalGames++;
    if (didWin) stats.totalWins++;
    if (!stats.byMode[gameType]) {
      stats.byMode[gameType] = { played: 0, wins: 0 };
    }
    stats.byMode[gameType].played++;
    if (didWin) stats.byMode[gameType].wins++;
    save(stats);
  },

  getStats() {
    return load();
  },

  getWinRate() {
    const stats = load();
    if (stats.totalGames === 0) return 0;
    return Math.round((stats.totalWins / stats.totalGames) * 100);
  },

  getModeStats(gameType) {
    const stats = load();
    return stats.byMode[gameType] || { played: 0, wins: 0 };
  },
};
