// ========================================
// CONFIGURAÇÃO ÚNICA DO JOGO (SERVIDOR E CLIENTE)
// Ambos usam estes valores para sincronia
// ========================================

const GAME_CONFIG = {
    // Dimensões de tela
    WIDTH: 1280,
    HEIGHT: 720,

    // Física básica
    PADDLE_SPEED: 500,

    BALL_SPEED_INITIAL: 400,
    BALL_ACCELERATION: 1.06,
    BALL_MAX_SPEED: 1500,
    BALL_MIN_SPEED: 250,

    // Dimensões dos objetos
    PADDLE_HEIGHT: 100,
    PADDLE_WIDTH: 20,
    BALL_RADIUS: 10,

    // Posições fixas
    PADDLE1_X: 80,
    PADDLE2_X: 1200,

    // Regras de jogo
    WIN_SCORE: 3,

    // Loop do servidor
    SERVER_TICK_RATE: 60, // ✅ Adicionado para uso no cliente (interpolação) e servidor
    FRAME_TIME: 1000 / 60, // 60 FPS (equivalente a 1000 / SERVER_TICK_RATE)
    COUNTDOWN_DURATION: 3000, // ms antes da primeira bola
    RESUME_COUNTDOWN: 3000, // ms para o countdown de retomada
    RECONNECT_TIMEOUT: 60000, // ms para o timeout de reconexão

    // Cliente
    LATENCY_CHECK_INTERVAL: 2000,
};

module.exports = GAME_CONFIG;