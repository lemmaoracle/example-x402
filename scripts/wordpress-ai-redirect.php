<?php
/**
 * Plugin Name: Lemma AI Redirect
 * Plugin URI: https://github.com/lemmaoracle/example-x402
 * Description: Redirect AI agents to Lemma x402 worker for paid access to verified content.
 * Version: 1.0.0
 * Author: Lemma Oracle
 * License: MIT
 */

defined('ABSPATH') or die('Direct access not allowed.');

class Lemma_AI_Redirect {
    
    private $worker_url = 'https://lemma-query.your-subdomain.workers.dev';
    
    /**
     * Constructor
     */
    public function __construct() {
        add_action('template_redirect', [$this, 'maybe_redirect_ai']);
        add_action('wp_footer', [$this, 'add_ai_detection_script']);
    }
    
    /**
     * Check if request is from AI agent
     */
    private function is_ai_agent() {
        $user_agent = $_SERVER['HTTP_USER_AGENT'] ?? '';
        $patterns = [
            'OpenAI', 'Claude', 'GPT', 'ChatGPT', 'Bard', 'Gemini',
            'Cohere', 'Anthropic', 'AI', 'LLM', 'Language-Model',
            'Agent', 'Crawler', 'Bot', 'Scraper'
        ];
        
        foreach ($patterns as $pattern) {
            if (stripos($user_agent, $pattern) !== false) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Redirect AI agents to worker endpoint
     */
    public function maybe_redirect_ai() {
        if (!$this->is_ai_agent() || !is_single()) {
            return;
        }
        
        $post_id = get_the_ID();
        $slug = get_post_field('post_name', $post_id);
        
        // Build redirect URL
        $redirect_url = $this->worker_url . '/ai-content/' . urlencode($slug);
        
        // Add query parameters for metadata
        $redirect_url = add_query_arg([
            'title' => urlencode(get_the_title()),
            'author' => urlencode(get_the_author_meta('display_name')),
            'published' => get_the_date('Y-m-d'),
        ], $redirect_url);
        
        // Redirect with 302 Found
        wp_redirect($redirect_url, 302);
        exit;
    }
    
    /**
     * Add JavaScript detection as fallback
     */
    public function add_ai_detection_script() {
        if (!is_single()) {
            return;
        }
        
        $post_id = get_the_ID();
        $slug = get_post_field('post_name', $post_id);
        $worker_url = $this->worker_url;
        
        ?>
        <script>
        (function() {
            // AI User-Agent detection patterns
            const aiPatterns = [
                'OpenAI', 'Claude', 'GPT', 'ChatGPT', 'Bard', 'Gemini',
                'Cohere', 'Anthropic', 'AI', 'LLM', 'Language-Model',
                'Agent', 'Crawler', 'Bot', 'Scraper'
            ];
            
            function isAIAgent() {
                const userAgent = navigator.userAgent || '';
                return aiPatterns.some(pattern => 
                    userAgent.toLowerCase().includes(pattern.toLowerCase())
                );
            }
            
            // Check on page load
            if (isAIAgent()) {
                console.log('AI agent detected via JavaScript.');
                
                // Optionally show a message
                const message = document.createElement('div');
                message.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: #fff3cd;
                    border: 1px solid #ffeaa7;
                    padding: 15px;
                    border-radius: 5px;
                    z-index: 10000;
                    max-width: 300px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                `;
                message.innerHTML = `
                    <h4 style="margin-top:0;">AI Agent Detected</h4>
                    <p>For verified, ZK-proven content, visit our <a href="<?php echo esc_url($worker_url); ?>/ai-content/<?php echo esc_js($slug); ?>">verified content gateway</a>.</p>
                `;
                document.body.appendChild(message);
            }
        })();
        </script>
        <?php
    }
    
    /**
     * Get current post slug
     */
    private function get_current_slug() {
        global $post;
        return $post ? $post->post_name : '';
    }
}

// Initialize plugin
new Lemma_AI_Redirect();