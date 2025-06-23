// Main Poker Game Logic with Chat Visibility Fix
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

  log(...args) {
    console.log('[PokerGame]', ...args);
  }
  
  // Initialize DOM elements with chat visibility fix
  initDOMElements() {
    this.potElement = document.querySelector('.pot-number');
    this.usersContainer = document.querySelector('.users');
    this.otherUsersContainer = document.querySelector('.other-users');
    this.backButton = document.querySelector('.back');
    this.tableCardsContainer = document.querySelector('.table-cards');
    this.gameStatusElement = document.querySelector('.game-status');

    // Chat elements - with forced visibility
    this.chatMessagesContainer = document.getElementById('chat-messages');
    this.chatInput = document.getElementById('chat-input');
    this.sendMessageBtn = document.getElementById('send-message-btn');

    // Force chat visibility if elements exist
    if (this.chatMessagesContainer) {
      this.chatMessagesContainer.style.display = 'flex';
      this.chatMessagesContainer.style.visibility = 'visible';
      this.chatMessagesContainer.style.opacity = '1';
    }

    // Game control buttons
    this.foldBtn = document.getElementById('fold-btn');
    this.checkBtn = document.getElementById('check-btn');
    this.callBtn = document.getElementById('call-btn');
    this.betBtn = document.getElementById('bet-btn');
    this.raiseBtn = document.getElementById('raise-btn');
    this.betAmountInput = document.getElementById('bet-amount');
    this.betIncreaseBtn = document.getElementById('bet-increase');
    this.betDecreaseBtn = document.getElementById('bet-decrease');
    this.allInBtn = document.getElementById('all-in-btn');

    // Get all action buttons
    this.actionButtons = document.querySelectorAll('.action-btn');
  }

  clearPlayerPositions() {
    document
      .querySelectorAll('.player-position')
      .forEach(pos => pos.innerHTML = '');
  }

  clearAllPlayerActions() {
    this.log('Clearing all player action displays for new round');
    
    // Reset the player actions object
    this.playerActions = {};
    
    // Find all player action elements and hide them
    document.querySelectorAll('.player-action').forEach(actionElement => {
      actionElement.textContent = '';
      actionElement.className = 'player-action hidden';
    });
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
      { name: 'callBtn', el: this.callBtn },    
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
      console.warn('[PokerGame] Some elements missing - this may affect functionality');
    }
    
    return allFound;
  }

  // Set up event listeners
  setupEventListeners() {
    this.log('Setting up event listeners');
    
    // Back button
    if (this.backButton) {
      this.backButton.addEventListener('click', () => this.handleBackButton());
    }
    
    // Chat functionality - with null checks
    if (this.sendMessageBtn && this.chatInput) {
      this.sendMessageBtn.addEventListener('click', () => this.sendChatMessage());
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.sendChatMessage();
        }
      });
    }
    
    // Action buttons
    if (this.foldBtn) this.foldBtn.addEventListener('click', () => this.handleFold());
    if (this.checkBtn) this.checkBtn.addEventListener('click', () => this.handleCheck());
    if (this.callBtn) this.callBtn.addEventListener('click', () => this.handleCall());
    if (this.betBtn) this.betBtn.addEventListener('click', () => this.handleCheck());
    if (this.raiseBtn) this.raiseBtn.addEventListener('click', () => this.handleRaise());
    if (this.allInBtn) this.allInBtn.addEventListener('click', () => this.handleAllIn());
    
    // Bet amount controls
    if (this.betIncreaseBtn) {
      this.betIncreaseBtn.addEventListener('click', () => this.increaseBetAmount());
    }
    if (this.betDecreaseBtn) {
      this.betDecreaseBtn.addEventListener('click', () => this.decreaseBetAmount());
    }
  }

  // Initialize the game
  async init() {
    this.log('Initializing game...');
    
    try {
      // Get current user info
      const response = await fetch('/api/user');
      if (response.ok) {
        const data = await response.json();
        this.currentUser = data.user;
        this.log('Current user:', this.currentUser);
        
        // Connect socket with user ID
        this.connectToGame();
      } else {
        throw new Error('Failed to get user info');
      }
      
    } catch (error) {
      console.error('[PokerGame] Initialization error:', error);
      this.addSystemMessage('Failed to initialize game. Please refresh the page.');
    }
  }

  // Connect to the poker game
  connectToGame() {
    this.log('Connecting to game with lobby ID:', this.lobbyId);
    
    if (this.socket) {
      // Connect socket with user authentication
      this.socket.connectWithAuth(this.currentUser.id);
      this.addSystemMessage('Connecting to game...');
      
      // Set up a timeout to check connection
      setTimeout(() => {
        if (this.socket.isSocketConnected()) {
          this.socket.joinGame(this.lobbyId);
        } else {
          this.log('Socket connection timeout, retrying...');
          this.tryReconnect();
        }
      }, 2000);
    } else {
      this.log('Socket not available, attempting to reconnect...');
      this.tryReconnect();
    }
  }

  // Try to reconnect socket
  tryReconnect() {
    this.log('Attempting to reconnect socket...');
    if (this.socket && this.currentUser) {
      // Use connectWithAuth instead of connect
      this.socket.connectWithAuth(this.currentUser.id);
      
      setTimeout(() => {
        if (this.socket.isSocketConnected()) {
          this.socket.joinGame(this.lobbyId);
        } else {
          this.addSystemMessage('Connection failed. Please refresh the page.');
        }
      }, 2000);
    } else {
      this.addSystemMessage('Unable to reconnect. Please refresh the page.');
    }
  }

  // Set up socket event callbacks
  setupSocketCallbacks() {
    if (!this.socket) {
      console.error('[PokerGame] No socket available for callbacks');
      return;
    }

    this.socket.setCallbacks({
      onGameJoined: (data) => {
        this.log('Game joined:', data);
        this.addSystemMessage('Successfully joined the game!');
        if (data.gameState) {
          this.updateGameState(data.gameState, data.playerState);
        }
      },

      onGameState: (data) => {
        this.log('Game state received:', data);
        this.updateGameState(data.gameState, data.playerState);
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
        this.log('Player action:', data);
        this.updatePlayerAction(data);
      },

      onError: (error) => {
        this.log('Socket error:', error);
        this.addSystemMessage(`Error: ${error.message}`);
      },

      onDisconnect: () => {
        this.log('Socket disconnected');
        this.addSystemMessage('Disconnected from server. Attempting to reconnect...');
        this.tryReconnect();
      },

      onNeedChips: (data) => {
        this.log('Player needs chips:', data);
        this.addSystemMessage('You need more chips to continue playing. Please add more chips to continue playing.');

        // Show a more prominent notification
        const notification = document.createElement('div');
        notification.className = 'chip-notification';
        notification.innerHTML = `
          <h3>Out of Chips!</h3>
          <p>You need to add more chips to keep playing.</p>
          <button id="add-chips-now">Add Chips Now</button>
        `;
        document.body.appendChild(notification);

        // Add event listener to the button
        document.getElementById('add-chips-now').addEventListener('click', () => {
          // Remove notification
          notification.remove();

          // Open add chips modal
          const addChipsBtn = document.getElementById('add-chips-btn');
          if (addChipsBtn) addChipsBtn.click();
        });

        // Auto-remove after 10 seconds
        setTimeout(() => {
          if (notification.parentNode) {
            notification.remove();
          }
        }, 10000);
      },

      onPlayerNeedsChips: (data) => {
        this.log('Player needs chips:', data);
        this.addSystemMessage(`${data.username} has run out of chips and needs to add more.`);
      },

      onGameMessage: (data) => {
        this.log('Game message received:', data);
        this.addSystemMessage(data.message);
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

    if (this.previousRound && this.previousRound !== gameState.currentRound) {
      this.clearAllPlayerActions();
    }

    this.previousRound = gameState.currentRound;

    // 1) Update pot
    if (gameState.pot !== undefined) {
      this.updatePot(gameState.pot);
    }

    // 2) Update table cards
    if (gameState.tableCards) {
      this.updateTableCards(gameState.tableCards);
    }

    // 3) Update game status
    if (gameState.gameStatus) {
      this.updateGameStatus(gameState.gameStatus);
    }

    // 4) Update players
    if (gameState.players) {
      this.renderPlayers(gameState.players);
    }

    // 5) Update action buttons based on player state
    if (playerState && playerState.availableActions) {
      this.updateActionButtons(playerState.availableActions);
    } else {
      this.disableAllActionButtons();
    }

    // 6) Update current turn indicator
    this.updateCurrentTurnIndicator(gameState);
  }

  // Update pot display
  updatePot(pot) {
    if (this.potElement) {
      this.potElement.textContent = pot || 0;
    }
  }

  // Update table cards
  updateTableCards(tableCards) {
    if (!this.tableCardsContainer) return;
    
    this.log('Updating table cards:', tableCards);
    const cardElements = this.tableCardsContainer.querySelectorAll('.table-card');
    
    // First hide all cards and reset them
    cardElements.forEach(card => {
      card.classList.add('hidden');
      card.textContent = '';
      card.setAttribute('data-value', '?');
      card.setAttribute('data-suit', '?');
    });
    
    // Then update visible cards
    for (let i = 0; i < tableCards.length && i < cardElements.length; i++) {
      const formattedCard = this.formatCard(tableCards[i]);
      cardElements[i].classList.remove('hidden');
      cardElements[i].textContent = formattedCard.display;
      cardElements[i].setAttribute('data-value', formattedCard.value);
      cardElements[i].setAttribute('data-suit', formattedCard.suit);
      this.log(`Set card ${i} to ${formattedCard.display}`);
    }
  }

  // Update game status
  updateGameStatus(status) {
    if (this.gameStatusElement) {
      this.gameStatusElement.textContent = status;
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
    
    // Clear and add to container
    this.usersContainer.innerHTML = '';
    this.usersContainer.appendChild(userElement);
  }

  // Render other players
  renderOtherPlayers(otherPlayers) {
    this.log('Rendering other players:', otherPlayers);
    
    // Clear all positions first
    this.clearPlayerPositions();
    
    // Render up to 5 other players in specific positions
    for (let i = 0; i < Math.min(otherPlayers.length, this.maxOtherPlayers); i++) {
      const player = otherPlayers[i];
      const position = i; // positions 0-4
      
      this.renderPlayerAtPosition(player, position);
    }
  }

  // Render a player at a specific position
  renderPlayerAtPosition(player, position) {
    const positionElement = document.getElementById(`position-${position}`);
    if (!positionElement) {
      this.log(`Position element ${position} not found`);
      return;
    }
    
    this.log(`Rendering player ${player.username} at position ${position}`);
    
    // Get role indicators
    let roleIndicator = this.getRoleIndicators(player);
    
    // Build cards HTML
    let cardsHtml = this.getPlayerCardsHtml(player);
    
    // Generate action display
    let actionDisplay = this.getActionDisplay(player.id);
    
    // Create player element
    const userElement = document.createElement('div');
    userElement.className = 'user';
    userElement.dataset.userId = player.id;
    userElement.dataset.position = position;
    
    // Add appropriate classes
    if (player.folded) userElement.classList.add('folded');
    if (player.isAllIn) userElement.classList.add('allin');
    if (player.isCurrentTurn) userElement.classList.add('current-turn');
    
    userElement.innerHTML = `
      ${cardsHtml}
      <div class="user-content">
        <div class="name">${player.username} ${roleIndicator}</div>
        <div class="balance">$${player.chips}</div>
        ${player.bet > 0 ? `<div class="current-bet">Bet: $${player.bet}</div>` : ''}
        ${actionDisplay}
      </div>
    `;
    
    positionElement.appendChild(userElement);
  }

  // Get role indicators for a player
  getRoleIndicators(player) {
    let indicators = [];
    if (player.isDealer) indicators.push('(D)');
    if (player.isSmallBlind) indicators.push('(SB)');
    if (player.isBigBlind) indicators.push('(BB)');
    return indicators.join(' ');
  }

  // Get player cards HTML
  getPlayerCardsHtml(player) {
    if (player.id === this.currentUser.id && this.playerState && this.playerState.hand) {
      // Show actual cards for current player
      return `
        <div class="cards">
          <div class="card" data-value="${this.formatCard(this.playerState.hand[0]).value}" data-suit="${this.formatCard(this.playerState.hand[0]).suit}">
            ${this.formatCard(this.playerState.hand[0]).display}
          </div>
          <div class="card" data-value="${this.formatCard(this.playerState.hand[1]).value}" data-suit="${this.formatCard(this.playerState.hand[1]).suit}">
            ${this.formatCard(this.playerState.hand[1]).display}
          </div>
        </div>
      `;
    } else {
      // Show card backs for other players
      return `
        <div class="cards">
          <div class="card"></div>
          <div class="card"></div>
        </div>
      `;
    }
  }

  // Get action display for a player
  getActionDisplay(playerId) {
    if (this.playerActions[playerId]) {
      const action = this.playerActions[playerId];
      return `<div class="player-action ${action.type}">${action.text}</div>`;
    }
    return '<div class="player-action hidden"></div>';
  }

  // Update current turn indicator
  updateCurrentTurnIndicator(gameState) {
    // Remove current-turn class from all players
    document.querySelectorAll('.user').forEach(user => {
      user.classList.remove('current-turn');
    });
    
    // Add current-turn class to active player
    if (gameState.currentTurn) {
      const currentPlayerElement = document.querySelector(`.user[data-user-id="${gameState.currentTurn}"]`);
      if (currentPlayerElement) {
        currentPlayerElement.classList.add('current-turn');
      }
    }
  }

  // Update action buttons based on available actions
  updateActionButtons(availableActions) {
    this.log('Updating action buttons:', availableActions);
    
    // First disable all buttons
    this.disableAllActionButtons();
    
    // Enable based on available actions
    availableActions.forEach(action => {
      switch (action) {
        case 'fold':
          this.enableButton(this.foldBtn);
          break;
        case 'check':
          this.enableButton(this.checkBtn);  
          break;
        case 'call':
          this.enableButton(this.callBtn);   
          break;
        case 'bet':
          this.enableButton(this.raiseBtn);  
          this.enableButton(this.betAmountInput);
          this.enableButton(this.betIncreaseBtn);
          this.enableButton(this.betDecreaseBtn);
          break;
        case 'raise':
          this.enableButton(this.raiseBtn);
          this.enableButton(this.betAmountInput);
          this.enableButton(this.betIncreaseBtn);
          this.enableButton(this.betDecreaseBtn);
          break;
      }
    });
    
    // Always enable all-in if any action is available
    if (availableActions.length > 0) {
      this.enableButton(this.allInBtn);
    }
  }

  // Disable all action buttons
  disableAllActionButtons() {
    this.actionButtons.forEach(btn => {
      this.disableButton(btn);
    });
    this.disableButton(this.betAmountInput);
    this.disableButton(this.betIncreaseBtn);
    this.disableButton(this.betDecreaseBtn);
  }

  // Enable a button
  enableButton(button) {
    if (button) {
      button.disabled = false;
      button.classList.remove('disabled');
    }
  }

  // Disable a button
  disableButton(button) {
    if (button) {
      button.disabled = true;
      button.classList.add('disabled');
    }
  }

  // Handle player actions
  handleFold() {
    this.log('Fold action');
    this.sendAction('fold');
  }

  handleCheck() {
    this.log('Check action - pure check');
    this.sendAction('check');
  }
  
  handleCall() {
    this.log('Call action - calling current bet');
    this.sendAction('call');
  }

  handleBet() {
    this.log('Bet action - now same as check');
    this.sendAction('check');
  }

  handleRaise() {
    this.log('Raise/Bet action');
    const amount = this.betAmountInput ? parseInt(this.betAmountInput.value, 10) : 10;

    // Determine if this should be a bet or raise based on game state
    if (this.gameState && this.gameState.currentBet === 0) {
      this.sendAction('bet', amount);
    } else {
      this.sendAction('raise', amount);
    }
  }

  handleAllIn() {
    this.log('Handling all-in action');
    
    // Get the current player's chips 
    const currentPlayer = this.gameState.players.find(p => p.id === this.currentUser.id);
    if (!currentPlayer) {
      alert('Cannot perform all-in action: Player data not found');
      return;
    }
    
    // Use the player's total chips for all-in
    const amount = currentPlayer.chips;
    
    // Disable all buttons to prevent double-clicks
    this.actionButtons.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('disabled');
    });
    this.betAmountInput.disabled = true;
    
    // Show the action immediately in UI
    this.updatePlayerAction({
      userId: this.currentUser.id,
      action: 'all-in',
      amount: amount
    });
    
    // Send action to server
    if (this.socket && this.socket.isSocketConnected()) {
      // Determine the correct action type based on game state
      let actionType;
      
      if (this.gameState.currentBet === 0) {
        // If no current bet, it's a bet action
        actionType = 'bet';
      } else if (this.gameState.currentBet > 0) {
        // If there's a current bet, it's a raise or call action
        if (amount > this.gameState.currentBet) {
          actionType = 'raise';
        } else {
          actionType = 'call';
        }
      }
      
      this.socket.sendAction(actionType, amount);
      this.requestGameStateUpdate();
    } else {
      this.log('Cannot send action - socket not connected');
      this.addSystemMessage("Message not sent - connection issues");
      
      // Re-enable buttons after delay
      setTimeout(() => {
        if (this.playerState && this.playerState.availableActions) {
          this.updateActionButtons(this.playerState.availableActions);
        }
      }, 1000);
      
      // Attempt reconnect
      this.tryReconnect();
    }
  }

  // Send action to server
  sendAction(action, amount = null) {
    this.log('Sending action:', action, amount);
    
    if (!this.socket || !this.socket.isSocketConnected()) {
      this.addSystemMessage('Not connected to server');
      this.tryReconnect();
      return;
    }
    
    // Disable all buttons to prevent double-clicks
    this.disableAllActionButtons();
    
    // Send the action
    this.socket.sendAction(action, amount);
    
    // Update UI immediately to show action
    this.updatePlayerAction({
      userId: this.currentUser.id,
      action: action,
      amount: amount
    });
    
    // Request updated game state
    this.requestGameStateUpdate();
  }

  // Request game state update
  requestGameStateUpdate() {
    if (this.socket && this.socket.isSocketConnected()) {
      this.socket.requestGameState();
    }
  }

  // Update player action display
  updatePlayerAction(data) {
    this.log('Updating player action:', data);
    const { userId, action, amount } = data;
    
    // Generate action text and type
    const actionInfo = this.getActionInfo(action, amount);
    if (!actionInfo) return;
    
    // Store action for rendering
    this.playerActions[userId] = actionInfo;
    
    // Update DOM elements
    this.updatePlayerActionElements(userId, actionInfo.type, actionInfo.text);
  }

  // Get action info for display
  getActionInfo(action, amount) {
    switch (action) {
      case 'fold':
        return { text: 'Folded', type: 'folded' };
      case 'check':
        return { text: 'Check', type: 'check' };
      case 'call':
        return { text: `Call ${amount}`, type: 'call' };
      case 'bet':
        return { text: `Bet ${amount}`, type: 'bet' };
      case 'raise':
        return { text: `Raise ${amount}`, type: 'raise' };
      case 'all-in':
        return { text: `All-in ${amount}`, type: 'all-in' };
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
  
  // Send a chat message - FIXED FOR VISIBILITY
  sendChatMessage() {
    if (!this.chatInput) {
      this.log('Chat input not found');
      return;
    }

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
  
  // Add a chat message to the display - FIXED FOR VISIBILITY
  addChatMessage(data) {
    this.log('Adding chat message to display:', data);
    
    if (!this.chatMessagesContainer) {
      this.log('Chat messages container not found');
      return;
    }

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
  
  // Add a system message to the chat - FIXED FOR VISIBILITY
  addSystemMessage(message) {
    this.log('Adding system message:', message);
    
    if (!this.chatMessagesContainer) {
      this.log('Chat messages container not found');
      return;
    }

    const messageElement = document.createElement('div');
    messageElement.className = 'system-message';
    messageElement.textContent = message;
    
    this.chatMessagesContainer.appendChild(messageElement);
    this.scrollChatToBottom();
  }
  
  // Scroll chat container to the bottom - FIXED FOR VISIBILITY
  scrollChatToBottom() {
    if (this.chatMessagesContainer) {
      this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
    }
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

  // Bet amount controls
  increaseBetAmount() {
    if (this.betAmountInput) {
      const current = parseInt(this.betAmountInput.value, 10) || 0;
      this.betAmountInput.value = current + 10;
    }
  }

  decreaseBetAmount() {
    if (this.betAmountInput) {
      const current = parseInt(this.betAmountInput.value, 10) || 0;
      this.betAmountInput.value = Math.max(10, current - 10);
    }
  }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing game');
  // Create game instance
  window.pokerGame = new PokerGame();
});