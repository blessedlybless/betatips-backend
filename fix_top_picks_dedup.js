const fs = require('fs');
const path = require('path');

const enginePath = path.join(__dirname, 'prediction_engine_v2.js');

if (!fs.existsSync(enginePath)) {
    console.log('ERROR: prediction_engine_v2.js not found');
    process.exit(1);
}

let content = fs.readFileSync(enginePath, 'utf8');
let changes = 0;

console.log('=== FIXING TOP_PICKS DEDUPLICATION ===\n');

// Strategy: Find where top_picks is built and add deduplication
// We need to find the code that pushes to top_picks and ensure
// each fixture_id only appears once (keeping the highest probability)

// Common patterns for building top_picks:
const patterns = [
    // Pattern 1: top_picks.push({...})
    {
        find: /top_picks\.push\(\{[\s\S]*?\}\)/g,
        strategy: 'wrap_push'
    },
    // Pattern 2: top_picks = allPicks.slice(0, max)
    {
        find: /top_picks\s*=\s*.*\.slice\s*\(\s*0\s*,\s*\w+\s*\)/g,
        strategy: 'slice_dedup'
    },
    // Pattern 3: top_picks = sorted.slice
    {
        find: /top_picks\s*=\s*\w+\.slice\s*\(\s*0\s*,\s*\w+\s*\)/g,
        strategy: 'slice_dedup'
    }
];

// Let's search for the actual top_picks building code
const lines = content.split('\n');
let topPicksSection = [];
let inTopPicksSection = false;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('top_picks') || line.includes('topPicks')) {
        inTopPicksSection = true;
    }
    if (inTopPicksSection) {
        topPicksSection.push(`${i + 1}: ${line}`);
        if (line.trim() === '' || line.trim() === '}' || line.trim() === '];') {
            inTopPicksSection = false;
        }
    }
}

if (topPicksSection.length > 0) {
    console.log('Found top_picks references:');
    topPicksSection.forEach(l => console.log(l));
}

// Look for the specific pattern where top_picks gets its final value
// and add deduplication after it

// Find: return { top_picks, ... } or similar
const returnMatch = content.match(/return\s*\{[\s\S]*?top_picks[\s\S]*?\}/);
if (returnMatch) {
    console.log('\nFound return statement with top_picks');
}

// The safest approach: Add a deduplication helper function and call it
// before returning top_picks

const dedupFunction = `
// DEDUPLICATE TOP PICKS - each fixture appears only once (highest prob)
function deduplicateTopPicks(picks) {
    const seen = new Set();
    return picks.filter(p => {
        if (seen.has(p.fixture_id)) return false;
        seen.add(p.fixture_id);
        return true;
    });
}
`;

// Check if dedup function already exists
if (!content.includes('deduplicateTopPicks')) {
    // Find a good place to insert - after the last function or before module.exports
    const moduleExportIndex = content.indexOf('module.exports');
    const lastFunctionIndex = content.lastIndexOf('function ');

    if (moduleExportIndex !== -1) {
        content = content.slice(0, moduleExportIndex) + dedupFunction + '\n' + content.slice(moduleExportIndex);
        changes++;
        console.log('✅ Added deduplicateTopPicks function');
    } else if (lastFunctionIndex !== -1) {
        // Find end of last function
        const afterLastFunc = content.indexOf('}', lastFunctionIndex);
        if (afterLastFunc !== -1) {
            content = content.slice(0, afterLastFunc + 1) + '\n' + dedupFunction + content.slice(afterLastFunc + 1);
            changes++;
            console.log('✅ Added deduplicateTopPicks function');
        }
    }
} else {
    console.log('ℹ️ deduplicateTopPicks already exists');
}

// Now find where top_picks is returned and wrap it with deduplication
// Pattern: top_picks: top_picks_variable
const topPicksReturnPattern = /(top_picks\s*:\s*)(\w+)/g;
let match;
while ((match = topPicksReturnPattern.exec(content)) !== null) {
    const varName = match[2];
    if (varName !== 'deduplicateTopPicks') {
        // Replace: top_picks: variableName
        // With:    top_picks: deduplicateTopPicks(variableName)
        const oldStr = match[0];
        const newStr = `top_picks: deduplicateTopPicks(${varName})`;

        if (!content.includes(newStr)) {
            content = content.replace(oldStr, newStr);
            changes++;
            console.log(`✅ Wrapped ${varName} with deduplicateTopPicks`);
        }
    }
}

// Also check for direct array literals: top_picks: [ ... ]
const directArrayPattern = /top_picks\s*:\s*\[/g;
if (directArrayPattern.test(content)) {
    console.log('⚠️ Found top_picks: [...] - may need manual deduplication');
}

if (changes > 0) {
    fs.writeFileSync(enginePath, content);
    console.log(`\n✅ Applied ${changes} fix(es)`);
} else {
    console.log('\n⚠️ Could not auto-apply deduplication');
    console.log('Please manually add this before returning top_picks:');
    console.log('  top_picks = top_picks.filter((p, i, arr) => ');
    console.log('    arr.findIndex(t => t.fixture_id === p.fixture_id) === i');
    console.log('  );');
}

console.log('\n=== NEXT STEPS ===');
console.log('1. Restart server: node server_v2.js');
console.log('2. Test: curl http://localhost:3001/api/picks/all');
console.log('3. Each fixture should appear only once in top_picks');