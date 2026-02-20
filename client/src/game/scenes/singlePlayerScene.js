import {BaseGameScene} from './baseGameScene.js';

class SinglePlayerScene extends BaseGameScene {
    constructor() {
        super('SinglePlayerScene');
    }

    async init(data) {
        await super.init(data);
        this.botDifficulty = data.difficulty || 'medium';
    }

    preload() {
        super.preload();
    }

    create() {
        super.create();
        this.createSinglePlayerPhysics();
        this.setupSinglePlayer();
    }

    update() {
        super.update();
        this.updateSinglePlayerFrame();
    }

    setupSinglePlayer() {
        this.showWait('Preparando partida...', 'Single Player');
        this.time.delayedCall(400, () => {
            this.startCountdown(() => {
                this.hideWait();
                this.gameStarted = true;
                this.launchBall();
            });
        });
    }

    updateSinglePlayerFrame() {
        this.controlPaddle(this.paddle1);
        this.botControl();

        const margin = this.cfg.PADDLE_HEIGHT / 2 + 10;
        this.paddle1.y = Phaser.Math.Clamp(this.paddle1.y, margin, this.cfg.HEIGHT - margin);
        this.paddle2.y = Phaser.Math.Clamp(this.paddle2.y, margin, this.cfg.HEIGHT - margin);

        if (this.ball.x > this.cfg.PADDLE1_X + 120 && this.ball.x < this.cfg.PADDLE2_X - 120) {
            this.lastHitPaddle = null;
        }

        if (this.ball.x < -this.cfg.BALL_RADIUS) {
            this.score2++;
            this.updateScore();
            this.resetBall();
        } else if (this.ball.x > this.cfg.WIDTH + this.cfg.BALL_RADIUS) {
            this.score1++;
            this.updateScore();
            this.resetBall();
        }
    }

    // ========================================
    // INPUT / BOT
    // ========================================

    controlPaddle(paddle) {
        if (!paddle.body) return;

        paddle.body.setVelocityY(0);

        if (this.keys.W.isDown || this.cursors.up.isDown) {
            paddle.body.setVelocityY(-this.cfg.PADDLE_SPEED);
        } else if (this.keys.S.isDown || this.cursors.down.isDown) {
            paddle.body.setVelocityY(this.cfg.PADDLE_SPEED);
        }
    }

    botControl() {
        const difficulties = {
            easy: {reactionTime: 200, accuracy: 0.6, maxSpeed: 200},
            medium: {reactionTime: 100, accuracy: 0.8, maxSpeed: 250},
            hard: {reactionTime: 50, accuracy: 0.95, maxSpeed: 300}
        };

        const diff = difficulties[this.botDifficulty] || difficulties.medium;

        if (this.ball.body.velocity.x > 0) {
            if (!this.botReactionTimer || Date.now() - this.botReactionTimer > diff.reactionTime) {
                this.botReactionTimer = Date.now();

                const predictedY = this.ball.y + (this.ball.body.velocity.y * 0.3);
                const error = (1 - diff.accuracy) * Phaser.Math.Between(-50, 50);
                const targetY = Phaser.Math.Clamp(predictedY + error, 60, this.cfg.HEIGHT - 60);
                const diffY = targetY - this.paddle2.y;

                if (Math.abs(diffY) > 10) {
                    const speed = Math.min(Math.abs(diffY) * 4, diff.maxSpeed);
                    this.paddle2.body.setVelocityY(Math.sign(diffY) * speed);
                } else {
                    this.paddle2.body.setVelocityY(0);
                }
            }
        } else {
            const centerDiff = this.cfg.HEIGHT / 2 - this.paddle2.y;
            if (Math.abs(centerDiff) > 5) {
                this.paddle2.body.setVelocityY(centerDiff * 2);
            } else {
                this.paddle2.body.setVelocityY(0);
            }
        }
    }

    // ========================================
    // FÍSICA LOCAL (SINGLE)
    // ========================================

    onHitPaddle(ball, paddle) {
        const paddleId = paddle === this.paddle1 ? 1 : 2;
        if (this.lastHitPaddle === paddleId) return;
        this.lastHitPaddle = paddleId;

        let newVx = paddle === this.paddle1
            ? Math.abs(ball.body.velocity.x)
            : -Math.abs(ball.body.velocity.x);

        const currentSpeed = Math.abs(newVx);
        const targetSpeed = Math.min(
            currentSpeed * this.cfg.BALL_ACCELERATION,
            this.cfg.BALL_MAX_SPEED
        );
        newVx = Math.sign(newVx) * targetSpeed;

        const relativeIntersectY = ball.y - paddle.y;
        const normalizedIntersect = Phaser.Math.Clamp(
            relativeIntersectY / (this.cfg.PADDLE_HEIGHT / 2),
            -1,
            1
        );
        const bounceAngle = normalizedIntersect * (Math.PI / 3);

        const speed = Math.abs(newVx);
        const newVy = speed * Math.sin(bounceAngle);

        ball.body.setVelocity(newVx, newVy);

        if (Math.abs(ball.body.velocity.x) < this.cfg.BALL_MIN_SPEED) {
            ball.body.setVelocityX(Math.sign(ball.body.velocity.x) * this.cfg.BALL_MIN_SPEED);
        }
        if (Math.abs(ball.body.velocity.x) > this.cfg.BALL_MAX_SPEED) {
            ball.body.setVelocityX(Math.sign(ball.body.velocity.x) * this.cfg.BALL_MAX_SPEED);
        }
        if (Math.abs(ball.body.velocity.y) > this.cfg.BALL_MAX_SPEED) {
            ball.body.setVelocityY(Math.sign(ball.body.velocity.y) * this.cfg.BALL_MAX_SPEED);
        }

        this.playPaddleHitEffects(paddleId);
    }

