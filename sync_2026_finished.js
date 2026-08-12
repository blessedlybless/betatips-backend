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

async function fetchFinishedMatches(compCode, compId) {
  const url = `https://api.football-data.org/v4/competitions/${compId}/matches?season=2026&status=FINISHED`;
  try {
    const res = await axios.get(url, {
      headers: { 'X-Auth-Token': API_KEY },
      timeout: 30000
    });
    return res.data.matches || [];
  } catch (err) {
    console.log(`   ❌ ${compCode}: ${err.response?.status || err.message}`);
    return [];
  }
}

async function getExistingKeys(compCode) {
  const { data, error } = await supabase
    .from('fixtures')
    .select('home_team, away_team, match_date')
    .eq('competition_code', compCode)
    .eq('season', '2026')
    .eq('status', 'FT');

  if (error) return new Set();
  const keys = new Set();
  if (data) data.forEach(f => keys.add(`${f.home_team}|${f.away_team}|${f.match_date}`));
  return keys;
}

async function saveMatches(matches, compCode, compName, existingKeys) {
  const toInsert = [];
  for (const m of matches) {
    const key = `${m.homeTeam.name}|${m.awayTeam.name}|${m.utcDate}`;
    if (existingKeys.has(key)) continue;

    toInsert.push({
      home_team: m.homeTeam.name,
      away_team: m.awayTeam.name,
      home_team_id: m.homeTeam.id,
      away_team_id: m.awayTeam.id,
      league: compName,
      competition_code: compCode,
      match_date: m.utcDate,
      status: 'FT',
      home_goals: m.score.fullTime.home,
      away_goals: m.score.fullTime.away,
      season: '2026',
      matchday: m.matchday || null
    });
  }

  if (toInsert.length === 0) return { saved: 0, skipped: matches.length };

  const CHUNK = 100;
  let saved = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { error } = await supabase.from('fixtures').insert(chunk);
    if (error) {
      for (const item of chunk) {
        const { error: e2 } = await supabase.from('fixtures').insert(item);
        if (!e2 || e2.message.includes('duplicate')) saved++;
      }
    } else {
      saved += chunk.length;
    }
  }
  return { saved, skipped: matches.length - toInsert.length };
}

async function updateTeamStats(compCode) {
  console.log(`   Updating team_stats for ${compCode}...`);

  // Get ALL finished matches for this competition (2025 + 2026)
  const { data: fixtures, error } = await supabase
    .from('fixtures')
    .select('*')
    .eq('competition_code', compCode)
    .eq('status', 'FT')
    .order('match_date', { ascending: true });

  if (error || !fixtures || fixtures.length === 0) {
    console.log(`   ⚠️ No fixtures found`);
    return;
  }

  console.log(`   Processing ${fixtures.length} total finished matches...`);

  const teamStats = {};

  fixtures.forEach(f => {
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

    if (hg > ag) { teamStats[home].wins++; teamStats[home].home_wins++; }
    else if (hg === ag) { teamStats[home].draws++; teamStats[home].home_draws++; }
    else { teamStats[home].losses++; teamStats[home].home_losses++; }

    teamStats[away].games_played++;
    teamStats[away].away_games++;
    teamStats[away].goals_for += ag;
    teamStats[away].goals_against += hg;
    teamStats[away].away_goals_for += ag;
    teamStats[away].away_goals_against += hg;

    if (ag > hg) { teamStats[away].wins++; teamStats[away].away_wins++; }
    else if (ag === hg) { teamStats[away].draws++; teamStats[away].away_draws++; }
    else { teamStats[away].losses++; teamStats[away].away_losses++; }
  });

  const statsArray = [];
  for (const name in teamStats) {
    const s = teamStats[name];
    const gp = s.games_played;
    s.win_rate = gp > 0 ? parseFloat((s.wins / gp).toFixed(3)) : 0;
    s.draw_rate = gp > 0 ? parseFloat((s.draws / gp).toFixed(3)) : 0;
    s.loss_rate = gp > 0 ? parseFloat((s.losses / gp).toFixed(3)) : 0;
    s.avg_goals_for = gp > 0 ? parseFloat((s.goals_for / gp).toFixed(3)) : 0;
    s.avg_goals_against = gp > 0 ? parseFloat((s.goals_against / gp).toFixed(3)) : 0;
    s.home_avg_goals_for = s.home_games > 0 ? parseFloat((s.home_goals_for / s.home_games).toFixed(3)) : 0;
    s.home_avg_goals_against = s.home_games > 0 ? parseFloat((s.home_goals_against / s.home_games).toFixed(3)) : 0;
    s.away_avg_goals_for = s.away_games > 0 ? parseFloat((s.away_goals_for / s.away_games).toFixed(3)) : 0;
    s.away_avg_goals_against = s.away_games > 0 ? parseFloat((s.away_goals_against / s.away_games).toFixed(3)) : 0;
    s.data_quality = 1;
    s.matches_used = gp;
    s.data_source = gp >= 15 ? 'rolling (current season)' : `hybrid (${Math.round(gp/15*100)}% rolling)`;
    s.form_string = '';
    s.form_points = 0;
    s.last_5_results = [];
    s.crest = '';
    statsArray.push(s);
  }

  const CHUNK = 50;
  let saved = 0;
  for (let i = 0; i < statsArray.length; i += CHUNK) {
    const { error } = await supabase
      .from('team_stats')
      .upsert(statsArray.slice(i, i + CHUNK), { onConflict: 'team_name,competition' });
    if (!error) saved += Math.min(CHUNK, statsArray.length - i);
  }
  console.log(`   ✅ Updated stats for ${saved} teams`);
}

