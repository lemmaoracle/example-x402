/**
 * Test script for AI detection and redirection functionality.
 * 
 * This script simulates both human and AI requests to test the
 * AI detection middleware and redirection endpoints.
 */

import { Hono } from 'hono';
import { testClient } from 'hono/testing';

// Import the worker app (we'll create a mock or test version)
// For now, we'll simulate the logic

const AI_USER_AGENTS = [
  'Mozilla/5.0 (compatible; OpenAI-API/1.0; +http://openai.com)',
  'Mozilla/5.0 (compatible; Claude-Web/1.0; Anthropic)',
  'GPTBot/1.0 (+https://openai.com/gptbot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) ChatGPT-User',
  'AI-Crawler/1.0',
  'LLM-Research-Bot/1.0',
];

const HUMAN_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
];

// Simulate the AI detection logic from the worker
function simulateAIDetection(userAgent, xRequestedWith, secPurpose) {
  const aiPatterns = [
    'OpenAI',
    'Claude',
    'GPT',
    'ChatGPT',
    'Bard',
    'Gemini',
    'Cohere',
    'Anthropic',
    'AI',
    'LLM',
    'Language-Model',
    'Agent',
    'Crawler',
    'Bot',
    'Scraper'
  ];
  
  const isAIUserAgent = aiPatterns.some(pattern => 
    (userAgent || '').toLowerCase().includes(pattern.toLowerCase())
  );
  
  return isAIUserAgent || 
         xRequestedWith === 'AI' || 
         secPurpose === 'fetch';
}

// Run tests
console.log('=== AI Detection Test Results ===\n');

// Test AI user agents
console.log('Testing AI User Agents:');
AI_USER_AGENTS.forEach((ua, i) => {
  const isAI = simulateAIDetection(ua, null, null);
  console.log(`${i + 1}. ${ua.substring(0, 60)}... => ${isAI ? '✓ AI DETECTED' : '✗ MISSED'}`);
});

console.log('\nTesting Human User Agents:');
HUMAN_USER_AGENTS.forEach((ua, i) => {
  const isAI = simulateAIDetection(ua, null, null);
  console.log(`${i + 1}. ${ua.substring(0, 60)}... => ${isAI ? '✗ FALSE POSITIVE' : '✓ HUMAN OK'}`);
});

// Test header-based detection
console.log('\nTesting Header-Based Detection:');
const headerTests = [
  { userAgent: 'Mozilla/5.0', xRequestedWith: 'AI', secPurpose: null, expected: true },
  { userAgent: 'Mozilla/5.0', xRequestedWith: null, secPurpose: 'fetch', expected: true },
  { userAgent: 'Mozilla/5.0', xRequestedWith: 'XMLHttpRequest', secPurpose: null, expected: false },
  { userAgent: 'Custom-AI-Bot/1.0', xRequestedWith: null, secPurpose: null, expected: true },
];

headerTests.forEach((test, i) => {
  const isAI = simulateAIDetection(test.userAgent, test.xRequestedWith, test.secPurpose);
  const passed = isAI === test.expected;
  console.log(`${i + 1}. UA: "${test.userAgent}", X-Requested-With: "${test.xRequestedWith}", Sec-Purpose: "${test.secPurpose}" => ${isAI ? 'AI' : 'Human'} (${passed ? '✓ PASS' : '✗ FAIL'})`);
});

// Test redirection logic simulation
console.log('\n=== Redirection Logic Simulation ===');

function simulateRedirection(isAI, slug) {
  if (!isAI) {
    return {
      action: 'redirect',
      target: `https://example-blog.com/${slug}`,
      message: 'Human detected, redirecting to free blog'
    };
  } else {
    return {
      action: 'serve',
      target: `/ai-content/${slug}`,
      message: 'AI detected, serving AI gateway',
      metadata: {
        paymentRequired: true,
        price: '$0.001 USDC',
        endpoint: '/query'
      }
    };
  }
}

const testCases = [
  { type: 'AI', userAgent: AI_USER_AGENTS[0], slug: 'ai-blockchain-future' },
  { type: 'Human', userAgent: HUMAN_USER_AGENTS[0], slug: 'ai-blockchain-future' },
  { type: 'AI with headers', userAgent: 'Mozilla/5.0', xRequestedWith: 'AI', slug: 'zk-proofs-explained' },
];

testCases.forEach((test, i) => {
  const isAI = simulateAIDetection(test.userAgent, test.xRequestedWith, null);
  const result = simulateRedirection(isAI, test.slug);
  console.log(`\nTest ${i + 1} (${test.type}):`);
  console.log(`  User-Agent: ${test.userAgent.substring(0, 40)}...`);
  console.log(`  Detected as: ${isAI ? 'AI' : 'Human'}`);
  console.log(`  Action: ${result.action}`);
  console.log(`  Target: ${result.target}`);
  console.log(`  Message: ${result.message}`);
});

console.log('\n=== Test Summary ===');
console.log('The AI detection system should:');
console.log('1. ✓ Correctly identify known AI/LLM user agents');
console.log('2. ✓ Avoid false positives for common human browsers');
console.log('3. ✓ Respect X-Requested-With: AI header');
console.log('4. ✓ Respect Sec-Purpose: fetch header');
console.log('5. ✓ Redirect humans to free blog access');
console.log('6. ✓ Serve AI agents the payment gateway');

console.log('\n=== Implementation Notes ===');
console.log('For production use, consider:');
console.log('1. Adding more AI patterns as new AI agents emerge');
console.log('2. Implementing rate limiting for AI endpoints');
console.log('3. Adding CAPTCHA or proof-of-work for suspicious patterns');
console.log('4. Logging detection results for continuous improvement');
console.log('5. Providing clear error messages for false positives');