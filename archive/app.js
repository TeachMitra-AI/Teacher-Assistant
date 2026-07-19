// Main Application Logic

class TeacherCoachingApp {
  constructor() {
    this.currentLanguage = 'en';
    this.isListening = false;
    this.recognition = null;
    this.queryHistory = [];
    this.currentResponseText = '';
    this.isSpeaking = false;
    this.fontScale = 16;
    this.minFontScale = 14;
    this.maxFontScale = 22;
    
    this.init();
  }

  /**
   * Initialize the application
   */
  init() {
    console.log('Initializing Teacher Coaching App...');
    
    // Load query history from localStorage
    this.loadQueryHistory();

    // Restore display preferences (theme + text size)
    this.initTheme();
    this.initFontSize();
    
    // Set up event listeners
    this.setupEventListeners();

    // Populate example questions and recent history
    this.renderExampleChips();
    this.renderHistory();

    // Register service worker for offline / installable app support
    this.registerServiceWorker();
    
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

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());

    // Text size controls
    document.getElementById('fontIncreaseBtn').addEventListener('click', () => this.changeFontSize(2));
    document.getElementById('fontDecreaseBtn').addEventListener('click', () => this.changeFontSize(-2));

    // Clear recent questions
    document.getElementById('clearHistoryBtn').addEventListener('click', () => this.clearHistory());

