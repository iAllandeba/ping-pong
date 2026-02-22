import { BaseGameScene } from './baseGameScene.js';

class MultiplayerScene extends BaseGameScene {
    constructor() {
        super('MultiplayerScene');

        this.onConnectHandler = this.handleConnect.bind(this);
        this.onDisconnectHandler = this.handleDisconnect.bind(this);
        this.onPlayerJoinedHandler = this.handlePlayerJoined.bind(this);
        this.onPlayerLeftHandler = this.handlePlayerLeft.bind(this);
        this.onRoomFullHandler = this.handleRoomFull.bind(this);
        this.onReconnectSuccessHandler = this.handleReconnectSuccess.bind(this);
        this.onReconnectFailedHandler = this.handleReconnectFailed.bind(this);
        this.onGameStartHandler = this.handleGameStart.bind(this);
        this.onGameStateHandler = this.handleGameState.bind(this);
        this.onBallLaunchedHandler = this.handleBallLaunched.bind(this);
        this.onPointScoredHandler = this.handlePointScored.bind(this);
        this.onGameEndHandler = this.handleGameEnd.bind(this);
        this.onRematchStatusHandler = this.handleRematchStatus.bind(this);
        this.onRematchStartHandler = this.handleRematchStart.bind(this);
        this.onServerCountdownHandler = this.handleServerCountdown.bind(this);
        this.onPlayerReconnectedHandler = this.handlePlayerReconnected.bind(this);
        this.onPongHandler = this.handlePong.bind(this);
        this.onCountdownCancelledHandler = this.handleCountdownCancelled.bind(this);
        this.onPlayerDisconnectedHandler = this.handlePlayerDisconnected.bind(this);
        this.onGameResumingHandler = this.handleGameResuming.bind(this);
        this.onGameResumedHandler = this.handleGameResumed.bind(this);
        this.onJoinedRoomHandler = this.handleJoinedRoom.bind(this);
        this.onWaitingForOpponentHandler = this.handleWaitingForOpponent.bind(this);
        this.onPaddleHitHandler = this.handlePaddleHit.bind(this);
        this.onScoreUpdateHandler = this.handleScoreUpdate.bind(this);
    }

    async init(data) {
        await super.init(data);

        this.roomCode = data.room;
        console.log(`[MultiplayerScene] Iniciando com roomCode: ${this.roomCode}`);

        this.playerNumber = null;
        this.socket = null;
        this.lastInputSent = { vy: 0 };
        this.hasJoinedRoom = false;
        this.inputHistory = [];

        this.pingText = null;
        this.latencyTimer = null;
        this.currentPing = 0;

        this.serverState = null;
        this.interpolationBuffer = [];
        this.BUFFER_SIZE = 2
        this.INTERP_DELAY_MS = 120;

        this.reconnectToken = null;
        this.reconnectTimer = null;
        this.rematchStatusText = null;
    }

    preload() {
        super.preload();
    }

    create() {
        super.create();
        this.createMultiplayerHud();
        this.setupMultiplayer();

        // Registrar o evento de shutdown da cena para remover listeners de socket
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    }

    update(time, delta) {
        super.update();

        this.sendPaddleInput();

        const dt = delta / 1000; // segundos

        // Predição simples do paddle local
        if (this.playerNumber === 1) {
            this.paddle1.y += this.lastInputSent.vy * dt;
        } else if (this.playerNumber === 2) {
            this.paddle2.y += this.lastInputSent.vy * dt;
        }

        // Mantém o paddle dentro da tela
        const paddle = this.playerNumber === 1 ? this.paddle1 : this.paddle2;
        if (paddle) {
            const halfHeight = paddle.displayHeight / 2;
            const minY = halfHeight;
            const maxY = this.game.config.height - halfHeight;
            paddle.y = Phaser.Math.Clamp(paddle.y, minY, maxY);
        }

        // A interpolação será feita dentro de updateFromServer
        if (this.serverState) {
            this.updateFromServer(time, delta);
        }
    }

