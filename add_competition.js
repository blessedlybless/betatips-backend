const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

// Competition codes supported by your free tier
const COMPETITIONS = {
  'BSA': { id: 2013, name: 'Campeonato Brasileiro Série A' },
  'PL':  { id: 2021, name: 'Premier League' },
  'PD':  { id: 2014, name: 'Primera Division' },
  'BL1': { id: 2002, name: 'Bundesliga' },
  'SA':  { id: 2019, name: 'Serie A' },
  'FL1': { id: 2015, name: 'Ligue 1' },
  'DED': { id: 2003, name: 'Eredivisie' },
  'PPL': { id: 2017, name: 'Primeira Liga' },
  'ELC': { id: 2016, name: 'Championship' }
};

async function addCompetition(code) {
  const comp = COMPETITIONS[code];
  if (!comp) {
    console.log('ERROR: Unknown code ' + code);
    console.log('Supported codes:', Object.keys(COMPETITIONS).join(', '));
    return;
  }

  console.log('========================================');
  console.log('  ADDING COMPETITION: ' + comp.name);
  console.log('  Code: ' + code);
  console.log('========================================');
  console.log();

  // Step 1: Check if we have historical data
  console.log('Step 1: Checking database...');
  const { count, error } = await supabase
    .from('fixtures')
    .select('*', { count: 'exact', head: true })
    .eq('competition_code', code)
    .eq('status', 'FT');

  if (error) {
    console.log('Database error:', error.message);
    return;
  }

  console.log('  Finished matches in database:', count || 0);
  console.log();

  // Step 2: Sync upcoming fixtures
  console.log('Step 2: Syncing upcoming fixtures from API...');

  const today = new Date().toISOString().split('T')[0];
  const future = new Date();
  future.setDate(future.getDate() + 14);
  const futureStr = future.toISOString().split('T')[0];

  try {
    const url = `https://api.football-data.org/v4/competitions/${comp.id}/matches`;
    const response = await axios.get(url, {
      headers: { 'X-Auth-Token': API_KEY },
      params: { dateFrom: today, dateTo: futureStr, status: 'SCHEDULED' },
      timeout: 15000
    });

    const matches = response.data.matches || [];
    const now = new Date();
    const upcoming = matches.filter(m => new Date(m.utcDate) >= now);

    console.log('  API returned:', matches.length, 'total');
    console.log('  Upcoming:', upcoming.length);
    console.log();

    if (upcoming.length === 0) {
      console.log('No upcoming fixtures found for ' + comp.name);
      console.log('The season may not have started yet.');
      return;
    }

    // Save fixtures
    const fixtures = upcoming.map(m => ({
      home_team: m.homeTeam.shortName || m.homeTeam.name,
      away_team: m.awayTeam.shortName || m.awayTeam.name,
      match_date: m.utcDate,
      league: comp.name,
      status: 'NS',
      home_goals: null,
      away_goals: null,
      home_team_id: m.homeTeam.id,
      away_team_id: m.awayTeam.id,
      competition_code: code,
      matchday: m.matchday || null,
      season: new Date().getFullYear().toString()
    }));

    const { data, error: saveErr } = await supabase
      .from('fixtures')
      .upsert(fixtures, { onConflict: 'home_team,away_team,match_date' })
      .select();

    if (saveErr) {
      console.log('Save error:', saveErr.message);
      return;
    }

    console.log('SUCCESS: Saved ' + fixtures.length + ' fixtures for ' + comp.name);
    console.log();
    console.log('Sample fixtures:');
    fixtures.slice(0, 5).forEach(f => {
      console.log('  ' + f.home_team + ' vs ' + f.away_team + ' - ' + f.match_date);
    });

    // Step 3: Backfill historical data if needed
    if ((count || 0) < 50) {
      console.log();
      console.log('Step 3: Historical data is low (' + (count || 0) + ' matches)');
      console.log('  Run: node backfill_' + code.toLowerCase() + '.js');
      console.log('  This fetches past season data for rolling stats.');
    } else {
      console.log();
      console.log('Step 3: Historical data is sufficient (' + count + ' matches)');
      console.log('  Predictions will work immediately!');
    }

    console.log();
    console.log('DONE! ' + comp.name + ' is now active.');
    console.log('Refresh your frontend to see picks.');

  } catch (err) {
    console.log('API Error:', err.message);
    if (err.response?.status === 403) {
      console.log('Your API key may not have access to this competition.');
    }
  }
}

// Get code from command line
const code = process.argv[2];
if (!code) {
  console.log('Usage: node add_competition.js <CODE>');
  console.log();
  console.log('Example:');
  console.log('  node add_competition.js PL     (Premier League)');
  console.log('  node add_competition.js PD     (La Liga)');
  console.log('  node add_competition.js BL1    (Bundesliga)');
  console.log('  node add_competition.js SA     (Serie A)');
  console.log('  node add_competition.js FL1    (Ligue 1)');
  console.log();
  console.log('Supported codes:', Object.keys(COMPETITIONS).join(', '));
  process.exit(1);
}

addCompetition(code.toUpperCase()).catch(console.error);