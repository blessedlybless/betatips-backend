const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function diagnose() {
  console.log('=== DATABASE DIAGNOSTIC ===\n');

  // Check team_stats
  const { data: teams } = await supabase.from('team_stats').select('*');
  console.log('Team Stats:');
  console.log('  Total teams:', teams?.length || 0);
  if (teams && teams.length > 0) {
    const comps = [...new Set(teams.map(t => t.competition))];
    console.log('  Competitions:', comps.join(', '));
    console.log('  Sample team:', teams[0].team_name, '-', teams[0].competition, '-', teams[0].data_source);
  }

  // Check fixtures
  const { data: fixtures } = await supabase.from('fixtures').select('*');
  console.log('\nFixtures:');
  console.log('  Total fixtures:', fixtures?.length || 0);
  if (fixtures && fixtures.length > 0) {
    const comps = [...new Set(fixtures.map(f => f.competition_code))];
    console.log('  Competition codes:', comps.join(', '));
    const plFixtures = fixtures.filter(f => f.competition_code === 'PL');
    console.log('  PL fixtures:', plFixtures.length);
    if (plFixtures.length > 0) {
      console.log('  Sample PL fixture:', plFixtures[0].home_team, 'vs', plFixtures[0].away_team);
    }
  }

  // Check predictions
  const { data: predictions } = await supabase.from('predictions').select('*');
  console.log('\nPredictions:', predictions?.length || 0);

  // Check prediction_results
  const { data: results } = await supabase.from('prediction_results').select('*');
  console.log('Prediction Results:', results?.length || 0);
}

diagnose().catch(console.error);
