'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const GAME_CONFIG = require('./gameConfig');
const initializeSocket = require('./socketConfig');
const GamePhysics = require('./gamePhysics');

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
        this.savedBallState = null;
        this.broadcastCount = 0;
        this._lastBroadcastState = null;

        this.serverCountdownTimer = null;
        this.disconnectedPlayers = new Map();

        // ── Instancia GamePhysics com callbacks ──────────────
        this.physics = new GamePhysics(this.cfg, {
            onPoint: (scoringPlayer) => {
                this.pointScored(scoringPlayer);
            },
            onPaddleHit: (player, angle) => {
                io.to(this.roomId).emit('paddleHit', { player, angle });
            },
            getLastHitPaddle: () => this.lastHitPaddle,
            setLastHitPaddle: (v) => {
                this.lastHitPaddle = v;
            },
            getStats: () => this.stats,
            getRoomId: () => this.roomId,
        });
    }

    // ─────────────────────────────────────────────
    // ESTADO INICIAL
    // ─────────────────────────────────────────────
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

    // ─────────────────────────────────────────────
    // GESTÃO DE PLAYERS
    // ─────────────────────────────────────────────
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

        this.players.splice(playerIndex, 1);

        this.pauseGame();

        io.to(this.roomId).emit('playerDisconnected', {
            playerNumber,
            waitingReconnect: true,
            gameState: this.getFullGameState()
        });

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
                this.stopGame();
            }
        }, this.cfg.RECONNECT_TIMEOUT);

        this.disconnectedPlayers.get(playerNumber).timeoutId = timeoutId;
        return player.reconnectToken;
    }

    handleReconnect(newSocketId, reconnectToken) {
        console.log(`[Room ${this.roomId}] 🔄 Tentativa de reconexão.`);

        if (this.isSocketInRoom(newSocketId)) {
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

                // Mantém a ordem dos players (P1 sempre primeiro)
                if (playerNumber === 1) {
                    this.players.unshift(restoredPlayer);
                } else {
                    this.players.push(restoredPlayer);
                }

                this.disconnectedPlayers.delete(playerNumber);
                console.log(`[Room ${this.roomId}] ✅ Player ${playerNumber} reconectou! Total: ${this.players.length}`);

                io.to(this.roomId).emit('playerReconnected', { playerNumber });

                if (this.gameState.isPaused && this.players.length === 2) {
                    this.resumeGame();
                }

                return {
                    success: true,
                    playerNumber,
                    gameState: this.getFullGameState()
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

    // ─────────────────────────────────────────────
    // CONTROLE DE FLUXO DO JOGO
    // ─────────────────────────────────────────────
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
                    this.physics.update(this.gameState, dt);
                    this.lastUpdate = now;
                    this.broadcast();
                }, this.cfg.FRAME_TIME);

                console.log(`[Room ${this.roomId}] ✅ gameLoop iniciado.`);
            }, 100); // 100ms de margem para o cliente processar

        }, this.cfg.RESUME_COUNTDOWN);
    }

    startServerCountdown(duration, onCompleteCallback) {
        const endTime = Date.now() + duration;
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
        this.gameState = this.createInitialGameState();
        this.stats = {
            p1: { hits: 0, misses: 0, maxSpeed: 0 },
            p2: { hits: 0, misses: 0, maxSpeed: 0 }
        };
        this.lastHitPaddle = null;
        this.savedBallState = null;

        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
            console.log(`[Room ${this.roomId}] Limpando gameLoop existente.`);
        }
        if (this.serverCountdownTimer) {
            clearInterval(this.serverCountdownTimer);
            this.serverCountdownTimer = null;
            console.log(`[Room ${this.roomId}] serverCountdownTimer parado.`);
        }

        console.log(`[Room ${this.roomId}] startGame → scores: P1=${this.gameState.scores.p1}, P2=${this.gameState.scores.p2}`);

        this.gameState.gameStarted = false;
        this.gameState.isPaused = false;
        this.lastUpdate = Date.now();

        this.broadcast();

        this.startServerCountdown(this.cfg.COUNTDOWN_DURATION, () => {
            console.log(`[Room ${this.roomId}] Countdown finalizado. Iniciando jogo.`);

            if (this.gameLoop) {
                console.warn(`[Room ${this.roomId}] gameLoop já ativo após countdown. Ignorando.`);
                return;
            }

            this.gameState.gameStarted = true;
            this.launchBall();

            console.log(
                `[Room ${this.roomId}] Bola lançada: ` +
                `x=${this.gameState.ball.x.toFixed(2)}, y=${this.gameState.ball.y.toFixed(2)}, ` +
                `vx=${this.gameState.ball.vx.toFixed(2)}, vy=${this.gameState.ball.vy.toFixed(2)}`
            );

            this.lastUpdate = Date.now();
            this._startGameLoop();

            io.to(this.roomId).emit('ballLaunched');
            this.broadcast();
        });
    }

    stopGame() {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
            console.log(`[Room ${this.roomId}] gameLoop parado.`);
        }
        if (this.serverCountdownTimer) {
            clearInterval(this.serverCountdownTimer);
            this.serverCountdownTimer = null;
        }

        this.gameState.gameStarted = false;
        this.gameState.isPaused = false;
        this.gameState.ball.vx = 0;
        this.gameState.ball.vy = 0;
        this.savedBallState = null;
        this.savedPaddle1State = null;
        this.savedPaddle2State = null;
        this.lastHitPaddle = null;

        this.disconnectedPlayers.forEach(dp => clearTimeout(dp.timeoutId));
        this.disconnectedPlayers.clear();
        this.pendingRematch.clear();

        console.log(`[Room ${this.roomId}] Sala limpa.`);
        this.broadcast();
    }

    launchBall() {
        const state = this.gameState;
        state.ball.x = this.cfg.WIDTH / 2;
        state.ball.y = this.cfg.HEIGHT / 2;
        state.ball.vx = (Math.random() > 0.5 ? 1 : -1) * this.cfg.BALL_SPEED_INITIAL;
        state.ball.vy = (Math.random() * 2 - 1) * this.cfg.BALL_SPEED_INITIAL * 0.5;
        this.lastHitPaddle = null;
        console.log(
            `[Room ${this.roomId}] 🎾 Bola lançada: ` +
            `(${state.ball.x}, ${state.ball.y}) vx=${state.ball.vx} vy=${state.ball.vy}`
        );
    }

    // ─────────────────────────────────────────────
    // GAME LOOP INTERNO
    // ─────────────────────────────────────────────
    _startGameLoop() {
        this.gameLoop = setInterval(() => {
            const now = Date.now();
            const dt = (now - this.lastUpdate) / 1000;

            // Delega física ao GamePhysics
            this.physics.update(this.gameState, dt);

            this.lastUpdate = now;
            this.broadcast();
        }, this.cfg.FRAME_TIME);

        console.log(`[Room ${this.roomId}] gameLoop iniciado (FRAME_TIME: ${this.cfg.FRAME_TIME}ms).`);
    }

    // ─────────────────────────────────────────────
    // PONTUAÇÃO
    // ─────────────────────────────────────────────

    pointScored(scoringPlayer) {
        console.log(`[Room ${this.roomId}] Ponto para P${scoringPlayer}`);
        const state = this.gameState;

        if (scoringPlayer === 1) {
            state.scores.p1++;
        } else {
            state.scores.p2++;
        }

        console.log(`[Room ${this.roomId}] 📊 Placar: P1=${state.scores.p1} x P2=${state.scores.p2}`);

        io.to(this.roomId).emit('pointScored', {
            scoringPlayer,
            scores: { ...state.scores }
        });


        if (state.scores.p1 >= this.cfg.WIN_SCORE || state.scores.p2 >= this.cfg.WIN_SCORE) {
            console.log(`[Room ${this.roomId}] 🏆 WIN_SCORE atingido!`);
            this.endGame();
            return;
        }

        // Reset da bola e paddles para o centro
        state.ball = this.getInitialBallState();
        state.paddle1 = this.getInitialPaddleState();
        state.paddle2 = this.getInitialPaddleState();

        this.lastHitPaddle = null;
        state.gameStarted = false;

        this.broadcast();
        console.log(`[Room ${this.roomId}] Ponto marcado. Iniciando countdown de relançamento.`);

        this.startServerCountdown(3000, () => {
            console.log(`[Room ${this.roomId}] Countdown de relançamento finalizado. gameLoop: ${!!this.gameLoop}`);

            if (this.gameLoop) {
                state.gameStarted = true;
                this.launchBall();
                this.broadcast();
                io.to(this.roomId).emit('ballLaunched', {
                    x: this.gameState.ball.x,
                    y: this.gameState.ball.y,
                    vx: this.gameState.ball.vx,
                    vy: this.gameState.ball.vy
                });
                console.log(`[Room ${this.roomId}] Bola relançada. VX=${this.gameState.ball.vx}, VY=${this.gameState.ball.vy}`);
            } else {
                console.warn(`[Room ${this.roomId}] gameLoop inativo — bola não relançada.`);
            }
        });
    }

    endGame() {
        const winner = this.gameState.scores.p1 >= this.cfg.WIN_SCORE ? 'PLAYER 1' : 'PLAYER 2';

        io.to(this.roomId).emit('gameEnd', {
            winner,
            scores: this.gameState.scores,
            stats: this.stats,
            gameState: this.getFullGameState()
        });

        this.stopGame();
        console.log(`[Room ${this.roomId}] 🏆 Fim de jogo: ${winner} venceu!`);
    }

    // ─────────────────────────────────────────────
    // BROADCAST COM DIRTY-CHECK
    // ─────────────────────────────────────────────
    broadcast() {
        const state = this.gameState;
        const ball = state.ball;

        const snapshot = `${ball.x.toFixed(1)},${ball.y.toFixed(1)},` +
            `${state.paddle1.y.toFixed(1)},${state.paddle2.y.toFixed(1)}`;

        if (snapshot === this._lastBroadcastState && !state.gameStarted === false) return;

        this._lastBroadcastState = snapshot;
        this.broadcastCount++;

        io.to(this.roomId).emit('gameState', {
            gameState: this.getFullGameState()
        });
    }
}

