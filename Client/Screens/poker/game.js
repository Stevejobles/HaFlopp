// Main Poker Game Logic - Fixed Version

class PokerGame {
  constructor() {
    console.log('[PokerGame] Initializing...');
    
    // Get game ID from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    this.lobbyId = urlParams.get('id');
    
    console.log('[PokerGame] Lobby ID from URL:', this.lobbyId);
    
    if (!this.lobbyId) {
      console.error('[PokerGame] No game ID provided');
      alert('No game ID provided. Redirecting to home page.');
      window.location.href = '../index.html';
      return;
    }
    
    // Initialize properties
    this.players = [];
    this.currentUser = null;
    this.tableCards = [];
    this.pot = 0;
    this.currentTurn = null;
    this.gameState = null;
    this.playerState = null;
    this.maxPlayers = 6;
    this.maxOtherPlayers = 5;
    this.playerActions = {};
    this.isGameStarted = false;
    this.debug = true;

    // DOM elements
    this.potElement = document.querySelector('.pot-number');
    this.otherUsersContainer = document.querySelector('.other-users');
    this.backButton = document.querySelector('.back');
    this.tableCardsContainer = document.querySelector('.table-cards');
    this.gameStatusElement = document.querySelector('.game-status');
    this.tableCardElements = document.querySelectorAll('.table-card');

    // Chat elements
    this.chatMessagesContainer = document.getElementById('chat-messages');
    this.chatInput = document.getElementById('chat-input');
    this.sendMessageBtn = document.getElementById('send-message-btn');

    // Game control buttons
    this.foldBtn = document.getElementById('fold-btn');
    this.checkBtn = document.getElementById('check-btn');
    this.betBtn = document.getElementById('bet-btn');
    this.raiseBtn = document.getElementById('raise-btn');
    this.betAmountInput = document.getElementById('bet-amount');
    this.betIncreaseBtn = document.getElementById('bet-increase');
    this.betDecreaseBtn = document.getElementById('bet-decrease');

    // Get all action buttons
    this.actionButtons = document.querySelectorAll('.action-btn');

    // Verify DOM elements
    this.verifyDOMElements();

    // Set up event listeners
    this.setupEventListeners();

    // Socket connection
    this.socket = window.pokerSocket;
    if (!this.socket) {
      console.error('[PokerGame] PokerSocket not found! Creating a new one...');
      // If socket client script failed to load, create it here
      if (typeof PokerSocketClient === 'function') {
        window.pokerSocket = new PokerSocketClient();
        this.socket = window.pokerSocket;
      } else {
        console.error('[PokerGame] PokerSocketClient class not available!');
        this.addSystemMessage('Critical error: Socket client not available. Please refresh the page.');
      }
    }
    this.setupSocketCallbacks();

    // Initialize the game
    this.init();
    
    // Set up a game state refresh timer
    this.gameStateTimer = setInterval(() => {
      if (this.socket && this.socket.isSocketConnected()) {
        this.socket.requestGameState();
      }
    }, 10000); // Request game state every 10 seconds as a fallback
  }
  
  log(...args) {
    if (this.debug) {
      console.log('[PokerGame]', ...args);
      // If debug panel exists, also add entry there
      if (typeof addDebugEntry === 'function') {
        addDebugEntry(args.join(' '));
      }
    }
  }
  
  // Verify that all DOM elements exist
  verifyDOMElements() {
    const elements = [
      { name: 'potElement', el: this.potElement },
      { name: 'otherUsersContainer', el: this.otherUsersContainer },
      { name: 'backButton', el: this.backButton },
      { name: 'tableCardsContainer', el: this.tableCardsContainer },
      { name: 'gameStatusElement', el: this.gameStatusElement },
      { name: 'chatMessagesContainer', el: this.chatMessagesContainer },
      { name: 'chatInput', el: this.chatInput },
      { name: 'sendMessageBtn', el: this.sendMessageBtn },
      { name: 'foldBtn', el: this.foldBtn },
      { name: 'checkBtn', el: this.checkBtn },
      { name: 'betBtn', el: this.betBtn },
      { name: 'raiseBtn', el: this.raiseBtn },
      { name: 'betAmountInput', el: this.betAmountInput },
      { name: 'betIncreaseBtn', el: this.betIncreaseBtn },
      { name: 'betDecreaseBtn', el: this.betDecreaseBtn }
    ];
    
    let allFound = true;
    elements.forEach(item => {
      if (!item.el) {
        console.error(`[PokerGame] DOM element not found: ${item.name}`);
        allFound = false;
      }
    });
    
    if (!allFound) {
      this.addSystemMessage('Some game elements could not be found. The game may not function correctly.');
    }
  }

