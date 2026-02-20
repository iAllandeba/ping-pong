export class BaseGameScene extends Phaser.Scene {
    constructor(key) {
        super({ key: key });
        this._escHandler = null;
        this.endGameContainer = null; // Adicionado para agrupar elementos do menu de fim de jogo
    }

    async init(data) {
        this.cfg = this.game.registry.get('gameConfig');

        this.gameStarted = false;
        this.score1 = 0;
        this.score2 = 0;
        this.lastHitPaddle = null;

        this.sfx = {
            hitPaddle: null,
            score: null,
            countdownBeep: null,
            countdownGo: null,
            victory: null
        };

        this.ballTrail = null;
        this.trailPoints = [];
        this.hitEmitter = null;

        this.waitOverlay = null;
        this.waitText = null;
        this.waitSub = null;
        this.countdownText = null;
    }

    preload() {
        this.load.audio('hitPaddle', 'assets/audio/hit_paddle.wav');
        this.load.audio('score', 'assets/audio/score.wav');
        this.load.audio('countdownBeep', 'assets/audio/countdown_beep.wav');
        this.load.audio('countdownGo', 'assets/audio/countdown_go.wav');
        this.load.audio('victory', 'assets/audio/victory.wav');
    }

    create() {
        this.createGameObjects();
        this.createHud();
        this.setupInput();
        this.setupAudioInstances();
        this.createBallTrail();
        this.createHitEmitter();
    }

    update() {
        if (!this.gameStarted) return;

        this.updateBallTrail();
    }

    endGame() {
        this.gameStarted = false;

        if (this.sfx.victory) {
            this.sfx.victory.play({ volume: 0.9 });
        }
    }

    stopGameLogic() {
        this.gameStarted = false;

        if (this.ball && this.ball.body) {
            this.ball.body.setVelocity(0, 0);
            this.ball.body.enable = false;
        }
        if (this.paddle1 && this.paddle1.body) {
            this.paddle1.body.setVelocityY(0);
            this.paddle1.body.enable = false;
        }
        if (this.paddle2 && this.paddle2.body) {
            this.paddle2.body.setVelocityY(0);
            this.paddle2.body.enable = false;
        }
        if (this.ballTrail) {
            this.ballTrail.clear();
            this.trailPoints = [];
        }
    }

    createGameObjects() {
        this.add.rectangle(this.cfg.WIDTH / 2, this.cfg.HEIGHT / 2, 4, this.cfg.HEIGHT, 0xffffff).setOrigin(0.5);

        this.paddle1 = this.add.rectangle(this.cfg.PADDLE1_X, this.cfg.HEIGHT / 2, this.cfg.PADDLE_WIDTH, this.cfg.PADDLE_HEIGHT, 0xffffff);
        this.paddle2 = this.add.rectangle(this.cfg.PADDLE2_X, this.cfg.HEIGHT / 2, this.cfg.PADDLE_WIDTH, this.cfg.PADDLE_HEIGHT, 0xffffff);
        this.ball = this.add.circle(this.cfg.WIDTH / 2, this.cfg.HEIGHT / 2, this.cfg.BALL_RADIUS, 0xffffff);
    }

    createHud() {
        this.add.text(this.cfg.WIDTH / 2, 30, 'PING PONG', {
            fontSize: '36px',
            fill: '#ffffff',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        this.statusText = this.add.text(this.cfg.WIDTH / 2, 75, '', { fontSize: '20px', fill: '#888888' }).setOrigin(0.5);

        this.waitOverlay = this.add.rectangle(this.cfg.WIDTH / 2, this.cfg.HEIGHT / 2, this.cfg.WIDTH, this.cfg.HEIGHT, 0x000000, 0.8).setDepth(100).setVisible(false);
        this.waitText = this.add.text(this.cfg.WIDTH / 2, 330, '', {
            fontSize: '40px',
            fill: '#ffffff',
            fontStyle: 'bold',
            align: 'center'
        }).setOrigin(0.5).setDepth(101).setVisible(false);
        this.waitSub = this.add.text(this.cfg.WIDTH / 2, 400, '', {
            fontSize: '20px',
            fill: '#cccccc',
            align: 'center'
        }).setOrigin(0.5).setDepth(101).setVisible(false);

        this.countdownText = this.add.text(this.cfg.WIDTH / 2, this.cfg.HEIGHT / 2, '', {
            fontSize: '120px',
            fill: '#ffd700',
            fontStyle: 'bold',
            stroke: '#000',
            strokeThickness: 8
        }).setOrigin(0.5).setDepth(102).setVisible(false);

        this.score1Text = this.add.text(this.cfg.WIDTH / 2 - 100, 120, '0', {
            fontSize: '64px',
            fill: '#ffffff',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        this.score2Text = this.add.text(this.cfg.WIDTH / 2 + 100, 120, '0', {
            fontSize: '64px',
            fill: '#ffffff',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        this.add.text(this.cfg.WIDTH / 2, 120, '-', { fontSize: '64px', fill: '#666666' }).setOrigin(0.5);
    }

    setupInput() {
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys('W,S,ESC');

        this._escHandler = () => {
            console.log(`${this.scene.key}: ESC pressed, returning to MenuScene.`);
            this.onEscToMenu();
        };

        this.input.keyboard.on('keydown-ESC', this._escHandler);
    }

    setupAudioInstances() {
        this.sfx.hitPaddle = this.sound.add('hitPaddle');
        this.sfx.score = this.sound.add('score');
        this.sfx.countdownBeep = this.sound.add('countdownBeep');
        this.sfx.countdownGo = this.sound.add('countdownGo');
        this.sfx.victory = this.sound.add('victory');
    }

    createBallTrail() {
        this.ballTrail = this.add.graphics();
        this.trailPoints = [];
    }

    updateBallTrail() {
        if (!this.ball) return;

        this.trailPoints.push({ x: this.ball.x, y: this.ball.y });
        if (this.trailPoints.length > 10) this.trailPoints.shift();

        this.ballTrail.clear();
        for (let i = 1; i < this.trailPoints.length; i++) {
            const alpha = i / this.trailPoints.length;
            this.ballTrail.lineStyle(2, 0xffffff, alpha * 0.3);
            this.ballTrail.lineBetween(this.trailPoints[i - 1].x, this.trailPoints[i - 1].y, this.trailPoints[i].x, this.trailPoints[i].y);
        }
    }

    createHitEmitter() {
        if (!this.textures.exists('spark')) {
            const graphics = this.add.graphics();
            graphics.fillStyle(0xffffff, 1);
            graphics.fillCircle(0, 0, 5);
            graphics.generateTexture('spark', 10, 10);
            graphics.destroy();
        }
        this.hitEmitter = this.add.particles(0, 0, 'spark', {
            lifespan: 400,
            speed: { min: 100, max: 200 },
            scale: { start: 0.8, end: 0 },
            gravityY: 150,
            blendMode: 'ADD',
            emitting: false
        });
    }

    showWait(title, sub) {
        console.log(`[CLIENT] showWait ${title}: ${sub}`);
        this.waitOverlay.setVisible(true);
        this.waitText.setVisible(true).setText(title || '');
        this.waitSub.setVisible(true).setText(sub || '');
    }

    hideWait() {
        this.waitOverlay.setVisible(false);
        this.waitText.setVisible(false);
        this.waitSub.setVisible(false);
    }

    startCountdown(onFinish) {
        this.countdownText.setVisible(true);
        let count = 3;
        this.countdownText.setText(count.toString());

        const step = () => {
            if (count > 0) {
                this.countdownText.setText(count.toString());
                this.countdownText.setScale(1);

                if (this.sfx.countdownBeep) {
                    this.sfx.countdownBeep.play({ volume: 0.7 });
                }

                this.tweens.add({
                    targets: this.countdownText,
                    scale: 1.5,
                    duration: 800,
                    ease: 'Bounce.easeOut',
                    yoyo: true
                });

                count--;
                this.time.delayedCall(1000, step);
            } else {
                this.countdownText.setText('GO!');
                this.countdownText.setColor('#00ff00');

                if (this.sfx.countdownGo) {
                    this.sfx.countdownGo.play({ volume: 0.9 });
                }

                this.tweens.add({
                    targets: this.countdownText,
                    scale: 2,
                    alpha: 0,
                    duration: 600,
                    ease: 'Power2',
                    onComplete: () => {
                        this.countdownText.setVisible(false);
                        this.countdownText.setAlpha(1);
                        this.countdownText.setColor('#ffd700');
                        if (onFinish) onFinish();
                    }
                });
            }
        };

        this.time.delayedCall(1000, step);
    }

    updateScore() {
        this.score1Text.setText(this.score1.toString());
        this.score2Text.setText(this.score2.toString());

        if (this.sfx.score) {
            this.sfx.score.play({ volume: 0.9 });
        }
    }

    createEndGameMenu(message, score1, score2, onRematch, onMenu) {
        this.hideEndGameMenu(); // Garante que qualquer menu anterior seja destruído

        const centerX = this.cfg.WIDTH / 2;
        const centerY = this.cfg.HEIGHT / 2;

        this.endGameContainer = this.add.container(0, 0).setDepth(150);

        const overlay = this.add.rectangle(centerX, centerY, this.cfg.WIDTH, this.cfg.HEIGHT, 0x000000, 0.8);
        this.endGameContainer.add(overlay);

        const endGameText = this.add.text(centerX, centerY - 100, message, {
            fontSize: '48px',
            fill: '#ffffff',
            fontStyle: 'bold',
            align: 'center'
        }).setOrigin(0.5);
        this.endGameContainer.add(endGameText);

        const scoreText = this.add.text(centerX, centerY - 30, `${score1} - ${score2}`, {
            fontSize: '36px',
            fill: '#ffd700',
            fontStyle: 'bold',
            align: 'center'
        }).setOrigin(0.5);
        this.endGameContainer.add(scoreText);

        const rematchButton = this.add.text(centerX, centerY + 50, 'REMATCH', {
            fontSize: '32px',
            fill: '#00ff00',
            backgroundColor: '#333333',
            padding: { x: 20, y: 10 },
            fontStyle: 'bold'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        rematchButton.on('pointerover', () => rematchButton.setBackgroundColor('#555555'));
        rematchButton.on('pointerout', () => rematchButton.setBackgroundColor('#333333'));
        rematchButton.on('pointerdown', () => {
            if (onRematch) onRematch();
            // O menu será escondido pelo handler do rematch ou pelo retorno ao menu principal
        });
        this.endGameContainer.add(rematchButton);

        const menuButton = this.add.text(centerX, centerY + 150, 'MENU PRINCIPAL', {
            fontSize: '32px',
            fill: '#ff0000',
            backgroundColor: '#333333',
            padding: { x: 20, y: 10 },
            fontStyle: 'bold'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        menuButton.on('pointerover', () => menuButton.setBackgroundColor('#555555'));
        menuButton.on('pointerout', () => menuButton.setBackgroundColor('#333333'));
        menuButton.on('pointerdown', () => {
            if (onMenu) onMenu();
            // O menu será escondido pelo handler do rematch ou pelo retorno ao menu principal
        });
        this.endGameContainer.add(menuButton);

        // Animação de entrada do menu
        this.endGameContainer.setAlpha(0).setScale(0.8);
        this.tweens.add({
            targets: this.endGameContainer,
            alpha: 1,
            scale: 1,
            duration: 300,
            ease: 'Back.easeOut'
        });
    }

    hideEndGameMenu() {
        if (this.endGameContainer) {
            console.log('🗑️ Destruindo menu de fim de jogo...');
            this.endGameContainer.destroy(true); // Destrói o container e todos os seus filhos
            this.endGameContainer = null;
        }
    }

    shutdown() {
        console.log(`🧹 ${this.scene.key}: Iniciando shutdown...`);

        this.stopGameLogic();

        // Remover listeners de input
        if (this._escHandler) {
            this.input.keyboard.off('keydown-ESC', this._escHandler);
            this._escHandler = null;
        }

        // Parar e limpar timers e tweens
        this.time.removeAllEvents();
        this.tweens.killAll();

        // Destruir Game Objects criados com this.add.
        if (this.ball) { this.ball.destroy(); this.ball = null; }
        if (this.paddle1) { this.paddle1.destroy(); this.paddle1 = null; }
        if (this.paddle2) { this.paddle2.destroy(); this.paddle2 = null; }
        if (this.ballTrail) { this.ballTrail.destroy(); this.ballTrail = null; }
        if (this.hitEmitter) { this.hitEmitter.destroy(); this.hitEmitter = null; }

        // Destruir elementos da HUD
        if (this.statusText) { this.statusText.destroy(); this.statusText = null; }
        if (this.waitOverlay) { this.waitOverlay.destroy(); this.waitOverlay = null; }
        if (this.waitText) { this.waitText.destroy(); this.waitText = null; }
        if (this.waitSub) { this.waitSub.destroy(); this.waitSub = null; }
        if (this.countdownText) { this.countdownText.destroy(); this.countdownText = null; }
        if (this.score1Text) { this.score1Text.destroy(); this.score1Text = null; }
        if (this.score2Text) { this.score2Text.destroy(); this.score2Text = null; }

        // Destruir o container do menu de fim de jogo
        this.hideEndGameMenu();

        // Destruir instâncias de áudio
        if (this.sfx) {
            Object.keys(this.sfx).forEach(key => {
                if (this.sfx[key]) {
                    this.sfx[key].destroy();
                    this.sfx[key] = null;
                }
            });
        }

        // Limpar quaisquer outras referências para evitar vazamentos de memória
        this.cfg = null;
        this.cursors = null;
        this.keys = null;
        this.trailPoints = [];
        this.lastHitPaddle = null;

        console.log(`✅ ${this.scene.key}: Shutdown completo.`);
    }

    onEscToMenu() {
        this.scene.stop(this.scene.key);
        this.scene.start('MenuScene');
    }

    playPaddleHitEffects(paddleNumber) {
        const ballX = this.ball?.x ?? this.cfg.WIDTH / 2;
        const ballY = this.ball?.y ?? this.cfg.HEIGHT / 2;

        // Partículas
        if (this.hitEmitter) {
            this.hitEmitter.emitParticleAt(ballX, ballY, 12);
        }

        // Tremor de câmera
        if (this.cameras && this.cameras.main) {
            this.cameras.main.shake(100, 0.005);
        }

        // Som
        if (this.sfx && this.sfx.hitPaddle) {
            this.sfx.hitPaddle.play({ volume: 0.8 });
        }

        // Animação visual do paddle
        let paddleToAnim = null;
        if (paddleNumber === 1) paddleToAnim = this.paddle1;
        if (paddleNumber === 2) paddleToAnim = this.paddle2;

        if (paddleToAnim) {
            this.tweens.add({
                targets: paddleToAnim,
                alpha: 0.5,
                duration: 60,
                yoyo: true
            });
        }
    }
}
