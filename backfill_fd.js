const { createClient } = require('@supabase/supabase-js');
const { getMatches, COMPETITIONS } = require('./football_data_service');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Build team stats from match results
function buildTeamStatsFromMatches(matches, competitionCode) {
  const teams = {};

  matches.forEach(match => {
    if (match.status !== 'FINISHED') return;

    const homeId = match.homeTeam.id;
    const awayId = match.awayTeam.id;
    const homeName = match.homeTeam.shortName || match.homeTeam.name;
    const awayName = match.awayTeam.shortName || match.awayTeam.name;
    const homeGoals = match.score.fullTime.home ?? 0;
    const awayGoals = match.score.fullTime.away ?? 0;

    // Initialize teams if not exists
    if (!teams[homeId]) {
      teams[homeId] = {
        team_id: homeId,
        team_name: homeName,
        competition: competitionCode,
        games_played: 0, wins: 0, draws: 0, losses: 0,
        goals_for: 0, goals_against: 0,
        home_games: 0, home_wins: 0, home_draws: 0, home_losses: 0,
        home_goals_for: 0, home_goals_against: 0,
        away_games: 0, away_wins: 0, away_draws: 0, away_losses: 0,
        away_goals_for: 0, away_goals_against: 0,
        last_5_results: [],
        form_points: 0,
        crest: match.homeTeam.crest || null
      };
    }
    if (!teams[awayId]) {
      teams[awayId] = {
        team_id: awayId,
        team_name: awayName,
        competition: competitionCode,
        games_played: 0, wins: 0, draws: 0, losses: 0,
        goals_for: 0, goals_against: 0,
        home_games: 0, home_wins: 0, home_draws: 0, home_losses: 0,
        home_goals_for: 0, home_goals_against: 0,
        away_games: 0, away_wins: 0, away_draws: 0, away_losses: 0,
        away_goals_for: 0, away_goals_against: 0,
        last_5_results: [],
        form_points: 0,
        crest: match.awayTeam.crest || null
      };
    }

    // Update home team
    const ht = teams[homeId];
    ht.games_played++;
    ht.goals_for += homeGoals;
    ht.goals_against += awayGoals;
    ht.home_games++;
    ht.home_goals_for += homeGoals;
    ht.home_goals_against += awayGoals;

    if (homeGoals > awayGoals) { ht.wins++; ht.home_wins++; ht.last_5_results.unshift('W'); ht.form_points += 3; }
    else if (homeGoals === awayGoals) { ht.draws++; ht.home_draws++; ht.last_5_results.unshift('D'); ht.form_points += 1; }
    else { ht.losses++; ht.home_losses++; ht.last_5_results.unshift('L'); }

    // Update away team
    const at = teams[awayId];
    at.games_played++;
    at.goals_for += awayGoals;
    at.goals_against += homeGoals;
    at.away_games++;
    at.away_goals_for += awayGoals;
    at.away_goals_against += homeGoals;

    if (awayGoals > homeGoals) { at.wins++; at.away_wins++; at.last_5_results.unshift('W'); at.form_points += 3; }
    else if (awayGoals === homeGoals) { at.draws++; at.away_draws++; at.last_5_results.unshift('D'); at.form_points += 1; }
    else { at.losses++; at.away_losses++; at.last_5_results.unshift('L'); }

    // Keep only last 5
    if (ht.last_5_results.length > 5) ht.last_5_results.pop();
    if (at.last_5_results.length > 5) at.last_5_results.pop();
  });

  // Calculate derived stats
  Object.values(teams).forEach(t => {
    t.win_rate = t.games_played > 0 ? (t.wins / t.games_played) : 0;
    t.draw_rate = t.games_played > 0 ? (t.draws / t.games_played) : 0;
    t.loss_rate = t.games_played > 0 ? (t.losses / t.games_played) : 0;
    t.avg_goals_for = t.games_played > 0 ? (t.goals_for / t.games_played) : 0;
    t.avg_goals_against = t.games_played > 0 ? (t.goals_against / t.games_played) : 0;
    t.home_avg_goals_for = t.home_games > 0 ? (t.home_goals_for / t.home_games) : 0;
    t.home_avg_goals_against = t.home_games > 0 ? (t.home_goals_against / t.home_games) : 0;
    t.away_avg_goals_for = t.away_games > 0 ? (t.away_goals_for / t.away_games) : 0;
    t.away_avg_goals_against = t.away_games > 0 ? (t.away_goals_against / t.away_games) : 0;
    t.form_string = t.last_5_results.join(',');
    t.data_quality = Math.min(t.games_played / 10, 1.0);
    t.data_source = 'historical (2024-25 season)';
    t.matches_used = t.games_played;
  });

  return Object.values(teams);
}

