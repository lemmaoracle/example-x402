#!/usr/bin/env -S npx tsx
/**
 * Register example-x402 circuit with Lemma
 * 
 * TypeScript version for example-x402 integration
 */

import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';

// Load environment variables
dotenv.config();

const LEMMA_API_KEY = process.env.LEMMA_API_KEY;
const LEMMA_API_URL = 'https://api.lemma.oracle.com';

if (!LEMMA_API_KEY) {
  console.error('❌ Missing required environment variable: LEMMA_API_KEY');
  process.exit(1);
}

async function registerExampleCircuit() {
  console.log('🚀 Registering example-x402 circuit with Lemma...\n');
  
  try {
    // Circuit details for example-x402
    const circuitId = 'example-circuit-v1.2';
    const schemaId = 'blog-article-v1';
    
    // Note: These would be actual IPFS hashes from build
    const wasmIpfsUrl = 'ipfs://QmPipdcWcx7CFXfQDGKpMSJRPyRpcLt4Yqfs1VgvvQ664h'; // From actual build
    const zkeyIpfsUrl = 'ipfs://QmWoHWvBKFgYTEZHGGQWK36EMjzcJVycabqmqTKshL3vgT'; // From actual build
    const verifierAddress = '0x354cc716ffc02F57Ff7B0bDd465E9C7f12b785E9'; // Actual deployed verifier
    
    console.log('1. Preparing circuit registration...');
    const circuitData = {
      circuitId: circuitId,
      schema: schemaId,
      verifier: verifierAddress,
      wasmIpfsUrl: wasmIpfsUrl,
      zkeyIpfsUrl: zkeyIpfsUrl,
      description: 'Example circuit for blog article attributes with actual verifier',
      metadata: {
        network: 'monad-testnet',
        chainId: 10143,
        version: '1.2',
        example: true,
        integration: 'lemma-x402-demo'
      }
    };
    
    console.log('   📝 Circuit:', JSON.stringify(circuitData, null, 2));
    
    console.log('2. Calling Lemma API...');
    const response = await fetch(`${LEMMA_API_URL}/api/v1/circuits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LEMMA_API_KEY}`
      },
      body: JSON.stringify(circuitData)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API error ${response.status}: ${response.statusText} - ${JSON.stringify(errorData)}`);
    }
    
    const registeredCircuit = await response.json();
    
    console.log('   ✅ Registered:', registeredCircuit.circuitId);
    console.log('   🔗 Verifier:', registeredCircuit.verifier);
    console.log('   📦 WASM IPFS:', registeredCircuit.wasmIpfsUrl);
    
    console.log('\n🎉 Example circuit registered successfully!');
    console.log('\n📋 Integration ready:');
    console.log(`   - Circuit: ${circuitId}`);
    console.log(`   - Schema: ${schemaId}`);
    console.log(`   - Verifier: ${verifierAddress}`);
    
  } catch (error: any) {
    console.error('❌ Error registering circuit:', error.message);
    
    // Check if circuit already exists
    if (error.message.includes('409') || error.message.includes('already exists')) {
      console.log('\nℹ️  Circuit may already be registered. Checking...');
      try {
        const checkResponse = await fetch(`${LEMMA_API_URL}/api/v1/circuits/example-circuit-v1.2`, {
          headers: {
            'Authorization': `Bearer ${LEMMA_API_KEY}`
          }
        });
        
        if (checkResponse.ok) {
          const existingCircuit = await checkResponse.json();
          console.log('   ✅ Circuit already exists:', existingCircuit.circuitId);
          console.log('   🔗 Existing verifier:', existingCircuit.verifier);
        }
      } catch (checkError) {
        console.error('   ❌ Circuit check failed:', checkError);
      }
    }
    
    process.exit(1);
  }
}

// Main execution
registerExampleCircuit();