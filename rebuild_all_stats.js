const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const COMPETITIONS = {
  'BSA': { name: 'Campeonato Brasileiro Série A' },
  'PL': { name: 'Premier League' },
  'PD': { name: 'Primera Division' },
  'BL1': { name: 'Bundesliga' },
  'SA': { name: 'Serie A' },
  'FL1': { name: 'Ligue 1' },
  'DED': { name: 'Eredivisie' },
  'PPL': { name: 'Primeira Liga' },
  'ELC': { name: 'Championship' }
};

async function rebuildStats() {
  console.log('=== REBUILDING TEAM STATS FOR ALL LEAGUES ===\n');
  console.log('This rebuilds stats from 2025 season data only (for now).');
  console.log('When 2026 matches are played, they will be added automatically.\n');

  for (const [code, info] of Object.entries(COMPETITIONS)) {
    console.log(`📊 ${code} - ${info.name}`);

    // Get ALL finished 2025 matches for this league
    const { data: fixtures, error } = await supabase
      .from('fixtures')
      .select('*')
      .eq('competition_code', code)
      .eq('status', 'FT')
      .eq('season', '2025')
      .order('match_date', { ascending: true });

    if (error) {
      console.log(`   ❌ Error: ${error.message}`);
      continue;
    }

    if (!fixtures || fixtures.length === 0) {
      console.log(`   ℹ️ No 2025 data found`);
      continue;
    }

    console.log(`   Processing ${fixtures.length} 2025 matches...`);

    // Build stats
    const teamStats = {};
    fixtures.forEach(f => {
      const home = f.home_team;
      const away = f.away_team;
      const hg = f.home_goals;
      const ag = f.away_goals;

      if (!teamStats[home]) teamStats[home] = initStats(home, code);
      if (!teamStats[away]) teamStats[away] = initStats(away, code);

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

    // Calculate derived stats
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
      s.data_source = 'historical (2025 season)';
      s.matches_used = gp;
      s.form_string = '';
      s.form_points = 0;
      s.last_5_results = [];
      s.crest = '';
      statsArray.push(s);
    }

    // Upsert in batches
    const CHUNK = 50;
    let saved = 0;
    for (let i = 0; i < statsArray.length; i += CHUNK) {
      const { error } = await supabase
        .from('team_stats')
        .upsert(statsArray.slice(i, i + CHUNK), { onConflict: 'team_name,competition' });
      if (!error) saved += Math.min(CHUNK, statsArray.length - i);
    }

    console.log(`   ✅ Saved stats for ${saved} teams`);
  }

  console.log('\n========================================');
  console.log('REBUILD COMPLETE');
  console.log('========================================');
  console.log('\nAll leagues now have correct 2025 historical stats.');
  console.log('When 2026 matches are played, the engine will transition');
  console.log('to rolling mode automatically (after 5 matches).');
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

rebuildStats().catch(console.error);