  // Set up event listeners
  setupEventListeners() {
    try {
      // Game controls
      this.backButton.addEventListener('click', this.handleBackButton.bind(this));
      this.foldBtn.addEventListener('click', () => this.handleAction('fold'));
      this.checkBtn.addEventListener('click', () => {
        // The check button could be showing "Call" text
        if (this.checkBtn.textContent === 'Call') {
          this.handleAction('call');
        } else {
          this.handleAction('check');
        }
      });
      this.betBtn.addEventListener('click', () => {
        const amount = parseInt(this.betAmountInput.value, 10);
        if (isNaN(amount) || amount <= 0) {
          alert('Please enter a valid bet amount');
          return;
        }
        this.handleAction('bet', amount);
      });
      this.raiseBtn.addEventListener('click', () => {
        const amount = parseInt(this.betAmountInput.value, 10);
        if (isNaN(amount) || amount <= 0) {
          alert('Please enter a valid raise amount');
          return;
        }
        this.handleAction('raise', amount);
      });

      // Bet amount controls
      this.betIncreaseBtn.addEventListener('click', () => this.adjustBetAmount(10));
      this.betDecreaseBtn.addEventListener('click', () => this.adjustBetAmount(-10));

      // Chat
      this.sendMessageBtn.addEventListener('click', () => this.sendChatMessage());
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.sendChatMessage();
        }
      });
      
      this.log('Event listeners set up successfully');
    } catch (error) {
      console.error('[PokerGame] Error setting up event listeners:', error);
    }
  }

  // Initialize the game
  async init() {
    this.log('Initializing game');
    try {
      // Add a first system message
      this.addSystemMessage('Connecting to game...');
      
      // Get the current user
      this.log('Fetching current user data');
      const userResponse = await fetch('/api/user');
      if (!userResponse.ok) {
        this.log('User not authenticated, redirecting to login');
        window.location.href = '../login.html';
        return;
      }

      const userData = await userResponse.json();
      this.currentUser = userData.user;
      this.log('Current user data:', this.currentUser);

      // Connect socket with user ID
      this.log('Connecting socket with user ID:', this.currentUser.id);
      this.socket.connectWithAuth(this.currentUser.id); 

      // Disable all action buttons initially
      this.updateActionButtons([]);

      // Show initial status
      this.gameStatusElement.textContent = 'Connecting to game...';

      // Add system message
      this.addSystemMessage(`Connected as ${this.currentUser.username}`);
      this.addSystemMessage(`Joining game ${this.lobbyId}`);
      
      // Manual check to verify connection after a delay
      setTimeout(() => {
        if (!this.socket.isSocketConnected()) {
          this.log('Socket not connected after timeout, attempting to reconnect');
          if (typeof this.socket.reconnect === 'function') {
            this.socket.reconnect();
          }
          this.socket.joinGame(this.lobbyId);
        }
      }, 3000);
      
      // Scroll chat to bottom
      this.scrollChatToBottom();
    } catch (error) {
      console.error('[PokerGame] Initialization error:', error);
      this.addSystemMessage('Failed to initialize the game. Please try refreshing the page.');
    }
  }

  // Method to check connection status (for debug button)
  checkConnection() {
    const connected = this.socket && this.socket.isSocketConnected();
    this.log('Connection check:', connected ? 'Connected' : 'Disconnected');
    this.addSystemMessage(`Connection status: ${connected ? 'Connected' : 'Disconnected'}`);
    
    if (!connected && this.socket) {
      this.log('Attempting to reconnect...');
      this.addSystemMessage('Attempting to reconnect...');
      if (typeof this.socket.reconnect === 'function') {
        this.socket.reconnect();
      }
      setTimeout(() => {
        this.socket.joinGame(this.lobbyId);
      }, 1000);
    } else if (connected) {
      this.log('Requesting game state...');
      this.addSystemMessage('Requesting fresh game state...');
      this.socket.requestGameState();
    }
  }

  requestGameStateUpdate() {
    if (this.socket && this.socket.isSocketConnected()) {
      this.socket.requestGameState();
    } else {
      console.error("Socket not connected, can't request game state");
      this.addSystemMessage("Connection issues - trying to reconnect...");
      
      // Try to reconnect if socket is disconnected
      if (this.socket) {
        if (typeof this.socket.reconnect === 'function') {
          this.socket.reconnect();
        }
      }
    }
  }

  // Set up socket callbacks
  setupSocketCallbacks() {
    this.log('Setting up socket callbacks');
    this.socket.setCallbacks({
      onConnect: () => {
        this.log('Socket connected');
        this.gameStatusElement.textContent = 'Connected to server, joining game...';
        this.addSystemMessage('Connected to game server');
        
        if (this.lobbyId) {
          this.socket.joinGame(this.lobbyId);
        }
      },

      onDisconnect: () => {
        this.log('Socket disconnected');
        this.gameStatusElement.textContent = 'Disconnected from server';
        this.addSystemMessage('Disconnected from server. Please refresh the page.');
      },

      onGameState: (data) => {
        this.log('Game state update received:', data);
        
        // Mark game as started
        if (!this.isGameStarted) {
          this.isGameStarted = true;
          this.addSystemMessage('Game has started!');
        }
        
        this.updateGameState(data.gameState, data.playerState);
      },

      onError: (error) => {
        console.error('[PokerGame] Socket error:', error);
        this.addSystemMessage(`Error: ${error.message || 'An unknown error occurred'}`);
      },

      onGameStarted: (data) => {
        this.log('Game started event received:', data);
        this.isGameStarted = true;
        this.gameStatusElement.textContent = 'Game starting...';
        this.addSystemMessage('Game has started!');
      },

      onPlayerJoin: (data) => {
        this.log('Player joined:', data);
        this.handlePlayerJoin(data);
      },

      onPlayerLeave: (data) => {
        this.log('Player left:', data);
        this.handlePlayerLeave(data);
      },

      onChatMessage: (data) => {
        this.log('Chat message received:', data);
        this.receiveChatMessage(data);
      },
      
      onChatHistory: (data) => {
        this.log('Chat history received:', data);
        if (data.history && Array.isArray(data.history)) {
          data.history.forEach(message => {
            this.receiveChatMessage(message);
          });
        }
      },

      onPlayerAction: (data) => {
        this.log('Player action received:', data);
        this.updatePlayerAction(data);
      }
    });
  }

  // Update game state based on server data
  updateGameState(gameState, playerState) {
    if (!gameState) {
      this.log('Received empty game state');
      return;
    }
    
    this.log('Updating game state:', gameState);
    this.log('Player state:', playerState);
    
    this.gameState = gameState;
    this.playerState = playerState;

    // Update pot
    if (gameState.pot !== undefined) {
      this.potElement.textContent = gameState.pot;
      this.log('Updated pot to:', gameState.pot);
    }

    // Update table cards
    this.updateTableCards(gameState.tableCards || []);

    // Clear previous player elements
    this.clearPlayerPositions();

    // Update players
    this.renderPlayers(gameState.players || []);

    // Update game status
    this.updateGameStatus(gameState);

    // Update action buttons based on available actions
    if (playerState && playerState.availableActions) {
      this.updateActionButtons(playerState.availableActions);
    } else {
      this.updateActionButtons([]);
    }
  }

  // Clear all player positions
  clearPlayerPositions() {
    const positions = document.querySelectorAll('.player-position');
    positions.forEach(position => {
      position.innerHTML = '';
    });
  }

  // Update table cards display
  updateTableCards(tableCards) {
    this.log('Updating table cards:', tableCards);
    
    // Update each card element
    for (let i = 0; i < this.tableCardElements.length; i++) {
      const cardElement = this.tableCardElements[i];
      
      if (i < tableCards.length) {
        // Card should be visible
        cardElement.classList.remove('hidden');
        
        // Format the card
        const card = this.formatCard(tableCards[i]);
        
        // Update card attributes and content
        cardElement.setAttribute('data-value', card.value);
        cardElement.setAttribute('data-suit', card.suit);
        
        // Create card display
        cardElement.innerHTML = `
          <div class="card-value" style="color: ${card.color || 'black'}">${card.value}</div>
          <div class="card-suit" style="color: ${card.color || 'black'}">${card.suit}</div>
        `;
        
        // Add custom styles for card elements if they don't exist
        if (!document.getElementById('card-styles')) {
          const styleEl = document.createElement('style');
          styleEl.id = 'card-styles';
          styleEl.textContent = `
            .card-value {
              position: absolute;
              top: 5px;
              left: 5px;
              font-size: 18px;
              font-weight: bold;
            }
            .card-suit {
              position: absolute;
              top: 25px;
              left: 5px;
              font-size: 22px;
            }
            .table-card {
              position: relative;
            }
          `;
          document.head.appendChild(styleEl);
        }
        
        this.log(`Set card ${i} to ${card.display}`);
      } else {
        // Card should be hidden
        cardElement.classList.add('hidden');
        cardElement.setAttribute('data-value', '?');
        cardElement.setAttribute('data-suit', '?');
        cardElement.innerHTML = '';
      }
    }
  }

  // Render all players
  renderPlayers(players) {
    if (!players || players.length === 0) {
      this.log('No players to render');
      return;
    }
    
    this.log('Rendering players:', players.length);
    
    // Find current user
    const currentPlayer = players.find(p => p.id === this.currentUser.id);
    
    // Filter other players (excluding current user)
    const otherPlayers = players.filter(p => p.id !== this.currentUser.id);
    
    this.log('Current player:', currentPlayer);
    this.log('Other players:', otherPlayers.length);
    
    // Render current user directly in the table
    if (currentPlayer) {
      this.renderCurrentPlayer(currentPlayer);
    } else {
      this.log('Warning: Current player not found in player list');
    }
    
    // Render other players in fixed positions
    this.renderOtherPlayers(otherPlayers);
  }

  // Render current player
  renderCurrentPlayer(player) {
    this.log('Rendering current player:', player);
    
    // Create a special position element for current player if it doesn't exist
    let positionElement = document.getElementById('current-player-position');
    if (!positionElement) {
      positionElement = document.createElement('div');
      positionElement.id = 'current-player-position';
      positionElement.className = 'current-player-position';
      positionElement.style.position = 'absolute';
      positionElement.style.bottom = '10px';
      positionElement.style.left = '50%';
      positionElement.style.transform = 'translateX(-50%)';
      positionElement.style.zIndex = '10';
      
      // Add it to the table element
      document.querySelector('.table').appendChild(positionElement);
    }

    // Clear previous content
    positionElement.innerHTML = '';

    // Create player element
    const userElement = document.createElement('div');
    userElement.className = 'user me';
    userElement.dataset.userId = player.id;
    
    // Add appropriate classes
    if (player.folded) userElement.classList.add('folded');
    if (player.isAllIn) userElement.classList.add('allin');
    if (player.isCurrentTurn) userElement.classList.add('current-turn');
    
    // Get role indicators
    let roleIndicator = '';
    if (player.isDealer) roleIndicator += '<span class="role dealer">D</span>';
    if (player.isSmallBlind) roleIndicator += '<span class="role small-blind">SB</span>';
    if (player.isBigBlind) roleIndicator += '<span class="role big-blind">BB</span>';
    
    // Build cards HTML
    let cardsHtml = '';
    if (this.playerState && this.playerState.hand) {
      cardsHtml = `
        <div class="cards">
          <div class="card">
            <div class="number">${this.formatCard(this.playerState.hand[0]).display}</div>
          </div>
          <div class="card">
            <div class="number">${this.formatCard(this.playerState.hand[1]).display}</div>
          </div>
        </div>
      `;
    } else {
      cardsHtml = `
        <div class="cards">
          <div class="card">
            <div class="number">?</div>
          </div>
          <div class="card">
            <div class="number">?</div>
          </div>
        </div>
      `;
    }
    
    // Generate action display
    let actionDisplay = '';
    if (this.playerActions[player.id]) {
      const action = this.playerActions[player.id];
      actionDisplay = `<div class="player-action ${action.type}">${action.text}</div>`;
    } else {
      actionDisplay = `<div class="player-action hidden"></div>`;
    }
    
    // Build HTML
    userElement.innerHTML = `
      ${cardsHtml}
      <div class="user-content">
        <div class="name">You ${roleIndicator}</div>
        <div class="balance">$${player.chips}</div>
        ${player.bet > 0 ? `<div class="current-bet">Bet: $${player.bet}</div>` : ''}
        ${actionDisplay}
      </div>
    `;
    
    positionElement.appendChild(userElement);
  }

  // Render other players
  renderOtherPlayers(otherPlayers) {
    this.log('Rendering', otherPlayers.length, 'other players');
  
    // Map players to fixed positions
    otherPlayers.forEach((player, index) => {
      // Only display up to 5 players
      if (index >= 5) return;
      
      const positionElement = document.getElementById(`position-${index}`);
      if (!positionElement) {
        this.log(`Position element position-${index} not found`);
        return;
      }
  
      const playerElement = document.createElement('div');
      playerElement.className = 'user';
      playerElement.dataset.userId = player.id;
      
      // Add status classes
      if (player.folded) playerElement.classList.add('folded');
      if (player.isAllIn) playerElement.classList.add('allin');
      if (player.isCurrentTurn) playerElement.classList.add('current-turn');
  
      // Add role indicators
      let roleIndicator = '';
      if (player.isDealer) roleIndicator += '<span class="role dealer">D</span>';
      if (player.isSmallBlind) roleIndicator += '<span class="role small-blind">SB</span>';
      if (player.isBigBlind) roleIndicator += '<span class="role big-blind">BB</span>';
  
      // Generate action display
      let actionDisplay = '';
      if (this.playerActions[player.id]) {
        const action = this.playerActions[player.id];
        actionDisplay = `<div class="player-action ${action.type}">${action.text}</div>`;
      } else {
        actionDisplay = `<div class="player-action hidden"></div>`;
      }
  
      playerElement.innerHTML = `
        <div class="cards">
          <div class="card"></div>
          <div class="card"></div>
        </div>
        <div class="user-content">
          <div class="name">${player.username} ${roleIndicator}</div>
          <div class="balance">$${player.chips}</div>
          ${player.bet > 0 ? `<div class="current-bet">Bet: $${player.bet}</div>` : ''}
          ${actionDisplay}
        </div>
      `;
  
      positionElement.appendChild(playerElement);
    });
  }

  // Handle player joining
  handlePlayerJoin(data) {
    this.log('Handling player join:', data);
    this.addSystemMessage(`${data.username || 'A player'} has joined the table.`);
    
    // Request new game state to make sure we have updated player list
    this.requestGameStateUpdate();
  }

  // Handle player leaving
  handlePlayerLeave(data) {
    this.log('Handling player leave:', data);
    this.addSystemMessage(`${data.username || 'A player'} has left the table.`);
    
    // Find the player element and mark as leaving
    const playerElement = document.querySelector(`.user[data-user-id="${data.userId}"]`);
    if (playerElement) {
      playerElement.classList.add('leaving');
      
      // Remove player element after animation
      setTimeout(() => {
        if (playerElement.parentNode) {
          playerElement.parentNode.removeChild(playerElement);
        }
      }, 500);
    }
    
    // Request new game state to make sure we have updated player list
    this.requestGameStateUpdate();
  }

  // Update game status display
  updateGameStatus(gameState) {
    if (!gameState) return;
    
    let statusText = '';
    
    if (gameState.isGameOver) {
      // Game over
      if (gameState.winner) {
        const winnerName = gameState.players.find(p => p.id === gameState.winner)?.username || 'Unknown';
        const isCurrentUserWinner = gameState.winner === this.currentUser.id;
        
        if (isCurrentUserWinner) {
          statusText = `You win the pot of $${gameState.pot}!`;
        } else {
          statusText = `Game over! ${winnerName} wins the pot of $${gameState.pot}`;
        }
        
        this.addSystemMessage(`${winnerName} wins the pot of $${gameState.pot}!`);
      } else {
        statusText = 'Game over!';
      }
    } else {
      // Game in progress
      const currentPlayerName = gameState.players.find(p => p.isCurrentTurn)?.username || 'Unknown';
      const isCurrentUserTurn = gameState.players.find(p => p.isCurrentTurn)?.id === this.currentUser.id;
      const turnIndicator = isCurrentUserTurn ? 'Your turn' : `${currentPlayerName}'s turn`;
      
      switch (gameState.currentRound) {
        case 'pre-flop':
          statusText = `Pre-flop betting round - ${turnIndicator}`;
          break;
        case 'flop':
          statusText = `Flop betting round - ${turnIndicator}`;
          break;
        case 'turn':
          statusText = `Turn betting round - ${turnIndicator}`;
          break;
        case 'river':
          statusText = `River betting round - ${turnIndicator}`;
          break;
        case 'showdown':
          statusText = 'Showdown!';
          break;
        default:
          statusText = `Waiting for ${turnIndicator}...`;
      }
    }
    
    this.log('Updating game status to:', statusText);
    this.gameStatusElement.textContent = statusText;
  }
  
  // Update action buttons based on available actions
  updateActionButtons(availableActions) {
    this.log('Updating action buttons with available actions:', availableActions);
    
    // First disable all buttons
    this.actionButtons.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('disabled');
    });
    this.betAmountInput.disabled = true;
    
    // Enable only available actions
    availableActions.forEach(action => {
      switch (action) {
        case 'fold':
          this.foldBtn.disabled = false;
          this.foldBtn.classList.remove('disabled');
          break;
        case 'check':
          this.checkBtn.disabled = false;
          this.checkBtn.classList.remove('disabled');
          this.checkBtn.textContent = 'Check';
          break;
        case 'call':
          this.checkBtn.disabled = false;
          this.checkBtn.classList.remove('disabled');
          this.checkBtn.textContent = 'Call';
          break;
        case 'bet':
          this.betBtn.disabled = false;
          this.betBtn.classList.remove('disabled');
          this.betAmountInput.disabled = false;
          break;
        case 'raise':
          this.raiseBtn.disabled = false;
          this.raiseBtn.classList.remove('disabled');
          this.betAmountInput.disabled = false;
          break;
      }
    });
    
    // Set min/max bet amount if betting is available
    if (availableActions.includes('bet') || availableActions.includes('raise')) {
      const currentPlayer = this.gameState.players.find(p => p.id === this.currentUser.id);
      if (currentPlayer) {
        // Set max bet to player's chips
        this.betAmountInput.max = currentPlayer.chips;
        
        // Set min bet based on action
        if (availableActions.includes('bet')) {
          // Min bet is big blind
          this.betAmountInput.min = this.gameState.bigBlindAmount || 10;
          this.betAmountInput.value = this.gameState.bigBlindAmount || 10;
        } else if (availableActions.includes('raise')) {
          // Min raise is current bet * 2
          const minRaise = this.gameState.currentBet * 2 || 20;
          this.betAmountInput.min = minRaise;
          this.betAmountInput.value = minRaise;
        }
      }
    }
  }
  
  // Adjust bet amount
  adjustBetAmount(delta) {
    if (this.betAmountInput.disabled) return;
    
    const currentValue = parseInt(this.betAmountInput.value, 10) || 0;
    const min = parseInt(this.betAmountInput.min, 10) || 0;
    const max = parseInt(this.betAmountInput.max, 10) || 1000;
    
    // Calculate new value within bounds
    let newValue = Math.max(min, Math.min(currentValue + delta, max));
    this.log(`Adjusting bet amount by ${delta} from ${currentValue} to ${newValue}`);
    this.betAmountInput.value = newValue;
  }
  
  // Handle player action
  handleAction(action, amount = 0) {
    this.log('Handling player action:', action, amount);
    
    // Validate amount for bet/raise
    if ((action === 'bet' || action === 'raise') && (isNaN(amount) || amount <= 0)) {
      alert('Please enter a valid bet amount');
      return;
    }
    
    // Disable all buttons during action processing
    this.actionButtons.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('disabled');
    });
    this.betAmountInput.disabled = true;
    
    // Update local player action display
    this.updatePlayerAction({
      userId: this.currentUser.id,
      action: action,
      amount: amount
    });
    
    // Send action to server
    if (this.socket && this.socket.isSocketConnected()) {
      this.socket.sendAction(action, amount);
    } else {
      this.log('Cannot send action - socket not connected');
      this.addSystemMessage('Cannot perform action - not connected to server');
      
      // Re-enable buttons after short delay
      setTimeout(() => {
        if (this.playerState && this.playerState.availableActions) {
          this.updateActionButtons(this.playerState.availableActions);
        }
      }, 1000);
    }
  }
  
  // Update player action display
  updatePlayerAction(data) {
    const { userId, action, amount } = data;
    
    this.log('Updating player action display:', userId, action, amount);
    
    let actionText = '';
    let actionType = '';
    
    switch (action) {
      case 'fold':
        actionText = 'Folded';
        actionType = 'folded';
        break;
      case 'check':
        actionText = 'Checked';
        actionType = 'checked';
        break;
      case 'call':
        actionText = `Called ${amount || this.gameState?.currentBet || ''}`;
        actionType = 'bet';
        break;
      case 'bet':
        actionText = `Bet ${amount || ''}`;
        actionType = 'bet';
        break;
      case 'raise':
        actionText = `Raised to ${amount || ''}`;
        actionType = 'raised';
        break;
      case 'all-in':
        actionText = 'All In!';
        actionType = 'all-in';
        break;
      default:
        this.log('Unknown action type:', action);
        return;
    }
  }
}