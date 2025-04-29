document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const addChipsBtn = document.getElementById('add-chips-btn');
    const chipRefillModal = document.getElementById('chip-refill-modal');
    const closeModal = document.querySelector('.close-modal');
    const chipOptions = document.querySelectorAll('.chip-option');
    const addCustomAmountBtn = document.getElementById('add-custom-amount');
    const customChipAmount = document.getElementById('custom-chip-amount');
    const userChipCount = document.getElementById('user-chip-count');
    
    // Get initial user chip count
    fetchUserChips();
    
    // Event listeners
    if (addChipsBtn) {
      addChipsBtn.addEventListener('click', function() {
        if (chipRefillModal) chipRefillModal.style.display = 'block';
      });
    }
    
    if (closeModal) {
      closeModal.addEventListener('click', function() {
        chipRefillModal.style.display = 'none';
      });
    }
    
    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
      if (event.target === chipRefillModal) {
        chipRefillModal.style.display = 'none';
      }
    });
    
    // Chip option buttons
    if (chipOptions) {
      chipOptions.forEach(option => {
        option.addEventListener('click', function() {
          const amount = parseInt(this.dataset.amount, 10);
          addChips(amount);
        });
      });
    }
    
    // Custom amount button
    if (addCustomAmountBtn && customChipAmount) {
      addCustomAmountBtn.addEventListener('click', function() {
        const amount = parseInt(customChipAmount.value, 10);
        if (!isNaN(amount) && amount > 0) {
          addChips(amount);
        } else {
          alert('Please enter a valid amount');
        }
      });
    }
    
    // Socket event for when player needs chips
    if (window.pokerSocket) {
      window.pokerSocket.socket.on('needChips', function(data) {
        alert(data.message);
        // Open the chip refill modal
        if (chipRefillModal) chipRefillModal.style.display = 'block';
      });
    }
    
    // Function to fetch user chips from server
    function fetchUserChips() {
      fetch('/api/user')
        .then(response => response.json())
        .then(data => {
          if (data.user && userChipCount) {
            userChipCount.textContent = data.user.chips.toLocaleString();
          }
        })
        .catch(error => console.error('Error fetching user data:', error));
    }
    
    // Function to add chips
    function addChips(amount) {
      // Show loading state
      const originalText = addCustomAmountBtn.textContent;
      addCustomAmountBtn.textContent = 'Adding...';
      addCustomAmountBtn.disabled = true;
      
      fetch('/api/user/add-chips', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amount: amount })
      })
      .then(response => response.json())
      .then(data => {
        if (data.chips && userChipCount) {
          userChipCount.textContent = data.chips.toLocaleString();
          
          // Show success message
          alert(`Successfully added $${data.added.toLocaleString()} chips!`);
          
          // Close the modal
          chipRefillModal.style.display = 'none';
          
          // If we're in a game, request a game state update to show new chips
          if (window.pokerGame && typeof window.pokerGame.requestGameStateUpdate === 'function') {
            window.pokerGame.requestGameStateUpdate();
          }
        } else {
          alert(data.message || 'Something went wrong');
        }
      })
      .catch(error => {
        console.error('Error adding chips:', error);
        alert('Failed to add chips. Please try again.');
      })
      .finally(() => {
        // Reset button
        addCustomAmountBtn.textContent = originalText;
        addCustomAmountBtn.disabled = false;
      });
    }
  });