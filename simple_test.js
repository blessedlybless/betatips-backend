const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

console.log('=== SIMPLE PREDICTION TEST ===\n');

async function test() {
  // Get first upcoming fixture
  const { data: fixtures } = await supabase
    .from('fixtures')
    .select('*')
    .eq('status', 'NS')
    .gte('match_date', new Date().toISOString())
    .order('match_date', { ascending: true })
    .limit(1);

  if (!fixtures || fixtures.length === 0) {
    console.log('No upcoming fixtures.');
    return;
  }

  const f = fixtures[0];
  console.log(`Fixture: ${f.home_team} vs ${f.away_team} (${f.competition_code})`);
  console.log(`Date: ${f.match_date}`);

  // Test 1: Simple query (should be instant)
  console.log('\nTest 1: Simple team query...');
  const t1 = Date.now();
  const { data: homeMatches } = await supabase
    .from('fixtures')
    .select('*')
    .eq('status', 'FT')
    .or(`home_team.ilike.%${f.home_team}%,away_team.ilike.%${f.home_team}%`)
    .order('match_date', { ascending: false })
    .limit(20);
  console.log(`   ✅ ${homeMatches?.length || 0} matches in ${Date.now() - t1}ms`);

  // Test 2: Try to load and call the prediction engine
  console.log('\nTest 2: Loading prediction engine...');
  const t2 = Date.now();
  try {
    delete require.cache[require.resolve('./prediction_engine_v2.js')];
    const engine = require('./prediction_engine_v2.js');
    console.log(`   ✅ Loaded in ${Date.now() - t2}ms`);
    console.log('   Exports:', Object.keys(engine).join(', '));

    // Try calling predictMatch if it exists
    if (engine.predictMatch) {
      console.log('\nTest 3: Calling predictMatch...');
      const t3 = Date.now();
      const result = await engine.predictMatch(f);
      console.log(`   ✅ Done in ${Date.now() - t3}ms`);
      console.log('   Result:', JSON.stringify(result, null, 2).substring(0, 300));
    } else {
      console.log('   ⚠️ No predictMatch function found');
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    console.log(err.stack);
  }
}

test().catch(console.error);