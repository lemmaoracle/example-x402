/**
 * AI Redirect Script for Blog Integration
 * 
 * Add this script to your blog pages to detect AI agents and redirect them
 * to the Lemma x402 worker for paid access to verified content.
 * 
 * Usage:
 * 1. Replace `WORKER_URL` with your deployed worker URL
 * 2. Add this script to your blog template (before </body>)
 * 3. Ensure `currentSlug` variable is set to the current article slug
 */

(function() {
  // Configuration
  const WORKER_URL = 'https://lemma-query.your-subdomain.workers.dev';
  const currentSlug = window.currentSlug || 
                     document.querySelector('meta[property="article:slug"]')?.content ||
                     window.location.pathname.split('/').pop().replace(/\.html$/, '');
  
  // AI User-Agent detection patterns
  const aiPatterns = [
    'OpenAI', 'Claude', 'GPT', 'ChatGPT', 'Bard', 'Gemini',
    'Cohere', 'Anthropic', 'AI', 'LLM', 'Language-Model',
    'Agent', 'Crawler', 'Bot', 'Scraper'
  ];
  
  // Check if current user is an AI agent
  function isAIAgent() {
    const userAgent = navigator.userAgent || '';
    return aiPatterns.some(pattern => 
      userAgent.toLowerCase().includes(pattern.toLowerCase())
    );
  }
  
  // Main function
  function initAIRedirect() {
    if (!isAIAgent()) {
      console.log('Human user detected. No redirect needed.');
      return;
    }
    
    console.log('AI agent detected. Redirecting to verified content gateway...');
    
    // Show a notification to human users (optional)
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: #f0f0f0;
      border: 1px solid #ccc;
      padding: 10px;
      border-radius: 4px;
      z-index: 10000;
      font-size: 12px;
      max-width: 300px;
    `;
    notification.innerHTML = `
      <strong>AI Agent Detected</strong><br>
      Redirecting to verified content gateway...
    `;
    document.body.appendChild(notification);
    
    // Redirect to worker AI endpoint
    setTimeout(() => {
      window.location.href = `${WORKER_URL}/ai-content/${encodeURIComponent(currentSlug)}`;
    }, 1000); // Small delay for UX
  }
  
  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAIRedirect);
  } else {
    initAIRedirect();
  }
})();