function initStats(name, comp) {
  return {
    team_name: name, competition: comp, team_id: null,
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
    oldest_match_date: null, newest_match_date: null, crest: ''
  };
}

async function syncAll() {
  console.log('=== SYNCING 2026 FINISHED MATCHES FOR ALL LEAGUES ===\n');
  console.log('Today: 2026-08-06');
  console.log('This fetches finished 2026 matches so the rolling window');
  console.log('transitions from 2025 historical → 2026 current season.\n');

  let totalSaved = 0;

  for (const [code, info] of Object.entries(COMPETITIONS)) {
    console.log(`📊 ${code} - ${info.name}`);

    const matches = await fetchFinishedMatches(code, info.id);
    console.log(`   API returned ${matches.length} finished 2026 matches`);

    if (matches.length === 0) {
      console.log(`   ℹ️ No 2026 finished matches yet (season not started or no data)`);
      await delay(6000);
      continue;
    }

    const existing = await getExistingKeys(code);
    console.log(`   Already in database: ${existing.size}`);

    const result = await saveMatches(matches, code, info.name, existing);
    console.log(`   ✅ New saved: ${result.saved} | Duplicates skipped: ${result.skipped}`);
    totalSaved += result.saved;

    // Update team_stats with blended 2025+2026 data
    await updateTeamStats(code);

    console.log(`   ⏳ Waiting 6 seconds...`);
    await delay(6000);
  }

  console.log('\n========================================');
  console.log('SYNC COMPLETE');
  console.log(`Total new 2026 finished matches saved: ${totalSaved}`);
  console.log('========================================');

  // Summary
  console.log('\n=== ROLLING WINDOW STATUS ===');
  for (const code of Object.keys(COMPETITIONS)) {
    const { data } = await supabase
      .from('fixtures')
      .select('*')
      .eq('competition_code', code)
      .eq('status', 'FT')
      .eq('season', '2026');
    const count = data ? data.length : 0;
    const status = count >= 15 ? '✅ 100% rolling' : count >= 5 ? `⚡ Hybrid (${Math.round(count/15*100)}%)` : count > 0 ? `🔄 Starting (${count})` : '⏳ Historical only';
    console.log(`   ${code}: ${count} finished 2026 matches → ${status}`);
  }

  console.log('\n=== NEXT STEPS ===');
  console.log('1. Restart server: node server_v2.js');
  console.log('2. Test: curl http://localhost:3001/api/picks/all');
  console.log('3. Check data_source field — should now show rolling/hybrid');
}

syncAll().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});