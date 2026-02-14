const UI_OFFSETS = {
    // Posições relativas (% ou offsets fixos)
    TITLE_Y_OFFSET: 140,
    SUBTITLE_Y_OFFSET: 210,
    BUTTON_START_Y: 300,
    BUTTON_START_Y_WITH_LAST_ROOM: 270,
    BUTTON_SPACING: 100,
    BUTTON_SPACING_SMALL: 90,
    INSTRUCTIONS_Y_OFFSET: -40, // 40px do fundo

    // Dimensões de botões (específicas do menu)
    BUTTON_LARGE: { width: 400, height: 80 },
    BUTTON_MEDIUM: { width: 400, height: 60 },
    BUTTON_SMALL: { width: 400, height: 50 },

    // Dimensões de modais (específicas do menu)
    MODAL_INVITE: { width: 700, height: 450 },
    MODAL_JOIN: { width: 600, height: 400 },
    MODAL_DIFFICULTY: { width: 500, height: 300 }
};

const COLORS = {
    // Cores principais
    BLACK: 0x000000,
    WHITE: 0xffffff,
    GRAY_DARK: 0x333333,
    GRAY_MEDIUM: 0x888888,
    GRAY_LIGHT: 0xaaaaaa,
    GRAY_UI: 0x666666,
    BACKGROUND: 0x1a1a1a,

    // Cores de botões (base e hover)
    BTN_SINGLE: { base: 0x4caf50, hover: 0x66bb6a },
    BTN_INVITE: { base: 0x2196f3, hover: 0x42a5f5 },
    BTN_JOIN: { base: 0x9c27b0, hover: 0xab47bc },
    BTN_LAST_ROOM: { base: 0xff9800, hover: 0xffb74d },
    BTN_COPY: { base: 0x666666, hover: 0x888888, success: 0x4caf50 },

    // Cores de modais
    MODAL_INVITE_STROKE: 0x2196f3,
    MODAL_JOIN_STROKE: 0x9c27b0,
    MODAL_DIFFICULTY_STROKE: 0x4caf50,

    // Cores de dificuldade
    DIFFICULTY_EASY: 0x81c784,
    DIFFICULTY_MEDIUM: 0x4caf50,
    DIFFICULTY_HARD: 0x2e7d32,

    // Cores de texto
    TEXT_SUCCESS: 0x4caf50,
    TEXT_ERROR: 0xff0000
};

const STYLES = {
    TITLE: {
        fontSize: '80px',
        fill: '#ffffff',
        fontStyle: 'bold'
    },
    SUBTITLE: {
        fontSize: '40px',
        fill: '#888888'
    },
    BUTTON_LARGE: {
        fontSize: '32px',
        fill: '#ffffff',
        fontStyle: 'bold'
    },
    BUTTON_MEDIUM: {
        fontSize: '24px',
        fill: '#ffffff',
        fontStyle: 'bold'
    },
    BUTTON_SMALL: {
        fontSize: '20px',
        fill: '#ffffff',
        fontStyle: 'bold'
    },
    INSTRUCTIONS: {
        fontSize: '18px',
        fill: '#666666'
    },
    MODAL_TITLE: {
        fontSize: '32px',
        fill: '#ffffff',
        fontStyle: 'bold'
    },
    MODAL_TEXT: {
        fontSize: '18px',
        fill: '#aaaaaa'
    },
    MODAL_URL: {
        fontSize: '16px',
        fill: '#4caf50',
        fontFamily: 'Courier New',
        wordWrap: { width: 630 }
    }
};

const ROOM_CODE_LENGTH = 6;

// ========================================
// MENU SCENE
// ========================================

