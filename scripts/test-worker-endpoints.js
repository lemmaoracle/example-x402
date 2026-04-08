/**
 * HTTP test script for worker endpoints.
 * 
 * Tests the AI detection and redirection endpoints.
 * Run with: node test-worker-endpoints.js
 */

import fetch from 'node-fetch';

// Configuration
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const TEST_SLUG = 'test-ai-redirection';

// Test cases
const testCases = [
  {
    name: 'Human Browser (Chrome)',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    expectedAI: false,
  },
  {
    name: 'OpenAI GPTBot',
    headers: {
      'User-Agent': 'GPTBot/1.0 (+https://openai.com/gptbot)',
    },
    expectedAI: true,
  },
  {
    name: 'Claude Web',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Claude-Web/1.0; Anthropic)',
    },
    expectedAI: true,
  },
  {
    name: 'AI via Header (X-Requested-With)',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'AI',
    },
    expectedAI: true,
  },
  {
    name: 'AI via Header (Sec-Purpose)',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Sec-Purpose': 'fetch',
    },
    expectedAI: true,
  },
];

async function runTest(testCase) {
  console.log(`\n=== Testing: ${testCase.name} ===`);
  console.log(`Headers: ${JSON.stringify(testCase.headers, null, 2)}`);
  
  try {
    // Test 1: AI content endpoint
    const aiContentUrl = `${WORKER_URL}/ai-content/${TEST_SLUG}`;
    console.log(`\n1. Testing GET ${aiContentUrl}`);
    
    const response = await fetch(aiContentUrl, {
      headers: testCase.headers,
    });
    
    const data = await response.json();
    
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(data, null, 2)}`);
    
    // Analyze response
    const detectedAI = data.message && data.message.includes('AI detected');
    console.log(`AI Detected: ${detectedAI} (Expected: ${testCase.expectedAI})`);
    
    if (detectedAI === testCase.expectedAI) {
      console.log('✅ Test PASSED');
    } else {
      console.log('❌ Test FAILED');
    }
    
    // Test 2: Health endpoint
    console.log(`\n2. Testing GET ${WORKER_URL}/`);
    const healthResponse = await fetch(WORKER_URL, {
      headers: testCase.headers,
    });
    
    const healthData = await healthResponse.json();
    console.log(`Health Status: ${healthResponse.status}`);
    console.log(`Service: ${healthData.service}`);
    
    if (healthData.endpoints) {
      console.log('✅ Health endpoint working correctly');
    }
    
  } catch (error) {
    console.error(`❌ Test error: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      console.error('Worker not running. Start it with:');
      console.error('cd packages/worker && npx wrangler dev');
    }
  }
}

async function runAllTests() {
  console.log('=== Worker Endpoint Tests ===');
  console.log(`Worker URL: ${WORKER_URL}`);
  console.log(`Test Slug: ${TEST_SLUG}`);
  console.log('\nNote: The worker must be running for these tests to work.');
  console.log('Start it with: cd packages/worker && npx wrangler dev\n');
  
  for (const testCase of testCases) {
    await runTest(testCase);
  }
  
  console.log('\n=== Summary ===');
  console.log('These tests verify:');
  console.log('1. AI detection based on User-Agent and headers');
  console.log('2. Proper redirection/responses for AI vs Human');
  console.log('3. Health endpoint functionality');
  console.log('\nFor a complete test, also test the payment flow:');
  console.log('1. Deploy the worker to Cloudflare');
  console.log('2. Run the agent script with AGENT_PRIVATE_KEY');
  console.log('3. Verify payment and content delivery');
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}

export { runAllTests, testCases };