    launchBall() {
        this.ball.setPosition(this.cfg.WIDTH / 2, this.cfg.HEIGHT / 2);
        const dir = Math.random() > 0.5 ? 1 : -1;
        this.ball.body.setVelocity(
            this.cfg.BALL_SPEED_INITIAL * dir,
            Phaser.Math.Between(-80, 80)
        );
        this.lastHitPaddle = null;
    }

    resetBall() {
        this.ball.setPosition(this.cfg.WIDTH / 2, this.cfg.HEIGHT / 2);
        this.ball.body.setVelocity(0, 0);
        this.lastHitPaddle = null;
        this.time.delayedCall(800, () => this.launchBall());
    }

    updateScore() {
        super.updateScore();
        if (this.score1 >= this.cfg.WIN_SCORE || this.score2 >= this.cfg.WIN_SCORE) {
            this.endGame();
        }
    }

    endGame() {
        super.endGame();

        const winner = this.score1 >= this.cfg.WIN_SCORE ? 'PLAYER 1' : 'PLAYER 2';
        this.stopGameLogic();

        const msg = `🏆 ${winner} VENCEU!\n${this.score1} x ${this.score2}`;
        this.showEndGameOverlay(msg, {allowRematch: true});
    }

    showEndGameOverlay(message, { allowRematch = true } = {}) {
        this.showWait(message, allowRematch ? 'Jogar novamente?' : '');

        const centerX = this.cfg.WIDTH / 2;
        const baseY = this.cfg.HEIGHT / 2 + 80;

        // Botão MENU
        this.endGameMenuButton = this.add.text(centerX - 120, baseY, 'MENU', {
            fontSize: '28px',
            fill: '#ffffff',
            backgroundColor: '#333333',
            padding: { x: 20, y: 10 }
        })
            .setOrigin(0.5)
            .setDepth(110)
            .setInteractive({ useHandCursor: true });

        this.endGameMenuButton.on('pointerover', () => {
            this.endGameMenuButton.setStyle({ backgroundColor: '#555555' });
        });
        this.endGameMenuButton.on('pointerout', () => {
            this.endGameMenuButton.setStyle({ backgroundColor: '#333333' });
        });

        this.endGameMenuButton.on('pointerdown', () => {
            // Para a lógica de jogo, se ainda restar algo
            this.stopGameLogic();
            // Garante limpeza completa da cena
            this.scene.stop(this.scene.key);   // chama BaseGameScene.shutdown()
            this.scene.start('MenuScene');
        });

        if (allowRematch) {
            // Botão REINICIAR
            this.endGameRematchButton = this.add.text(centerX + 120, baseY, 'REINICIAR', {
                fontSize: '28px',
                fill: '#ffffff',
                backgroundColor: '#4caf50',
                padding: { x: 20, y: 10 }
            })
                .setOrigin(0.5)
                .setDepth(110)
                .setInteractive({ useHandCursor: true });

            this.endGameRematchButton.on('pointerover', () => {
                this.endGameRematchButton.setStyle({ backgroundColor: '#66bb6a' });
            });
            this.endGameRematchButton.on('pointerout', () => {
                this.endGameRematchButton.setStyle({ backgroundColor: '#4caf50' });
            });

            this.endGameRematchButton.on('pointerdown', () => {
                this.stopGameLogic();
                // Esconde o overlay atual (BaseGameScene.hideWait destrói os botões atuais)
                this.hideWait();
                // Reinicia a cena inteira, chamando shutdown() + init/create novamente
                this.scene.restart();
            });
        }
    }

    createSinglePlayerPhysics() {
        this.physics.add.existing(this.paddle1, false);
        this.paddle1.body.setImmovable(true).setAllowGravity(false).setSize(this.cfg.PADDLE_WIDTH, this.cfg.PADDLE_HEIGHT);

        this.physics.add.existing(this.paddle2, false);
        this.paddle2.body.setImmovable(true).setAllowGravity(false).setSize(this.cfg.PADDLE_WIDTH, this.cfg.PADDLE_HEIGHT);

        this.physics.add.existing(this.ball, false);
        this.ball.body.setCircle(this.cfg.BALL_RADIUS).setAllowGravity(false);

        this.ball.body.setCollideWorldBounds(true);
        this.ball.body.setBounce(1, 1);
        this.ball.body.setVelocity(0, 0);
        this.physics.world.setBoundsCollision(false, false, true, true);

        this.physics.add.collider(this.ball, this.paddle1, this.onHitPaddle, null, this);
        this.physics.add.collider(this.ball, this.paddle2, this.onHitPaddle, null, this);
    }
}

export default SinglePlayerScene;