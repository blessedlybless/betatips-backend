const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

const COMPETITIONS = {
  'BSA': { id: 2013, name: 'Campeonato Brasileiro Série A' },
  'PL': { id: 2021, name: 'Premier League' },
  'PD': { id: 2014, name: 'Primera Division' },
  'BL1': { id: 2002, name: 'Bundesliga' },
  'SA': { id: 2019, name: 'Serie A' },
  'FL1': { id: 2015, name: 'Ligue 1' },
  'DED': { id: 2003, name: 'Eredivisie' },
  'PPL': { id: 2017, name: 'Primeira Liga' },
  'ELC': { id: 2016, name: 'Championship' }
};

const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchMatches(compCode, compId) {
  const url = `https://api.football-data.org/v4/competitions/${compId}/matches?season=2025&status=FINISHED`;
  try {
    console.log(`   Calling API...`);
    const res = await axios.get(url, {
      headers: { 'X-Auth-Token': API_KEY },
      timeout: 30000
    });
    return res.data.matches || [];
  } catch (err) {
    console.log(`   ❌ ${compCode}: ${err.response?.status || err.message}`);
    if (err.response?.data) console.log(`   Details:`, JSON.stringify(err.response.data).substring(0, 200));
    return [];
  }
}

async function getExistingFixtures(compCode) {
  const { data, error } = await supabase
    .from('fixtures')
    .select('home_team, away_team, match_date')
    .eq('competition_code', compCode)
    .eq('season', '2025');

  if (error) {
    console.log(`   Warning: Could not check existing fixtures: ${error.message}`);
    return new Set();
  }

  const keys = new Set();
  if (data) {
    data.forEach(f => keys.add(`${f.home_team}|${f.away_team}|${f.match_date}`));
  }
  return keys;
}

async function saveMatchesBatch(matches, compCode, compName, existingKeys) {
  const toInsert = [];

  for (const match of matches) {
    const homeTeam = match.homeTeam?.name || match.homeTeam;
    const awayTeam = match.awayTeam?.name || match.awayTeam;
    const homeGoals = match.score?.fullTime?.home ?? match.home_goals;
    const awayGoals = match.score?.fullTime?.away ?? match.away_goals;
    const matchDate = match.utcDate || match.match_date;
    const homeId = match.homeTeam?.id || match.home_team_id;
    const awayId = match.awayTeam?.id || match.away_team_id;

    const key = `${homeTeam}|${awayTeam}|${matchDate}`;
    if (existingKeys.has(key)) continue;

    // Only columns that exist in your schema
    toInsert.push({
      home_team: homeTeam,
      away_team: awayTeam,
      home_team_id: homeId,
      away_team_id: awayId,
      league: compName,
      competition_code: compCode,
      match_date: matchDate,
      status: 'FT',
      home_goals: homeGoals,
      away_goals: awayGoals,
      season: '2025',
      matchday: match.matchday || null
    });
  }

  if (toInsert.length === 0) return { saved: 0, skipped: matches.length };

  const CHUNK_SIZE = 100;
  let totalSaved = 0;

  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from('fixtures').insert(chunk);

    if (error) {
      console.log(`   ❌ Batch insert error: ${error.message}`);
      for (const item of chunk) {
        const { error: e2 } = await supabase.from('fixtures').insert(item);
        if (!e2) totalSaved++;
        else if (e2.message.includes('duplicate')) totalSaved++; // Already exists
      }
    } else {
      totalSaved += chunk.length;
    }

    if (toInsert.length > 100) {
      process.stdout.write(`   Progress: ${Math.min(i + CHUNK_SIZE, toInsert.length)}/${toInsert.length}...\r`);
    }
  }
  console.log(`   Progress: ${totalSaved}/${toInsert.length} saved          `);

  const skipped = matches.length - toInsert.length;
  return { saved: totalSaved, skipped };
}

