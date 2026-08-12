const { createClient } = require('@supabase/supabase-js');
const { predictMatch } = require('./prediction_engine_v2');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function debugGetAllPicks() {
  console.log('=== TRACING getAllPicks ===');
  console.log();

  // Step 1: Query fixtures exactly like getAllPicks does
  console.log('Step 1: Querying fixtures...');
  const today = new Date().toISOString();
  const { data: fixtures, error } = await supabase
    .from('fixtures')
    .select('*')
    .eq('status', 'NS')
    .gte('match_date', today)
    .order('match_date', { ascending: true });

  if (error) {
    console.log('Query error:', error.message);
    return;
  }

  console.log('Found fixtures:', fixtures ? fixtures.length : 0);
  console.log();

  if (!fixtures || fixtures.length === 0) {
    console.log('No fixtures found - this is the problem!');
    return;
  }

  // Step 2: Try predictMatch on first fixture
  console.log('Step 2: Testing predictMatch on first fixture...');
  const first = fixtures[0];
  console.log('First fixture:', first.home_team, 'vs', first.away_team);
  console.log('Competition:', first.competition_code);

  try {
    const pred = await predictMatch(first.home_team, first.away_team, first.competition_code || 'PL');
    console.log('predictMatch result:');
    console.log('  status:', pred.status);
    console.log('  data_quality:', pred.data_quality);
    console.log('  best_pick:', pred.best_pick ? 'YES' : 'NO');
    console.log('  all_predictions length:', pred.all_predictions ? pred.all_predictions.length : 0);
    console.log('  top_picks length:', pred.top_picks ? pred.top_picks.length : 0);
  } catch (err) {
    console.log('predictMatch ERROR:', err.message);
    console.log(err.stack);
  }

  console.log();

  // Step 3: Try all fixtures
  console.log('Step 3: Processing all fixtures...');
  let successCount = 0;
  let failCount = 0;
  let noPickCount = 0;

  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    try {
      const pred = await predictMatch(f.home_team, f.away_team, f.competition_code || 'PL');
      if (pred.status === 'PICK') {
        successCount++;
      } else {
        noPickCount++;
      }
    } catch (err) {
      failCount++;
      console.log('  ERROR on ' + f.home_team + ' vs ' + f.away_team + ':', err.message);
    }
  }

  console.log('Results:');
  console.log('  PICK:', successCount);
  console.log('  NO_PICK:', noPickCount);
  console.log('  ERROR:', failCount);
}

debugGetAllPicks().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});