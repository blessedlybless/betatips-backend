const fs = require('fs');

console.log('=== CHECKING PREDICTION ENGINE FOR ERRORS ===\n');

const file = 'prediction_engine_v2.js';
if (!fs.existsSync(file)) {
  console.log('❌ File not found:', file);
  process.exit(1);
}

const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

// Check 1: Try to parse as JS (basic syntax check)
console.log('1. Checking for syntax errors...');
try {
  new Function(content);
  console.log('   ✅ No obvious syntax errors');
} catch (err) {
  console.log(`   ❌ Syntax error: ${err.message}`);
  console.log('   This is likely why the server hangs!');
}

// Check 2: Look for common infinite loop patterns
console.log('\n2. Checking for infinite loop patterns...');

let issues = 0;

// Check for while(true) without break
lines.forEach((line, i) => {
  if (line.includes('while (true)') || line.includes('while(true)')) {
    console.log(`   ⚠️ Line ${i+1}: while(true) found - check for break condition`);
    issues++;
  }
});

// Check for for loops with wrong increment
lines.forEach((line, i) => {
  if (line.includes('for (') && line.includes('i++') === false && line.includes('i--') === false && line.includes('++') === false && line.includes('--') === false) {
    console.log(`   ⚠️ Line ${i+1}: for loop without increment: ${line.trim()}`);
    issues++;
  }
});

// Check 3: Look for the specific lines we patched
console.log('\n3. Checking patched lines...');

// Check ROLLING_WINDOW
lines.forEach((line, i) => {
  if (line.includes('ROLLING_WINDOW')) {
    console.log(`   Line ${i+1}: ${line.trim()}`);
  }
});

// Check SEASON_TRANSITION_MATCHES
lines.forEach((line, i) => {
  if (line.includes('SEASON_TRANSITION_MATCHES')) {
    console.log(`   Line ${i+1}: ${line.trim()}`);
  }
});

// Check 4: Look for undefined variables
console.log('\n4. Checking for undefined variable references...');
const definedVars = new Set();
const usedVars = new Set();

lines.forEach((line, i) => {
  // Very rough check for const/let/var declarations
  const declMatch = line.match(/(?:const|let|var)\s+(\w+)/);
  if (declMatch) definedVars.add(declMatch[1]);

  // Check for variable usage (very rough)
  if (line.includes('ROLLING_WINDOW') && !line.includes('const') && !line.includes('let') && !line.includes('var')) {
    if (!definedVars.has('ROLLING_WINDOW')) {
      console.log(`   ⚠️ Line ${i+1}: ROLLING_WINDOW used but may not be defined in scope`);
    }
  }
});

// Check 5: Look for the getTeamRollingStats function (most likely to hang)
console.log('\n5. Checking getTeamRollingStats function...');
let inFunction = false;
let funcStart = -1;
lines.forEach((line, i) => {
  if (line.includes('async function getTeamRollingStats') || line.includes('function getTeamRollingStats')) {
    inFunction = true;
    funcStart = i;
    console.log(`   Function starts at line ${i+1}`);
  }
  if (inFunction && line.trim() === '}' && i > funcStart) {
    console.log(`   Function ends at line ${i+1}`);
    inFunction = false;
  }
});

// Check 6: Look for database query loops
console.log('\n6. Checking for database queries in loops...');
lines.forEach((line, i) => {
  if (line.includes('for (') && lines.slice(i, i+10).some(l => l.includes('supabase') && l.includes('select'))) {
    console.log(`   ⚠️ Line ${i+1}: Database query inside loop - may be slow but not infinite`);
  }
});

console.log(`\n=== SUMMARY ===`);
if (issues === 0) {
  console.log('No obvious infinite loop patterns found.');
  console.log('The hang might be from a slow database query.');
} else {
  console.log(`Found ${issues} potential issues.`);
}
console.log('\nNext: Check server terminal for the actual error message.');