    handleConnect() {
        console.log('🔗 Conectado ao servidor!');

        if (!this.socket || !this.socket.connected) {
            console.error('Erro: Socket é nulo ou desconectado em handleConnect. Tentando recriar.');

            // Em um cenário ideal, isso não deveria acontecer aqui.
            this.setupMultiplayer(); // Tenta re-setup o socket
            return;
        }

        const savedToken = localStorage.getItem(`reconnectToken_${this.roomCode}`);
        if (savedToken) {
            this.reconnectToken = savedToken;
            this.showWait('Reconectando...', 'Restaurando sessão...');

            this.socket.emit('attemptReconnect', {
                roomId: this.roomCode,
                reconnectToken: this.reconnectToken
            });
        } else {
            this.showWait('Conectando...', 'Entrando na sala...');

            this.socket.emit('joinRoom', this.roomCode);
        }
    }

    handleDisconnect() {
        console.log('🔌 Desconectado do servidor!');
        this.stopLatencyMonitor();
        this.stopReconnectTimer();
        this.hideServerCountdown();
        this.hideEndGameMenu();

        // Se a desconexão não foi intencional (ex: servidor caiu, internet),
        // e não estamos já no processo de voltar ao menu,
        // podemos mostrar uma mensagem e talvez tentar reconectar automaticamente.
        // Por enquanto, vamos para o menu principal para simplificar.
        this.showWait('Desconectado', 'Conexão perdida com o servidor. Voltando ao menu principal...');
        this.backToMenuScene();
    }

    setupMultiplayer() {
        // Se já houver um socket conectado e a sala já foi juntada,
        // apenas reseta o estado local. Isso é para casos de rematch na mesma cena.
        if (this.socket && this.socket.connected && this.hasJoinedRoom) {
            console.log('Socket já conectado e na sala. Apenas resetando estado local.');
            this.resetGameForRematch();
            return;
        }

        // ---------- CRIAÇÃO DO SOCKET ----------
        // Se não há socket ou ele está desconectado, cria um novo.
        // Isso garante que this.socket sempre aponte para o socket ativo.
        if (!this.socket || !this.socket.connected) {
            console.log('Criando novo socket.io instance...');
            this.socket = io();
        } else {
            console.log('Socket.io instance já existe e está conectada.');
        }

        this.setupSocketListeners();
        this.startLatencyMonitor();
    }

    setupSocketListeners() {
        this.removeSocketListeners();

        this.socket.on('connect', this.onConnectHandler);
        this.socket.on('disconnect', this.onDisconnectHandler);
        this.socket.on('playerJoined', this.onPlayerJoinedHandler);
        this.socket.on('playerLeft', this.onPlayerLeftHandler);
        this.socket.on('roomFull', this.onRoomFullHandler);
        this.socket.on('reconnectSuccess', this.onReconnectSuccessHandler);
        this.socket.on('reconnectFailed', this.onReconnectFailedHandler);
        this.socket.on('gameStart', this.onGameStartHandler);
        this.socket.on('gameState', this.onGameStateHandler);
        this.socket.on('ballLaunched', this.onBallLaunchedHandler);
        this.socket.on('pointScored', this.onPointScoredHandler);
        this.socket.on('gameEnd', this.onGameEndHandler);
        this.socket.on('rematchStatus', this.onRematchStatusHandler);
        this.socket.on('rematchStart', this.onRematchStartHandler);
        this.socket.on('serverCountdown', this.onServerCountdownHandler);
        this.socket.on('playerReconnected', this.onPlayerReconnectedHandler);
        this.socket.on('pong', this.onPongHandler);
        this.socket.on('countdownCancelled', this.onCountdownCancelledHandler);
        this.socket.on('playerDisconnected', this.onPlayerDisconnectedHandler);
        this.socket.on('gameResuming', this.onGameResumingHandler);
        this.socket.on('gameResumed', this.onGameResumedHandler);
        this.socket.on('joinedRoom', this.onJoinedRoomHandler);
        this.socket.on('waitingForOpponent', this.onWaitingForOpponentHandler);
        this.socket.on('paddleHit', this.onPaddleHitHandler);
        this.socket.on('scoreUpdate', this.onScoreUpdateHandler);

        console.log('📡 Registrando listeners de socket...');
    }

