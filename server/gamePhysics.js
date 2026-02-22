'use strict';

// ========================================
// UTILITÁRIO: clamp simples
// ========================================
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// ========================================
// GAME PHYSICS
// Responsável por toda a simulação física:
// movimento da bola, colisões com paredes
// e paddles (swept), pontuação de borda.
//
// Uso:
//   const physics = new GamePhysics(cfg, {
//       onPoint:     (scoringPlayer) => {},
//       onPaddleHit: (player, angle) => {},
//       getLastHitPaddle:  () => this.lastHitPaddle,
//       setLastHitPaddle:  (v) => { this.lastHitPaddle = v; },
//       getStats:    () => this.stats,
//       getRoomId:   () => this.roomId,
//   });
//   physics.update(gameState, dt);
// ========================================

class GamePhysics {
    constructor(cfg, callbacks = {}) {
        this.cfg = cfg;

        // Callbacks injetados pelo GameRoom
        this.onPoint = callbacks.onPoint || (() => {
        });
        this.onPaddleHit = callbacks.onPaddleHit || (() => {
        });
        this.getLastHitPaddle = callbacks.getLastHitPaddle || (() => null);
        this.setLastHitPaddle = callbacks.setLastHitPaddle || (() => {
        });
        this.getStats = callbacks.getStats || (() => ({
            p1: { hits: 0, misses: 0, maxSpeed: 0 },
            p2: { hits: 0, misses: 0, maxSpeed: 0 }
        }));
        this.getRoomId = callbacks.getRoomId || (() => 'unknown');
    }

    // ─────────────────────────────────────────────
    // ENTRY POINT — chamado a cada tick do gameLoop
    // ─────────────────────────────────────────────
    update(state, dt) {
        if (!state.gameStarted || state.isPaused) return;

        const speed = Math.hypot(state.ball.vx, state.ball.vy);

        // Subpassos dinâmicos: bola nunca percorre mais que 80% do raio por passo
        const maxDistPerStep = this.cfg.BALL_RADIUS * 0.8;
        const distThisFrame = speed * dt;
        const steps = Math.max(1, Math.ceil(distThisFrame / maxDistPerStep));
        const subDt = dt / steps;

        for (let i = 0; i < steps; i++) {
            this._step(state, subDt);
            // Se ponto foi marcado dentro do subpasso, interrompe
            if (!state.gameStarted) break;
        }
    }