// Transform matches to fixtures format
function matchesToFixtures(matches, competitionCode) {
  return matches
    .filter(m => m.status === 'FINISHED')
    .map(m => ({
      home_team: m.homeTeam.shortName || m.homeTeam.name,
      away_team: m.awayTeam.shortName || m.awayTeam.name,
      match_date: m.utcDate,
      league: COMPETITIONS[competitionCode]?.name || competitionCode,
      status: 'FT',
      home_goals: m.score.fullTime.home,
      away_goals: m.score.fullTime.away,
      home_team_id: m.homeTeam.id,
      away_team_id: m.awayTeam.id,
      competition_code: competitionCode,
      matchday: m.matchday || null,
      season: m.season?.startDate?.substring(0, 4) || '2024'
    }));
}

async function backfillLeague(competitionCode) {
  console.log(`\n=== Backfilling ${COMPETITIONS[competitionCode]?.name || competitionCode} (${competitionCode}) ===`);

  try {
    console.log('  Fetching matches...');
    const matchesData = await getMatches(competitionCode, 'FINISHED', '2024-08-01', '2025-06-30');
    const matches = matchesData.matches || [];
    console.log(`  Found ${matches.length} finished matches`);

    if (matches.length === 0) {
      console.log('  ⚠️ No matches found. Trying without date filter...');
      const allMatches = await getMatches(competitionCode, 'FINISHED');
      const all = allMatches.matches || [];
      console.log(`  Found ${all.length} total finished matches`);
      if (all.length === 0) return { teams: 0, fixtures: 0 };

      const teamStats = buildTeamStatsFromMatches(all, competitionCode);
      const fixtures = matchesToFixtures(all, competitionCode);
      await saveToDatabase(teamStats, fixtures);
      return { teams: teamStats.length, fixtures: fixtures.length };
    }

    const teamStats = buildTeamStatsFromMatches(matches, competitionCode);
    const fixtures = matchesToFixtures(matches, competitionCode);
    await saveToDatabase(teamStats, fixtures);

    return { teams: teamStats.length, fixtures: fixtures.length };
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    if (error.response) {
      console.error(`  Status: ${error.response.status}`);
      console.error(`  Data: ${JSON.stringify(error.response.data)}`);
    }
    return { teams: 0, fixtures: 0 };
  }
}

async function saveToDatabase(teamStats, fixtures) {
  // Save team stats - use team_name,competition for conflict (matches schema)
  if (teamStats.length > 0) {
    console.log(`  Saving ${teamStats.length} team stats...`);
    const { error: statsError } = await supabase
      .from('team_stats')
      .upsert(teamStats, { onConflict: 'team_name,competition' });

    if (statsError) {
      console.error(`  ❌ Team stats error: ${statsError.message}`);
    } else {
      console.log(`  ✅ Team stats saved`);
    }
  }

  // Save fixtures
  if (fixtures.length > 0) {
    console.log(`  Saving ${fixtures.length} fixtures...`);
    const { error: fixError } = await supabase
      .from('fixtures')
      .upsert(fixtures, { onConflict: 'home_team,away_team,match_date' });

    if (fixError) {
      console.error(`  ❌ Fixtures error: ${fixError.message}`);
    } else {
      console.log(`  ✅ Fixtures saved`);
    }
  }
}

async function main() {
  console.log('========================================');
  console.log('=== HARDCORE Predictions - Backfill  ===');
  console.log('=== Using Football-Data.org API       ===');
  console.log('========================================');
  console.log('Rate limit: ~8 requests/minute (7s delay)');
  console.log('');

  const leagues = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'CL', 'BSA'];
  let totalTeams = 0;
  let totalFixtures = 0;

  for (const code of leagues) {
    const result = await backfillLeague(code);
    totalTeams += result.teams;
    totalFixtures += result.fixtures;

    if (code !== leagues[leagues.length - 1]) {
      console.log('  Pausing 15s before next league...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  console.log('\n========================================');
  console.log('=== Backfill Complete ===');
  console.log(`Total teams: ${totalTeams}`);
  console.log(`Total fixtures: ${totalFixtures}`);
  console.log('========================================');
}

main().catch(console.error);