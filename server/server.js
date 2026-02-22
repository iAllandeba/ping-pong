const express = require('express');
const http = require('http');
const path = require('path');
const GAME_CONFIG = require('./gameConfig');
const initializeSocket = require('./socketConfig');

const app = express();
const server = http.createServer(app);
const io = initializeSocket(server, process.env.CORS_ORIGIN || '*');

// ========================================
// SERVE ESTÁTICO (index.html, src/, etc.)
// ========================================
app.use(express.static(path.join(__dirname, '../client/public')));
app.use('/src', express.static(path.join(__dirname, '../client/src')));
// ========================================
// ENDPOINT DE CONFIGURAÇÃO (ÚNICA FONTE)
// ========================================
app.get('/api/config', (req, res) => {
    res.json(GAME_CONFIG);
});

// ========================================
// GAME ROOM CLASS
// ========================================

const rooms = new Map();

class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.cfg = GAME_CONFIG;

        this.players = []; // [{ id: socketId, number: 1/2, reconnectToken: '...' }]
        this.gameState = this.createInitialGameState();

        this.gameLoop = null;
        this.lastUpdate = Date.now();
        this.lastHitPaddle = null;
        this.pendingRematch = new Set();

        this.stats = {
            p1: { hits: 0, misses: 0, maxSpeed: 0 },
            p2: { hits: 0, misses: 0, maxSpeed: 0 }
        };

        this.disconnectedPlayers = new Map(); // playerNumber -> { reconnectToken, disconnectTime, playerData, timeoutId }
        this.savedBallState = null; // ✅ Salva o estado da bola ao pausar
        this.broadcastCount = 0;
        this._lastBroadcastState = null;

        this.serverCountdownTimer = null; // ✅ Novo: Timer para o countdown do servidor
    }

    createInitialGameState() {
        return {
            ball: this.getInitialBallState(),
            paddle1: this.getInitialPaddleState(),
            paddle2: this.getInitialPaddleState(),
            scores: { p1: 0, p2: 0 },
            gameStarted: false,
            isPaused: false
        };
    }

    getInitialPaddleState() {
        return { y: this.cfg.HEIGHT / 2, vy: 0 };
    }

    getInitialBallState() {
        return {
            x: this.cfg.WIDTH / 2,
                y: this.cfg.HEIGHT / 2,
                vx: 0,
                vy: 0
        };
    }

    addPlayer(socketId) {
        if (this.players.some(p => p.id === socketId) || this.players.length >= 2) {
            return null;
        }

        const playerNumber = this.players.length + 1;
        const reconnectToken = `${socketId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        this.players.push({
            id: socketId,
            number: playerNumber,
            reconnectToken
        });

        this.lastUpdate = Date.now();
        console.log(`[Room ${this.roomId}] ✅ Player ${playerNumber} adicionado.`);

        return { playerNumber, reconnectToken };
    }

    isSocketInRoom(socketId) {
        return this.players.some(p => p.id === socketId);
    }

    handleDisconnect(socketId) {
        const playerIndex = this.players.findIndex(p => p.id === socketId);
        if (playerIndex === -1) return null;

        const player = this.players[playerIndex];
        const playerNumber = player.number;

        console.log(`[Room ${this.roomId}] ⏸️ Player ${playerNumber} desconectou.`);

        this.disconnectedPlayers.set(playerNumber, {
            reconnectToken: player.reconnectToken,
            disconnectTime: Date.now(),
            playerData: { ...player },
            timeoutId: null
        });

        this.players.splice(playerIndex, 1); // Remove o player ativo

        this.pauseGame();

        io.to(this.roomId).emit('playerDisconnected', {
            playerNumber,
            waitingReconnect: true,
            gameState: this.getFullGameState()
        });

        // Timeout para reconexão
        const timeoutId = setTimeout(() => {
            const disconnected = this.disconnectedPlayers.get(playerNumber);
            if (disconnected) {
                console.log(`[Room ${this.roomId}] ❌ Player ${playerNumber} não reconectou a tempo. Encerrando.`);
                this.disconnectedPlayers.delete(playerNumber);

                if (this.players.length > 0) {
                    const winner = playerNumber === 1 ? 'PLAYER 2' : 'PLAYER 1';
                    io.to(this.roomId).emit('gameEnd', {
                        winner,
                        reason: 'disconnect_timeout',
                        scores: this.gameState.scores,
                        stats: this.stats
                    });
                }
                this.stopGame(); // ✅ Encerra o jogo se o player não reconectar
            }
        }, this.cfg.RECONNECT_TIMEOUT);

        this.disconnectedPlayers.get(playerNumber).timeoutId = timeoutId;
        return player.reconnectToken;
    }

    handleReconnect(newSocketId, reconnectToken) {
        console.log(`[Room ${this.roomId}] 🔄 Tentativa de reconexão.`);

        if (this.isSocketInRoom(newSocketId)) {
            console.log(`[Room ${this.roomId}] ⚠️ Socket ${newSocketId} já está na sala.`);
            return { success: false, message: 'Já conectado nesta sala' };
        }

        for (const [playerNumber, disconnectedData] of this.disconnectedPlayers.entries()) {
            if (disconnectedData.reconnectToken === reconnectToken) {
                if (disconnectedData.timeoutId) {
                    clearTimeout(disconnectedData.timeoutId);
                }

                const restoredPlayer = {
                    id: newSocketId,
                    number: playerNumber,
                    reconnectToken
                };

                // ✅ Adiciona o jogador de volta à lista de players ativos
                // Mantém a ordem dos players (P1 sempre primeiro)
                if (playerNumber === 1) {
                    this.players.unshift(restoredPlayer);
                } else {
                    this.players.push(restoredPlayer);
                }

                this.disconnectedPlayers.delete(playerNumber);
                console.log(`[Room ${this.roomId}] ✅ Player ${playerNumber} reconectou! Total: ${this.players.length}`);

                io.to(this.roomId).emit('playerReconnected', { playerNumber });

                // ✅ Se o jogo estava pausado e agora temos 2 players ativos, retomar
                if (this.gameState.isPaused && this.players.length === 2) {
                    this.resumeGame();
                }

                return {
                    success: true,
                    playerNumber,
                    gameState: this.getFullGameState() // ✅ Envia o estado completo para o cliente que reconectou
                };
            }
        }

        console.log(`[Room ${this.roomId}] ❌ Token de reconexão inválido ou expirado.`);
        return { success: false, message: 'Token inválido ou expirado' };
    }

    getFullGameState() {
        return Object.freeze({
            ball: Object.freeze({ ...this.gameState.ball }),
            paddle1: Object.freeze({ ...this.gameState.paddle1 }),
            paddle2: Object.freeze({ ...this.gameState.paddle2 }),
            scores: Object.freeze({ ...this.gameState.scores }),
            gameStarted: this.gameState.gameStarted,
            isPaused: this.gameState.isPaused,
            stats: this.stats
        });
    }

    // ✅ Pausa o jogo de forma autoritativa
    pauseGame() {
        if (this.gameState.isPaused) {
            console.log(`[Room ${this.roomId}] Já pausado, ignorando pauseGame()`);
            return;
        }

        this.gameState.isPaused = true;
        this.gameState.gameStarted = false;

        this.savedBallState = { ...this.gameState.ball };
        this.savedPaddle1State = { ...this.gameState.paddle1 };
        this.savedPaddle2State = { ...this.gameState.paddle2 };

        this.gameState.ball.vx = 0;
        this.gameState.ball.vy = 0;

        clearInterval(this.gameLoop);
        this.gameLoop = null;

        if (this.serverCountdownTimer) {
            clearInterval(this.serverCountdownTimer);
            this.serverCountdownTimer = null;
            io.to(this.roomId).emit('countdownCancelled');
        }
        console.log(`[Room ${this.roomId}] ⏸️ Pausado. Bola: x=${this.savedBallState.x.toFixed(2)}, vx=${this.savedBallState.vx.toFixed(2)}`);
        this.broadcast();
    }

    // ✅ Retoma o jogo de forma autoritativa
    resumeGame() {
        if (!this.gameState.isPaused || this.players.length < 2) return;

        console.log(`[Room ${this.roomId}] ▶️ Jogo retomando...`);
        io.to(this.roomId).emit('gameResuming', { countdown: this.cfg.RESUME_COUNTDOWN / 1000 });

        setTimeout(() => {
            if (this.gameLoop) {
                console.warn(`[Room ${this.roomId}] gameLoop já ativo durante retomada. Ignorando.`);
                return; // Já retomou
            }

            this.gameState.isPaused = false;
            this.gameState.gameStarted = true; // O jogo está rodando novamente

            // Restaura a bola para onde estava ou relança se não houver estado salvo
            if (this.savedBallState) {
                this.gameState.ball = { ...this.savedBallState };

                this.gameState.paddle1 = this.savedPaddle1State
                    ? { ...this.savedPaddle1State }
                    : this.gameState.paddle1;

                this.gameState.paddle2 = this.savedPaddle2State
                    ? { ...this.savedPaddle2State }
                    : this.gameState.paddle2;

                this.savedBallState    = null;
                this.savedPaddle1State = null;
                this.savedPaddle2State = null;
                console.log(`[Room ${this.roomId}] Bola restaurada para: x=${this.gameState.ball.x}, y=${this.gameState.ball.y}`);
            } else {
                this.launchBall();
                console.log(`[Room ${this.roomId}] Bola relançada após retomada.`);
            }

            this.lastUpdate = Date.now();

            io.to(this.roomId).emit('gameResumed', {
                gameState: this.getFullGameState()
            });

            setTimeout(() => {
                if (this.gameLoop) return;

                this.lastUpdate = Date.now(); // ancora de novo após o delay
                this.gameLoop = setInterval(() => {
                    const now = Date.now();
                    const dt  = Math.min((now - this.lastUpdate) / 1000, 0.05); // ✅ cap de dt
                    this.updateGamePhysics(dt);
                    this.lastUpdate = now;
                    this.broadcast();
                }, this.cfg.FRAME_TIME);

                console.log(`[Room ${this.roomId}] ✅ gameLoop iniciado.`);
            }, 100); // 100ms de margem para o cliente processar

        }, this.cfg.RESUME_COUNTDOWN);
    }

    // ✅ NOVO: Inicia o countdown no servidor
    startServerCountdown(duration, onCompleteCallback) {
        const startTime = Date.now();
        const endTime = startTime + duration;
        let lastEmittedSecond = Math.ceil(duration / 1000);

        io.to(this.roomId).emit('serverCountdown', { time: lastEmittedSecond, totalDuration: duration });
        this.serverCountdownTimer = setInterval(() => {
            const remaining = endTime - Date.now();
            const secondsLeft = Math.ceil(remaining / 1000);

            if (secondsLeft !== lastEmittedSecond) {
                lastEmittedSecond = secondsLeft;
                io.to(this.roomId).emit('serverCountdown', { time: Math.max(0, secondsLeft), totalDuration: duration });
            }

            if (remaining <= 0) {
                clearInterval(this.serverCountdownTimer);
                this.serverCountdownTimer = null;
                if (onCompleteCallback) onCompleteCallback();
            }
        }, 100);
    }

    startGame() {
        // ✅ Reset de estado e limpeza de timers
        this.gameState = this.createInitialGameState();
        this.stats = {
            p1: { hits: 0, misses: 0, maxSpeed: 0 },
            p2: { hits: 0, misses: 0, maxSpeed: 0 }
        };
        this.lastHitPaddle = null;
        this.savedBallState = null; // Limpa qualquer estado de bola salva

        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
            console.log(`[Room ${this.roomId}] Limpando gameLoop existente.`);
        }
        if (this.serverCountdownTimer) { // ✅ Limpa countdown anterior se houver
            clearInterval(this.serverCountdownTimer);
            this.serverCountdownTimer = null;
            console.log(`[Room ${this.roomId}] serverCountdownTimer parado.`);
        }

        console.log(`[Room ${this.roomId}] startGame -> scores reset: P1=${this.gameState.scores.p1}, P2=${this.gameState.scores.p2}`); // ✅ Log do reset de scores

        this.gameState.gameStarted = false; // Jogo não está rodando ainda
        this.gameState.isPaused = false; // Não está pausado, mas aguardando início
        this.lastUpdate = Date.now();

        this.broadcast(); // Envia o estado inicial (bola parada no centro)

        // ✅ Inicia o countdown no servidor
        this.startServerCountdown(this.cfg.COUNTDOWN_DURATION, () => {
            // Callback ao final do countdown
            console.log(`[Room ${this.roomId}] Callback do countdown finalizado. Tentando iniciar jogo.`);
            if (this.gameLoop) {
                console.warn(`[Room ${this.roomId}] gameLoop já ativo após countdown. Ignorando início.`);
                return; // Já começou por algum motivo
            }

            this.gameState.gameStarted = true; // O jogo está oficialmente "rodando"
            this.launchBall(); // ✅ Lança a bola AQUI
            console.log(`[Room ${this.roomId}] Callback countdown finalizado. Bola lançada. Estado: x=${this.gameState.ball.x.toFixed(2)}, y=${this.gameState.ball.y.toFixed(2)}, vx=${this.gameState.ball.vx.toFixed(2)}, vy=${this.gameState.ball.vy.toFixed(2)}`);

            this.lastUpdate = Date.now();

            this.gameLoop = setInterval(() => { // ✅ Inicia o gameLoop AQUI
                const now = Date.now();
                const dt = (now - this.lastUpdate) / 1000; // Delta time em segundos
                this.updateGamePhysics(dt);
                this.lastUpdate = now;
                this.broadcast();
            }, this.cfg.FRAME_TIME);
            console.log(`[Room ${this.roomId}] gameLoop iniciado com FRAME_TIME: ${this.cfg.FRAME_TIME}ms.`);

            io.to(this.roomId).emit('ballLaunched'); // Opcional: para o cliente saber que a bola foi lançada
            this.broadcast(); // Envia o estado com a bola em movimento
        });
    }

    stopGame() {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
            console.log(`[Room ${this.roomId}] gameLoop parado.`);
        }
        if (this.serverCountdownTimer) { // ✅ Limpa countdown se estiver ativo
            clearInterval(this.serverCountdownTimer);
            this.serverCountdownTimer = null;
            console.log(`[Room ${this.roomId}] serverCountdownTimer parado.`);
        }
        this.gameState.gameStarted = false;
        this.gameState.isPaused = false;
        this.gameState.ball.vx = 0;
        this.gameState.ball.vy = 0;
        this.savedBallState = null;
        this.savedPaddle1State = null;
        this.savedPaddle2State = null;
        this.disconnectedPlayers.forEach(dp => clearTimeout(dp.timeoutId));
        this.disconnectedPlayers.clear();
        this.pendingRematch.clear();
        console.log(`[Room ${this.roomId}] Jogo completamente parado e sala limpa.`);
        this.broadcast(); // Envia o estado final
    }

    launchBall() {
        const state = this.gameState;
        state.ball.x = this.cfg.WIDTH / 2;
        state.ball.y = this.cfg.HEIGHT / 2;
        state.ball.vx = (Math.random() > 0.5 ? 1 : -1) * this.cfg.BALL_SPEED_INITIAL;
        state.ball.vy = (Math.random() * 2 - 1) * this.cfg.BALL_SPEED_INITIAL * 0.5; // Ângulo mais suave
        this.lastHitPaddle = null;
        console.log(`[Room ${this.roomId}] 🎾 Bola lançada. Posição: (${state.ball.x}, ${state.ball.y}), Velocidade: (${state.ball.vx}, ${state.ball.vy})`);
    }

    updateGamePhysics(dt) {
        const state = this.gameState;
        if (!state.gameStarted || state.isPaused) return;

        const speed = Math.hypot(state.ball.vx, state.ball.vy);

        // Número de subpassos dinâmico baseado na velocidade
        // Garante que a bola nunca percorra mais que BALL_RADIUS por subpasso
        const maxDistPerStep = this.cfg.BALL_RADIUS * 0.8;
        const distThisFrame = speed * dt;
        const steps = Math.max(1, Math.ceil(distThisFrame / maxDistPerStep));

        const subDt = dt / steps;
        for (let i = 0; i < steps; i++) {
            this._physicsStep(subDt);
            // Se um ponto foi marcado dentro do subpasso, para a simulação
            if (!state.gameStarted) break;
        }
    }

    _physicsStep(dt) {
        const state = this.gameState;
        const cfg = this.cfg;

        if (!state.gameStarted || state.isPaused) {
            // console.log(`[Room ${this.roomId}] Física pausada. gameStarted: ${state.gameStarted}, isPaused: ${state.isPaused}`);
            return;
        }

        const ball = state.ball;
        const halfPaddle = cfg.PADDLE_HEIGHT / 2;

        // ─────────────────────────────────────────────
        // 1. GUARDAR POSIÇÃO ANTERIOR (necessário para swept)
        // ─────────────────────────────────────────────
        const prevX = ball.x;
        const prevY = ball.y;

        // ─────────────────────────────────────────────
        // 2. MOVER A BOLA
        // ─────────────────────────────────────────────
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        // ─────────────────────────────────────────────
        // 3. COLISÃO VERTICAL (paredes topo/base)
        // ─────────────────────────────────────────────
        const top    = cfg.BALL_RADIUS;
        const bottom = cfg.HEIGHT - cfg.BALL_RADIUS;

        if (ball.y <= top) {
            ball.y  = top;
            ball.vy = Math.abs(ball.vy); // sempre para baixo
        } else if (ball.y >= bottom) {
            ball.y  = bottom;
            ball.vy = -Math.abs(ball.vy); // sempre para cima
        }

        // ─────────────────────────────────────────────
        // 4. MOVER PADDLES
        // ─────────────────────────────────────────────
        const minY = halfPaddle;
        const maxY = cfg.HEIGHT - halfPaddle;

        state.paddle1.y = Phaser_clamp(state.paddle1.y + state.paddle1.vy * dt, minY, maxY);
        state.paddle2.y = Phaser_clamp(state.paddle2.y + state.paddle2.vy * dt, minY, maxY);

        // ─────────────────────────────────────────────
        // 5. SWEPT COLLISION COM PADDLES
        //
        // Para cada paddle, definimos um "plano de colisão" vertical (linha X).
        // Verificamos se a trajetória da bola [prevX → ball.x] cruzou esse plano
        // E se, no ponto de cruzamento, a bola estava dentro da faixa Y do paddle.
        // ─────────────────────────────────────────────

        // --- PADDLE 1 (esquerdo) ---
        // O plano de colisão é a face direita do paddle
        const p1Face = cfg.PADDLE1_X + cfg.PADDLE_WIDTH / 2;

        if (
            ball.vx < 0 &&          // bola indo para esquerda
            this.lastHitPaddle !== 1 // sem colisão dupla
        ) {
            // A bola cruzou o plano se:
            //   - prevX estava à direita do plano (bola ainda não tinha chegado)
            //   - ball.x está à esquerda do plano (bola passou ou está no paddle)
            const prevLeftEdge = prevX - cfg.BALL_RADIUS;
            const currLeftEdge = ball.x - cfg.BALL_RADIUS;

            if (prevLeftEdge >= p1Face && currLeftEdge <= p1Face) {
                // Calcula o tempo exato (t ∈ [0,1]) em que a bola tocou o plano
                const tHit = (prevLeftEdge - p1Face) / (prevLeftEdge - currLeftEdge);

                // Posição Y interpolada no momento do impacto
                const hitY = prevY + (ball.y - prevY) * tHit;

                // Verifica se a bola estava dentro da área do paddle no impacto
                const p1Top    = state.paddle1.y - halfPaddle - cfg.BALL_RADIUS;
                const p1Bottom = state.paddle1.y + halfPaddle + cfg.BALL_RADIUS;

                if (hitY >= p1Top && hitY <= p1Bottom) {
                    // ✅ COLISÃO CONFIRMADA — resolver
                    this._resolvePaddleCollision(ball, state.paddle1, 1, hitY, state.paddle1.y, halfPaddle, p1Face, cfg);

                    // Reposiciona a bola exatamente na face do paddle (sem interpenetração)
                    ball.x = p1Face + cfg.BALL_RADIUS;

                    // Simula o tempo restante após o impacto com a nova velocidade
                    const remainingT = (1 - tHit) * dt;
                    ball.x += ball.vx * remainingT;
                    ball.y += ball.vy * remainingT;
                    // (garante que o resto do subpasso não é desperdiçado)
                }
            }
        }

        // --- PADDLE 2 (direito) ---
        // O plano de colisão é a face esquerda do paddle
        const p2Face = cfg.PADDLE2_X - cfg.PADDLE_WIDTH / 2;

        if (
            ball.vx > 0 &&          // bola indo para direita
            this.lastHitPaddle !== 2
        ) {
            const prevRightEdge = prevX + cfg.BALL_RADIUS;
            const currRightEdge = ball.x + cfg.BALL_RADIUS;

            if (prevRightEdge <= p2Face && currRightEdge >= p2Face) {
                const tHit = (p2Face - prevRightEdge) / (currRightEdge - prevRightEdge);

                const hitY = prevY + (ball.y - prevY) * tHit;

                const p2Top    = state.paddle2.y - halfPaddle - cfg.BALL_RADIUS;
                const p2Bottom = state.paddle2.y + halfPaddle + cfg.BALL_RADIUS;

                if (hitY >= p2Top && hitY <= p2Bottom) {
                    this._resolvePaddleCollision(ball, state.paddle2, 2, hitY, state.paddle2.y, halfPaddle, p2Face, cfg);

                    ball.x = p2Face - cfg.BALL_RADIUS;

                    const remainingT = (1 - tHit) * dt;
                    ball.x += ball.vx * remainingT;
                    ball.y += ball.vy * remainingT;
                }
            }
        }

        // ─────────────────────────────────────────────
        // 6. RESET DE lastHitPaddle
        // (quando a bola se afasta o suficiente do paddle)
        // ─────────────────────────────────────────────
        if (this.lastHitPaddle === 1 && ball.x - cfg.BALL_RADIUS > p1Face + 20) {
            this.lastHitPaddle = null;
        } else if (this.lastHitPaddle === 2 && ball.x + cfg.BALL_RADIUS < p2Face - 20) {
            this.lastHitPaddle = null;
        }

        // ─────────────────────────────────────────────
        // 7. ÂNGULO MÍNIMO VERTICAL + VELOCIDADE
        // ─────────────────────────────────────────────
        this.enforceMinVerticalAngle(ball, 10);

        // ─────────────────────────────────────────────
        // 8. PONTUAÇÃO
        // ─────────────────────────────────────────────
        if (ball.x - cfg.BALL_RADIUS <= 0) {
            state.scores.p2++;
            this.stats.p1.misses++;
            console.log(`[Room ${this.roomId}] Ponto para P2! Placar: ${state.scores.p1}-${state.scores.p2}`);
            this.pointScored(2);
        } else if (ball.x + cfg.BALL_RADIUS >= cfg.WIDTH) {
            state.scores.p1++;
            this.stats.p2.misses++;
            console.log(`[Room ${this.roomId}] Ponto para P1! Placar: ${state.scores.p1}-${state.scores.p2}`);
            this.pointScored(1);
        }
    }

// ─────────────────────────────────────────────
// HELPER: resolve bounce angle + speed após colisão confirmada
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
            // Após P1, bola sempre vai para a DIREITA
            ball.vx =  Math.cos(finalAngle) * speed;
            ball.vy =  Math.sin(finalAngle) * speed;
        } else {
            // Após P2, bola sempre vai para a ESQUERDA
            ball.vx = -Math.cos(finalAngle) * speed;
            ball.vy =  Math.sin(finalAngle) * speed;
        }

        this.clampVerticalRatio(ball, 0.75);

        this.lastHitPaddle = paddleNumber;

        const statKey = paddleNumber === 1 ? 'p1' : 'p2';
        this.stats[statKey].hits++;

        const currentSpeed = Math.hypot(ball.vx, ball.vy);
        if (currentSpeed > this.stats[statKey].maxSpeed) {
            this.stats[statKey].maxSpeed = currentSpeed;
        }

        io.to(this.roomId).emit('paddleHit', { paddleNumber, angle: finalAngle });

        console.log(
            `[Room ${this.roomId}] 🏓 P${paddleNumber} hit | ` +
            `hitY=${hitY.toFixed(1)}, angle=${(finalAngle * 180 / Math.PI).toFixed(1)}°, ` +
            `speed=${currentSpeed.toFixed(0)}px/s`
        );
    }

    pointScored(scoringPlayer) {
        console.log(`[Room ${this.roomId}] Ponto para P${scoringPlayer}`);

        const state = this.gameState;

        io.to(this.roomId).emit('scoreUpdate', {
            scores: state.scores
        });

        console.log(`[Room ${this.roomId}] 📊 Placar: P1=${state.scores.p1} x P2=${state.scores.p2}`);

        if (state.scores.p1 >= this.cfg.WIN_SCORE || state.scores.p2 >= this.cfg.WIN_SCORE) {
            console.log(`[Room ${this.roomId}] Condição de vitória atingida! WIN_SCORE: ${this.cfg.WIN_SCORE}`);
            this.endGame();
            return;
        }

        // Pausa o jogo brevemente e reseta a bola para o centro após um ponto
        state.ball = this.getInitialBallState();

        state.paddle1 = this.getInitialPaddleState();
        state.paddle2 = this.getInitialPaddleState();

        this.lastHitPaddle = null;
        state.gameStarted = false; // Pausa o jogo para o countdown de lançamento

        this.broadcast(); // Envia o estado com a bola no centro e jogo pausado
        console.log(`[Room ${this.roomId}] Ponto marcado. Iniciando countdown para relançar a bola.`);

        // Inicia um pequeno countdown no servidor antes de relançar a bola
        this.startServerCountdown(3000, () => {
            console.log(`[Room ${this.roomId}] Countdown de relançamento finalizado. gameLoop: ${!!this.gameLoop}`);
            if (this.gameLoop) { // Apenas relança se o gameLoop principal ainda estiver ativo
                state.gameStarted = true; // Retoma o jogo
                this.launchBall();
                this.broadcast();
                io.to(this.roomId).emit('ballLaunched', {
                    x: this.gameState.ball.x,
                    y: this.gameState.ball.y,
                    vx: this.gameState.ball.vx,
                    vy: this.gameState.ball.vy
                });
                console.log(`[Room ${this.roomId}] Countdown finalizado. Jogo iniciado e bola lançada.`);
                console.log(`[Room ${this.roomId}] Bola relançada após ponto. VX: ${this.gameState.ball.vx}, VY: ${this.gameState.ball.vy}`);
            } else {
                console.warn(`[Room ${this.roomId}] gameLoop não ativo para relançar bola após ponto.`);
            }
        });
    }

    endGame() {
        const winner =
            this.gameState.scores.p1 >= this.cfg.WIN_SCORE ? 'PLAYER 1' : 'PLAYER 2';

        io.to(this.roomId).emit('gameEnd', {
            winner,
            scores: this.gameState.scores,
            stats: this.stats,
            gameState: this.getFullGameState()
        });

        this.stopGame();
        console.log(`[Room ${this.roomId}] 🏆 Fim de jogo: ${winner} venceu!`);
    }

    broadcast() {
        const state = this.gameState;
        const ball = state.ball;

        // Só transmite se algo mudou (threshold de 0.5px)
        const snapshot = `${ball.x.toFixed(1)},${ball.y.toFixed(1)},${state.paddle1.y.toFixed(1)},${state.paddle2.y.toFixed(1)}`;

        if (snapshot === this._lastBroadcastState && !state.gameStarted === false) {
            return; // nada mudou, não transmite
        }

        this._lastBroadcastState = snapshot;
        this.broadcastCount++;

        io.to(this.roomId).emit('gameState', {
            ball: this.gameState.ball,
            paddle1: { y: this.gameState.paddle1.y },
            paddle2: { y: this.gameState.paddle2.y },
            scores: this.gameState.scores,
            gameStarted: this.gameState.gameStarted,
            isPaused: this.gameState.isPaused,
            timestamp: Date.now()
        });
    }

    enforceMinVerticalAngle(ball, minAngleDeg = 10) {
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        if (speed === 0) return;

        const minRad = (minAngleDeg * Math.PI) / 180;
        let angle = Math.atan2(ball.vy, ball.vx);

        // Normaliza para [-PI, PI]
        // Checa se está muito próximo de horizontal (0° ou 180°)
        const absAngle = Math.abs(angle);
        const nearRight = absAngle < minRad;                   // ~0°
        const nearLeft  = Math.abs(absAngle - Math.PI) < minRad; // ~180°

        if (nearRight) {
            // indo quase reto para direita
            const sign = ball.vy >= 0 ? 1 : -1;
            angle = sign * minRad;
            ball.vx = Math.cos(angle) * speed;
            ball.vy = Math.sin(angle) * speed;
        } else if (nearLeft) {
            // indo quase reto para esquerda
            const sign = ball.vy >= 0 ? 1 : -1;
            angle = Math.PI - sign * minRad;
            ball.vx = Math.cos(angle) * speed;
            ball.vy = Math.sin(angle) * speed;
        }
    }

    calculateBounceAngle(ballY, paddleY, paddleHalfHeight) {
        // posição relativa no paddle: -1 (topo) ... 0 (meio) ... +1 (base)
        const relative = (ballY - paddleY) / paddleHalfHeight;
        const clamped = Math.max(-1, Math.min(1, relative));

        const MAX_BOUNCE_ANGLE_DEG = 40;
        const maxRad = (MAX_BOUNCE_ANGLE_DEG * Math.PI) / 180;

        return clamped * maxRad; // -maxRad ... +maxRad
    }

    /**
     * Garante que o componente vertical nunca seja quase 100% da velocidade.
     * Útil contra ângulos muito verticais.
     */
    clampVerticalRatio(ball, maxVerticalRatio = 0.85) {
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        if (speed === 0) return;

        const maxVy = speed * maxVerticalRatio;
        if (Math.abs(ball.vy) > maxVy) {
            const sign = ball.vy >= 0 ? 1 : -1;
            ball.vy = sign * maxVy;
        }
    }
}

function getOrCreateRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new GameRoom(roomId));
    }
    return rooms.get(roomId);
}

// ========================================
// SOCKET.IO EVENTOS
// ========================================

io.on('connection', (socket) => {
    console.log('✅ Player conectado:', socket.id);

    socket.on('ping', (data) => {
        socket.emit('pong', { clientSendTime: data.clientSendTime });
    });

    socket.on('attemptReconnect', (data) => {
        const { roomId, reconnectToken } = data;
        console.log(`🔄 Tentativa de reconexão na sala ${roomId}`);

        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('reconnectFailed', {
                message: 'Sala não encontrada ou já foi encerrada'
            });
            return;
        }

        const result = room.handleReconnect(socket.id, reconnectToken);

        if (result.success) {
            socket.join(roomId);
            socket.emit('reconnectSuccess', {
                playerNumber: result.playerNumber,
                gameState: result.gameState,
                roomId: roomId,
                reconnectToken: reconnectToken
            });
            console.log(`✅ Reconexão: P${result.playerNumber} na sala ${roomId}`);
        } else {
            socket.emit('reconnectFailed', {
                message: result.message || 'Falha na reconexão'
            });
        }
    });

    socket.on('joinRoom', (roomId) => {
        const room = getOrCreateRoom(roomId);

        if (room.players.length >= 2) {
            socket.emit('roomFull', { message: 'Sala cheia (máximo 2 jogadores).' });
            return;
        }

        const result = room.addPlayer(socket.id);
        if (!result) {
            console.log(`⚠️ Entrada duplicada na sala ${roomId}`);
            return;
        }

        socket.join(roomId);
        console.log(`👤 Player ${result.playerNumber} entrou na sala ${roomId}`);

        socket.emit('joinedRoom', {
            roomId,
            playerNumber: result.playerNumber,
            reconnectToken: result.reconnectToken,
            playersInRoom: room.players.length,
            gameConfig: GAME_CONFIG,
            gameState: room.getFullGameState()
        });

        if (room.players.length === 1) {
            socket.emit('waitingForOpponent', `Código da sala: ${roomId}`);
        }

        if (room.players.length === 2) {
            console.log(`🎮 Sala ${roomId} completa! Iniciando partida...`);

            socket.to(roomId).emit('playerJoined', {
                playerNumber: result.playerNumber,
                playersInRoom: room.players.length
            });

            io.to(roomId).emit('gameStart', {
                message: 'Ambos conectados, iniciando partida.'
            });

            if (room.gameState.isPaused) {
                room.resumeGame();
            } else {
                room.startGame();
            }
        }
    });

    socket.on('paddleInput', (data) => {
        const room = rooms.get(data.room);
        if (!room || !room.gameState.gameStarted || room.gameState.isPaused) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        if (player.number === 1) {
            room.gameState.paddle1.vy = data.vy;
        } else {
            room.gameState.paddle2.vy = data.vy;
        }
    });

    socket.on('rematchRequest', (roomId) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        room.pendingRematch.add(player.number);
        io.to(roomId).emit('rematchStatus', {
            playersReady: room.pendingRematch.size,
            totalPlayers: 2
        });

        if (room.pendingRematch.size === 2) {
            room.pendingRematch.clear();

            io.to(roomId).emit('rematchStart', {
                message: 'Nova partida iniciando...'
            });

            room.startGame();
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ Player desconectado:', socket.id);

        rooms.forEach((room) => {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                room.handleDisconnect(socket.id);
            }
        });
    });

    socket.on('leaveRoom', () => {
        const room = [...rooms.values()].find(r => r.isSocketInRoom(socket.id));
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        io.to(room.roomId).emit('playerLeft', { playerNumber: player.number });
        room.stopGame();
    });
});

// ========================================
// LIMPEZA DE SALAS INATIVAS
// ========================================

setInterval(() => {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minutos

    rooms.forEach((room, roomId) => {
        // Uma sala é inativa se não tem players ativos E não tem players desconectados aguardando reconexão
        if (
            room.players.length === 0 &&
            room.disconnectedPlayers.size === 0 &&
            now - room.lastUpdate > timeout
        ) {
            console.log(`🧹 Removendo sala inativa: ${roomId}`);
            room.stopGame(); // Garante que o loop de jogo seja parado
            rooms.delete(roomId);
        }
    });
}, 5 * 60 * 1000); // Checa a cada 5 minutos

// ========================================
// ROTA DE STATUS
// ========================================

app.get('/status', (req, res) => {
    const status = {
        totalRooms: rooms.size,
        rooms: []
    };

    rooms.forEach((room, roomId) => {
        status.rooms.push({
            id: roomId,
            activePlayers: room.players.length,
            disconnectedPlayers: room.disconnectedPlayers.size,
            gameStarted: room.gameState.gameStarted,
            isPaused: room.gameState.isPaused,
            scores: room.gameState.scores,
            ball: {
                x: Math.round(room.gameState.ball.x),
                y: Math.round(room.gameState.ball.y),
                vx: Math.round(room.gameState.ball.vx),
                vy: Math.round(room.gameState.ball.vy)
            }
        });
    });
    res.json(status);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📊 Status: http://localhost:${PORT}/status`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});

// Tratamento de encerramento do processo
process.on('SIGINT', () => {
    console.log('Servidor encerrando...');

    server.close(() => {
        console.log('Servidor HTTP fechado.');
        process.exit(0);
    });

    setTimeout(() => {
        console.warn('⚠️ Servidor não encerrou em 5 segundos, forçando saída.');
        process.exit(1);
    }, 5000);
});

function Phaser_clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}