import { loadGameConfig } from '../../config/configLoader.js';
import MenuScene from './menuScene.js';
import SinglePlayerScene from './singlePlayerScene.js';
import MultiplayerScene from './multiplayerScene.js';

// ========================================
// INICIALIZAÇÃO COM LOADING
// ========================================

(async function initGame() {
    const loadingScreen = document.getElementById('loading-screen');

    try {
        console.log('🔄 Carregando configurações do servidor...');
        const gameConfig = await loadGameConfig();

        console.log('✅ Configurações carregadas:', gameConfig);

        const config = {
            type: Phaser.AUTO,
            title: 'Ping Pong Multiplayer',
            width: gameConfig.WIDTH,
            height: gameConfig.HEIGHT,
            backgroundColor: '#000000',
            pixelArt: false,
            parent: 'game-container', // ✅ Renderiza dentro da div#game-container
            physics: {
                default: 'arcade',
                arcade: {
                    gravity: { y: 0 },
                    debug: false
                }
            },
            scene: [MenuScene, SinglePlayerScene, MultiplayerScene],
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH
            }
        };

        const game = new Phaser.Game(config);

        game.registry.set('gameConfig', gameConfig);

        setTimeout(() => {
            loadingScreen.classList.add('fade-out');
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 500);
        }, 800);

    } catch (error) {
        console.error('❌ Erro ao inicializar o jogo:', error);

        const loadingText = loadingScreen.querySelector('p');
        loadingText.textContent = '❌ Erro ao carregar configurações. Recarregue a página.';
        loadingText.style.color = '#ff0000';
    }
})();