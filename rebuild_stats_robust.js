const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const COMPETITIONS = {
  'BSA': { name: 'Campeonato Brasileiro Série A' },
  'PL':  { name: 'Premier League' },
  'PD':  { name: 'Primera Division' },
  'BL1': { name: 'Bundesliga' },
  'SA':  { name: 'Serie A' },
  'FL1': { name: 'Ligue 1' },
  'DED': { name: 'Eredivisie' },
  'PPL': { name: 'Primeira Liga' },
  'ELC': { name: 'Championship' }
};

async function detectColumns() {
  console.log('=== DETECTING SCHEMA ===\n');

  // We know competition is NOT NULL from the error
  // Try inserting with competition + team_name first
  const baseCols = { team_name: 'TEST', competition: 'TEST' };

  const { data: baseData, error: baseError } = await supabase
    .from('team_stats')
    .insert(baseCols)
    .select();

  if (baseError) {
    console.log('Even basic insert failed:', baseError.message);
    return null;
  }

  const testId = baseData[0].id;
  const existingCols = Object.keys(baseData[0]);
  console.log('Existing columns:', existingCols.join(', '));

  // Test which stat columns exist by trying to update them
  const statColumns = [
    'games_played', 'home_games', 'away_games',
    'goals_for', 'goals_against',
    'home_goals_for', 'home_goals_against',
    'away_goals_for', 'away_goals_against',
    'home_avg_goals_for', 'home_avg_goals_against',
    'away_avg_goals_for', 'away_avg_goals_against',
    'avg_goals_for', 'avg_goals_against',
    'win_rate', 'draw_rate', 'loss_rate',
    'form_string', 'season'
  ];

  const validStatCols = [];

  for (const col of statColumns) {
    if (existingCols.includes(col)) {
      validStatCols.push(col);
      continue;
    }

    const updateObj = {};
    updateObj[col] = col === 'form_string' ? 'W,D,L' : 1;

    const { error } = await supabase
      .from('team_stats')
      .update(updateObj)
      .eq('id', testId);

    if (!error) {
      validStatCols.push(col);
    }
  }

  // Clean up
  await supabase.from('team_stats').delete().eq('id', testId);

  console.log('\nValid stat columns:', validStatCols.join(', '));

  return {
    allCols: existingCols,
    statCols: validStatCols,
    hasSeason: validStatCols.includes('season')
  };
}