class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });

        this.roomCodeInput = null;
        this.modalElements = [];
    }

    preload() {
        // Assets podem ser carregados aqui
    }

    async create() {
        this.cfg = this.game.registry.get('gameConfig');

        // ✅ Calcula valores derivados da config do servidor
        this.layout = this.calculateLayout(this.cfg);

        // Verifica entrada direta via URL
        if (this.handleDirectRoomEntry()) {
            return;
        }

        // Recupera última sala visitada
        const lastRoom = this.getLastRoom();

        // Renderiza elementos do menu
        this.renderBackground();
        this.renderTitle();
        this.renderButtons(lastRoom);
        this.renderInstructions();
    }

    /**
     * Calcula valores de layout baseados na config do servidor
     * ✅ Única fonte da verdade: server/gameConfig.js
     */
    calculateLayout(cfg) {
        return {
            WIDTH: cfg.WIDTH,
            HEIGHT: cfg.HEIGHT,
            CENTER_X: cfg.WIDTH / 2,
            CENTER_Y: cfg.HEIGHT / 2,

            // Posições calculadas
            TITLE_Y: UI_OFFSETS.TITLE_Y_OFFSET,
            SUBTITLE_Y: UI_OFFSETS.SUBTITLE_Y_OFFSET,
            INSTRUCTIONS_Y: cfg.HEIGHT + UI_OFFSETS.INSTRUCTIONS_Y_OFFSET,

            // Reutiliza offsets de UI
            ...UI_OFFSETS
        };
    }

    // ========================================
    // NAVEGAÇÃO E ENTRADA DIRETA
    // ========================================

    clearReconnectTokenFromLocalStorage() {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('reconnectToken_')) {
                console.log(`[MultiplayerScene] Removendo token de reconexão antigo: ${key}`);
                localStorage.removeItem(key);
            }
        }
    }

    handleDirectRoomEntry() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomFromUrl = urlParams.get('room');

        if (roomFromUrl && this.isValidRoomCode(roomFromUrl)) {
            const code = roomFromUrl.toUpperCase();

            this.clearReconnectTokenFromLocalStorage();
            this.saveLastRoom(code);
            this.startGame('multi', code);
            return true;
        }

        return false;
    }

    isValidRoomCode(code) {
        return code && code.length === ROOM_CODE_LENGTH;
    }

    getLastRoom() {
        return localStorage.getItem('lastRoom');
    }

    saveLastRoom(code) {
        localStorage.setItem('lastRoom', code);
    }

    startGame(mode, room, difficulty = null) {
        const data = { mode, room };
        if (difficulty) data.difficulty = difficulty;

        let sceneKey = 'SinglePlayerScene';
        if (mode === 'multi')
            sceneKey = 'MultiplayerScene';

        this.scene.start(sceneKey, data);
    }

    // ========================================
    // RENDERIZAÇÃO DO MENU
    // ========================================

    renderBackground() {
        // ✅ Usa valores do servidor
        this.add.rectangle(
            this.layout.CENTER_X,
            this.layout.CENTER_Y,
            this.layout.WIDTH,
            this.layout.HEIGHT,
            COLORS.BLACK
        );

        // Linha central decorativa
        this.add.rectangle(
            this.layout.CENTER_X,
            this.layout.CENTER_Y,
            4,
            this.layout.HEIGHT,
            COLORS.GRAY_DARK
        ).setOrigin(0.5);
    }

    renderTitle() {
        this.add.text(
            this.layout.CENTER_X,
            this.layout.TITLE_Y,
            'PING PONG',
            STYLES.TITLE
        ).setOrigin(0.5);
    }

    renderButtons(lastRoom) {
        let btnY = lastRoom
            ? this.layout.BUTTON_START_Y_WITH_LAST_ROOM
            : this.layout.BUTTON_START_Y;

        // Botão Single Player
        this.createButton(
            this.layout.CENTER_X, btnY,
            this.layout.BUTTON_LARGE.width, this.layout.BUTTON_LARGE.height,
            COLORS.BTN_SINGLE.base, COLORS.BTN_SINGLE.hover,
            '🎮 SINGLE PLAYER',
            STYLES.BUTTON_LARGE,
            () => this.showDifficultyModal()
        );
        btnY += this.layout.BUTTON_SPACING;

        // Botão Convidar Amigo
        this.createButton(
            this.layout.CENTER_X, btnY,
            this.layout.BUTTON_LARGE.width, this.layout.BUTTON_LARGE.height,
            COLORS.BTN_INVITE.base, COLORS.BTN_INVITE.hover,
            '👥 CONVIDAR AMIGO',
            STYLES.BUTTON_LARGE,
            () => this.showInviteModal()
        );
        btnY += this.layout.BUTTON_SPACING;

        // Botão Entrar com Código
        this.createButton(
            this.layout.CENTER_X, btnY,
            this.layout.BUTTON_MEDIUM.width, this.layout.BUTTON_MEDIUM.height,
            COLORS.BTN_JOIN.base, COLORS.BTN_JOIN.hover,
            '🔗 ENTRAR COM CÓDIGO',
            STYLES.BUTTON_MEDIUM,
            () => this.showJoinModal()
        );
        btnY += this.layout.BUTTON_SPACING_SMALL;

        // Botão "Voltar para última sala" (condicional)
        if (lastRoom && this.isValidRoomCode(lastRoom)) {
            this.createButton(
                this.layout.CENTER_X, btnY,
                this.layout.BUTTON_SMALL.width, this.layout.BUTTON_SMALL.height,
                COLORS.BTN_LAST_ROOM.base, COLORS.BTN_LAST_ROOM.hover,
                `⏪ VOLTAR À SALA ${lastRoom}`,
                STYLES.BUTTON_SMALL,
                () => this.startGame('multi', lastRoom)
            );
        }
    }

    renderInstructions() {
        this.add.text(
            this.layout.CENTER_X,
            this.layout.INSTRUCTIONS_Y,
            'Controles: W/S ou ↑/↓ | ESC para voltar ao menu',
            STYLES.INSTRUCTIONS
        ).setOrigin(0.5);
    }

    // ========================================
    // HELPERS DE CRIAÇÃO DE UI
    // ========================================

    createButton(x, y, width, height, color, hoverColor, label, labelStyle, onClick) {
        const rect = this.add.rectangle(x, y, width, height, color)
            .setInteractive({ useHandCursor: true })
            .setOrigin(0.5);

        const text = this.add.text(x, y, label, labelStyle)
            .setOrigin(0.5);

        rect.on('pointerover', () => rect.setFillStyle(hoverColor));
        rect.on('pointerout', () => rect.setFillStyle(color));
        rect.on('pointerdown', onClick);

        return { rect, text };
    }

    createModalBase(width, height, strokeColor, overlayAlpha = 0.8) {
        const overlay = this.add.rectangle(
            this.layout.CENTER_X,
            this.layout.CENTER_Y,
            this.layout.WIDTH,
            this.layout.HEIGHT,
            COLORS.BLACK,
            overlayAlpha
        ).setInteractive();

        const modal = this.add.rectangle(
            this.layout.CENTER_X,
            this.layout.CENTER_Y,
            width,
            height,
            COLORS.BACKGROUND
        );
        modal.setStrokeStyle(4, strokeColor);

        return { overlay, modal };
    }

    createCloseButton(x, y, onClose) {
        const btnClose = this.add.text(x, y, '✕', {
            fontSize: '32px',
            fill: '#ffffff'
        })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });

        btnClose.on('pointerover', () => btnClose.setColor('#ff0000'));
        btnClose.on('pointerout', () => btnClose.setColor('#ffffff'));
        btnClose.on('pointerdown', onClose);

        return btnClose;
    }

    // ========================================
    // MODAIS
    // ========================================

    showInviteModal() {
        const roomCode = this.generateRoomCode();
        const fullUrl = this.buildRoomUrl(roomCode);

        const { overlay, modal } = this.createModalBase(
            this.layout.MODAL_INVITE.width,
            this.layout.MODAL_INVITE.height,
            COLORS.MODAL_INVITE_STROKE
        );

        const title = this.add.text(
            this.layout.CENTER_X, 200,
            'CONVIDAR AMIGO',
            STYLES.MODAL_TITLE
        ).setOrigin(0.5);

        const instr = this.add.text(
            this.layout.CENTER_X, 250,
            'Envie este link para seu amigo:',
            STYLES.MODAL_TEXT
        ).setOrigin(0.5);

        const urlBox = this.add.rectangle(
            this.layout.CENTER_X, 310, 650, 80, COLORS.GRAY_DARK
        );

        const urlText = this.add.text(
            this.layout.CENTER_X, 310,
            fullUrl,
            STYLES.MODAL_URL
        ).setOrigin(0.5);

        const statusText = this.add.text(
            this.layout.CENTER_X, 360,
            'Ao copiar, você entrará na sala.',
            STYLES.MODAL_TEXT
        ).setOrigin(0.5);

        let btnCopy, txtCopy, btnClose;

        const destroyAll = () => {
            [overlay, modal, title, instr, urlBox, urlText, statusText,
                btnCopy, txtCopy, btnClose].forEach(obj => obj && obj.destroy());

            this.modalElements = this.modalElements.filter(
                o => ![overlay, modal, title, instr, urlBox, urlText, statusText, btnCopy, txtCopy, btnClose].includes(o)
            );
        };

        ({ rect: btnCopy, text: txtCopy } = this.createButton(
            this.layout.CENTER_X, 430,
            250, 50,
            COLORS.BTN_COPY.base, COLORS.BTN_COPY.hover,
            '📋 COPIAR LINK',
            STYLES.BUTTON_SMALL,
            () => this.handleCopyLink(fullUrl, roomCode, btnCopy, txtCopy, destroyAll)
        ));

        btnClose = this.createCloseButton(920, 160, destroyAll);
        this.modalElements.push(
            overlay, modal, title, instr, urlBox, urlText, statusText,
            btnCopy, txtCopy, btnClose
        );
    }

    showJoinModal() {
        const { overlay, modal } = this.createModalBase(
            this.layout.MODAL_JOIN.width,
            this.layout.MODAL_JOIN.height,
            COLORS.MODAL_JOIN_STROKE
        );

        const title = this.add.text(
            this.layout.CENTER_X, 220,
            'ENTRAR NA SALA',
            STYLES.MODAL_TITLE
        ).setOrigin(0.5);

        const instr = this.add.text(
            this.layout.CENTER_X, 270,
            'Digite o código da sala (6 caracteres):',
            STYLES.MODAL_TEXT
        ).setOrigin(0.5);

        const input = this.createRoomCodeInput();

        let btnEnter, txtEnter, btnClose;

        const destroyAll = () => {
            input && input.remove();
            if (this.roomCodeInput === input) {
                this.roomCodeInput = null;
            }

            [overlay, modal, title, instr, btnEnter, txtEnter, btnClose]
                .forEach(obj => obj && obj.destroy());

            this.modalElements = this.modalElements.filter(
                o => ![overlay, modal, title, instr, btnEnter, txtEnter, btnClose].includes(o)
            );
        };

        ({ rect: btnEnter, text: txtEnter } = this.createButton(
            this.layout.CENTER_X, 440,
            200, 50,
            COLORS.BTN_JOIN.base, COLORS.BTN_JOIN.hover,
            '▶ ENTRAR',
            STYLES.BUTTON_SMALL,
            () => this.handleJoinRoom(input, destroyAll)
        ));

        btnClose = this.createCloseButton(880, 180, destroyAll);

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleJoinRoom(input, destroyAll);
        });

        this.modalElements.push(
            overlay, modal, title, instr, btnEnter, txtEnter, btnClose
        );
    }

    showDifficultyModal() {
        const { overlay, modal } = this.createModalBase(
            this.layout.MODAL_DIFFICULTY.width,
            this.layout.MODAL_DIFFICULTY.height,
            COLORS.MODAL_DIFFICULTY_STROKE,
            0.75
        );

        const title = this.add.text(
            this.layout.CENTER_X, 260,
            'Selecione a dificuldade',
            { fontSize: '28px', fill: '#ffffff', fontStyle: 'bold' }
        ).setOrigin(0.5);

        const elements = [overlay, modal, title];

        const options = [
            { label: 'FÁCIL', key: 'easy', y: 320, color: COLORS.DIFFICULTY_EASY },
            { label: 'MÉDIO', key: 'medium', y: 380, color: COLORS.DIFFICULTY_MEDIUM },
            { label: 'DIFÍCIL', key: 'hard', y: 440, color: COLORS.DIFFICULTY_HARD }
        ];

        const destroyAll = () => {
            elements.forEach(obj => obj && obj.destroy());
            // Filtra apenas os elementos que foram adicionados por este modal
            this.modalElements = this.modalElements.filter(o => !elements.includes(o));
        };

        options.forEach(opt => {
            const { rect, text } = this.createButton(
                this.layout.CENTER_X, opt.y,
                300, 50,
                opt.color, 0x66bb6a, // hover color
                opt.label,
                { fontSize: '22px', fill: '#ffffff', fontStyle: 'bold' },
                () => {
                    destroyAll(); // Destrói os elementos do modal
                    this.startGame('single', 'local', opt.key);
                }
            );
            elements.push(rect, text); // Adiciona os botões ao array 'elements'
        });

        this.modalElements.push(...elements);
    }

    // ========================================
    // HELPERS DE LÓGICA
    // ========================================

    generateRoomCode() {
        return Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase();
    }

    buildRoomUrl(roomCode) {
        const baseUrl = window.location.origin + window.location.pathname;
        return `${baseUrl}?room=${roomCode}`;
    }

    createRoomCodeInput() {
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = ROOM_CODE_LENGTH;
        input.placeholder = 'Ex: ABC123';
        input.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 300px;
      height: 50px;
      font-size: 24px;
      text-align: center;
      text-transform: uppercase;
      background: #333;
      color: #fff;
      border: 3px solid #9c27b0;
      border-radius: 10px;
      outline: none;
      font-family: 'Courier New', monospace;
    `;

        input.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });

        document.body.appendChild(input);
        input.focus();

        this.roomCodeInput = input;

        return input;
    }

    handleCopyLink(url, roomCode, btnRect, btnText, onSuccess) {
        navigator.clipboard.writeText(url)
            .then(() => {
                btnText.setText('✅ LINK COPIADO!');
                btnRect.setFillStyle(COLORS.BTN_COPY.success);

                this.time.delayedCall(700, () => {
                    onSuccess();
                    this.saveLastRoom(roomCode);
                    this.startGame('multi', roomCode);
                });
            })
            .catch(() => {
                btnText.setText('❌ ERRO AO COPIAR');
            });
    }

    handleJoinRoom(input, onSuccess) {
        const code = input.value.trim().toUpperCase();

        if (this.isValidRoomCode(code)) {
            this.saveLastRoom(code);
            onSuccess();
            this.startGame('multi', code);
        } else {
            input.style.borderColor = '#ff0000';
            input.value = '';
            input.placeholder = 'CÓDIGO INVÁLIDO';

            setTimeout(() => {
                input.style.borderColor = '#9c27b0';
                input.placeholder = 'Ex: ABC123';
            }, 1200);
        }
    }

    shutdown() {
        console.log('🧹 MenuScene: shutdown');

        // Limpa input DOM se existir
        if (this.roomCodeInput) {
            this.roomCodeInput.remove();
            this.roomCodeInput = null;
        }

        // Destroi elementos de modais que possam ainda estar na tela
        if (this.modalElements && this.modalElements.length) {
            this.modalElements.forEach(obj => {
                if (obj && obj.destroy) obj.destroy();
            });
            this.modalElements = [];
        }
    }
}

export default MenuScene;