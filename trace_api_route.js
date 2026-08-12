const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

console.log('=== TRACING /api/picks/all ROUTE ===\n');

async function traceRoute() {
  const totalStart = Date.now();

  // Step 1: Get upcoming fixtures (this is what the API does first)
  console.log('Step 1: Fetching upcoming fixtures...');
  const s1 = Date.now();
  const now = new Date().toISOString();
  const { data: fixtures, error: fErr } = await supabase
    .from('fixtures')
    .select('*')
    .eq('status', 'NS')
    .gte('match_date', now)
    .order('match_date', { ascending: true });

  if (fErr) {
    console.log('   ❌ Error:', fErr.message);
    return;
  }
  console.log(`   ✅ Found ${fixtures?.length || 0} fixtures (${Date.now() - s1}ms)`);

  if (!fixtures || fixtures.length === 0) {
    console.log('\n   No fixtures to predict. Route would return empty.');
    return;
  }

  // Step 2: For EACH fixture, the engine calls getTeamRollingStats
  console.log(`\nStep 2: Testing getTeamRollingStats for ${fixtures[0].home_team}...`);
  const s2 = Date.now();

  // This is the EXACT query the engine makes
  const { data: homeMatches, error: hErr } = await supabase
    .from('fixtures')
    .select('*')
    .eq('status', 'FT')
    .or(`home_team.ilike.%${fixtures[0].home_team}%,away_team.ilike.%${fixtures[0].home_team}%`)
    .order('match_date', { ascending: false })
    .limit(20);

  if (hErr) {
    console.log('   ❌ Error:', hErr.message);
  } else {
    console.log(`   ✅ Found ${homeMatches?.length || 0} home matches (${Date.now() - s2}ms)`);
  }

  // Step 3: Check if getTeamHistoricalStats is called (the fallback)
  console.log(`\nStep 3: Testing getTeamHistoricalStats fallback...`);
  const s3 = Date.now();

  // The engine checks: if (allMatches.length < SEASON_TRANSITION_MATCHES)
  // For a team with < 5 matches, it calls getTeamHistoricalStats
  const { data: allStats, error: sErr } = await supabase
    .from('team_stats')
    .select('*')
    .eq('competition', fixtures[0].competition_code)
    .limit(50);

  if (sErr) {
    console.log('   ❌ Error:', sErr.message);
  } else {
    console.log(`   ✅ Found ${allStats?.length || 0} team_stats rows (${Date.now() - s3}ms)`);
  }

  // Step 4: Check if the team_stats rebuild is hanging
  console.log(`\nStep 4: Testing heavy query (team_stats for all teams)...`);
  const s4 = Date.now();
  const { data: allTeamStats, error: allErr } = await supabase
    .from('team_stats')
    .select('*')
    .limit(500);

  if (allErr) {
    console.log('   ❌ Error:', allErr.message);
  } else {
    console.log(`   ✅ Found ${allTeamStats?.length || 0} total stats rows (${Date.now() - s4}ms)`);
  }

  // Step 5: Check league averages query
  console.log(`\nStep 5: Testing league averages query...`);
  const s5 = Date.now();
  const { data: leagueMatches, error: lErr } = await supabase
    .from('fixtures')
    .select('*')
    .eq('competition_code', fixtures[0].competition_code)
    .eq('status', 'FT')
    .order('match_date', { ascending: false })
    .limit(200);

  if (lErr) {
    console.log('   ❌ Error:', lErr.message);
  } else {
    console.log(`   ✅ Found ${leagueMatches?.length || 0} league matches (${Date.now() - s5}ms)`);
  }

  console.log(`\n=== TOTAL: ${Date.now() - totalStart}ms ===`);
  console.log('If total > 10000ms, the database is slow.');
  console.log('If a single step > 5000ms, that query is the problem.');
}

traceRoute().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});