async function rebuildAllStats() {
  const schema = await detectColumns();

  if (!schema) {
    console.log('❌ Cannot detect schema');
    return;
  }

  console.log('\n=== REBUILDING ALL TEAM STATS ===\n');

  // Clear all
  const { error: delError } = await supabase.from('team_stats').delete().neq('id', 0);
  if (delError) console.log('⚠️ Clear warning:', delError.message);
  else console.log('✅ Cleared all stats\n');

  for (const [code, comp] of Object.entries(COMPETITIONS)) {
    console.log(`📊 ${code} - ${comp.name}`);

    const { data: matches, error } = await supabase
      .from('fixtures')
      .select('*')
      .eq('competition_code', code)
      .eq('status', 'FT')
      .order('match_date', { ascending: true });

    if (error) {
      console.log(`   ❌ Query error: ${error.message}`);
      continue;
    }

    if (!matches || matches.length === 0) {
      console.log(`   ℹ️ No matches\n`);
      continue;
    }

    console.log(`   Processing ${matches.length} matches...`);

    const teamMap = {};

    for (const match of matches) {
      const home = match.home_team;
      const away = match.away_team;

      [home, away].forEach(team => {
        if (!teamMap[team]) {
          teamMap[team] = {
            team_name: team,
            games_played: 0, home_games: 0, away_games: 0,
            goals_for: 0, goals_against: 0,
            home_goals_for: 0, home_goals_against: 0,
            away_goals_for: 0, away_goals_against: 0,
            wins: 0, draws: 0, losses: 0, last_5_results: []
          };
        }
      });

      const hg = match.home_goals || 0;
      const ag = match.away_goals || 0;

      teamMap[home].games_played++;
      teamMap[home].home_games++;
      teamMap[home].goals_for += hg;
      teamMap[home].goals_against += ag;
      teamMap[home].home_goals_for += hg;
      teamMap[home].home_goals_against += ag;

      teamMap[away].games_played++;
      teamMap[away].away_games++;
      teamMap[away].goals_for += ag;
      teamMap[away].goals_against += hg;
      teamMap[away].away_goals_for += ag;
      teamMap[away].away_goals_against += hg;

      if (hg > ag) {
        teamMap[home].wins++; teamMap[home].last_5_results.push('W');
        teamMap[away].losses++; teamMap[away].last_5_results.push('L');
      } else if (hg < ag) {
        teamMap[home].losses++; teamMap[home].last_5_results.push('L');
        teamMap[away].wins++; teamMap[away].last_5_results.push('W');
      } else {
        teamMap[home].draws++; teamMap[home].last_5_results.push('D');
        teamMap[away].draws++; teamMap[away].last_5_results.push('D');
      }
    }

    const statsToInsert = [];
    for (const stats of Object.values(teamMap)) {
      const gp = stats.games_played;
      if (gp === 0) continue;

      const row = {
        team_name: stats.team_name,
        competition: code
      };

      const sc = schema.statCols;

      if (sc.includes('games_played')) row.games_played = gp;
      if (sc.includes('home_games')) row.home_games = stats.home_games;
      if (sc.includes('away_games')) row.away_games = stats.away_games;
      if (sc.includes('goals_for')) row.goals_for = stats.goals_for;
      if (sc.includes('goals_against')) row.goals_against = stats.goals_against;
      if (sc.includes('home_goals_for')) row.home_goals_for = stats.home_goals_for;
      if (sc.includes('home_goals_against')) row.home_goals_against = stats.home_goals_against;
      if (sc.includes('away_goals_for')) row.away_goals_for = stats.away_goals_for;
      if (sc.includes('away_goals_against')) row.away_goals_against = stats.away_goals_against;
      if (sc.includes('home_avg_goals_for')) row.home_avg_goals_for = stats.home_games > 0 ? +(stats.home_goals_for / stats.home_games).toFixed(2) : 0;
      if (sc.includes('home_avg_goals_against')) row.home_avg_goals_against = stats.home_games > 0 ? +(stats.home_goals_against / stats.home_games).toFixed(2) : 0;
      if (sc.includes('away_avg_goals_for')) row.away_avg_goals_for = stats.away_games > 0 ? +(stats.away_goals_for / stats.away_games).toFixed(2) : 0;
      if (sc.includes('away_avg_goals_against')) row.away_avg_goals_against = stats.away_games > 0 ? +(stats.away_goals_against / stats.away_games).toFixed(2) : 0;
      if (sc.includes('avg_goals_for')) row.avg_goals_for = +(stats.goals_for / gp).toFixed(2);
      if (sc.includes('avg_goals_against')) row.avg_goals_against = +(stats.goals_against / gp).toFixed(2);
      if (sc.includes('win_rate')) row.win_rate = +(stats.wins / gp).toFixed(2);
      if (sc.includes('draw_rate')) row.draw_rate = +(stats.draws / gp).toFixed(2);
      if (sc.includes('loss_rate')) row.loss_rate = +(stats.losses / gp).toFixed(2);
      if (sc.includes('form_string')) row.form_string = stats.last_5_results.slice(-5).join(',');
      if (schema.hasSeason) row.season = '2025';

      statsToInsert.push(row);
    }

    if (statsToInsert.length === 0) {
      console.log(`   ℹ️ No teams to save\n`);
      continue;
    }

    // Batch insert
    const BATCH_SIZE = 50;
    let saved = 0;
    for (let i = 0; i < statsToInsert.length; i += BATCH_SIZE) {
      const batch = statsToInsert.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase.from('team_stats').insert(batch);
      if (insertError) {
        console.log(`   ❌ Insert error: ${insertError.message}`);
      } else {
        saved += batch.length;
      }
    }

    console.log(`   ✅ ${saved} teams saved\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✅ REBUILD COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\nRestart: node server_v2.js');
  console.log('Test: curl http://localhost:3001/api/picks/all');
}

rebuildAllStats().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});