import Phaser from 'phaser';
import { LobbyScene } from './scenes/LobbyScene.js';
import { GameScene } from './scenes/GameScene.js';

const MAP_WIDTH = 960;
const MAP_HEIGHT = 540;

const config = {
  type: Phaser.AUTO,
  width: MAP_WIDTH,
  height: MAP_HEIGHT,
  backgroundColor: '#1a1a2e',
  parent: 'game-container',
  dom: { createContainer: true },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    expandParent: true,
    min: { width: 400, height: 300 },
    max: { width: 1600, height: 1200 },
  },
  scene: [LobbyScene, GameScene],
};

new Phaser.Game(config);