    removeSocketListeners() {
        if (!this.socket) return;

        this.socket.off('connect', this.onConnectHandler);
        this.socket.off('disconnect', this.onDisconnectHandler);
        this.socket.off('playerJoined', this.onPlayerJoinedHandler);
        this.socket.off('playerLeft', this.onPlayerLeftHandler);
        this.socket.off('roomFull', this.onRoomFullHandler);
        this.socket.off('reconnectSuccess', this.onReconnectSuccessHandler);
        this.socket.off('reconnectFailed', this.onReconnectFailedHandler);
        this.socket.off('gameStart', this.onGameStartHandler);
        this.socket.off('gameState', this.onGameStateHandler);
        this.socket.off('ballLaunched', this.onBallLaunchedHandler);
        this.socket.off('pointScored', this.onPointScoredHandler);
        this.socket.off('gameEnd', this.onGameEndHandler);
        this.socket.off('rematchStatus', this.onRematchStatusHandler);
        this.socket.off('rematchStart', this.onRematchStartHandler);
        this.socket.off('serverCountdown', this.onServerCountdownHandler);
        this.socket.off('playerReconnected', this.onPlayerReconnectedHandler);
        this.socket.off('pong', this.onPongHandler);
        this.socket.off('countdownCancelled', this.onCountdownCancelledHandler);
        this.socket.off('playerDisconnected', this.onPlayerDisconnectedHandler);
        this.socket.off('gameResuming', this.onGameResumingHandler);
        this.socket.off('gameResumed', this.onGameResumedHandler);
        this.socket.off('joinedRoom', this.onJoinedRoomHandler);
        this.socket.off('waitingForOpponent', this.onWaitingForOpponentHandler);
        this.socket.off('paddleHit', this.onPaddleHitHandler);
        this.socket.off('scoreUpdate', this.onScoreUpdateHandler);

        console.log('🧹 Removendo listeners de socket...');
    }

    resetGameForRematch() {
        console.log('[MultiplayerScene] Resetando estado do jogo para rematch...');
        this.stopGameLogic();
        this.score1 = 0;
        this.score2 = 0;
        this.updateScore();
        this.ball.setPosition(this.cfg.WIDTH / 2, this.cfg.HEIGHT / 2);
        this.paddle1.setPosition(this.cfg.PADDLE1_X, this.cfg.HEIGHT / 2);
        this.paddle2.setPosition(this.cfg.PADDLE2_X, this.cfg.HEIGHT / 2);
        this.gameStarted = false;
        this.serverState = null;
        this.interpolationBuffer = [];
        this.hideServerCountdown();
        this.hideEndGameMenu();
        this.statusText.setText('');
        if (this.rematchStatusText) this.rematchStatusText.setVisible(false).setText('');
    }

    handlePlayerJoined(data) {
        console.log('🤝 [CLIENT] PlayerJoined:', data);
        this.statusText.setText(`Jogador ${data.playerNumber} entrou na sala.`);
        if (data.playersInRoom === 2) {
            this.statusText.setText('Oponente encontrado! Preparando partida...');
        }
    }

    handlePlayerLeft(data) {
        console.log('👋 [CLIENT] PlayerLeft:', data);
        this.statusText.setText(`Jogador ${data.playerNumber} saiu da sala.`);
        this.showWait('Oponente Saiu', 'Aguardando novo oponente...');
        this.stopGameLogic();
        this.hideEndGameMenu();
        this.hideServerCountdown();
    }

