const fs = require('fs');

const file = 'server_v2.js';
if (!fs.existsSync(file)) {
  console.log('❌ server_v2.js not found');
  process.exit(1);
}

let content = fs.readFileSync(file, 'utf8');

console.log('=== ADDING PREDICTION CACHE ===\n');

let changes = 0;

// Step 1: Add cache variables near the top (after requires)
const cacheCode = `// Prediction cache - prevents re-computing on every request
const predictionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedPredictions() {
  const key = 'all_picks_' + new Date().toDateString();
  const cached = predictionCache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    console.log('\u2705 Returning cached predictions');
    return cached.data;
  }
  return null;
}

function setCachedPredictions(data) {
  const key = 'all_picks_' + new Date().toDateString();
  predictionCache.set(key, { data, time: Date.now() });
  console.log('\u2705 Predictions cached for 5 minutes');
}
`;

// Find a good place to insert (after the last require)
const lastRequire = content.lastIndexOf("require(");
const lastRequireEnd = content.indexOf(';', lastRequire) + 1;
const insertPoint = content.indexOf('\n', lastRequireEnd) + 1;

if (!content.includes('predictionCache')) {
  content = content.slice(0, insertPoint) + '\n' + cacheCode + '\n' + content.slice(insertPoint);
  console.log('✅ Added prediction cache variables');
  changes++;
} else {
  console.log('ℹ️ Cache variables already exist');
}

// Step 2: Wrap the /api/picks/all route with cache
// Find the route handler
const routePattern = /app\.get\(['"]\/api\/picks\/all['"]/;
if (routePattern.test(content)) {
  // Find the route handler body
  const routeStart = content.search(routePattern);
  const asyncStart = content.indexOf('async', routeStart);
  const funcStart = content.indexOf('(', asyncStart);

  // Look for the opening brace of the route handler
  let braceCount = 0;
  let routeBodyStart = -1;
  for (let i = funcStart; i < content.length; i++) {
    if (content[i] === '{') {
      if (braceCount === 0) routeBodyStart = i + 1;
      braceCount++;
    }
    if (content[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        // Found the end of route handler
        const routeBodyEnd = i;

        // Insert cache check at the beginning of route body
        const cacheCheck = `\n  // Check cache first\n  const cached = getCachedPredictions();\n  if (cached) {\n    return res.json(cached);\n  }\n`;

        // Insert cache set before res.json
        const oldBody = content.slice(routeBodyStart, routeBodyEnd);

        // Find the final res.json and wrap it with cache set
        const resJsonPattern = /res\.json\(([^)]+)\)/;
        const newBody = oldBody.replace(resJsonPattern, (match, p1) => {
          return `setCachedPredictions(${p1});\n    ${match}`;
        });

        if (newBody !== oldBody) {
          content = content.slice(0, routeBodyStart) + cacheCheck + newBody + content.slice(routeBodyEnd);
          console.log('✅ Added cache to /api/picks/all route');
          changes++;
        }
        break;
      }
    }
  }
}

// Step 3: Also add cache to individual match prediction if it exists
const matchRoutePattern = /app\.get\(['"]\/api\/predictions\/match\/[0-9]+['"]/;
if (matchRoutePattern.test(content) && !content.includes('getCachedPredictions')) {
  console.log('ℹ️ Individual match route found but cache not added (may need manual)');
}

if (changes > 0) {
  fs.writeFileSync(file, content);
  console.log(`\n✅ Applied ${changes} cache patches`);
  console.log('\nAfter this fix:');
  console.log('  - First request: Computes all predictions (~3-4 minutes)');
  console.log('  - Next requests: Returns cached result instantly (< 100ms)');
  console.log('  - Cache expires after 5 minutes or on new day');
} else {
  console.log('\n⚠️ No changes applied - cache may already exist');
}

console.log('\nRestart server: node server_v2.js');