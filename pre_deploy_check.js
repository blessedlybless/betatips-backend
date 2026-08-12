const fs = require('fs');
const path = require('path');

console.log('=== PRE-DEPLOYMENT CHECK ===\n');

let issues = 0;

// Check 1: package.json exists and has dependencies
const pkgPath = path.join(__dirname, 'package.json');
if (!fs.existsSync(pkgPath)) {
    console.log('❌ package.json NOT FOUND');
    issues++;
} else {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = Object.keys(pkg.dependencies || {});
    console.log('✅ package.json found');
    console.log('   Dependencies:', deps.join(', '));

    const required = ['express', 'cors', '@supabase/supabase-js', 'axios', 'dotenv'];
    const missing = required.filter(d => !deps.includes(d));
    if (missing.length > 0) {
        console.log('❌ Missing dependencies:', missing.join(', '));
        console.log('   Run: npm install ' + missing.join(' '));
        issues++;
    } else {
        console.log('✅ All required dependencies present');
    }
}

// Check 2: server_v2.js uses process.env.PORT
const serverPath = path.join(__dirname, 'server_v2.js');
if (!fs.existsSync(serverPath)) {
    console.log('❌ server_v2.js NOT FOUND');
    issues++;
} else {
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    if (serverCode.includes('process.env.PORT')) {
        console.log('✅ server_v2.js uses process.env.PORT');
    } else {
        console.log('⚠️ server_v2.js may not use process.env.PORT');
        console.log('   Make sure it has: const PORT = process.env.PORT || 3001;');
    }

    if (serverCode.includes('cors')) {
        console.log('✅ CORS is configured');
    } else {
        console.log('❌ CORS not found in server_v2.js');
        issues++;
    }
}

// Check 3: .env file exists
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
    console.log('⚠️ .env file not found (you will need env vars on Render)');
} else {
    console.log('✅ .env file found');
}

// Check 4: prediction_engine_v2.js exists
const enginePath = path.join(__dirname, 'prediction_engine_v2.js');
if (!fs.existsSync(enginePath)) {
    console.log('❌ prediction_engine_v2.js NOT FOUND');
    issues++;
} else {
    console.log('✅ prediction_engine_v2.js found');
}

// Check 5: Check for season filter
if (fs.existsSync(enginePath)) {
    const engineCode = fs.readFileSync(enginePath, 'utf8');
    if (engineCode.includes(".eq('season', '2026')")) {
        console.log('✅ Season filter (2026) is present');
    } else {
        console.log('⚠️ Season filter may be missing - run MASTER_FIX.js first');
    }
}

console.log('\n=== RESULT ===');
if (issues === 0) {
    console.log('✅ READY FOR DEPLOYMENT');
    console.log('\nNext steps:');
    console.log('  1. Push to GitHub');
    console.log('  2. Go to https://dashboard.render.com');
    console.log('  3. New Web Service -> Connect repo');
    console.log('  4. Add environment variables');
    console.log('  5. Deploy!');
} else {
    console.log(`❌ ${issues} issue(s) found. Fix before deploying.`);
}