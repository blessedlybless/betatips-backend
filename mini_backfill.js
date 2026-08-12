const { createClient } = require('@supabase/supabase-js');
const { getMatches, COMPETITIONS } = require('./football_data_service');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function backfillOne(code) {
  console.log('Backfilling ' + COMPETITIONS[code].name);
  const matchesData = await getMatches(code, 'FINISHED', '2024-08-01', '2025-06-30');
  const matches = matchesData.matches || [];
  console.log('Found ' + matches.length + ' matches');

  const teams = {};

  matches.forEach(m => {
    if (m.status !== 'FINISHED') return;

    const homeId = m.homeTeam.id;
    const awayId = m.awayTeam.id;
    const homeName = m.homeTeam.shortName || m.homeTeam.name;
    const awayName = m.awayTeam.shortName || m.awayTeam.name;
    const homeGoals = m.score.fullTime.home ?? 0;
    const awayGoals = m.score.fullTime.away ?? 0;

    if (!teams[homeId]) {
      teams[homeId] = {
        team_id: homeId,
        team_name: homeName,
        competition: code,
        games_played: 0, wins: 0, draws: 0, losses: 0,
        goals_for: 0, goals_against: 0,
        home_games: 0, home_wins: 0, home_draws: 0, home_losses: 0,
        home_goals_for: 0, home_goals_against: 0,
        away_games: 0, away_wins: 0, away_draws: 0, away_losses: 0,
        away_goals_for: 0, away_goals_against: 0,
        last_5_results: [],
        form_points: 0,
        crest: m.homeTeam.crest || null
      };
    }
    if (!teams[awayId]) {
      teams[awayId] = {
        team_id: awayId,
        team_name: awayName,
        competition: code,
        games_played: 0, wins: 0, draws: 0, losses: 0,
        goals_for: 0, goals_against: 0,
        home_games: 0, home_wins: 0, home_draws: 0, home_losses: 0,
        home_goals_for: 0, home_goals_against: 0,
        away_games: 0, away_wins: 0, away_draws: 0, away_losses: 0,
        away_goals_for: 0, away_goals_against: 0,
        last_5_results: [],
        form_points: 0,
        crest: m.awayTeam.crest || null
      };
    }

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

    if (ht.last_5_results.length > 5) ht.last_5_results.pop();
    if (at.last_5_results.length > 5) at.last_5_results.pop();
  });

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

  const fixtures = matches.filter(m => m.status === 'FINISHED').map(m => ({
    home_team: m.homeTeam.shortName || m.homeTeam.name,
    away_team: m.awayTeam.shortName || m.awayTeam.name,
    match_date: m.utcDate,
    league: COMPETITIONS[code].name,
    status: 'FT',
    home_goals: m.score.fullTime.home,
    away_goals: m.score.fullTime.away,
    home_team_id: m.homeTeam.id,
    away_team_id: m.awayTeam.id,
    competition_code: code,
    matchday: m.matchday || null,
    season: '2024'
  }));

  await supabase.from('team_stats').upsert(Object.values(teams), { onConflict: 'team_name,competition' });
  await supabase.from('fixtures').upsert(fixtures, { onConflict: 'home_team,away_team,match_date' });
  console.log('Saved ' + Object.values(teams).length + ' teams, ' + fixtures.length + ' fixtures');
}

(async () => {
  await backfillOne('DED');
  await new Promise(r => setTimeout(r, 15000));
  await backfillOne('PPL');
  console.log('Done!');
})().catch(console.error);
