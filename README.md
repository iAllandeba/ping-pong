# Ping Pong Multiplayer

Um jogo de Ping Pong multiplayer em tempo real, desenvolvido com foco em aprendizado, boas práticas de arquitetura de jogos e colaboração aberta.  
O projeto utiliza **Phaser3** para o front-end (cliente do jogo) e **Node.js + Socket.IO** no back-end para comunicação em tempo real entre os jogadores.

Este repositório é open source e foi pensado para receber contribuições de desenvolvedores e entusiastas que queiram melhorar o jogo, adicionar novas funcionalidades, corrigir bugs ou criar modos de jogo.

## 📌 Acompanhamento do Projeto

O planejamento, controle de bugs, implementação de features e organização de tarefas são gerenciados no board oficial do GitHub:

🔗 **Board do Projeto:**  
https://github.com/orgs/iAllandeba/projects/1

---

## 🔔 Atualizações e Comunicação

Para receber notificações sobre atualizações de fluxos, mudanças e novidades do projeto, entre no canal do Discord:

💬 **Discord:**  
https://discord.gg/hgWCdxfe

---

## 🧩 Descrição do Projeto

O **Ping Pong Multiplayer** é um jogo de Pong para dois jogadores que se conectam via navegador.

Principais características:

- Partidas 1x1 em tempo real via WebSocket (Socket.IO).
- Sincronização de estado do jogo no servidor (servidor authoritative).
- Suporte a reconexão do jogador (quando possível).
- Deploy automatizado em ambiente de **homologação** e **produção**.
- Estrutura pensada para facilitar testes, refatorações e novas features.

---

## 🤝 Contribuição

Contribuições são muito bem-vindas!

Você pode ajudar com:

- Novas funcionalidades (ex.: power-ups, novos modos de jogo).
- Correção de bugs.
- Melhoria de desempenho.
- Refatoração de código.
- Documentação e testes automatizados.

### Como contribuir

1. **Faça um fork** do repositório.
2. **Crie uma branch** para sua feature ou correção de bug:
    ```bash
    git checkout -b feature/minha-feature # ou git checkout -b fix/meu-bugfix
    ```
3. **Implemente as suas alterações**, mantendo o código limpo e coeso.
4. **Adicione ou atualize testes**, se aplicável.
5. **Execute os testes localmente**
6. **Faça o commit** com uma mensagem clara:
    ```bash
    git commit -m "feat: adiciona modo hardcore"
    git commit -m "fix: corrige reconexão do player 2"
    git commit -m "style: melhoria de estilos do menu"
    git commit -m "perf: otimização da resposta entre servidor e cliente"
    ```
7. **Envie sua branch para o seu fork**:
    ```bash
    git push origin feature/minha-feature
    ```
8. **Abra um Pull Request (PR) em homologação** apontando para este repositório.

### Boas práticas para Pull Requests

- Descreva claramente **o que foi feito** e **por quê**.
- Se possível, adicione **prints**, **gifs** ou descrição de **cenários de teste**.
- Tente manter o PR focado em **uma única mudança** ou em mudanças fortemente relacionadas.
- Evite incluir mudanças irrelevantes (ex.: formatação em arquivos que não fazem parte da sua alteração).

---

## 🚀 CI/CD

O projeto utiliza uma esteira de **CI/CD** configurada para publicação automática em dois ambientes:

- **Homologação**: `https://hml-pingpong.allandeba.dev.br`
- **Produção**: `https://pingpong.allandeba.dev.br`

### Fluxo de publicação

- **Pull Request para a branch `homol`**
  - Ao abrir ou atualizar um **PR com destino à branch `homol`**, a pipeline de publicação é acionada automaticamente.
  - O Build é gerado, a imagem/container é publicada e o ambiente de **homologação** é atualizado:
    - URL: `https://hml-pingpong.allandeba.dev.br`
  - Use esse ambiente para testes manuais, validação de novas features e QA.

- **Pull Request para a branch `main`**
  - Ao abrir ou atualizar um **PR com destino à branch `main`**, a pipeline de publicação de **produção** é disparada.
  - Após a aprovação e merge na `main`, o ambiente de **produção** é atualizado:
    - URL: `https://pingpong.allandeba.dev.br`

> Observação:  
> - Por padrão, contribuições devem ser abertas contra uma branch de desenvolvimento (como `homol` ou outra definida no fluxo do projeto).  
> - Apenas mantenedores devem abrir PRs diretamente para `main`, seguindo o fluxo de release definido.

---

## 🛠️ Instalação (Ambiente de Desenvolvimento)

Abaixo um fluxo típico para rodar o projeto localmente.

### Pré-requisitos

- **Node.js** (versão LTS recomendada – ex.: 18.x ou superior)
- **npm** ou **yarn**
- (Opcional) **Docker** e **Docker Compose**, se quiser rodar via contêiner.

### Clonar o repositório
```bash
git clone https://github.com/iAllandeba/ping-pong.git
cd ping-pong
```

### Instalar dependências
```bash
npm install
# ou
yarn install
```

### Rodar servidor em modo desenvolvimento
```bash
node server/server.js
```

Por padrão, o servidor deverá estar disponível em:

- `http://localhost:3000`

Abra o navegador nesse endereço para testar o jogo localmente.

### Rodar com Docker (opcional)

```bash
# Build da imagem
docker build -t pingpong-multiplayer .

# Rodar o container
docker run --name pingpong-multiplayer -p 3000:3000 pingpong-multiplayer

# Acesse http://localhost:3000
```

---

## 🎮 Uso

### Jogar localmente (desenvolvimento)

1. Inicie o servidor local (`node server/server.js`).
2. Abra o navegador em `http://localhost:3000`.
3. Fluxo típico:
   - **Player 1** acessa a página e cria uma sala.
   - **Player 1** compartilha o link para o Player 2
   - **Player 2** acessa via link ou digita o **código da sala** exemplo: `http://localhost:3000/?room=ABC123`
4. Quando os dois jogadores estiverem conectados, o jogo inicia automaticamente.

### Jogar em Homologação

- Acesse:  
  `https://hml-pingpong.allandeba.dev.br`

Use este ambiente para testar novas funcionalidades que ainda não foram para produção.

### Jogar em Produção

- Acesse:  
  `https://pingpong.allandeba.dev.br`

Este é o ambiente “oficial” do jogo, utilizado por usuários finais.

---

## 📦 Estrutura (resumo)

- `server.js` – ponto de entrada do servidor Node.js / Socket.IO.
- `src/` - arquivos estáticos do cliente (HTML, JS bundler, etc.).
- `multiplayerScene.js` – lógica da cena multiplayer no Phaser.
- `singlePlayerScene.js` – lógica da cena single player no Phaser.
- `menuScene.js` – tela inicial / menu do jogo.
- `gameConfig.js` – configuração do jogo (velocidade da bola, tamanho da tela, etc.).
- `.github/workflows/` – pipelines de CI/CD (GitHub Actions).

---

## 📄 Licença

Este projeto é distribuído sob a licença **MIT**.

Isso significa que você pode:

- Usar o código de forma pessoal ou comercial.
- Modificar, distribuir e criar projetos derivados.

Desde que mantenha o aviso de copyright e o texto da licença.

O texto completo da licença MIT deve estar disponível no arquivo:

- [`LICENSE`](./LICENSE)

---

Se tiver dúvidas, sugestões de melhorias ou quiser discutir novas ideias de features, sinta-se à vontade para abrir uma **Issue** ou iniciar uma discussão no repositório.

Boas contribuições e bom jogo! 🏓