    handleRoomFull(data) {
        console.log('⚠️ [CLIENT] RoomFull:', data.message);
        this.showWait('Sala Cheia', data.message);
        this.time.delayedCall(3000, () => {
            this.backToMenuScene();
        });
    }

    handleReconnectSuccess(data) {
        console.log('✅ [CLIENT] ReconnectSuccess:', data);
        this.playerNumber = data.playerNumber;
        this.roomCode = data.roomId;
        this.reconnectToken = data.reconnectToken;
        this.hasJoinedRoom = true;
        this.stopReconnectTimer();
        this.statusText.setText('Reconexão bem-sucedida!');
        this.serverState = data.gameState;
        this.applyServerState(this.serverState);
        // O servidor deve enviar 'gameResumed' se o jogo estava pausado
    }

    handleReconnectFailed(data) {
        console.log('❌ [CLIENT] ReconnectFailed:', data);
        this.clearReconnectToken();
        this.stopReconnectTimer();
        this.showWait('Reconexão Falhou', data.message);

        this.backToMenuScene();
    }

    handleGameStart(data) {
        console.log('🎉 [CLIENT] gameStart recebido:', data);
        this.gameStarted = true;
        this.hideEndGameMenu();
        this.statusText.setText('Partida iniciada!');
        this.serverState = data.gameState;
        this.applyServerState(this.serverState);
    }

    handleGameState(state) {
        // console.log('🔄 [CLIENT] gameState', state); // DEBUG
        this.serverState = state;
        this.interpolationBuffer.push(state);

        const maxStates = this.BUFFER_SIZE;
        while (this.interpolationBuffer.length > maxStates) {
            this.interpolationBuffer.shift();
        }

        this.gameStarted = state.gameStarted;

        this.updateScore();
    }

    handleBallLaunched() {
        // console.log('🚀 [CLIENT] ballLaunched');
        // O cliente já recebe a posição e velocidade da bola via gameState,
        // então este evento pode ser usado para efeitos visuais/sonoros adicionais.
        if (this.sfx.countdownGo) {
            this.sfx.countdownGo.play({ volume: 0.9 });
        }
    }

    handlePointScored(data) {
        console.log('🎯 [CLIENT] PointScored:', data);
        this.score1 = data.scores.p1;
        this.score2 = data.scores.p2;
        this.updateScore();
        if (this.sfx.score) {
            this.sfx.score.play({ volume: 0.8 });
        }
        // O servidor enviará um novo gameState com a bola resetada
    }

    handleGameEnd(data) {
        console.log('🏆 [CLIENT] gameEnd recebido:', data);
        this.clearReconnectToken();
        this.stopGameLogic();
        this.hideServerCountdown();

        const winnerMessage = data.winner === `PLAYER ${this.playerNumber}` ? 'VOCÊ VENCEU!' : 'VOCÊ PERDEU!';
        const finalScore1 = data.scores.p1;
        const finalScore2 = data.scores.p2;

        this.createEndGameMenu(
            winnerMessage,
            finalScore1,
            finalScore2,
            () => {
                console.log('Rematch solicitado!');
                this.socket.emit('rematchRequest', this.roomCode);
                this.hideEndGameMenu();
                this.showWait('Aguardando Rematch', 'Esperando oponente...');
            },
            () => {
                this.hideEndGameMenu();
                this.backToMenuScene();
            }
        );
    }

    handleRematchStatus(data) {
        console.log('[Multiplayer] RematchStatus recebido:', data);
        if (this.rematchStatusText) {
            this.rematchStatusText.setVisible(true).setText(`Rematch: ${data.playersReady}/${data.totalPlayers}`);
        }
        if (data.playersReady === data.totalPlayers) {
            this.rematchStatusText.setText('Todos prontos! Iniciando nova partida...');
            this.time.delayedCall(1000, () => {
                if (this.rematchStatusText) this.rematchStatusText.setVisible(false);
            });
        }
    }

