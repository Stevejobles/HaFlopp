// Main Poker Game Logic
class PokerGame {
  constructor(lobbyId) {
    this.lobbyId = lobbyId;
    this.players = [];
    this.currentUser = null;
    this.tableCards = [];
    this.pot = 0;
    this.currentTurn = null;
    this.gameState = null;
    this.playerState = null;
    this.maxPlayers = 6; // Maximum of 6 players per lobby (including current user)
    this.maxOtherPlayers = 5; // Maximum of 5 other players (excluding current user)
    this.playerActions = {}; // Track player actions

    // DOM elements
    this.potElement = document.querySelector('.pot-number');
    this.usersContainer = document.querySelector('.users');
    this.otherUsersContainer = document.querySelector('.other-users');
    this.backButton = document.querySelector('.back');
    this.tableCardsContainer = document.querySelector('.table-cards');
    this.gameStatusElement = document.querySelector('.game-status');
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

    // Event listeners for game controls
    this.backButton.addEventListener('click', this.handleBackButton.bind(this));
    this.foldBtn.addEventListener('click', () => this.handleAction('fold'));
    this.checkBtn.addEventListener('click', () => this.handleAction('check'));
    this.betBtn.addEventListener('click', () => this.handleAction('bet', parseInt(this.betAmountInput.value, 10)));
    this.raiseBtn.addEventListener('click', () => this.handleAction('raise', parseInt(this.betAmountInput.value, 10)));

    // Event listeners for bet amount controls
    this.betIncreaseBtn.addEventListener('click', () => this.adjustBetAmount(10));
    this.betDecreaseBtn.addEventListener('click', () => this.adjustBetAmount(-10));

    // Event listeners for chat
    this.sendMessageBtn.addEventListener('click', () => {
      this.sendChatMessage();
    });
    
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendChatMessage();
      }
    });

    // Socket connection
    this.socket = window.pokerSocket;
    this.setupSocketCallbacks();

    // Initialize
    this.init();
  }

  async init() {
    try {
      // Get the current user
      const userResponse = await fetch('/api/user');
      if (!userResponse.ok) {
        window.location.href = '../login.html';
        return;
      }

      const userData = await userResponse.json();
      this.currentUser = userData.user;

      // Setup socket callbacks first
      this.setupSocketCallbacks();

      // Then connect socket with user ID
      this.socket.connectWithAuth(this.currentUser.id);

      // Disable all action buttons initially
      this.updateActionButtons([]);

      // Show initial status
      this.gameStatusElement.textContent = 'Connecting to game...';

      // Initially clear other players container
      this.clearOtherPlayers();

      // Scroll chat to bottom
      this.scrollChatToBottom();
    } catch (error) {
      console.error('Initialization error:', error);
      alert('Failed to initialize the game');
    }
  }

  setupSocketCallbacks() {
    this.socket.setCallbacks({
      onConnect: () => {
        console.log('Connected to server');
        if (this.lobbyId) {
          this.socket.joinGame(this.lobbyId);
        }
      },

      onDisconnect: () => {
        console.log('Disconnected from server');
        this.gameStatusElement.textContent = 'Disconnected from server';
        this.addSystemMessage('Disconnected from server. Please refresh the page.');
      },

      onGameState: (data) => {
        console.log('Game state update:', data);
        this.updateGameState(data.gameState, data.playerState);
      },

      onError: (error) => {
        console.error('Game error:', error);
        this.addSystemMessage(`Error: ${error.message || 'An unknown error occurred'}`);
      },

      onGameStarted: (data) => {
        console.log('Game started:', data);
        this.gameStatusElement.textContent = 'Game starting...';
        this.addSystemMessage('Game has started!');
      },
      
      // Add handlers for player join/leave events
      onPlayerJoin: (data) => {
        console.log('Player joined:', data);
        this.handlePlayerJoin(data);
      },
      
      onPlayerLeave: (data) => {
        console.log('Player left:', data);
        this.handlePlayerLeave(data);
      },
      
      // Add handler for chat messages
      onChatMessage: (data) => {
        console.log('Chat message received:', data);
        this.receiveChatMessage(data);
      },
      
      // Add handler for player actions
      onPlayerAction: (data) => {
        console.log('Player action received:', data);
        this.updatePlayerAction(data);
      }
    });
  }

  updateGameState(gameState, playerState) {
    this.gameState = gameState;
    this.playerState = playerState;

    // Update pot - make sure it's dynamic and changing based on player bets
    if (gameState.pot !== undefined) {
      this.potElement.textContent = `$${gameState.pot}`;
    }

    // Update table cards
    this.updateTableCards(gameState.tableCards);

    // Update players
    this.renderPlayers(gameState.players);

    // Update game status
    this.updateGameStatus(gameState);

    // Update action buttons
    if (playerState) {
      this.updateActionButtons(playerState.availableActions || []);
    } else {
      this.updateActionButtons([]);
    }
  }

  updateTableCards(tableCards) {
    if (!tableCards || tableCards.length === 0) {
      // Reset all cards to hidden
      const cardElements = this.tableCardsContainer.querySelectorAll('.table-card');
      cardElements.forEach(card => {
        card.classList.add('hidden');
        card.textContent = '?';
      });
      return;
    }

    // Update visible cards
    const cardElements = this.tableCardsContainer.querySelectorAll('.table-card');

    for (let i = 0; i < cardElements.length; i++) {
      if (i < tableCards.length) {
        // Show this card
        cardElements[i].classList.remove('hidden');
        cardElements[i].textContent = this.formatCard(tableCards[i]);
      } else {
        // Hide this card
        cardElements[i].classList.add('hidden');
        cardElements[i].textContent = '?';
      }
    }
  }

  clearOtherPlayers() {
    // Clear the other users container
    this.otherUsersContainer.innerHTML = '';
  }

  renderPlayers(players) {
    if (!players || players.length === 0) return;

    // Clear current user
    const currentUserElement = document.querySelector('.user.me');
    if (currentUserElement) {
      currentUserElement.remove();
    }

    // Clear all other players
    this.clearOtherPlayers();

    // Find current user
    const currentPlayer = players.find(p => p.id === this.currentUser.id);

    // Filter other players (excluding current user)
    const otherPlayers = players.filter(p => p.id !== this.currentUser.id);

    // Render current user
    if (currentPlayer) {
      this.renderCurrentPlayer(currentPlayer);
    }

    // Render other players with assigned seats
    this.renderOtherPlayers(otherPlayers);
  }

  renderCurrentPlayer(player) {
    // Create current user element
    const userElement = document.createElement('div');
    userElement.className = 'user me';
    userElement.dataset.userId = player.id;

    // Add player status classes
    if (player.folded) userElement.classList.add('folded');
    if (player.isAllIn) userElement.classList.add('allin');
    if (player.isCurrentTurn) userElement.classList.add('current-turn');

    let cardsHtml = '';

    // Show cards if available
    if (this.playerState && this.playerState.hand) {
      cardsHtml = `
          <div class="cards">
            <div class="card">
              <div class="number">${this.formatCard(this.playerState.hand[0])}</div>
            </div>
            <div class="card">
              <div class="number">${this.formatCard(this.playerState.hand[1])}</div>
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

    // Add player role indicators
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

    userElement.innerHTML = `
        ${cardsHtml}
        <div class="user-content">
          <div class="name">You ${roleIndicator}</div>
          <div class="balance">${player.chips}</div>
          ${player.bet > 0 ? `<div class="current-bet">Bet: ${player.bet}</div>` : ''}
          ${actionDisplay}
        </div>
      `;

    this.usersContainer.appendChild(userElement);
  }

  renderOtherPlayers(otherPlayers) {
    // Clear existing players first
    this.clearOtherPlayers();

    console.log(`Rendering ${otherPlayers.length} other players`);

    // Create player elements for each player
    // The positioning will be handled by the CSS nth-of-type selectors
    otherPlayers.forEach((player, index) => {
      // Create the player element - DO NOT add any position classes here
      // Let CSS :nth-of-type selectors handle positioning
      const playerElement = document.createElement('div');
      playerElement.className = 'user';
      playerElement.dataset.userId = player.id;

      // Add status classes, but NOT position classes
      if (player.folded) playerElement.classList.add('folded');
      if (player.isAllIn) playerElement.classList.add('allin');
      if (player.isCurrentTurn) playerElement.classList.add('current-turn');

      // Add player role indicators
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

      this.otherUsersContainer.appendChild(playerElement);
    });
  }

  // Handle player joining the game
  handlePlayerJoin(playerData) {
    console.log('Player joined:', playerData);

    // Add system message to chat
    this.addSystemMessage(`${playerData.username || 'A player'} has joined the table.`);

    // Refresh game state to include the new player
    if (this.socket) {
      this.socket.joinGame(this.lobbyId);
    }
  }

  // Handle player leaving the game
  handlePlayerLeave(playerData) {
    console.log('Player left:', playerData);

    // Add system message to chat
    this.addSystemMessage(`${playerData.username || 'A player'} has left the table.`);

    // Find the player element
    const playerElement = document.querySelector(`.user[data-user-id="${playerData.userId}"]`);

    if (playerElement) {
      // Add leaving animation
      playerElement.classList.add('leaving');

      // Remove the player element after animation completes
      setTimeout(() => {
        playerElement.remove();

        // Refresh game state
        if (this.socket) {
          this.socket.joinGame(this.lobbyId);
        }
      }, 500);
    }
  }

  updateGameStatus(gameState) {
    if (!gameState) return;

    // Update game status text based on current state
    if (gameState.isGameOver) {
      // Game over, show winner
      if (gameState.winner) {
        const winnerName = gameState.players.find(p => p.id === gameState.winner)?.username || 'Unknown';
        this.gameStatusElement.textContent = `Game over! ${winnerName} wins the pot of ${gameState.pot}`;
        this.addSystemMessage(`${winnerName} wins the pot of ${gameState.pot}!`);
      } else {
        this.gameStatusElement.textContent = 'Game over!';
      }
    } else {
      // Game in progress, show current round
      const currentPlayerName = gameState.players.find(p => p.isCurrentTurn)?.username || 'Unknown';
      const isCurrentUserTurn = gameState.players.find(p => p.isCurrentTurn)?.id === this.currentUser.id;
      const turnIndicator = isCurrentUserTurn ? 'Your turn' : `${currentPlayerName}'s turn`;

      switch (gameState.currentRound) {
        case 'pre-flop':
          this.gameStatusElement.textContent = `Pre-flop betting round - ${turnIndicator}`;
          break;
        case 'flop':
          this.gameStatusElement.textContent = `Flop betting round - ${turnIndicator}`;
          break;
        case 'turn':
          this.gameStatusElement.textContent = `Turn betting round - ${turnIndicator}`;
          break;
        case 'river':
          this.gameStatusElement.textContent = `River betting round - ${turnIndicator}`;
          break;
        case 'showdown':
          this.gameStatusElement.textContent = 'Showdown!';
          break;
        default:
          this.gameStatusElement.textContent = `Waiting for ${turnIndicator}...`;
      }
    }
  }

  updateActionButtons(availableActions) {
    // Disable all buttons by default
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
          // For call, use the check button with updated text
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

  // Adjusts the bet amount input by the given delta
  adjustBetAmount(delta) {
    const currentValue = parseInt(this.betAmountInput.value, 10) || 0;
    const min = parseInt(this.betAmountInput.min, 10) || 0;
    const max = parseInt(this.betAmountInput.max, 10) || 1000;

    // Calculate new value while staying within bounds
    let newValue = Math.max(min, Math.min(currentValue + delta, max));
    this.betAmountInput.value = newValue;
  }

  // Handle player action
  handleAction(action, amount = 0) {
    // Validate amount for bet/raise
    if ((action === 'bet' || action === 'raise') && isNaN(amount)) {
      alert('Please enter a valid bet amount');
      return;
    }

    // Disable all buttons during action processing
    this.actionButtons.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('disabled');
    });
    this.betAmountInput.disabled = true;

    // Update local player action
    this.updatePlayerAction({
      userId: this.currentUser.id,
      action: action,
      amount: amount
    });

    // Send action to server
    this.socket.sendAction(action, amount);
  }

  // Update player action display
  updatePlayerAction(data) {
    const { userId, action, amount } = data;

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
        actionText = `Called ${amount || ''}`;
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
        return;
    }

    // Store the player action
    this.playerActions[userId] = {
      type: actionType,
      text: actionText
    };

    // Update player elements
    this.updatePlayerActionElements(userId, actionType, actionText);

    // Add action to chat
    const playerName = userId === this.currentUser.id ? 'You' :
      this.gameState?.players.find(p => p.id === userId)?.username || 'Player';
    this.addSystemMessage(`${playerName} ${actionText.toLowerCase()}`);
  }

  // Update player action elements in the DOM
  updatePlayerActionElements(userId, actionType, actionText) {
    // Find player element
    const playerElement = document.querySelector(`.user[data-user-id="${userId}"]`);
    if (!playerElement) return;

    // Find or create action element
    let actionElement = playerElement.querySelector('.player-action');
    if (!actionElement) {
      actionElement = document.createElement('div');
      actionElement.className = 'player-action';
      playerElement.querySelector('.user-content').appendChild(actionElement);
    }

    // Update action element
    actionElement.textContent = actionText;
    actionElement.className = `player-action ${actionType}`;

    // Remove hidden class
    actionElement.classList.remove('hidden');

    // Clear action after a delay (except for fold)
    if (actionType !== 'folded') {
      setTimeout(() => {
        if (actionElement) {
          actionElement.classList.add('hidden');
        }
      }, 3000);
    }
  }

  // Format card for display (e.g. "Ah" -> "A♥")
  formatCard(cardCode) {
    if (!cardCode) return '?';

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

    return displayValue + suitSymbol;
  }

  // Send a chat message
  // Send a chat message
  sendChatMessage() {
    const message = this.chatInput.value.trim();
    if (!message) return;
    
    console.log("Sending chat message:", message);
    
    // Clear input
    this.chatInput.value = '';
    
    // Get timestamp
    const timestamp = new Date().toISOString();
    
    // Create message data
    const messageData = {
      userId: this.currentUser.id,
      username: this.currentUser.username || 'You',
      message,
      timestamp,
      isSelf: true
    };
    
    // Add message to chat locally immediately
    this.addChatMessage(messageData);
    
    // Send message to server through socket
    if (this.socket && this.socket.isSocketConnected()) {
      this.socket.sendChatMessage(message);
    } else {
      console.error("Socket not connected, can't send chat message");
      this.addSystemMessage("Message not sent - connection issues");
    }
  }

  // Receive a chat message from the server
  receiveChatMessage(data) {
    console.log("Received chat message:", data);

    // Skip own messages (we already added them locally)
    if (data.userId === this.currentUser.id) return;

    // Add message to chat
    this.addChatMessage({
      ...data,
      isSelf: false
    });
  }

  // Add a chat message to the display
  addChatMessage(data) {
    const { userId, username, message, timestamp, isSelf } = data;

    // Create message element
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${isSelf ? 'my-message' : 'other-message'}`;

    // Format timestamp
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Set content
    messageElement.innerHTML = `
    <div class="message-sender">${username}</div>
    <div class="message-content">${this.escapeHTML(message)}</div>
    <div class="message-time">${time}</div>
  `;

    // Add to container
    this.chatMessagesContainer.appendChild(messageElement);

    // Scroll to bottom
    this.scrollChatToBottom();
  }

  // Receive a chat message from the server
  receiveChatMessage(data) {
    // Skip own messages (we already added them locally)
    if (data.userId === this.currentUser.id) return;

    // Add message to chat
    this.addChatMessage({
      ...data,
      isSelf: false
    });
  }

  // Add a chat message to the display
  addChatMessage(data) {
    const { userId, username, message, timestamp, isSelf } = data;

    // Create message element
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${isSelf ? 'my-message' : 'other-message'}`;

    // Format timestamp
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Set content
    messageElement.innerHTML = `
      <div class="message-sender">${username}</div>
      <div class="message-content">${this.escapeHTML(message)}</div>
      <div class="message-time">${time}</div>
    `;

    // Add to container
    this.chatMessagesContainer.appendChild(messageElement);

    // Scroll to bottom
    this.scrollChatToBottom();
  }

  // Add a system message to the chat
  addSystemMessage(message) {
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
    return text.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  handleBackButton() {
    if (confirm('Are you sure you want to leave the game?')) {
      // Disconnect socket
      this.socket.disconnect();
      window.location.href = '../index.html';
    }
  }

  // Use pokerSolver.js to evaluate a hand (if available)
  evaluateHand(holeCards, tableCards) {
    if (!window.Hand || !window.Game) {
      console.error('PokerSolver not loaded');
      return null;
    }

    // Combine hole cards and table cards
    const cards = [...holeCards, ...tableCards];

    // Evaluate the hand
    const hand = window.Hand.solve(cards);

    return {
      name: hand.name,
      descr: hand.descr,
      cards: hand.cards
    };
  }

  // Format hand name for display
  formatHandName(handEvaluation) {
    if (!handEvaluation) return 'Unknown hand';
    return handEvaluation.descr || handEvaluation.name;
  }
}