    // ─────────────────────────────────────────────
    // PASSO DE FÍSICA
    // ─────────────────────────────────────────────
    _step(state, dt) {
        if (!state.gameStarted || state.isPaused) return;

        const cfg = this.cfg;
        const ball = state.ball;
        const halfPaddle = cfg.PADDLE_HEIGHT / 2;

        // 1. GUARDAR POSIÇÃO ANTERIOR (swept collision)
        const prevX = ball.x;
        const prevY = ball.y;

        // 2. MOVER A BOLA
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        // 3. COLISÃO VERTICAL (paredes topo/base)
        const top = cfg.BALL_RADIUS;
        const bottom = cfg.HEIGHT - cfg.BALL_RADIUS;

        if (ball.y <= top) {
            ball.y = top;
            ball.vy = Math.abs(ball.vy);
        } else if (ball.y >= bottom) {
            ball.y = bottom;
            ball.vy = -Math.abs(ball.vy);
        }

        // 4. MOVER PADDLES
        const minY = halfPaddle;
        const maxY = cfg.HEIGHT - halfPaddle;

        state.paddle1.y = clamp(state.paddle1.y + state.paddle1.vy * dt, minY, maxY);
        state.paddle2.y = clamp(state.paddle2.y + state.paddle2.vy * dt, minY, maxY);

        // 5. SWEPT COLLISION — PADDLE 1 (esquerdo)
        // Plano de colisão: face direita do paddle
        const p1Face = cfg.PADDLE1_X + cfg.PADDLE_WIDTH / 2;

        if (ball.vx < 0 && this.getLastHitPaddle() !== 1) {
            const prevLeftEdge = prevX - cfg.BALL_RADIUS;
            const currLeftEdge = ball.x - cfg.BALL_RADIUS;

            if (prevLeftEdge >= p1Face && currLeftEdge <= p1Face) {
                const tHit = (prevLeftEdge - p1Face) / (prevLeftEdge - currLeftEdge);
                const hitY = prevY + (ball.y - prevY) * tHit;

                const p1Top = state.paddle1.y - halfPaddle - cfg.BALL_RADIUS;
                const p1Bottom = state.paddle1.y + halfPaddle + cfg.BALL_RADIUS;

                if (hitY >= p1Top && hitY <= p1Bottom) {
                    this._resolvePaddleCollision(
                        ball, state.paddle1, 1,
                        hitY, state.paddle1.y, halfPaddle, p1Face, cfg
                    );

                    ball.x = p1Face + cfg.BALL_RADIUS;

                    const remainingT = (1 - tHit) * dt;
                    ball.x += ball.vx * remainingT;
                    ball.y += ball.vy * remainingT;
                }
            }
        }

        // 5b. SWEPT COLLISION — PADDLE 2 (direito)
        // Plano de colisão: face esquerda do paddle
        const p2Face = cfg.PADDLE2_X - cfg.PADDLE_WIDTH / 2;

        if (ball.vx > 0 && this.getLastHitPaddle() !== 2) {
            const prevRightEdge = prevX + cfg.BALL_RADIUS;
            const currRightEdge = ball.x + cfg.BALL_RADIUS;

            if (prevRightEdge <= p2Face && currRightEdge >= p2Face) {
                const tHit = (p2Face - prevRightEdge) / (currRightEdge - prevRightEdge);
                const hitY = prevY + (ball.y - prevY) * tHit;

                const p2Top = state.paddle2.y - halfPaddle - cfg.BALL_RADIUS;
                const p2Bottom = state.paddle2.y + halfPaddle + cfg.BALL_RADIUS;

                if (hitY >= p2Top && hitY <= p2Bottom) {
                    this._resolvePaddleCollision(
                        ball, state.paddle2, 2,
                        hitY, state.paddle2.y, halfPaddle, p2Face, cfg
                    );

                    ball.x = p2Face - cfg.BALL_RADIUS;

                    const remainingT = (1 - tHit) * dt;
                    ball.x += ball.vx * remainingT;
                    ball.y += ball.vy * remainingT;
                }
            }
        }

        // 6. RESET DE lastHitPaddle quando bola se afasta o suficiente
        const lastHit = this.getLastHitPaddle();
        if (lastHit === 1 && ball.x - cfg.BALL_RADIUS > p1Face + 20) {
            this.setLastHitPaddle(null);
        } else if (lastHit === 2 && ball.x + cfg.BALL_RADIUS < p2Face - 20) {
            this.setLastHitPaddle(null);
        }

        // 7. ÂNGULO MÍNIMO VERTICAL
        this.enforceMinVerticalAngle(ball, 10);

        // 8. PONTUAÇÃO (bordas esquerda/direita)
        if (ball.x - cfg.BALL_RADIUS <= 0) {
            const stats = this.getStats();
            stats.p1.misses++;
            console.log(`[Room ${this.getRoomId()}] Ponto para P2! Placar atualizado.`);
            this.onPoint(2);

        } else if (ball.x + cfg.BALL_RADIUS >= cfg.WIDTH) {
            const stats = this.getStats();
            stats.p2.misses++;
            console.log(`[Room ${this.getRoomId()}] Ponto para P1! Placar atualizado.`);
            this.onPoint(1);
        }
    }