    handleRematchStart(data) {
        console.log('[Multiplayer] RematchStart recebido:', data);
        this.hideEndGameMenu();
        this.resetGameForRematch();
        this.showWait('Nova partida!', 'Preparando...');
        // O servidor agora enviará 'serverCountdown' e 'gameState' para iniciar a nova partida.
        // O cliente apenas espera por esses eventos.
    }

    handleServerCountdown(data) {
        console.log(`⏳ [CLIENT] serverCountdown recebido: ${data.time}`);

        if (data.time > 0) {
            this.showWait('Prepare-se!', `Partida começando em ${data.time}s...`);
        } else {
            this.showWait('GO!', 'A partida começou!');
        }

        this.showServerCountdown(data.time);
    }

    showServerCountdown(time) {
        if (!this.countdownText) return;

        this.countdownText.setVisible(true);
        const color = time <= 3 && time > 0 ? '#ff0000' : '#ffffff';
        this.countdownText.setColor(color);
        this.countdownText.setText(`${time}`);

        if (time > 0 && time <= 3) {
            if (this.sfx.countdownBeep) {
                this.sfx.countdownBeep.play({ volume: 0.7 });
            }

            // Cancela tweens anteriores para não acumular animações
            this.tweens.killTweensOf(this.countdownText);

            this.tweens.add({
                targets: this.countdownText,
                scale: 1.5,
                duration: 200,
                yoyo: true,
                ease: 'Sine.easeInOut',
            });
        } else if (time === 0) {
            this.countdownText.setText('GO!');
            this.countdownText.setColor('#ffffff');

            if (this.sfx?.countdownGo) {
                this.sfx.countdownGo.play({ volume: 0.9 });
            }

            this.tweens.killTweensOf(this.countdownText);

            this.tweens.add({
                targets: this.countdownText,
                scale: 2,
                alpha: 0,
                duration: 500,
                ease: 'Sine.easeOut',
                onComplete: () => {
                    this.countdownText.setVisible(false).setAlpha(1).setScale(1);
                    this.hideWait();
                }
            });
        }
    }

    hideServerCountdown() {
        if (this.countdownText) {
            this.countdownText.setVisible(false).setAlpha(1).setScale(1);
        }
    }

    handlePlayerReconnected(data) {
        console.log('🤝 [CLIENT] PlayerReconnected:', data);
        this.statusText.setText(`Jogador ${data.playerNumber} reconectou.`);
        this.hideServerCountdown();
        // O servidor deve enviar um gameState atualizado ou retomar o jogo
    }

    handlePong(data) {
        this.currentPing = Date.now() - data.clientSendTime;
        if (this.pingText) {
            this.pingText.setText(`Ping: ${this.currentPing} ms`);
        }
        this.adjustInterpolationForLatency(this.currentPing);
    }

    handleCountdownCancelled(data) {
        console.log('🚫 [CLIENT] CountdownCancelled:', data);
        this.hideServerCountdown();
        const msg = data?.message ?? 'Partida cancelada';
        this.showWait('Partida Cancelada', msg);
        this.backToMenuScene();
    }

    handlePlayerDisconnected(data) {
        console.log('💔 [CLIENT] PlayerDisconnected:', data);
        this.stopGameLogic();
        this.hideServerCountdown();

        const disconnectedPlayerNumber = data.playerNumber;
        const message = `Oponente (P${disconnectedPlayerNumber}) desconectou!`;

        this.createEndGameMenu(
            message,
            this.score1,
            this.score2,
            () => {
                console.log('Aguardando reconexão ou novo rematch...');
                this.hideEndGameMenu();
                this.showWait('Aguardando Oponente', 'Esperando reconexão ou novo jogador...');
                // O servidor já está gerenciando o timeout de reconexão.
                // Se um novo jogador entrar, o servidor enviará 'gameStart'.
            },
            () => {
                console.log('Voltando ao menu principal após desconexão do oponente...');
                this.hideEndGameMenu();
                this.backToMenuScene();
            },
            data.waitingReconnect ? 'ESPERAR RECONEXÃO' : 'NOVO REMATCH'
        );
    }

