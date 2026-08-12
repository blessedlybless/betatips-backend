const axios = require('axios');
const net = require('net');

console.log('=== DIAGNOSING SERVER ===\n');

// Check 1: Is port 3001 open?
console.log('1. Checking if port 3001 is open...');
const client = new net.Socket();
client.setTimeout(3000);

client.connect(3001, 'localhost', () => {
  console.log('   ✅ Port 3001 is OPEN (server is running)');
  client.destroy();

  // If port is open, test the route
  testRoute();
});

client.on('error', (err) => {
  console.log(`   ❌ Port 3001 is CLOSED: ${err.message}`);
  console.log('   The server is NOT running.');
  console.log('   Start it: node server_v2.js');
  client.destroy();
});

client.on('timeout', () => {
  console.log('   ❌ Port 3001 timed out (server may be frozen)');
  client.destroy();
});

// Check 2: Test the route directly
async function testRoute() {
  console.log('\n2. Testing /api/picks/all route...');

  try {
    const res = await axios.get('http://localhost:3001/api/picks/all', {
      timeout: 10000
    });
    console.log(`   ✅ Route responded in ${res.headers['x-response-time'] || 'unknown'}ms`);
    console.log(`   Status: ${res.status}`);
    console.log(`   Picks found: ${res.data?.top_picks?.length || 0}`);
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      console.log('   ❌ Route TIMED OUT after 10 seconds');
      console.log('   The server is stuck processing the request.');
      console.log('   Likely causes:');
      console.log('     - Infinite loop in prediction engine');
      console.log('     - Database query hanging');
      console.log('     - Missing await on async function');
    } else if (err.response) {
      console.log(`   ❌ Route returned error: ${err.response.status}`);
      console.log(`   ${JSON.stringify(err.response.data).substring(0, 200)}`);
    } else {
      console.log(`   ❌ Error: ${err.message}`);
    }
  }
}

// Check 3: Test a simple route
async function testSimpleRoute() {
  console.log('\n3. Testing simple /api/health or / route...');

  try {
    const res = await axios.get('http://localhost:3001/', { timeout: 5000 });
    console.log(`   ✅ Root route works: ${res.status}`);
  } catch (err) {
    console.log(`   ❌ Root route failed: ${err.message}`);
  }
}

setTimeout(() => {
  testSimpleRoute();
}, 5000);