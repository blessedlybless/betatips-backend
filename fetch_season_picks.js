const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const API_BASE = process.env.API_URL || 'http://localhost:3001/api';

async function fetchSeasonPicks() {
  console.log('========================================');
  console.log('  SEASON PICKS FETCHER');
  console.log('========================================');
  console.log();
  console.log('Date: ' + new Date().toISOString().split('T')[0]);
  console.log('API: ' + API_BASE);
  console.log();

  console.log('STEP 1: Checking database for upcoming fixtures...');
  const today = new Date().toISOString();
  const { data: upcomingFixtures, error: fixtureError } = await supabase
    .from('fixtures')
    .select('*')
    .eq('status', 'NS')
    .gte('match_date', today)
    .order('match_date', { ascending: true });

  if (fixtureError) {
    console.log('ERROR Database: ' + fixtureError.message);
    return;
  }

  console.log('  Found ' + (upcomingFixtures ? upcomingFixtures.length : 0) + ' upcoming fixtures in database');

  if (!upcomingFixtures || upcomingFixtures.length === 0) {
    console.log();
    console.log('WARNING: NO UPCOMING FIXTURES FOUND');
    console.log();
    console.log('To get fixtures, run one of:');
    console.log('  1. node sync_bsa_live.js        (sync from API)');
    console.log('  2. node seed_bsa_upcoming.js    (seed test data)');
    console.log();
    console.log('Then run this script again.');
    return;
  }

  const byLeague = {};
  upcomingFixtures.forEach(f => {
    if (!byLeague[f.league]) byLeague[f.league] = [];
    byLeague[f.league].push(f);
  });

  console.log();
  console.log('Fixtures by league:');
  Object.entries(byLeague).forEach(([league, matches]) => {
    console.log('  ' + league + ': ' + matches.length + ' matches');
  });

  console.log();
  console.log('STEP 2: Fetching predictions from API...');

  try {
    const res = await axios.get(API_BASE + '/picks/all', { timeout: 30000 });
    const data = res.data;

    console.log('  API responded successfully');
    console.log();

    console.log('========================================');
    console.log('  TODAY PICKS');
    console.log('  ' + data.date + (data.is_weekend ? ' (WEEKEND)' : ''));
    console.log('========================================');
    console.log();

    if (data.top_picks && data.top_picks.length > 0) {
      console.log('TOP PICKS (Ranked):');
      console.log();
      data.top_picks.forEach((pick, i) => {
        const crown = i === 0 ? 'CROWN ' : '';
        console.log('  ' + crown + '#' + pick.rank + ' ' + pick.match);
        console.log('     Pick: ' + pick.pick);
        console.log('     Probability: ' + (pick.probability * 100).toFixed(1) + '% (' + pick.confidence + ')');
        console.log('     League: ' + pick.league);
        console.log();
      });
    } else {
      console.log('No top picks available');
    }

    if (data.all_predictions && data.all_predictions.length > 0) {
      console.log('ALL MATCHES:');
      console.log();

      const withPicks = data.all_predictions.filter(p => p.status === 'PICK');
      const noPicks = data.all_predictions.filter(p => p.status !== 'PICK');

      console.log('  With Picks: ' + withPicks.length);
      withPicks.forEach(p => {
        const bp = p.best_pick;
        console.log('    PASS ' + p.match + ' -> ' + bp.market + ' @ ' + (bp.probability * 100).toFixed(0) + '%');
      });

      if (noPicks.length > 0) {
        console.log();
        console.log('  No Pick: ' + noPicks.length);
        noPicks.forEach(p => {
          console.log('    FAIL ' + p.match + ' -> ' + p.reasoning.substring(0, 60) + '...');
        });
      }
    }

    console.log();
    console.log('----------------------------------------');
    console.log('Summary:');
    console.log('  Total matches: ' + data.total_found);
    console.log('  Qualified picks: ' + (data.total_qualified || 0));
    console.log('  Max picks today: ' + data.max_picks);
    console.log('  Is weekend: ' + (data.is_weekend ? 'Yes' : 'No'));
    console.log('----------------------------------------');

    console.log();
    console.log('STEP 3: Testing individual match prediction...');
    if (upcomingFixtures.length > 0) {
      const testMatch = upcomingFixtures[0];
      console.log('  Testing: ' + testMatch.home_team + ' vs ' + testMatch.away_team);

      try {
        const predRes = await axios.post(API_BASE + '/predict', {
          home_team: testMatch.home_team,
          away_team: testMatch.away_team,
          competition: testMatch.competition_code || 'BSA'
        }, { timeout: 15000 });

        const pred = predRes.data;
        console.log('  Prediction received');
        console.log('     Status: ' + pred.status);
        console.log('     Data Quality: ' + pred.data_quality + '%');
        if (pred.best_pick) {
          console.log('     Best Pick: ' + pred.best_pick.market + ' @ ' + (pred.best_pick.probability * 100).toFixed(1) + '%');
        }
      } catch (predErr) {
        console.log('  Prediction failed: ' + predErr.message);
      }
    }

  } catch (err) {
    console.log();
    console.log('ERROR API: ' + err.message);
    if (err.code === 'ECONNREFUSED') {
      console.log('   Make sure the backend server is running:');
      console.log('   node server_v2.js');
    }
  }

  console.log();
  console.log('========================================');
  console.log('Done!');
  console.log('========================================');
}

async function checkCompetitionStatus() {
  console.log();
  console.log('COMPETITION STATUS CHECK:');
  console.log();

  for (const code of ['BSA', 'PL', 'PD', 'BL1', 'SA', 'FL1']) {
    const { count: finishedCount } = await supabase
      .from('fixtures')
      .select('*', { count: 'exact', head: true })
      .eq('competition_code', code)
      .eq('status', 'FT');

    const { count: upcomingCount } = await supabase
      .from('fixtures')
      .select('*', { count: 'exact', head: true })
      .eq('competition_code', code)
      .eq('status', 'NS')
      .gte('match_date', new Date().toISOString());

    const status = finishedCount > 20 ? 'READY' : finishedCount > 0 ? 'LOW DATA' : 'NO DATA';
    console.log('  ' + code + ': ' + status + ' (' + (finishedCount || 0) + ' finished, ' + (upcomingCount || 0) + ' upcoming)');
  }
}

fetchSeasonPicks().then(() => {
  return checkCompetitionStatus();
}).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});