async function updateTeamStatsFromFixtures(compCode) {
  console.log(`\n   Updating team_stats for ${compCode}...`);

  const { data: fixtures, error } = await supabase
    .from('fixtures')
    .select('*')
    .eq('competition_code', compCode)
    .eq('status', 'FT')
    .eq('season', '2025');

  if (error) {
    console.log(`   ❌ Error fetching fixtures: ${error.message}`);
    return;
  }

  if (!fixtures || fixtures.length === 0) {
    console.log(`   ⚠️ No fixtures found for ${compCode}`);
    return;
  }

  console.log(`   Processing ${fixtures.length} fixtures...`);

  const teamStats = {};

  fixtures.forEach((f) => {
    const home = f.home_team;
    const away = f.away_team;
    const hg = f.home_goals;
    const ag = f.away_goals;

    if (!teamStats[home]) teamStats[home] = initStats(home, compCode);
    if (!teamStats[away]) teamStats[away] = initStats(away, compCode);

    teamStats[home].games_played++;
    teamStats[home].home_games++;
    teamStats[home].goals_for += hg;
    teamStats[home].goals_against += ag;
    teamStats[home].home_goals_for += hg;
    teamStats[home].home_goals_against += ag;

    if (hg > ag) {
      teamStats[home].wins++;
      teamStats[home].home_wins++;
    } else if (hg === ag) {
      teamStats[home].draws++;
      teamStats[home].home_draws++;
    } else {
      teamStats[home].losses++;
      teamStats[home].home_losses++;
    }

    teamStats[away].games_played++;
    teamStats[away].away_games++;
    teamStats[away].goals_for += ag;
    teamStats[away].goals_against += hg;
    teamStats[away].away_goals_for += ag;
    teamStats[away].away_goals_against += hg;

    if (ag > hg) {
      teamStats[away].wins++;
      teamStats[away].away_wins++;
    } else if (ag === hg) {
      teamStats[away].draws++;
      teamStats[away].away_draws++;
    } else {
      teamStats[away].losses++;
      teamStats[away].away_losses++;
    }
  });

  const statsArray = [];
  for (const teamName in teamStats) {
    const s = teamStats[teamName];
    s.win_rate = s.games_played > 0 ? parseFloat((s.wins / s.games_played).toFixed(3)) : 0;
    s.draw_rate = s.games_played > 0 ? parseFloat((s.draws / s.games_played).toFixed(3)) : 0;
    s.loss_rate = s.games_played > 0 ? parseFloat((s.losses / s.games_played).toFixed(3)) : 0;
    s.avg_goals_for = s.games_played > 0 ? parseFloat((s.goals_for / s.games_played).toFixed(3)) : 0;
    s.avg_goals_against = s.games_played > 0 ? parseFloat((s.goals_against / s.games_played).toFixed(3)) : 0;
    s.home_avg_goals_for = s.home_games > 0 ? parseFloat((s.home_goals_for / s.home_games).toFixed(3)) : 0;
    s.home_avg_goals_against = s.home_games > 0 ? parseFloat((s.home_goals_against / s.home_games).toFixed(3)) : 0;
    s.away_avg_goals_for = s.away_games > 0 ? parseFloat((s.away_goals_for / s.away_games).toFixed(3)) : 0;
    s.away_avg_goals_against = s.away_games > 0 ? parseFloat((s.away_goals_against / s.away_games).toFixed(3)) : 0;
    s.data_quality = 1;
    s.data_source = 'historical (2025 season)';
    s.matches_used = s.games_played;
    s.form_string = '';
    s.form_points = 0;
    s.last_5_results = [];
    s.crest = '';
    statsArray.push(s);
  }

  const CHUNK_SIZE = 50;
  let savedCount = 0;
  for (let i = 0; i < statsArray.length; i += CHUNK_SIZE) {
    const chunk = statsArray.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from('team_stats')
      .upsert(chunk, { onConflict: 'team_name,competition' });

    if (error) {
      console.log(`   ❌ Stats batch error: ${error.message}`);
    } else {
      savedCount += chunk.length;
    }
  }

  console.log(`   ✅ Saved stats for ${savedCount} teams`);
}

function initStats(teamName, comp) {
  return {
    team_name: teamName,
    competition: comp,
    team_id: null,
    games_played: 0, wins: 0, draws: 0, losses: 0,
    goals_for: 0, goals_against: 0,
    home_games: 0, home_wins: 0, home_draws: 0, home_losses: 0,
    home_goals_for: 0, home_goals_against: 0,
    away_games: 0, away_wins: 0, away_draws: 0, away_losses: 0,
    away_goals_for: 0, away_goals_against: 0,
    win_rate: 0, draw_rate: 0, loss_rate: 0,
    avg_goals_for: 0, avg_goals_against: 0,
    home_avg_goals_for: 0, home_avg_goals_against: 0,
    away_avg_goals_for: 0, away_avg_goals_against: 0,
    form_string: '', last_5_results: [], form_points: 0,
    data_quality: 1, data_source: '', matches_used: 0,
    oldest_match_date: null, newest_match_date: null,
    crest: ''
  };
}

async function backfillAll() {
  console.log('=== BACKFILLING 2025/26 SEASON FOR ALL LEAGUES ===\n');

  let totalSaved = 0;
  let totalSkipped = 0;

  for (const [code, info] of Object.entries(COMPETITIONS)) {
    console.log(`\n📊 ${code} - ${info.name}`);
    console.log(`   Fetching 2025/26 finished matches from API...`);

    const matches = await fetchMatches(code, info.id);
    console.log(`   API returned ${matches.length} matches`);

    if (matches.length === 0) {
      console.log(`   ⚠️ No data. Skipping.`);
      await delay(6000);
      continue;
    }

    console.log(`   Checking database for existing ${code} 2025 fixtures...`);
    const existingKeys = await getExistingFixtures(code);
    console.log(`   Found ${existingKeys.size} existing fixtures`);

    console.log(`   Saving matches to database...`);
    const result = await saveMatchesBatch(matches, code, info.name, existingKeys);
    console.log(`   ✅ Saved: ${result.saved} | Skipped (duplicates): ${result.skipped}`);
    totalSaved += result.saved;
    totalSkipped += result.skipped;

    await updateTeamStatsFromFixtures(code);

    console.log(`   ⏳ Waiting 6 seconds for API rate limit...`);
    await delay(6000);
  }

  console.log('\n========================================');
  console.log('BACKFILL COMPLETE');
  console.log(`Total new matches saved: ${totalSaved}`);
  console.log(`Total skipped (already existed): ${totalSkipped}`);
  console.log('========================================');

  console.log('\n=== FINAL DATABASE SUMMARY ===');
  const { data: allFixtures } = await supabase.from('fixtures').select('*');
  const bySeason = {};
  const byComp = {};
  if (allFixtures) {
    allFixtures.forEach(f => {
      bySeason[f.season] = (bySeason[f.season] || 0) + 1;
      byComp[f.competition_code] = (byComp[f.competition_code] || 0) + 1;
    });
  }
  console.log('Fixtures by season:', bySeason);
  console.log('Fixtures by competition:', byComp);
  console.log(`Total fixtures: ${allFixtures ? allFixtures.length : 0}`);

  const { data: allStats } = await supabase.from('team_stats').select('*');
  console.log(`Total team_stats: ${allStats ? allStats.length : 0}`);

  console.log('\n=== NEXT STEPS ===');
  console.log('1. Restart your server: node server_v2.js');
  console.log('2. Test predictions: curl http://localhost:3001/api/picks/all');
}

backfillAll().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});