// ========================================
// HELPER
// ========================================
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
            socket.emit('reconnectFailed', { message: 'Sala não encontrada ou já encerrada' });
            return;
        }

        const result = room.handleReconnect(socket.id, reconnectToken);

        if (result.success) {
            socket.join(roomId);
            socket.emit('reconnectSuccess', {
                playerNumber: result.playerNumber,
                gameState: result.gameState,
                roomId,
                reconnectToken
            });
            console.log(`✅ Reconexão: P${result.playerNumber} na sala ${roomId}`);
        } else {
            socket.emit('reconnectFailed', { message: result.message || 'Falha na reconexão' });
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
        const room = [...rooms.values()].find(r => r.isSocketInRoom(socket.id));
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const paddle = player.number === 1 ? room.gameState.paddle1 : room.gameState.paddle2;
        if (paddle) {
            paddle.vy = data.vy ?? 0;
        }
    });

    socket.on('rematchRequest', () => {
        const room = [...rooms.values()].find(r => r.isSocketInRoom(socket.id));
        if (!room) return;

        room.pendingRematch.add(socket.id);

        if (room.pendingRematch.size === 2) {
            room.pendingRematch.clear();
            console.log(`[Room ${room.roomId}] 🔄 Revanche aceita!`);
            io.to(room.roomId).emit('rematchStarting');
            room.startGame();
        } else {
            io.to(room.roomId).emit('rematchRequested', { requestedBy: socket.id });
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ Player desconectado:', socket.id);

        for (const [roomId, room] of rooms.entries()) {
            if (room.isSocketInRoom(socket.id)) {
                const token = room.handleDisconnect(socket.id);
                console.log(`[Room ${roomId}] Token de reconexão: ${token}`);
                break;
            }
        }
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
// LIMPEZA PERIÓDICA DE SALAS VAZIAS
// ========================================
setInterval(() => {
    for (const [roomId, room] of rooms.entries()) {
        const isEmpty = room.players.length === 0;
        const noDisconnected = room.disconnectedPlayers.size === 0;
        const isIdle = !room.gameLoop && !room.serverCountdownTimer;

        if (isEmpty && noDisconnected && isIdle) {
            console.log(`[RoomManager] 🗑️ Removendo sala vazia: ${roomId}`);
            rooms.delete(roomId);
        }
    }

    console.log(`[RoomManager] Salas ativas: ${rooms.size}, Players totais: ${
        [...rooms.values()].reduce((acc, r) => acc + r.players.length, 0)
    }`);
}, 5 * 60 * 1000);

// ========================================
// START SERVER
// ========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando http://localhost:${PORT}`);
    console.log(`📊 Status: http://localhost:${PORT}/status`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