    handleGameResuming(data) {
        console.log('▶️ [CLIENT] GameResuming:', data);
        this.showWait('Jogo Retomando', 'Aguardando sincronização...');
    }

    handleGameResumed(data) {
        console.log('✅ [CLIENT] GameResumed:', data);
        this.statusText.setText('Jogo retomado!');
    }

    handleJoinedRoom(data) {
        console.log('✅ [CLIENT] Sala unida:', data);
        this.playerNumber = data.playerNumber;
        this.roomCode = data.roomId;
        this.reconnectToken = data.reconnectToken;
        this.hasJoinedRoom = true;

        this.clearReconnectTokenFromLocalStorage();
        localStorage.setItem(`reconnectToken_${this.roomCode}`, this.reconnectToken);

        if (data.playersInRoom === 1) {
            this.showWait('Aguardando Oponente', 'Compartilhe o código da sala: ' + this.roomCode);
        } else if (data.playersInRoom === 2) {
            this.statusText.setText('Oponente encontrado! Preparando partida...');
            // O servidor enviará 'gameStart' e 'serverCountdown' em seguida
        }
        this.serverState = data.gameState;
        this.applyServerState(this.serverState);
    }

    handleWaitingForOpponent(data) {
        console.log('⏳ [CLIENT] Aguardando oponente:', data);
        this.showWait('Aguardando Oponente', data);
    }

    handlePaddleHit(paddleNumber) {
        // console.log('💥 [CLIENT] PaddleHit:', player); // DEBUG
        this.playPaddleHitEffects(paddleNumber);
    }

    handleScoreUpdate(data) {
        // console.log('📊 [CLIENT] ScoreUpdate:', data); // DEBUG
        this.score1 = data.scores.p1;
        this.score2 = data.scores.p2;
        this.updateScore();
    }

    startLatencyMonitor() {
        this.stopLatencyMonitor();
        this.latencyTimer = this.time.addEvent({
            delay: 2000, // A cada 2 segundos
            callback: () => {
                if (this.socket && this.socket.connected) {
                    this.socket.emit('ping', { clientSendTime: Date.now() });
                }
            },
            loop: true
        });
        console.log(`📡 Monitor de latência iniciado a cada ${this.latencyTimer.delay}ms.`);
    }

    stopLatencyMonitor() {
        if (this.latencyTimer) {
            this.latencyTimer.remove();
            this.latencyTimer = null;
            console.log('📡 Monitor de latência parado.');
        }
    }

    stopReconnectTimer() {
        if (this.reconnectTimer) {
            this.reconnectTimer.remove();
            this.reconnectTimer = null;
            console.log('✅ Contador de reconexão parado.');
        }
        // ✅ Usar this.countdownText para o display de reconexão
        if (this.countdownText) {
            this.countdownText.setVisible(false);
        }
    }

    sendPaddleInput() {
        // console.debug(`✅ sendPaddleInput para o servidor. this.playerNumber=${this.playerNumber}`);

        if (!this.socket || !this.playerNumber) return;

        let vy = 0;
        if (this.keys.W.isDown || this.cursors.up.isDown) {
            vy = -this.cfg.PADDLE_SPEED;
        } else if (this.keys.S.isDown || this.cursors.down.isDown) {
            vy = this.cfg.PADDLE_SPEED;
        }

        if (vy === this.lastInputSent.vy) return;
        this.lastInputSent.vy = vy;

        const now = Date.now();
        this.inputHistory.push({ time: now, vy });

        // console.debug(`✅ enviando evento paddleInput para o servidor. room: ${this.roomCode}, vy: ${vy}, clientTime: ${now}`);

        this.socket.emit('paddleInput', {
            room: this.roomCode,
            vy,
            clientTime: now
        });
    }

