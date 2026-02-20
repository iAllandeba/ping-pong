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

        // ✅ Se o jogo estava rodando, pausa de forma autoritativa
        if (this.gameState.gameStarted && !this.gameState.isPaused) {
            this.pauseGame();
            console.log(`[Room ${this.roomId}] ⏸️ Jogo pausado após desconexão do P${playerNumber}`);
        }
        // ✅ Se estava em countdown, cancela o countdown
        if (this.serverCountdownTimer) {
            clearInterval(this.serverCountdownTimer);
            this.serverCountdownTimer = null;
            io.to(this.roomId).emit('countdownCancelled'); // Notifica clientes
            console.log(`[Room ${this.roomId}] ❌ Countdown cancelado devido a desconexão.`);
        }


        io.to(this.roomId).emit('playerDisconnected', {
            playerNumber,
            waitingReconnect: true,
            gameState: this.getFullGameState() // ✅ Envia o estado atual (pausado) para o outro cliente
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
        return {
            ball: { ...this.gameState.ball },
            paddle1: { ...this.gameState.paddle1 },
            paddle2: { ...this.gameState.paddle2 },
            scores: { ...this.gameState.scores },
            gameStarted: this.gameState.gameStarted,
            isPaused: this.gameState.isPaused, // ✅ Inclui isPaused
            stats: { ...this.stats }
        };
    }

    // ✅ Pausa o jogo de forma autoritativa
    pauseGame() {
        if (this.gameState.gameStarted && !this.gameState.isPaused) {
            this.gameState.isPaused = true;
            this.gameState.gameStarted = false; // O jogo não está "rodando" ativamente
            this.savedBallState = { ...this.gameState.ball }; // Salva o estado da bola
            this.gameState.ball.vx = 0;
            this.gameState.ball.vy = 0;
            clearInterval(this.gameLoop);
            this.gameLoop = null;
            console.log(`[Room ${this.roomId}] Jogo pausado. Bola parada.`);
            this.broadcast(); // Envia o estado pausado
        }
    }

    // ✅ Retoma o jogo de forma autoritativa
    resumeGame() {
        if (this.gameState.isPaused && this.players.length === 2) {
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
                    this.savedBallState = null;
                    console.log(`[Room ${this.roomId}] Bola restaurada para: x=${this.gameState.ball.x}, y=${this.gameState.ball.y}`);
                } else {
                    this.launchBall();
                    console.log(`[Room ${this.roomId}] Bola relançada após retomada.`);
                }

                this.gameLoop = setInterval(() => {
                    const now = Date.now();
                    const dt = (now - this.lastUpdate) / 1000; // Delta time em segundos
                    this.updateGamePhysics(dt);
                    this.lastUpdate = now;
                    this.broadcast();
                }, this.cfg.FRAME_TIME);
                console.log(`[Room ${this.roomId}] gameLoop iniciado para retomada.`);

                io.to(this.roomId).emit('gameResumed', { gameState: this.getFullGameState() }); // ✅ Envia o estado completo
                this.broadcast(); // Garante que o estado inicial da retomada seja enviado
                console.log(`[Room ${this.roomId}] ✅ Jogo retomado.`);
            }, this.cfg.RESUME_COUNTDOWN);
        }
    }

    // ✅ NOVO: Inicia o countdown no servidor
    startServerCountdown(duration, onCompleteCallback) {
        let timeLeft = duration / 1000; // Converte para segundos
        io.to(this.roomId).emit('serverCountdown', { time: timeLeft, totalDuration: duration });
        console.log(`[Room ${this.roomId}] Servidor iniciando countdown: ${timeLeft}s`);

        this.serverCountdownTimer = setInterval(() => {
            timeLeft--;
            io.to(this.roomId).emit('serverCountdown', { time: timeLeft, totalDuration: duration });
            console.log(`[Room ${this.roomId}] Countdown: ${timeLeft}s`);

            if (timeLeft <= 0) {
                clearInterval(this.serverCountdownTimer);
                this.serverCountdownTimer = null;
                console.log(`[Room ${this.roomId}] Countdown finalizado.`);
                if (onCompleteCallback) {
                    onCompleteCallback();
                }
            }
        }, 1000);
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
        const cfg = this.cfg;

        if (!state.gameStarted || state.isPaused) {
            // console.log(`[Room ${this.roomId}] Física pausada. gameStarted: ${state.gameStarted}, isPaused: ${state.isPaused}`);
            return;
        }

        // ✅ VERIFICAÇÃO ADICIONAL: Garante que a bola está dentro dos limites no início do jogo
        // Isso evita que um ponto seja marcado no primeiro tick se a bola estiver "nascendo" fora
        if (state.ball.x < cfg.BALL_RADIUS || state.ball.x > cfg.WIDTH - cfg.BALL_RADIUS) {
            // Se a bola está muito perto da borda no início, não pontua ainda.
            // Isso pode acontecer se a bola for lançada exatamente na borda ou ligeiramente fora.
            // Apenas move a bola para dentro se estiver muito perto.
            if (state.ball.x < cfg.BALL_RADIUS) state.ball.x = cfg.BALL_RADIUS;
            if (state.ball.x > cfg.WIDTH - cfg.BALL_RADIUS) state.ball.x = cfg.WIDTH - cfg.BALL_RADIUS;
            // console.log(`[Room ${this.roomId}] Ajustando bola para dentro do campo: x=${state.ball.x}`);
        }


        // Atualiza posição da bola
        state.ball.x += state.ball.vx * dt;
        state.ball.y += state.ball.vy * dt;

        // Limites verticais
        const top = cfg.BALL_RADIUS;
        const bottom = cfg.HEIGHT - cfg.BALL_RADIUS;
        if (state.ball.y <= top) {
            state.ball.y = top;
            state.ball.vy *= -1;
        } else if (state.ball.y >= bottom) {
            state.ball.y = bottom;
            state.ball.vy *= -1;
        }

        // Atualiza paddles com base em vy atuais
        state.paddle1.y += state.paddle1.vy * dt;
        state.paddle2.y += state.paddle2.vy * dt;

        // Clampa paddles dentro dos limites da tela
        const halfPaddle = cfg.PADDLE_HEIGHT / 2;
        const minY = halfPaddle;
        const maxY = cfg.HEIGHT - halfPaddle;

        state.paddle1.y = Math.max(minY, Math.min(maxY, state.paddle1.y));
        state.paddle2.y = Math.max(minY, Math.min(maxY, state.paddle2.y));

        // Colisão com paddles
        // Paddle 1
        if (
            state.ball.vx < 0 && // Bola indo para a esquerda
            state.ball.x - cfg.BALL_RADIUS <= cfg.PADDLE1_X + cfg.PADDLE_WIDTH / 2 && // Posição X da bola
            state.ball.x - cfg.BALL_RADIUS >= cfg.PADDLE1_X - cfg.PADDLE_WIDTH / 2 && // Garante que a bola não passe direto
            state.ball.y + cfg.BALL_RADIUS >= state.paddle1.y - halfPaddle && // Colisão Y
            state.ball.y - cfg.BALL_RADIUS <= state.paddle1.y + halfPaddle &&
            this.lastHitPaddle !== 1 // Evita múltiplas colisões no mesmo tick
        ) {
            state.ball.vx *= -1; // Inverte direção X
            state.ball.vx *= cfg.BALL_ACCELERATION; // Acelera a bola
            state.ball.vy += state.paddle1.vy * 0.2; // Adiciona um pouco da velocidade do paddle
            this.clampBallSpeed(state.ball);
            this.lastHitPaddle = 1;
            this.stats.p1.hits++;
            io.to(this.roomId).emit('paddleHit', { player: 1 });
            // console.log(`[Room ${this.roomId}] P1 hit! Ball VX: ${state.ball.vx}, VY: ${state.ball.vy}`);
        }
        // Paddle 2
        else if (
            state.ball.vx > 0 && // Bola indo para a direita
            state.ball.x + cfg.BALL_RADIUS >= cfg.PADDLE2_X - cfg.PADDLE_WIDTH / 2 && // Posição X da bola
            state.ball.x + cfg.BALL_RADIUS <= cfg.PADDLE2_X + cfg.PADDLE_WIDTH / 2 && // Garante que a bola não passe direto
            state.ball.y + cfg.BALL_RADIUS >= state.paddle2.y - halfPaddle && // Colisão Y
            state.ball.y - cfg.BALL_RADIUS <= state.paddle2.y + halfPaddle &&
            this.lastHitPaddle !== 2 // Evita múltiplas colisões no mesmo tick
        ) {
            state.ball.vx *= -1; // Inverte direção X
            state.ball.vx *= cfg.BALL_ACCELERATION; // Acelera a bola
            state.ball.vy += state.paddle2.vy * 0.2; // Adiciona um pouco da velocidade do paddle
            this.clampBallSpeed(state.ball);
            this.lastHitPaddle = 2;
            this.stats.p2.hits++;
            io.to(this.roomId).emit('paddleHit', { player: 2 });
            console.debug(`[Room ${this.roomId}] P2 hit! Ball VX: ${state.ball.vx}, VY: ${state.ball.vy}`);
        } else {
            // Reset quando a bola cruza o meio da tela
            const midX = cfg.WIDTH / 2;
            if (
                (this.lastHitPaddle === 1 && state.ball.x > midX) ||
                (this.lastHitPaddle === 2 && state.ball.x < midX)
            ) {
                console.debug(`[Room ${this.roomId}] lastHitPaddle resetado após cruzar o meio. Era: ${this.lastHitPaddle}`);
                this.lastHitPaddle = null;
            }
        }

        // Garante que a bola nunca fique quase horizontal demais
        this.enforceMinVerticalAngle(state.ball, 10);
        const leftEdge  = state.ball.x - cfg.BALL_RADIUS;
        const rightEdge = state.ball.x + cfg.BALL_RADIUS;

        // Log quando a bola estiver próxima da borda esquerda/direita
        if (rightEdge < 50 || leftEdge > cfg.WIDTH - 50) {
            console.log(
                `[Room ${this.roomId}] DEBUG borda: x=${state.ball.x.toFixed(2)}, ` +
                `left=${leftEdge.toFixed(2)}, right=${rightEdge.toFixed(2)}, ` +
                `vx=${state.ball.vx.toFixed(2)}, vy=${state.ball.vy.toFixed(2)}`
            );
        }

        // Pontuação
        if (state.ball.x - cfg.BALL_RADIUS <= 0) {
            // Bola saiu inteira pela ESQUERDA -> ponto P2
            console.log(`[Room ${this.roomId}] 🚨 Bola fora (esquerda)! X+R: ${(state.ball.x + cfg.BALL_RADIUS).toFixed(2)} (Limite 0)`);
            state.scores.p2++;
            this.stats.p1.misses++;
            console.log(`[Room ${this.roomId}] Ponto para P2! Placar: ${state.scores.p1}-${state.scores.p2}`);
            this.pointScored(2);
        } else if (state.ball.x + cfg.BALL_RADIUS >= cfg.WIDTH) {
            // Bola saiu inteira pela DIREITA -> ponto P1
            console.log(`[Room ${this.roomId}] 🚨 Bola fora (direita)! X-R: ${(state.ball.x - cfg.BALL_RADIUS).toFixed(2)} (Limite ${cfg.WIDTH})`);
            state.scores.p1++;
            this.stats.p2.misses++;
            console.log(`[Room ${this.roomId}] Ponto para P1! Placar: ${state.scores.p1}-${state.scores.p2}`);
            this.pointScored(1);
        }
    }

    clampBallSpeed(ball) {
        const currentSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        if (currentSpeed > this.cfg.BALL_MAX_SPEED) {
            const ratio = this.cfg.BALL_MAX_SPEED / currentSpeed;
            ball.vx *= ratio;
            ball.vy *= ratio;
            // console.log(`[Room ${this.roomId}] Ball speed clamped to MAX: ${currentSpeed.toFixed(2)} -> ${this.cfg.BALL_MAX_SPEED}`);
        } else if (currentSpeed < this.cfg.BALL_MIN_SPEED && currentSpeed !== 0) {
            const ratio = this.cfg.BALL_MIN_SPEED / currentSpeed;
            ball.vx *= ratio;
            ball.vy *= ratio;
            // console.log(`[Room ${this.roomId}] Ball speed clamped to MIN: ${currentSpeed.toFixed(2)} -> ${this.cfg.BALL_MIN_SPEED}`);
        }
    }

    pointScored() {
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
            gameState: room.getFullGameState() // Envia o estado atual da sala (pode estar pausado ou aguardando)
        });

        if (room.players.length === 1) {
            socket.emit('waitingForOpponent', `Código da sala: ${roomId}`);
        }

        if (room.players.length === 2) {
            console.log(`🎮 Sala ${roomId} completa! Iniciando partida...`);
            io.to(roomId).emit('gameStart', {
                message: 'Ambos conectados, iniciando partida.'
            });

            room.startGame();
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