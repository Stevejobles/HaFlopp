// Main Poker Game Logic - Optimized Version
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
    this.lastMessageSent = null;

    // DOM elements
    this.initDOMElements();

    // Verify DOM elements
    this.verifyDOMElements();

    // Set up event listeners
    this.setupEventListeners();

    // Socket connection
    this.initSocket();

    // Initialize the game
    this.init();
  }
  
  // Initialize DOM elements
  initDOMElements() {
    this.potElement = document.querySelector('.pot-number');
    this.usersContainer = document.querySelector('.users');
    this.otherUsersContainer = document.querySelector('.other-users');
    this.backButton = document.querySelector('.back');
    this.tableCardsContainer = document.querySelector('.table-cards');
    this.gameStatusElement = document.querySelector('.game-status');

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
  }

  clearPlayerPositions() {
    document
      .querySelectorAll('.player-position')
      .forEach(pos => pos.innerHTML = '');
  }
  
  // Initialize socket connection
  initSocket() {
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
      { name: 'usersContainer', el: this.usersContainer },
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
          this.log('Socket not connected after timeout, attempting reconnect');
          this.tryReconnect();
        }
      }, 3000);
      
      // Scroll chat to bottom
      this.scrollChatToBottom();
    } catch (error) {
      console.error('[PokerGame] Initialization error:', error);
      this.addSystemMessage('Failed to initialize the game. Please try refreshing the page.');
    }
  }

  // Try to reconnect socket and join game
  tryReconnect() {
    this.log('Attempting to reconnect socket');
    if (this.socket) {
      if (typeof this.socket.reconnect === 'function') {
        this.socket.reconnect();
      } else if (this.currentUser && this.currentUser.id) {
        this.socket.connectWithAuth(this.currentUser.id);
      }
      
      if (this.lobbyId) {
        this.socket.joinGame(this.lobbyId);
      }
    }
  }

  // Request updated game state from server
  requestGameStateUpdate() {
    if (this.socket && this.socket.isSocketConnected()) {
      this.socket.requestGameState();
    } else {
      console.error("Socket not connected, can't request game state");
      this.addSystemMessage("Connection issues - trying to reconnect...");
      this.tryReconnect();
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
        this.processChatHistory(data);
      },

      onPlayerAction: (data) => {
        this.log('Player action received:', data);
        this.updatePlayerAction(data);
      }
    });
  }

  // Process chat history
  processChatHistory(data) {
    if (data.history && Array.isArray(data.history)) {
      this.log(`Processing ${data.history.length} chat history messages`);
      data.history.forEach(msg => {
        this.receiveChatMessage(msg);
      });
      this.scrollChatToBottom();
    }
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

    // 1) Update pot
    if (gameState.pot !== undefined) {
      this.potElement.textContent = gameState.pot;
      this.log('Updated pot to:', gameState.pot);
    }

    // 2) Update community cards
    this.updateTableCards(gameState.tableCards || []);

    // 3) Clear out your seat
    if (this.usersContainer) {
      this.usersContainer.innerHTML = '';
    }
    // 4) Clear only the fixed seat CONTENTS (leaves the markers)
    this.clearPlayerPositions();

    // 5) Re-render everyone
    this.renderPlayers(gameState.players || []);

    // 6) Update status & buttons as before
    this.updateGameStatus(gameState);
    if (playerState && playerState.availableActions) {
      this.updateActionButtons(playerState.availableActions);
    } else {
      this.updateActionButtons([]);
    }
  }

  // Update table cards display
  updateTableCards(tableCards) {
    this.log('Updating table cards:', tableCards);
    const cardElements = this.tableCardsContainer.querySelectorAll('.table-card');
    
    // First set all cards to hidden
    cardElements.forEach(card => {
      card.classList.add('hidden');
      card.setAttribute('data-value', '?');
      card.setAttribute('data-suit', '?');
    });
    
    // Then update visible cards
    for (let i = 0; i < tableCards.length && i < cardElements.length; i++) {
      const formattedCard = this.formatCard(tableCards[i]);
      cardElements[i].classList.remove('hidden');
      cardElements[i].setAttribute('data-value', formattedCard.value);
      cardElements[i].setAttribute('data-suit', formattedCard.suit);
      this.log(`Set card ${i} to ${formattedCard.display}`);
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
    
    // Render current user
    if (currentPlayer) {
      this.renderCurrentPlayer(currentPlayer);
    } else {
      this.log('Warning: Current player not found in player list');
    }
    
    // Render other players
    this.renderOtherPlayers(otherPlayers);
  }

  // Render current player
  renderCurrentPlayer(player) {
    this.log('Rendering current player:', player);
    if (!this.usersContainer) {
      this.log('Error: users container not found');
      return;
    }

    const userElement = document.createElement('div');
    userElement.className = 'user me';
    userElement.dataset.userId = player.id;
    
    // Add appropriate classes
    if (player.folded) userElement.classList.add('folded');
    if (player.isAllIn) userElement.classList.add('allin');
    if (player.isCurrentTurn) userElement.classList.add('current-turn');
    
    // Get role indicators
    let roleIndicator = this.getRoleIndicators(player);
    
    // Build cards HTML
    let cardsHtml = this.getPlayerCardsHtml(player);

    // Generate action display
    let actionDisplay = this.getActionDisplay(player.id);
    
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
    
    this.usersContainer.appendChild(userElement);
  }

  // Get HTML for player cards
  getPlayerCardsHtml(player) {
    if (this.playerState && this.playerState.hand && this.playerState.hand.length >= 2) {
      return `
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
      return `
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
  }

  // Get role indicators (dealer, small blind, big blind)
  getRoleIndicators(player) {
    let indicators = '';
    if (player.isDealer) indicators += '<span class="role dealer">D</span>';
    if (player.isSmallBlind) indicators += '<span class="role small-blind">SB</span>';
    if (player.isBigBlind) indicators += '<span class="role big-blind">BB</span>';
    return indicators;
  }

  // Get action display HTML
  getActionDisplay(playerId) {
    if (this.playerActions[playerId]) {
      const action = this.playerActions[playerId];
      return `<div class="player-action ${action.type}">${action.text}</div>`;
    } else {
      return `<div class="player-action hidden"></div>`;
    }
  }

  // Render other players
  renderOtherPlayers(otherPlayers) {
    this.log('Rendering', otherPlayers.length, 'other players');
  
    // Clear any existing players from positions
    document.querySelectorAll('.player-position').forEach(position => {
      position.innerHTML = '';
    });
  
    // Place players in fixed positions
    otherPlayers.forEach((player, index) => {
      // Only display up to 5 players
      if (index >= 5) return;
      
      const positionElement = document.getElementById(`position-${index}`);
      if (!positionElement) return;
  
      const playerElement = document.createElement('div');
      playerElement.className = 'user';
      playerElement.dataset.userId = player.id;
      
      // Add status classes
      if (player.folded) playerElement.classList.add('folded');
      if (player.isAllIn) playerElement.classList.add('allin');
      if (player.isCurrentTurn) playerElement.classList.add('current-turn');
  
      // Add role indicators
      let roleIndicator = this.getRoleIndicators(player);
  
      // Generate action display
      let actionDisplay = this.getActionDisplay(player.id);
  
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
    
    // Request a refresh of the game state
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
    
    // Request a refresh of the game state
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
      
      // Try to reconnect
      this.tryReconnect();
    }
  }
  
  // Update player action display
  updatePlayerAction(data) {
    const { userId, action, amount } = data;
    
    this.log('Updating player action display:', userId, action, amount);
    
    // Map action to display text and class
    const actionDisplay = this.getActionDisplayForType(action, amount);
    if (!actionDisplay) return;
    
    // Store action
    this.playerActions[userId] = {
      type: actionDisplay.type,
      text: actionDisplay.text
    };
    
    // Update player elements
    this.updatePlayerActionElements(userId, actionDisplay.type, actionDisplay.text);
    
    // Add to chat
    const playerName = userId === this.currentUser.id ? 'You' :
      this.gameState?.players.find(p => p.id === userId)?.username || 'Player';
    this.addSystemMessage(`${playerName} ${actionDisplay.text.toLowerCase()}`);
  }
  
  // Get action display text and class based on action type
  getActionDisplayForType(action, amount) {
    switch (action) {
      case 'fold':
        return { text: 'Folded', type: 'folded' };
      case 'check':
        return { text: 'Checked', type: 'checked' };
      case 'call':
        return { text: `Called $${amount || ''}`, type: 'bet' };
      case 'bet':
        return { text: `Bet $${amount || ''}`, type: 'bet' };
      case 'raise':
        return { text: `Raised to $${amount || ''}`, type: 'raised' };
      case 'all-in':
        return { text: 'All In!', type: 'all-in' };
      default:
        this.log('Unknown action type:', action);
        return null;
    }
  }
  
  // Update player action elements in the DOM
  updatePlayerActionElements(userId, actionType, actionText) {
    this.log('Updating player action elements for:', userId, actionType, actionText);
    
    // Find player element
    const playerElement = document.querySelector(`.user[data-user-id="${userId}"]`);
    if (!playerElement) {
      this.log('Player element not found for user ID:', userId);
      return;
    }
    
    // Find or create action element
    let actionElement = playerElement.querySelector('.player-action');
    if (!actionElement) {
      this.log('Creating new action element for player');
      actionElement = document.createElement('div');
      actionElement.className = 'player-action';
      const userContent = playerElement.querySelector('.user-content');
      if (userContent) {
        userContent.appendChild(actionElement);
      } else {
        this.log('User content element not found');
        return;
      }
    }
    
    // Update action element
    actionElement.textContent = actionText;
    actionElement.className = `player-action ${actionType}`;
    
    // Remove hidden class
    actionElement.classList.remove('hidden');
    
    // Clear action after a delay (except for fold)
    if (actionType !== 'folded') {
      setTimeout(() => {
        if (actionElement && !actionElement.closest('body')) {
          this.log('Action element no longer in DOM, skipping hide');
          return; // Element no longer in DOM
        }
        this.log('Hiding action element after timeout');
        actionElement.classList.add('hidden');
      }, 3000);
    }
  }
  
  // Format card for display (e.g. "Ah" -> "A♥")
  formatCard(cardCode) {
    if (!cardCode) return { display: '?', value: '?', suit: '?' };
    
    this.log('Formatting card:', cardCode);
    
    const value = cardCode.slice(0, 1);
    const suit = cardCode.slice(1, 2);
    
    // Convert suit to symbol
    let suitSymbol = suit;
    switch (suit) {
      case 'h':
        suitSymbol = '♥';
        break;
      case 'd':
        suitSymbol = '♦';
        break;
      case 'c':
        suitSymbol = '♣';
        break;
      case 's':
        suitSymbol = '♠';
        break;
    }
    
    // Convert value for special cards
    let displayValue = value;
    if (value === 'T') displayValue = '10';
    
    return {
      display: displayValue + suitSymbol,
      value: displayValue,
      suit: suitSymbol
    };
  }
  
  // Send a chat message
  sendChatMessage() {
    const message = this.chatInput.value.trim();
    if (!message) return;
  
    this.log('Sending chat message:', message);
  
    // Clear input
    this.chatInput.value = '';
  
    // Make sure we have the correct lobby ID
    if (!this.lobbyId) {
      console.error('No lobby ID available for chat message');
      this.addSystemMessage('Error: Cannot send message - no game ID');
      return;
    }
  
    // Create message data
    const messageData = {
      userId: this.currentUser.id,
      username: this.currentUser.username || 'You',
      message,
      timestamp: new Date().toISOString(),
      isSelf: true
    };
    
    // Store last message sent for deduplication
    this.lastMessageSent = messageData;
  
    // Send message to server
    if (this.socket && this.socket.isSocketConnected()) {
      this.socket.sendChatMessage(message);
  
      // Add message to chat locally immediately
      this.addChatMessage(messageData);
      
      // Force scroll to bottom
      this.scrollChatToBottom();
    } else {
      console.error("Socket not connected, can't send chat message");
      this.addSystemMessage("Message not sent - connection issues");
      
      // Try to reconnect socket
      this.tryReconnect();
    }
  }

  // Receive a chat message from the server
  receiveChatMessage(data) {
    this.log('Received chat message:', data);

    // Skip own messages (we already added them locally)
    if (data.userId === this.currentUser.id && 
        this.lastMessageSent && 
        data.message === this.lastMessageSent.message) {
      this.log('Skipping own message that was already displayed');
      return;
    }

    // Add message to chat
    this.addChatMessage({
      ...data,
      isSelf: data.userId === this.currentUser.id
    });
  }
  
  // Add a chat message to the display
  addChatMessage(data) {
    this.log('Adding chat message to display:', data);
    const { userId, username, message, timestamp, isSelf } = data;
    
    // Create message element
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${isSelf ? 'my-message' : 'other-message'}`;
    
    // Format timestamp
    let time;
    try {
      time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // Set content with better visibility
    messageElement.innerHTML = `
      <div class="message-sender">${username}</div>
      <div class="message-content">${this.escapeHTML(message)}</div>
      <div class="message-time">${time}</div>
    `;
    
    // Add to container
    this.chatMessagesContainer.appendChild(messageElement);
    
    // Force scroll to bottom
    this.scrollChatToBottom();
  }
  
  // Add a system message to the chat
  addSystemMessage(message) {
    this.log('Adding system message:', message);
    const messageElement = document.createElement('div');
    messageElement.className = 'system-message';
    messageElement.textContent = message;
    
    this.chatMessagesContainer.appendChild(messageElement);
    this.scrollChatToBottom();
  }
  
  // Scroll chat container to the bottom
  scrollChatToBottom() {
    this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
  }
  
  // Escape HTML to prevent XSS in chat
  escapeHTML(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Check socket connection status
  checkConnection() {
    const isConnected = this.socket && this.socket.isSocketConnected();
    this.log('Checking connection status:', isConnected ? 'Connected' : 'Disconnected');
    
    if (!isConnected) {
      this.addSystemMessage('Connection check: Disconnected. Attempting to reconnect...');
      this.tryReconnect();
    } else {
      this.addSystemMessage('Connection check: Connected to server.');
      this.requestGameStateUpdate();
    }
    
    return isConnected;
  }
  
  // Handle back button click
  handleBackButton() {
    this.log('Back button clicked');
    if (confirm('Are you sure you want to leave the game? This will remove you from the table.')) {
      // Disconnect socket
      if (this.socket) {
        this.socket.disconnect();
      }
      window.location.href = '../index.html';
    }
  }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing game');
  // Create game instance
  window.pokerGame = new PokerGame();
  
  // Add debug button for testing
  const debugBtn = document.createElement('button');
  debugBtn.textContent = '🐞 Debug Connection';
  debugBtn.style.position = 'fixed';
  debugBtn.style.bottom = '10px';
  debugBtn.style.left = '140px';
  debugBtn.style.zIndex = '9999';
  debugBtn.style.padding = '8px 12px';
  debugBtn.style.background = 'rgba(255,0,0,0.3)';
  debugBtn.style.border = 'none';
  debugBtn.style.borderRadius = '5px';
  debugBtn.style.color = 'white';
  debugBtn.style.cursor = 'pointer';
  
  debugBtn.addEventListener('click', () => {
    if (window.pokerGame) {
      window.pokerGame.checkConnection();
    } else {
      console.error('Game instance not found');
      alert('Game instance not initialized. Try refreshing the page.');
    }
  });
  
  document.body.appendChild(debugBtn);
});