    // ─────────────────────────────────────────────
    // RESOLVE COLISÃO COM PADDLE
    // ─────────────────────────────────────────────
    _resolvePaddleCollision(ball, paddle, paddleNumber, hitY, paddleY, halfPaddle, faceX, cfg) {
        const angle = this.calculateBounceAngle(hitY, paddleY, halfPaddle);

        let speed = Math.hypot(ball.vx, ball.vy);
        speed = Math.min(speed * cfg.BALL_ACCELERATION, cfg.BALL_MAX_SPEED);
        speed = Math.max(speed, cfg.BALL_MIN_SPEED);

        // Influência da velocidade do paddle no ângulo (até ±15°)
        const paddleInfluence = (paddle.vy / cfg.PADDLE_SPEED) * (15 * Math.PI / 180);
        const finalAngle = angle + paddleInfluence;

        if (paddleNumber === 1) {
            ball.vx = Math.cos(finalAngle) * speed;
            ball.vy = Math.sin(finalAngle) * speed;
        } else {
            ball.vx = -Math.cos(finalAngle) * speed;
            ball.vy = Math.sin(finalAngle) * speed;
        }

        this.clampVerticalRatio(ball, 0.75);
        this.setLastHitPaddle(paddleNumber);

        // Atualiza stats
        const stats = this.getStats();
        const statKey = paddleNumber === 1 ? 'p1' : 'p2';
        stats[statKey].hits++;

        const currentSpeed = Math.hypot(ball.vx, ball.vy);
        if (currentSpeed > stats[statKey].maxSpeed) {
            stats[statKey].maxSpeed = currentSpeed;
        }

        // Emite evento via callback
        this.onPaddleHit(paddleNumber, finalAngle);

        console.log(
            `[Room ${this.getRoomId()}] 🏓 P${paddleNumber} hit | ` +
            `hitY=${hitY.toFixed(1)}, ` +
            `angle=${(finalAngle * 180 / Math.PI).toFixed(1)}°, ` +
            `speed=${currentSpeed.toFixed(0)}px/s`
        );
    }

    // ─────────────────────────────────────────────
    // ÂNGULO MÍNIMO — evita bola quase horizontal
    // ─────────────────────────────────────────────
    enforceMinVerticalAngle(ball, minAngleDeg = 10) {
        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed === 0) return;

        const minRad = (minAngleDeg * Math.PI) / 180;
        const angle = Math.atan2(ball.vy, ball.vx);
        const absAngle = Math.abs(angle);

        const nearRight = absAngle < minRad;
        const nearLeft = Math.abs(absAngle - Math.PI) < minRad;

        if (nearRight) {
            const sign = ball.vy >= 0 ? 1 : -1;
            const a = sign * minRad;
            ball.vx = Math.cos(a) * speed;
            ball.vy = Math.sin(a) * speed;
        } else if (nearLeft) {
            const sign = ball.vy >= 0 ? 1 : -1;
            const a = Math.PI - sign * minRad;
            ball.vx = Math.cos(a) * speed;
            ball.vy = Math.sin(a) * speed;
        }
    }

    // ─────────────────────────────────────────────
    // ÂNGULO DE REBOTE baseado na posição de impacto
    // ─────────────────────────────────────────────
    calculateBounceAngle(ballY, paddleY, paddleHalfHeight) {
        const relative = (ballY - paddleY) / paddleHalfHeight;
        const clamped = Math.max(-1, Math.min(1, relative));
        const MAX_DEG = 40;
        const maxRad = (MAX_DEG * Math.PI) / 180;
        return clamped * maxRad;
    }

    // ─────────────────────────────────────────────
    // LIMITA COMPONENTE VERTICAL DA VELOCIDADE
    // ─────────────────────────────────────────────
    clampVerticalRatio(ball, maxVerticalRatio = 0.85) {
        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed === 0) return;

        const maxVy = speed * maxVerticalRatio;
        if (Math.abs(ball.vy) > maxVy) {
            ball.vy = (ball.vy >= 0 ? 1 : -1) * maxVy;
        }
    }
}

module.exports = GamePhysics;