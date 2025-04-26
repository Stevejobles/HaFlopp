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

    // DOM elements
    this.potElement = document.querySelector('.pot-number');
    this.usersContainer = document.querySelector('.users');
    this.otherUsersContainer = document.querySelector('.other-users');
    this.backButton = document.querySelector('.back');
    this.tableCardsContainer = document.querySelector('.table-cards');
    this.gameStatusElement = document.querySelector('.game-status');

    // Game control buttons
    this.foldBtn = document.getElementById('fold-btn');
    this.checkBtn = document.getElementById('check-btn');
    this.betBtn = document.getElementById('bet-btn');
    this.raiseBtn = document.getElementById('raise-btn');
    this.betAmountInput = document.getElementById('bet-amount');

    // Get all control buttons
    this.controlButtons = document.querySelectorAll('.control-btn');

    // Event listeners
    this.backButton.addEventListener('click', this.handleBackButton.bind(this));
    this.foldBtn.addEventListener('click', () => this.handleAction('fold'));
    this.checkBtn.addEventListener('click', () => this.handleAction('check'));
    this.betBtn.addEventListener('click', () => this.handleAction('bet', parseInt(this.betAmountInput.value, 10)));
    this.raiseBtn.addEventListener('click', () => this.handleAction('raise', parseInt(this.betAmountInput.value, 10)));

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
      
      // Disable all control buttons initially
      this.updateControlButtons([]);
      
      // Show initial status
      this.gameStatusElement.textContent = 'Connecting to game...';

      // Initially clear other players container
      this.clearOtherPlayers();
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
      },

      onGameState: (data) => {
        this.updateGameState(data.gameState, data.playerState);
      },

      onError: (error) => {
        console.error('Game error:', error);
        alert(error.message || 'An error occurred');
      },

      onGameStarted: (data) => {
        console.log('Game started:', data);
        this.gameStatusElement.textContent = 'Game starting...';
      },
      
      // Add handlers for player join/leave events
      onPlayerJoin: (data) => {
        this.handlePlayerJoin(data);
      },
      
      onPlayerLeave: (data) => {
        this.handlePlayerLeave(data);
      }
    });
  }

  updateGameState(gameState, playerState) {
    this.gameState = gameState;
    this.playerState = playerState;

    // Update pot
    this.potElement.textContent = `$${gameState.pot}`;

    // Update table cards
    this.updateTableCards(gameState.tableCards);

    // Update players
    this.renderPlayers(gameState.players);

    // Update game status
    this.updateGameStatus(gameState);

    // Update control buttons
    if (playerState) {
      this.updateControlButtons(playerState.availableActions || []);
    } else {
      this.updateControlButtons([]);
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

    userElement.innerHTML = `
        ${cardsHtml}
        <div class="user-content">
          <div class="name">${player.username} ${roleIndicator}</div>
          <div class="balance">$${player.chips}</div>
          ${player.bet > 0 ? `<div class="current-bet">Bet: $${player.bet}</div>` : ''}
        </div>
      `;

    this.usersContainer.appendChild(userElement);
  }

  renderOtherPlayers(otherPlayers) {
    // Clear existing players first
    this.clearOtherPlayers();

    // Determine how many seats to render based on actual player count
    // If we have 3 players total (including current user), we need 2 other player seats
    const totalPlayerCount = otherPlayers.length + 1; // +1 for current user
    const seatsToRender = Math.min(this.maxOtherPlayers, otherPlayers.length);

    console.log(`Rendering ${seatsToRender} seats for ${otherPlayers.length} other players (total: ${totalPlayerCount} players)`);

    // Add a class to the container to indicate total player count for proper positioning
    this.otherUsersContainer.className = `other-users players-${totalPlayerCount}`;

    // Create player elements for each seat
    for (let seatIndex = 0; seatIndex < seatsToRender; seatIndex++) {
      const player = otherPlayers[seatIndex];
      const seatNumber = seatIndex + 1; // Seat numbers are 1-based (1 to 5)

      // Create the player element
      const playerElement = document.createElement('div');
      playerElement.className = `user seat-${seatNumber}`;
      playerElement.dataset.userId = player.id;
      playerElement.classList.add('joining'); // Add animation class

      // Add player status classes
      if (player.folded) playerElement.classList.add('folded');
      if (player.isAllIn) playerElement.classList.add('allin');
      if (player.isCurrentTurn) playerElement.classList.add('current-turn');

      // Add player role indicators
      let roleIndicator = '';
      if (player.isDealer) roleIndicator += '<span class="role dealer">D</span>';
      if (player.isSmallBlind) roleIndicator += '<span class="role small-blind">SB</span>';
      if (player.isBigBlind) roleIndicator += '<span class="role big-blind">BB</span>';

      playerElement.innerHTML = `
          <div class="cards">
            <div class="card"></div>
            <div class="card"></div>
          </div>
          <div class="user-content">
            <div class="name">${player.username} ${roleIndicator}</div>
            <div class="balance">${player.chips}</div>
            ${player.bet > 0 ? `<div class="current-bet">Bet: ${player.bet}</div>` : ''}
          </div>
        `;

      this.otherUsersContainer.appendChild(playerElement);
      
      // Remove animation class after animation completes
      setTimeout(() => {
        playerElement.classList.remove('joining');
      }, 500);
    }
  }
  
  // Handle player joining the game
  handlePlayerJoin(playerData) {
    console.log('Player joined:', playerData);
    
    // Refresh game state to include the new player
    if (this.socket) {
      this.socket.joinGame(this.lobbyId);
    }
  }
  
  // Handle player leaving the game
  handlePlayerLeave(playerData) {
    console.log('Player left:', playerData);
    
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
        this.gameStatusElement.textContent = `Game over! ${winnerName} wins the pot of $${gameState.pot}`;
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

  updateControlButtons(availableActions) {
    // Disable all buttons by default
    this.controlButtons.forEach(btn => {
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
          // For simplicity, we use check button for calls too
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

  // Handle player action
  handleAction(action, amount = 0) {
    // Validate amount for bet/raise
    if ((action === 'bet' || action === 'raise') && isNaN(amount)) {
      alert('Please enter a valid bet amount');
      return;
    }

    // Disable all buttons during action processing
    this.controlButtons.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('disabled');
    });
    this.betAmountInput.disabled = true;

    // Send action to server
    this.socket.sendAction(action, amount);
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

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Get the lobby ID from the URL
  const urlParams = new URLSearchParams(window.location.search);
  const lobbyId = urlParams.get('id');
  console.log('Extracted lobby ID from URL:', lobbyId);

  if (!lobbyId) {
    alert('No game ID provided');
    window.location.href = '../index.html';
    return;
  }

  // Create the game
  const game = new PokerGame(lobbyId);
});