    adjustInterpolationForLatency(rtt) {
        this.INTERP_DELAY_MS = Phaser.Math.Clamp(rtt * 1.5, 80, 220);

        if (rtt < 80) {
            this.BUFFER_SIZE = 6;
        } else if (rtt < 150) {
            this.BUFFER_SIZE = 8;
        } else {
            this.BUFFER_SIZE = 10;
        }
    }

    updateFromServer() {
        const buffer = this.interpolationBuffer;
        if (!buffer.length) return;

        const now = Date.now();
        const renderTimestamp = now - this.INTERP_DELAY_MS;

        // Se só há um state, aplica direto (não temos como interpolar).
        if (buffer.length === 1) {
            this.applyServerState(buffer[0]);
            return;
        }

        let previousState = null;
        let nextState = null;

        for (let i = buffer.length - 1; i >= 0; i--) {
            const s = buffer[i];
            if (s.timestamp <= renderTimestamp) {
                previousState = s;
                nextState = buffer[i + 1] || s;
                break;
            }
        }

        if (!previousState) {
            const first = buffer[0];
            this.applyServerState(first);
            return;
        }

        if (!nextState) {
            this.applyServerState(previousState);
            return;
        }

        const t0 = previousState.timestamp;
        const t1 = nextState.timestamp;
        const dt = t1 - t0 || 1;
        const alpha = Phaser.Math.Clamp((renderTimestamp - t0) / dt, 0, 1);

        // --- INTERPOLAÇÃO PADRÃO ---
        // bola
        const interpolatedBallX = Phaser.Math.Linear(previousState.ball.x, nextState.ball.x, alpha);
        const interpolatedBallY = Phaser.Math.Linear(previousState.ball.y, nextState.ball.y, alpha);
        this.ball.x = interpolatedBallX;
        this.ball.y = interpolatedBallY;
        if (this.ball.body) {
            const interpolatedBallVX = Phaser.Math.Linear(previousState.ball.vx, nextState.ball.vx, alpha);
            const interpolatedBallVY = Phaser.Math.Linear(previousState.ball.vy, nextState.ball.vy, alpha);
            this.ball.body.setVelocity(interpolatedBallVX, interpolatedBallVY);
        }

        // paddles
        const serverPaddle1Y = Phaser.Math.Linear(previousState.paddle1.y, nextState.paddle1.y, alpha);
        const serverPaddle2Y = Phaser.Math.Linear(previousState.paddle2.y, nextState.paddle2.y, alpha);
        this.paddle1.y = serverPaddle1Y;
        this.paddle2.y = serverPaddle2Y;
        if (this.paddle1.body) {
            const interpolatedPaddle1VY = Phaser.Math.Linear(previousState.paddle1.vy, nextState.paddle1.vy, alpha);
            this.paddle1.body.setVelocityY(interpolatedPaddle1VY);
        }
        if (this.paddle2.body) {
            const interpolatedPaddle2VY = Phaser.Math.Linear(previousState.paddle2.vy, nextState.paddle2.vy, alpha);
            this.paddle2.body.setVelocityY(interpolatedPaddle2VY);
        }

        // Pontuação/estado
        this.score1 = nextState.scores.p1;
        this.score2 = nextState.scores.p2;
        this.updateScore();
        this.gameStarted = nextState.gameStarted;

        // --- RECONCILIAÇÃO SUAVE DO PADDLE LOCAL ---

        const isP1 = this.playerNumber === 1;
        const localPaddle = isP1 ? this.paddle1 : this.paddle2;
        const serverPaddleY = isP1 ? serverPaddle1Y : serverPaddle2Y;

        if (localPaddle) {
            const diff = serverPaddleY - localPaddle.y;
            const CORRECTION_FACTOR = 0.1; // 10% da diferença por frame

            if (Math.abs(diff) < 50) {
                // diferença pequena: corrige suavemente
                localPaddle.y += diff * CORRECTION_FACTOR;
            } else {
                // diferença grande: algo desandou → snap direto
                localPaddle.y = serverPaddleY;
            }
        }
    }

