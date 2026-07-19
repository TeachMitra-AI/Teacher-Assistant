// AI Service - Backend Proxy Integration
//
// This client never talks to the LLM directly and holds no API key.
// It calls our backend (CONFIG.API.BACKEND_ENDPOINT), which owns the key,
// builds prompts, and handles retries/continuation server-side.

class AIService {
  constructor() {
    this.endpoint = CONFIG.API.BACKEND_ENDPOINT;
    this.requestQueue = [];
    this.isProcessing = false;
  }

  /**
   * Generate a response by calling the backend proxy.
   * @param {string} query - Teacher's question
   * @param {object} context - Classroom context (grade, subject, etc.)
   * @param {string} language - Response language
   * @returns {Promise<object>} - AI response with text and metadata
   */
  async generateResponse(query, context = {}, language = 'en') {
    try {
      const startTime = Date.now();
      const data = await this.makeRequest({ query, context, language });
      const responseTime = data.responseTime || Date.now() - startTime;

      // Track analytics
      if (CONFIG.FEATURES.ANALYTICS) {
        this.trackAnalytics({
          event: CONFIG.ANALYTICS.RESPONSE_RECEIVED,
          query: query,
          context: context,
          language: language,
          responseTime: responseTime,
          timestamp: new Date().toISOString()
        });
      }

      return {
        success: true,
        text: data.text,
        responseTime: responseTime,
        timestamp: data.timestamp || new Date().toISOString(),
        context: context,
        language: language
      };

    } catch (error) {
      console.error('AI Service Error:', error);
      return this.handleError(error, query, context);
    }
  }

  /**
   * POST the query to the backend proxy, with retry on transient failures.
   */
  async makeRequest(payload, retryCount = 0) {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CONFIG.API.TIMEOUT)
      });

      if (!response.ok) {
        let errorMessage = `Request failed (${response.status})`;
        try {
          const errorData = await response.json();
          if (errorData && errorData.error) {
            errorMessage = errorData.error;
          }
        } catch (_) {
          // Response had no JSON body.
        }
        const err = new Error(errorMessage);
        err.status = response.status;
        throw err;
      }

      return await response.json();

    } catch (error) {
      // Retry only on network errors or 5xx responses.
      const retriable = !error.status || error.status >= 500;
      if (retriable && retryCount < CONFIG.API.MAX_RETRIES) {
        console.log(`Retrying request (attempt ${retryCount + 1}/${CONFIG.API.MAX_RETRIES})...`);
        await this.delay(1000 * (retryCount + 1)); // Exponential backoff
        return this.makeRequest(payload, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Handle errors with user-friendly messages.
   * The backend returns a safe, user-facing message in `error.message`.
   */
  handleError(error, query, context) {
    let errorMessage = error.message || 'Sorry, I encountered an error. Please try again.';
    let errorType = 'UNKNOWN_ERROR';

    if (!navigator.onLine) {
      errorMessage = 'No internet connection. Your query has been saved and will be sent when you\'re back online.';
      errorType = 'OFFLINE_ERROR';
    } else if (error.name === 'TimeoutError' || (error.message && error.message.includes('timed out'))) {
      errorMessage = 'Request timed out. Please check your internet connection and try again.';
      errorType = 'TIMEOUT_ERROR';
    } else if (error.status === 429) {
      errorMessage = 'Too many requests. Please wait a moment and try again.';
      errorType = 'RATE_LIMIT_ERROR';
    } else if (error.status === 400) {
      errorType = 'VALIDATION_ERROR';
    } else if (error.status >= 500) {
      errorType = 'SERVER_ERROR';
    }

    return {
      success: false,
      error: errorMessage,
      errorType: errorType,
      query: query,
      context: context,
      timestamp: new Date().toISOString()
    };
  }


  /**
   * Track analytics events
   */
  trackAnalytics(event) {
    try {
      // Store in localStorage for now (can be sent to analytics service later)
      const analytics = JSON.parse(localStorage.getItem('teacherCoachingAnalytics') || '[]');
      analytics.push(event);
      
      // Keep only last 100 events
      if (analytics.length > 100) {
        analytics.shift();
      }
      
      localStorage.setItem('teacherCoachingAnalytics', JSON.stringify(analytics));
    } catch (error) {
      console.error('Analytics tracking error:', error);
    }
  }

  /**
   * Utility: Delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get analytics summary
   */
  getAnalyticsSummary() {
    try {
      const analytics = JSON.parse(localStorage.getItem('teacherCoachingAnalytics') || '[]');
      
      const summary = {
        totalQueries: analytics.filter(e => e.event === CONFIG.ANALYTICS.QUERY_SUBMITTED).length,
        totalResponses: analytics.filter(e => e.event === CONFIG.ANALYTICS.RESPONSE_RECEIVED).length,
        voiceUsage: analytics.filter(e => e.event === CONFIG.ANALYTICS.VOICE_USED).length,
        offlineQueries: analytics.filter(e => e.event === CONFIG.ANALYTICS.OFFLINE_QUERY).length,
        averageResponseTime: this.calculateAverageResponseTime(analytics),
        languageDistribution: this.getLanguageDistribution(analytics),
        topIssueTypes: this.getTopIssueTypes(analytics)
      };

      return summary;
    } catch (error) {
      console.error('Error generating analytics summary:', error);
      return null;
    }
  }

  calculateAverageResponseTime(analytics) {
    const responses = analytics.filter(e => e.event === CONFIG.ANALYTICS.RESPONSE_RECEIVED && e.responseTime);
    if (responses.length === 0) return 0;
    const total = responses.reduce((sum, e) => sum + e.responseTime, 0);
    return Math.round(total / responses.length);
  }

  getLanguageDistribution(analytics) {
    const distribution = {};
    analytics.forEach(e => {
      if (e.language) {
        distribution[e.language] = (distribution[e.language] || 0) + 1;
      }
    });
    return distribution;
  }

  getTopIssueTypes(analytics) {
    const issueTypes = {};
    analytics.forEach(e => {
      if (e.context && e.context.issueType) {
        issueTypes[e.context.issueType] = (issueTypes[e.context.issueType] || 0) + 1;
      }
    });
    return Object.entries(issueTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));
  }
}

// Create singleton instance
const aiService = new AIService();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIService;
}
