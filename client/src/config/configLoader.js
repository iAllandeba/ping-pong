// ========================================
// CARREGADOR DE CONFIG DO SERVIDOR
// ========================================

let cachedConfig = null;

export async function loadGameConfig() {
    if (cachedConfig) return cachedConfig;

    try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        cachedConfig = await res.json();
        console.log('✅ Config carregada do servidor:', cachedConfig);
        return cachedConfig;
    } catch (err) {
        console.error('❌ Erro ao carregar config do servidor:', err);

        // Fallback mínimo
        //TODO: Atualizar para última versão default atualmente utilizada
        cachedConfig = {
            WIDTH: 1280,
            HEIGHT: 720,
            PADDLE_SPEED: 300,
            BALL_SPEED_INITIAL: 250,
            BALL_ACCELERATION: 1.03,
            BALL_MAX_SPEED: 550,
            BALL_MIN_SPEED: 250,
            PADDLE_HEIGHT: 100,
            PADDLE_WIDTH: 20,
            BALL_RADIUS: 10,
            PADDLE1_X: 80,
            PADDLE2_X: 1200,
            WIN_SCORE: 3,
            LATENCY_CHECK_INTERVAL: 2000
        };
        return cachedConfig;
    }
}