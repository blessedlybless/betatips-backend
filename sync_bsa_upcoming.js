const { createClient } = require('@supabase/supabase-js');
const { getMatches, COMPETITIONS } = require('./football_data_service');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function syncBSA() {
  console.log('=== SYNCING BRAZILIAN SERIE A UPCOMING FIXTURES ===');
  console.log();

  const today = new Date().toISOString().split('T')[0];
  const future = new Date();
  future.setDate(future.getDate() + 14);
  const futureStr = future.toISOString().split('T')[0];

  console.log('Fetching BSA fixtures from ' + today + ' to ' + futureStr + '...');

  try {
    const matchesData = await getMatches('BSA', 'SCHEDULED', today, futureStr);
    const matches = matchesData.matches || [];

    console.log('Found ' + matches.length + ' upcoming matches');
    console.log();

    if (matches.length === 0) {
      console.log('No upcoming matches found. Trying broader search...');
      const allData = await getMatches('BSA', null, today, futureStr);
      const allMatches = allData.matches || [];
      console.log('Found ' + allMatches.length + ' total matches (any status)');

      const scheduled = allMatches.filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED');
      console.log('Of which ' + scheduled.length + ' are scheduled/timed');

      if (scheduled.length === 0) {
        console.log();
        console.log('No upcoming BSA fixtures available from API right now.');
        console.log('This could mean:');
        console.log('  - The API does not have 2026 season data yet');
        console.log('  - The season is on break');
        console.log('  - You need a paid tier for current season data');
        return;
      }
    }

    const fixtures = matches.map(m => ({
      home_team: m.homeTeam.shortName || m.homeTeam.name,
      away_team: m.awayTeam.shortName || m.awayTeam.name,
      match_date: m.utcDate,
      league: COMPETITIONS['BSA'].name,
      status: 'NS',
      home_goals: null,
      away_goals: null,
      home_team_id: m.homeTeam.id,
      away_team_id: m.awayTeam.id,
      competition_code: 'BSA',
      matchday: m.matchday || null,
      season: '2026'
    }));

    const { data, error } = await supabase
      .from('fixtures')
      .upsert(fixtures, { onConflict: 'home_team,away_team,match_date' });

    if (error) {
      console.log('Error saving fixtures:', error.message);
    } else {
      console.log('Saved ' + fixtures.length + ' upcoming BSA fixtures');
      fixtures.forEach(f => {
        console.log('  ' + f.home_team + ' vs ' + f.away_team + ' - ' + f.match_date);
      });
    }

  } catch (err) {
    console.log('API Error:', err.message);
    console.log('This usually means the API does not have current BSA data.');
  }
}

syncBSA().catch(console.error);
