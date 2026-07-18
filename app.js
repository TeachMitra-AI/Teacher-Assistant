// Main Application Logic

class TeacherCoachingApp {
  constructor() {
    this.currentLanguage = 'en';
    this.isListening = false;
    this.recognition = null;
    this.queryHistory = [];
    
    this.init();
  }

  /**
   * Initialize the application
   */
  init() {
    console.log('Initializing Teacher Coaching App...');
    
    // Load query history from localStorage
    this.loadQueryHistory();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Initialize voice recognition if supported
    if (CONFIG.FEATURES.VOICE_INPUT) {
      this.initVoiceRecognition();
    }
    
    // Set up connection status monitoring
    this.setupConnectionMonitoring();
    
    // Set up offline queue callbacks
    this.setupOfflineCallbacks();
    
    console.log('App initialized successfully');
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Submit button
    document.getElementById('submitBtn').addEventListener('click', () => this.handleSubmit());
    
    // Clear button
    document.getElementById('clearBtn').addEventListener('click', () => this.handleClear());
    
    // Voice button
    document.getElementById('voiceBtn').addEventListener('click', () => this.toggleVoiceInput());
    
    // Language selector
    document.getElementById('languageSelect').addEventListener('change', (e) => {
      this.currentLanguage = e.target.value;
      this.showToast('Language changed', 'info');
    });
    
    // Query input - character count
    document.getElementById('queryInput').addEventListener('input', (e) => {
      document.getElementById('charCount').textContent = e.target.value.length;
    });
    
    // Enter key to submit (Ctrl+Enter)
    document.getElementById('queryInput').addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        this.handleSubmit();
      }
    });
  }

  /**
   * Initialize voice recognition
   */
  initVoiceRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.log('Speech recognition not supported');
      document.getElementById('voiceBtn').style.display = 'none';
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;
    
    // Set language based on current selection
    this.recognition.lang = CONFIG.LANGUAGES[this.currentLanguage].code;
    
    this.recognition.onstart = () => {
      console.log('Voice recognition started');
      this.isListening = true;
      document.getElementById('voiceBtn').classList.add('listening');
      this.showToast('Listening... Speak now', 'info');
    };
    
    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      console.log('Voice input:', transcript);
      document.getElementById('queryInput').value = transcript;
      document.getElementById('charCount').textContent = transcript.length;
      
      // Track analytics
      if (CONFIG.FEATURES.ANALYTICS) {
        aiService.trackAnalytics({
          event: CONFIG.ANALYTICS.VOICE_USED,
          timestamp: new Date().toISOString()
        });
      }
    };
    
    this.recognition.onerror = (event) => {
      console.error('Voice recognition error:', event.error);
      this.isListening = false;
      document.getElementById('voiceBtn').classList.remove('listening');
      
      let errorMessage = 'Voice input error';
      if (event.error === 'no-speech') {
        errorMessage = 'No speech detected. Please try again.';
      } else if (event.error === 'not-allowed') {
        errorMessage = 'Microphone access denied. Please allow microphone access.';
      }
      
      this.showToast(errorMessage, 'error');
    };
    
    this.recognition.onend = () => {
      console.log('Voice recognition ended');
      this.isListening = false;
      document.getElementById('voiceBtn').classList.remove('listening');
    };
  }

  /**
   * Toggle voice input
   */
  toggleVoiceInput() {
    if (!this.recognition) {
      this.showToast('Voice input not supported in your browser', 'error');
      return;
    }

    if (this.isListening) {
      this.recognition.stop();
    } else {
      // Update language
      this.recognition.lang = CONFIG.LANGUAGES[this.currentLanguage].code;
      this.recognition.start();
    }
  }

  /**
   * Handle form submission
   */
  async handleSubmit() {
    const query = document.getElementById('queryInput').value.trim();
    
    if (!query) {
      this.showToast('Please enter a question', 'warning');
      return;
    }

    // Get context
    const context = {
      grade: document.getElementById('gradeSelect').value,
      subject: document.getElementById('subjectSelect').value,
      classroomType: document.getElementById('classroomTypeSelect').value,
      issueType: document.getElementById('issueTypeSelect').value
    };

    // Show loading state
    this.setLoadingState(true);

    try {
      // Track analytics
      if (CONFIG.FEATURES.ANALYTICS) {
        aiService.trackAnalytics({
          event: CONFIG.ANALYTICS.QUERY_SUBMITTED,
          query: query,
          context: context,
          language: this.currentLanguage,
          timestamp: new Date().toISOString()
        });
      }

      // Check cache first
      let response = null;
      if (CONFIG.CACHE.ENABLED) {
        response = await cacheManager.getCachedResponse(query, context, this.currentLanguage);
        if (response) {
          console.log('Using cached response');
          this.showToast('Using cached response', 'info');
        }
      }

      // If not cached, get from AI
      if (!response) {
        // Check if online
        if (!navigator.onLine) {
          // Add to offline queue
          const queueId = cacheManager.addToOfflineQueue(query, context, this.currentLanguage);
          this.showToast('You are offline. Your query has been saved and will be processed when you reconnect.', 'warning');
          this.setLoadingState(false);
          return;
        }

        response = await aiService.generateResponse(query, context, this.currentLanguage);
        
        if (!response.success) {
          throw new Error(response.error);
        }

        // Cache the response
        if (CONFIG.CACHE.ENABLED) {
          await cacheManager.cacheResponse(query, context, this.currentLanguage, response);
        }
      }

      // Display response
      this.displayResponse(query, response, context);
      
      // Save to history
      this.addToHistory(query, response, context);
      
      this.showToast('Response received!', 'success');

    } catch (error) {
      console.error('Error submitting query:', error);
      this.showToast(error.message || 'An error occurred. Please try again.', 'error');
    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * Display AI response
   */
  displayResponse(query, response, context) {
    const responseArea = document.getElementById('responseArea');
    
    // Hide empty state
    const emptyState = document.getElementById('emptyState');
    if (emptyState) {
      emptyState.style.display = 'none';
    }

    // Create response container
    const responseContainer = document.createElement('div');
    responseContainer.className = 'response-container';
    
    // Format response text
    const formattedText = this.formatResponseText(response.text);
    
    responseContainer.innerHTML = `
      <div class="response-text">${formattedText}</div>
      <div class="response-meta">
        <div class="response-info">
          <span>⏱️ Response time: ${response.responseTime ? Math.round(response.responseTime / 1000) : 0}s</span>
          ${context.grade ? `<span style="margin-left: 1rem;">📚 ${context.grade}</span>` : ''}
          ${context.subject ? `<span style="margin-left: 1rem;">📖 ${context.subject}</span>` : ''}
        </div>
        <div class="feedback-buttons">
          <button class="feedback-btn" onclick="app.provideFeedback('helpful', this)" title="This was helpful">
            👍 Helpful
          </button>
          <button class="feedback-btn" onclick="app.provideFeedback('not-helpful', this)" title="This was not helpful">
            👎 Not Helpful
          </button>
        </div>
      </div>
    `;
    
    // Clear previous responses and add new one
    responseArea.innerHTML = '';
    responseArea.appendChild(responseContainer);
    
    // Scroll to response
    if (CONFIG.UI.AUTO_SCROLL) {
      responseContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * Escape HTML special characters to prevent XSS.
   */
  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Format response text with basic markdown-like formatting
   */
  formatResponseText(text) {
    // Escape any HTML first so raw model/user content cannot inject markup.
    text = this.escapeHtml(text);

    // Convert numbered lists
    text = text.replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
    
    // Wrap consecutive list items in ol
    text = text.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ol>${match}</ol>`);
    
    // Convert bullet points
    text = text.replace(/^[•\-\*]\s+(.+)$/gm, '<li>$1</li>');
    
    // Wrap consecutive list items in ul
    text = text.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
      if (!match.includes('<ol>')) {
        return `<ul>${match}</ul>`;
      }
      return match;
    });
    
    // Convert bold text
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Convert headings
    text = text.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    
    // Convert line breaks
    text = text.replace(/\n\n/g, '</p><p>');
    text = `<p>${text}</p>`;
    
    return text;
  }

  /**
   * Handle clear button
   */
  handleClear() {
    document.getElementById('queryInput').value = '';
    document.getElementById('charCount').textContent = '0';
    document.getElementById('gradeSelect').value = '';
    document.getElementById('subjectSelect').value = '';
    document.getElementById('classroomTypeSelect').value = '';
    document.getElementById('issueTypeSelect').value = '';
    
    // Show empty state
    const emptyState = document.getElementById('emptyState');
    if (emptyState) {
      emptyState.style.display = 'block';
    }
    
    // Clear response area
    const responseArea = document.getElementById('responseArea');
    const responseContainers = responseArea.querySelectorAll('.response-container');
    responseContainers.forEach(container => container.remove());
  }

  /**
   * Set loading state
   */
  setLoadingState(isLoading) {
    const submitBtn = document.getElementById('submitBtn');
    const submitBtnText = document.getElementById('submitBtnText');
    const submitBtnSpinner = document.getElementById('submitBtnSpinner');
    
    if (isLoading) {
      submitBtn.disabled = true;
      submitBtnText.textContent = 'Getting Response...';
      submitBtnSpinner.style.display = 'inline-block';
    } else {
      submitBtn.disabled = false;
      submitBtnText.textContent = 'Get Coaching';
      submitBtnSpinner.style.display = 'none';
    }
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${this.getToastIcon(type)}</span>
      <span>${message}</span>
    `;
    
    toastContainer.appendChild(toast);
    
    // Auto remove after duration
    setTimeout(() => {
      toast.style.animation = 'slideInRight 0.3s ease-out reverse';
      setTimeout(() => toast.remove(), 300);
    }, CONFIG.UI.TOAST_DURATION);
  }

  /**
   * Get toast icon based on type
   */
  getToastIcon(type) {
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    return icons[type] || icons.info;
  }

  /**
   * Provide feedback on response
   */
  provideFeedback(feedbackType, buttonElement) {
    // Mark button as active
    const allFeedbackBtns = buttonElement.parentElement.querySelectorAll('.feedback-btn');
    allFeedbackBtns.forEach(btn => btn.classList.remove('active'));
    buttonElement.classList.add('active');
    
    // Track analytics
    if (CONFIG.FEATURES.ANALYTICS) {
      aiService.trackAnalytics({
        event: CONFIG.ANALYTICS.FEEDBACK_GIVEN,
        feedbackType: feedbackType,
        timestamp: new Date().toISOString()
      });
    }
    
    this.showToast('Thank you for your feedback!', 'success');
  }

  /**
   * Add query to history
   */
  addToHistory(query, response, context) {
    const historyItem = {
      query: query,
      response: response,
      context: context,
      timestamp: new Date().toISOString()
    };
    
    this.queryHistory.unshift(historyItem);
    
    // Keep only last 50 items
    if (this.queryHistory.length > 50) {
      this.queryHistory = this.queryHistory.slice(0, 50);
    }
    
    this.saveQueryHistory();
  }

  /**
   * Save query history to localStorage
   */
  saveQueryHistory() {
    try {
      localStorage.setItem('queryHistory', JSON.stringify(this.queryHistory));
    } catch (error) {
      console.error('Error saving query history:', error);
    }
  }

  /**
   * Load query history from localStorage
   */
  loadQueryHistory() {
    try {
      const saved = localStorage.getItem('queryHistory');
      if (saved) {
        this.queryHistory = JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error loading query history:', error);
      this.queryHistory = [];
    }
  }

  /**
   * Set up connection status monitoring
   */
  setupConnectionMonitoring() {
    this.updateConnectionStatus();
    
    window.addEventListener('online', () => this.updateConnectionStatus());
    window.addEventListener('offline', () => this.updateConnectionStatus());
  }

  /**
   * Update connection status UI
   */
  updateConnectionStatus() {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    if (navigator.onLine) {
      statusDot.classList.remove('offline');
      statusText.textContent = 'Online';
    } else {
      statusDot.classList.add('offline');
      statusText.textContent = 'Offline';
    }
  }

  /**
   * Set up offline queue callbacks
   */
  setupOfflineCallbacks() {
    // Callback when offline query is processed
    window.onOfflineQueryProcessed = (item, response) => {
      console.log('Offline query processed:', item);
      this.showToast(`Your offline query has been processed: "${item.query.substring(0, 50)}..."`, 'success');
    };
    
    // Callback when connection status changes
    window.onConnectionStatusChanged = (isOnline) => {
      if (isOnline) {
        const queueStatus = cacheManager.getOfflineQueueStatus();
        if (queueStatus.pending > 0) {
          this.showToast(`Processing ${queueStatus.pending} offline queries...`, 'info');
        }
      }
    };
  }
}

// Initialize app when DOM is ready
let app;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    app = new TeacherCoachingApp();
  });
} else {
  app = new TeacherCoachingApp();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TeacherCoachingApp;
}