    applyServerState(state) {
        if (!state) return;

        this.ball.x = state.ball.x;
        this.ball.y = state.ball.y;
        if (this.ball.body) {
            this.ball.body.setVelocity(state.ball.vx, state.ball.vy);
        }

        this.paddle1.y = state.paddle1.y;
        this.paddle2.y = state.paddle2.y;
        if (this.paddle1.body) {
            this.paddle1.body.setVelocityY(state.paddle1.vy);
        }
        if (this.paddle2.body) {
            this.paddle2.body.setVelocityY(state.paddle2.vy);
        }

        this.score1 = state.scores.p1;
        this.score2 = state.scores.p2;
        this.gameStarted = state.gameStarted;
        this.updateScore();
    }

    disconnectSocket() {
        if (!this.socket) {
            console.log('🔌 Socket já está nulo ou desconectado.');
            return;
        }

        console.log('🔌 Desconectando Socket.IO...');
        this.removeSocketListeners();
        if (this.socket.connected) {
            this.socket.disconnect();
        }
        this.socket = null;

        this.roomCode = null;
        this.reconnectToken = null;
        this.stopReconnectTimer();
        if (this.latencyTimer) {
            this.latencyTimer.remove();
            this.latencyTimer = null;
        }
        this.hideServerCountdown();
    }

    clearReconnectToken() {
        localStorage.removeItem(`reconnectToken_${this.roomCode}`);
    }

    shutdown() {
        console.log(`🧹 ${this.scene.key}: Iniciando shutdown específico do Multiplayer...`);

        this.disconnectSocket();

        super.shutdown();

        this.playerNumber = null;
        this.lastInputSent = { vy: 0 };
        this.hasJoinedRoom = false;
        this.pingText = null;
        this.serverState = null;
        this.interpolationBuffer = [];
        this.roomCode = null;
        this.currentPing = 0;
        this.INTERP_DELAY_MS = 120;
        this.rematchStatusText = null;

        console.log(`✅ ${this.scene.key}: Shutdown específico do Multiplayer completo.`);
    }

    createMultiplayerHud() {
        this.pingText = this.add.text(this.cfg.WIDTH - 10, 10, 'Ping: -- ms', {
            fontSize: '18px',
            fill: '#ffffff'
        }).setOrigin(1, 0).setDepth(100);

        // ✅ Adicionado: Texto para o status do rematch (ex: "Rematch: 1/2")
        this.rematchStatusText = this.add.text(this.cfg.WIDTH / 2, this.cfg.HEIGHT / 2 + 100, '', {
            fontSize: '24px',
            fill: '#ffffff',
            fontStyle: 'bold',
            align: 'center'
        }).setOrigin(0.5).setDepth(101).setVisible(false);
    }

    onEscToMenu() {
        this.disconnectSocket();
        super.onEscToMenu();
    }

    clearReconnectTokenFromLocalStorage() {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('reconnectToken_')) {
                console.log(`[MultiplayerScene] Removendo token de reconexão antigo: ${key}`);
                localStorage.removeItem(key);
            }
        }
    }

    backToMenuScene() {
        if (!this.scene.isActive('MenuScene')) { // Evita loop se já estamos voltando
            console.log('Voltando ao menu principal em 3s...');

            this.time.delayedCall(3000, () => {
                this.disconnectSocket(); // Limpa o socket completamente
                this.scene.stop(this.scene.key);
                const url = new URL(window.location.href);
                url.searchParams.delete('room');
                window.history.replaceState({}, document.title, url.toString());
                this.scene.start('MenuScene');
            });
        }
    }
}

export default MultiplayerScene;