    // Recent questions drawer
    document.getElementById('historyToggle').addEventListener('click', () => this.toggleHistory());
    document.getElementById('closeHistoryBtn').addEventListener('click', () => this.closeHistory());
    document.getElementById('historyOverlay').addEventListener('click', () => this.closeHistory());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeHistory();
    });

    // Stop any read-aloud speech when the language changes
    document.getElementById('languageSelect').addEventListener('change', () => this.stopReadAloud());
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

    // Keep the raw text available for read-aloud / copy / share actions.
    this.currentResponseText = response.text;
    
    responseContainer.innerHTML = `
      <div class="response-text">${formattedText}</div>
      <div class="response-actions">
        <button class="action-chip" id="readAloudBtn" type="button" onclick="app.readAloud()" title="Listen to this answer">
          🔊 <span>Read aloud</span>
        </button>
        <button class="action-chip" type="button" onclick="app.copyResponse()" title="Copy answer">
          📋 <span>Copy</span>
        </button>
        <button class="action-chip whatsapp" type="button" onclick="app.shareWhatsApp()" title="Share on WhatsApp">
          💬 <span>WhatsApp</span>
        </button>
      </div>
      <div class="response-meta">
        <div class="response-info">
          <span>⏱️ ${response.responseTime ? Math.round(response.responseTime / 1000) : 0}s</span>
          ${context.grade ? `<span style="margin-left: 1rem;">📚 ${this.escapeHtml(context.grade)}</span>` : ''}
          ${context.subject ? `<span style="margin-left: 1rem;">📖 ${this.escapeHtml(context.subject)}</span>` : ''}
        </div>
        <div class="feedback-buttons">
          <button class="feedback-btn" onclick="app.provideFeedback('helpful', this)" title="This was helpful">
            👍 <span>Helpful</span>
          </button>
          <button class="feedback-btn" onclick="app.provideFeedback('not-helpful', this)" title="This was not helpful">
            👎 <span>Not Helpful</span>
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

  /* ---------- Theme (light / dark) ---------- */
  initTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  }

  applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    const icon = document.getElementById('themeIcon');
    const btn = document.getElementById('themeToggle');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (btn) btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    this.applyTheme(next);
    try { localStorage.setItem('theme', next); } catch (e) {}
  }

  /* ---------- Text size ---------- */
  initFontSize() {
    const saved = parseInt(localStorage.getItem('fontScale'), 10);
    if (!isNaN(saved)) {
      this.fontScale = Math.min(this.maxFontScale, Math.max(this.minFontScale, saved));
    }
    this.applyFontSize();
  }

  applyFontSize() {
    document.documentElement.style.fontSize = this.fontScale + 'px';
  }

  changeFontSize(delta) {
    const next = Math.min(this.maxFontScale, Math.max(this.minFontScale, this.fontScale + delta));
    if (next === this.fontScale) {
      this.showToast(delta > 0 ? 'Maximum text size reached' : 'Minimum text size reached', 'info');
      return;
    }
    this.fontScale = next;
    this.applyFontSize();
    try { localStorage.setItem('fontScale', String(this.fontScale)); } catch (e) {}
  }

  /* ---------- Read aloud (text to speech) ---------- */
  readAloud() {
    if (!('speechSynthesis' in window)) {
      this.showToast('Read aloud is not supported in your browser', 'error');
      return;
    }
    // Toggle: tapping again while speaking stops playback.
    if (this.isSpeaking) {
      this.stopReadAloud();
      return;
    }
    const text = this.currentResponseText;
    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    const langCode = (CONFIG.LANGUAGES[this.currentLanguage] || {}).code || 'en-US';
    utterance.lang = langCode; // Hinglish uses the Hindi (hi-IN) voice.
    utterance.rate = 0.95;
    utterance.onend = () => this.setSpeakingState(false);
    utterance.onerror = () => this.setSpeakingState(false);

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    this.setSpeakingState(true);
  }

  stopReadAloud() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.setSpeakingState(false);
  }

  setSpeakingState(speaking) {
    this.isSpeaking = speaking;
    const btn = document.getElementById('readAloudBtn');
    if (btn) {
      btn.classList.toggle('speaking', speaking);
      btn.innerHTML = speaking ? '⏹️ <span>Stop</span>' : '🔊 <span>Read aloud</span>';
    }
  }

  /* ---------- Copy & Share ---------- */
  async copyResponse() {
    const text = this.currentResponseText;
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      this.showToast('Answer copied', 'success');
    } catch (e) {
      this.showToast('Could not copy. Please select and copy manually.', 'error');
    }
  }

  shareWhatsApp() {
    const text = this.currentResponseText;
    if (!text) return;
    const message = encodeURIComponent(text + '\n\n— Teacher Coaching Assistant');
    window.open('https://wa.me/?text=' + message, '_blank', 'noopener');
  }

  /* ---------- Example starter questions ---------- */
  renderExampleChips() {
    const container = document.getElementById('exampleChips');
    if (!container) return;
    const examples = [
      'How do I manage a noisy multi-grade classroom?',
      'Explain fractions with no teaching materials',
      'Students find English reading difficult. Help?',
      'A quick activity to teach the water cycle',
      'How to assess 40 students fairly and fast?'
    ];
    container.innerHTML = '<span class="chips-label">💡 Try:</span>' +
      examples.map(q => `<button class="chip" type="button">${this.escapeHtml(q)}</button>`).join('');
    container.querySelectorAll('.chip').forEach((chip, i) => {
      chip.addEventListener('click', () => {
        const input = document.getElementById('queryInput');
        input.value = examples[i];
        document.getElementById('charCount').textContent = examples[i].length;
        input.focus();
      });
    });
  }

  /* ---------- Recent questions drawer ---------- */
  renderHistory() {
    const list = document.getElementById('historyList');
    const toggle = document.getElementById('historyToggle');
    const badge = document.getElementById('historyBadge');
    if (!list || !toggle) return;

    const count = this.queryHistory.length;

    // Badge shows the number of saved questions (hidden when there are none).
    if (badge) {
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.hidden = count === 0;
    }

    if (!count) {
      list.innerHTML = '<p class="history-empty">No questions yet.<br>Ask something and it will appear here.</p>';
      return;
    }

    list.innerHTML = this.queryHistory.slice(0, 15).map((item, i) => {
      const when = this.formatTimestamp(item.timestamp);
      const meta = [item.context && item.context.grade, item.context && item.context.subject]
        .filter(Boolean).map(x => this.escapeHtml(x)).join(' • ');
      return `
        <button class="history-item" type="button" data-index="${i}">
          <span class="history-query">${this.escapeHtml(item.query)}</span>
          <span class="history-meta">${meta ? meta + ' • ' : ''}${when}</span>
        </button>`;
    }).join('');

    list.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => this.loadHistoryItem(parseInt(el.dataset.index, 10)));
    });
  }

  openHistory() {
    const drawer = document.getElementById('historyDrawer');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.getElementById('historyOverlay').hidden = false;
  }

  closeHistory() {
    const drawer = document.getElementById('historyDrawer');
    const overlay = document.getElementById('historyOverlay');
    if (!drawer || !overlay) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    overlay.hidden = true;
  }

  toggleHistory() {
    const drawer = document.getElementById('historyDrawer');
    if (drawer.classList.contains('open')) {
      this.closeHistory();
    } else {
      this.openHistory();
    }
  }

  loadHistoryItem(index) {
    const item = this.queryHistory[index];
    if (!item) return;
    // Restore the question and its context...
    document.getElementById('queryInput').value = item.query;
    document.getElementById('charCount').textContent = item.query.length;
    if (item.context) {
      document.getElementById('gradeSelect').value = item.context.grade || '';
      document.getElementById('subjectSelect').value = item.context.subject || '';
      document.getElementById('classroomTypeSelect').value = item.context.classroomType || '';
      document.getElementById('issueTypeSelect').value = item.context.issueType || '';
    }
    // ...and show the saved answer instantly (no new API call).
    if (item.response) {
      this.displayResponse(item.query, item.response, item.context || {});
    }
    this.closeHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  clearHistory() {
    this.queryHistory = [];
    this.saveQueryHistory();
    this.renderHistory();
    this.showToast('History cleared', 'info');
  }

  formatTimestamp(ts) {
    try {
      const d = new Date(ts);
      const diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return d.toLocaleDateString();
    } catch (e) {
      return '';
    }
  }

  /* ---------- Service worker (PWA / offline) ---------- */
  registerServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch(err => {
          console.warn('Service worker registration failed:', err);
        });
      });
    }
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
    this.renderHistory();
  }
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
