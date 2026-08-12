const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

// Football-Data.org competition codes
const COMPETITION_CODES = {
  'BSA': { id: 2013, name: 'Campeonato Brasileiro Série A' },
  'PL':  { id: 2021, name: 'Premier League' },
  'PD':  { id: 2014, name: 'Primera Division' },
  'BL1': { id: 2002, name: 'Bundesliga' },
  'SA':  { id: 2019, name: 'Serie A' },
  'FL1': { id: 2015, name: 'Ligue 1' },
  'DED': { id: 2003, name: 'Eredivisie' },
  'PPL': { id: 2017, name: 'Primeira Liga' },
  'ELC': { id: 2016, name: 'Championship' },
  'CL':  { id: 2001, name: 'UEFA Champions League' }
};

async function fetchMatches(competitionCode) {
  const comp = COMPETITION_CODES[competitionCode];
  if (!comp) {
    console.log('ERROR: Unknown competition code ' + competitionCode);
    return [];
  }

  const today = new Date().toISOString().split('T')[0];
  const future = new Date();
  future.setDate(future.getDate() + 14);
  const futureStr = future.toISOString().split('T')[0];

  const url = `https://api.football-data.org/v4/competitions/${comp.id}/matches`;

  console.log('Fetching: ' + comp.name);
  console.log('URL: ' + url);
  console.log('Date range: ' + today + ' to ' + futureStr);

  try {
    const response = await axios.get(url, {
      headers: { 'X-Auth-Token': API_KEY },
      params: {
        dateFrom: today,
        dateTo: futureStr,
        status: 'SCHEDULED'
      },
      timeout: 15000
    });

    const matches = response.data.matches || [];
    console.log('API returned ' + matches.length + ' matches');

    if (matches.length > 0) {
      const sample = matches[0];
      console.log('Sample: ' + (sample.homeTeam.shortName || sample.homeTeam.name) + ' vs ' + (sample.awayTeam.shortName || sample.awayTeam.name));
      console.log('Date: ' + sample.utcDate);
      console.log('Status: ' + sample.status);
    }

    return matches;

  } catch (err) {
    if (err.response) {
      console.log('API Error ' + err.response.status + ': ' + (err.response.data?.message || err.response.statusText));
      if (err.response.status === 403) {
        console.log('Your API key may not have access to this competition.');
      }
    } else {
      console.log('Network Error: ' + err.message);
    }
    return [];
  }
}

async function syncBSA() {
  console.log('========================================');
  console.log('  SYNCING REAL BSA FIXTURES FROM API');
  console.log('========================================');
  console.log();
  console.log('API Key: ' + (API_KEY ? API_KEY.substring(0, 8) + '...' : 'NOT SET'));
  console.log();

  if (!API_KEY) {
    console.log('ERROR: FOOTBALL_DATA_API_KEY not found in .env');
    console.log('Add it to your .env file:');
    console.log('  FOOTBALL_DATA_API_KEY=your_key_here');
    return;
  }

  const matches = await fetchMatches('BSA');

  if (matches.length === 0) {
    console.log();
    console.log('No matches found from API.');
    console.log();
    console.log('Possible reasons:');
    console.log('  1. No BSA matches scheduled in the next 14 days');
    console.log('  2. Season is on break (World Cup, international break)');
    console.log('  3. API key issue (check your plan at football-data.org)');
    console.log();
    console.log('Fallback: Use node seed_bsa_upcoming.js for testing');
    return;
  }

  // Filter only future matches
  const now = new Date();
  const upcoming = matches.filter(m => new Date(m.utcDate) >= now);
  console.log('Upcoming matches: ' + upcoming.length);

  if (upcoming.length === 0) {
    console.log('All returned matches are in the past.');
    return;
  }

  // Save to database
  const fixtures = upcoming.map(m => ({
    home_team: m.homeTeam.shortName || m.homeTeam.name,
    away_team: m.awayTeam.shortName || m.awayTeam.name,
    match_date: m.utcDate,
    league: COMPETITION_CODES['BSA'].name,
    status: 'NS',
    home_goals: null,
    away_goals: null,
    home_team_id: m.homeTeam.id,
    away_team_id: m.awayTeam.id,
    competition_code: 'BSA',
    matchday: m.matchday || null,
    season: '2026'
  }));

  console.log();
  console.log('Saving to database...');

  const { data, error } = await supabase
    .from('fixtures')
    .upsert(fixtures, { onConflict: 'home_team,away_team,match_date' })
    .select();

  if (error) {
    console.log('ERROR: ' + error.message);
    return;
  }

  console.log('SUCCESS: Saved ' + fixtures.length + ' real BSA fixtures');
  console.log();
  console.log('Fixtures:');
  fixtures.forEach(f => {
    console.log('  ' + f.home_team + ' vs ' + f.away_team + ' - ' + f.match_date);
  });
  console.log();
  console.log('Refresh your frontend to see predictions!');
}

// Also test other competitions
async function testAllCompetitions() {
  console.log();
  console.log('========================================');
  console.log('  TESTING ALL COMPETITIONS');
  console.log('========================================');
  console.log();

  for (const [code, comp] of Object.entries(COMPETITION_CODES)) {
    process.stdout.write(code + ' (' + comp.name + '): ');
    try {
      const url = `https://api.football-data.org/v4/competitions/${comp.id}/matches`;
      const res = await axios.get(url, {
        headers: { 'X-Auth-Token': API_KEY },
        params: { dateFrom: '2026-08-01', dateTo: '2026-08-31', status: 'SCHEDULED' },
        timeout: 10000
      });
      const count = res.data.matches?.length || 0;
      console.log(count + ' matches');
    } catch (err) {
      if (err.response?.status === 403) {
        console.log('FORBIDDEN (upgrade needed)');
      } else if (err.response?.status === 404) {
        console.log('NOT FOUND');
      } else {
        console.log('ERROR: ' + (err.response?.status || err.message));
      }
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
}

// Main
syncBSA().then(() => {
  return testAllCompetitions();
}).then(() => {
  console.log();
  console.log('Done!');
  process.exit(0);
}).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});