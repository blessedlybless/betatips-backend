require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ============ CONFIGURATION ============
const ROLLING_WINDOW = 10;
const MIN_MATCHES_FOR_PREDICTION = 5;
const SEASON_TRANSITION_MATCHES = 15;

const MARKETS = {
  '1': { name: 'Home Win', minProb: 0.58 },
  '2': { name: 'Away Win', minProb: 0.58 },
  '1X': { name: 'Home Win or Draw', minProb: 0.68 },
  'X2': { name: 'Away Win or Draw', minProb: 0.68 },
  'Over 1.5': { name: 'Over 1.5 Goals', minProb: 0.72 },
  'Over 2.5': { name: 'Over 2.5 Goals', minProb: 0.62 },
  'BTTS Yes': { name: 'Both Teams To Score', minProb: 0.60 }
};

const DATA_QUALITY_GATES = {
  MIN_FOR_ANY_PREDICTION: 0.30,
  STRICT_MODE_THRESHOLD: 0.60,
  HIGH_CONFIDENCE_THRESHOLD: 0.70
};

const MAX_PICKS_WEEKDAY = 3;
const MAX_PICKS_WEEKEND = 5;

// Poisson math
function poissonProb(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function factorial(n) {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function poissonDistribution(lambda, maxGoals = 10) {
  const dist = [];
  for (let i = 0; i <= maxGoals; i++) dist.push(poissonProb(lambda, i));
  return dist;
}

// ============ ROLLING WINDOW STATS ============
async function getTeamRollingStats(teamName, competition) {
  const { data: homeMatches } = await supabase
    .from('fixtures').select('*')
    .eq('home_team', teamName).eq('competition_code', competition)
    .eq('status', 'FT').order('match_date', { ascending: false }).limit(ROLLING_WINDOW);

  const { data: awayMatches } = await supabase
    .from('fixtures').select('*')
    .eq('away_team', teamName).eq('competition_code', competition)
    .eq('status', 'FT').order('match_date', { ascending: false }).limit(ROLLING_WINDOW);

  const allMatches = [...(homeMatches || []), ...(awayMatches || [])]
    .sort((a, b) => new Date(b.match_date) - new Date(a.match_date))
    .slice(0, ROLLING_WINDOW);

  if (allMatches.length === 0) return getTeamHistoricalStats(teamName, competition);

  const stats = {
    team_name: teamName, competition: competition,
    games_played: 0, wins: 0, draws: 0, losses: 0,
    goals_for: 0, goals_against: 0,
    home_games: 0, home_wins: 0, home_draws: 0, home_losses: 0,
    home_goals_for: 0, home_goals_against: 0,
    away_games: 0, away_wins: 0, away_draws: 0, away_losses: 0,
    away_goals_for: 0, away_goals_against: 0,
    last_5_results: [], form_points: 0,
    data_source: 'rolling', matches_used: allMatches.length,
    oldest_match_date: allMatches[allMatches.length - 1]?.match_date,
    newest_match_date: allMatches[0]?.match_date
  };

  allMatches.forEach((match, idx) => {
    const isHome = match.home_team === teamName;
    const teamGoals = isHome ? match.home_goals : match.away_goals;
    const oppGoals = isHome ? match.away_goals : match.home_goals;

    stats.goals_for += teamGoals; stats.goals_against += oppGoals;
    if (isHome) {
      stats.home_games++; stats.home_goals_for += teamGoals; stats.home_goals_against += oppGoals;
      if (teamGoals > oppGoals) { stats.home_wins++; stats.wins++; }
      else if (teamGoals === oppGoals) { stats.home_draws++; stats.draws++; }
      else { stats.home_losses++; stats.losses++; }
    } else {
      stats.away_games++; stats.away_goals_for += teamGoals; stats.away_goals_against += oppGoals;
      if (teamGoals > oppGoals) { stats.away_wins++; stats.wins++; }
      else if (teamGoals === oppGoals) { stats.away_draws++; stats.draws++; }
      else { stats.away_losses++; stats.losses++; }
    }
    if (idx < 5) {
      if (teamGoals > oppGoals) { stats.last_5_results.push('W'); stats.form_points += 3; }
      else if (teamGoals === oppGoals) { stats.last_5_results.push('D'); stats.form_points += 1; }
      else { stats.last_5_results.push('L'); }
    }
  });

  stats.win_rate = stats.games_played > 0 ? stats.wins / stats.games_played : 0;
  stats.avg_goals_for = stats.games_played > 0 ? stats.goals_for / stats.games_played : 0;
  stats.avg_goals_against = stats.games_played > 0 ? stats.goals_against / stats.games_played : 0;
  stats.home_avg_goals_for = stats.home_games > 0 ? stats.home_goals_for / stats.home_games : 0;
  stats.home_avg_goals_against = stats.home_games > 0 ? stats.home_goals_against / stats.home_games : 0;
  stats.away_avg_goals_for = stats.away_games > 0 ? stats.away_goals_for / stats.away_games : 0;
  stats.away_avg_goals_against = stats.away_games > 0 ? stats.away_goals_against / stats.away_games : 0;
  stats.form_string = stats.last_5_results.join(',');
  stats.data_quality = Math.min(stats.games_played / MIN_MATCHES_FOR_PREDICTION, 1.0);

  if (allMatches.length < SEASON_TRANSITION_MATCHES) {
    const historical = await getTeamHistoricalStats(teamName, competition);
    if (historical) {
      const rollingWeight = allMatches.length / SEASON_TRANSITION_MATCHES;
      const histWeight = 1 - rollingWeight;
      stats.home_avg_goals_for = (stats.home_avg_goals_for * rollingWeight) + (historical.home_avg_goals_for * histWeight);
      stats.home_avg_goals_against = (stats.home_avg_goals_against * rollingWeight) + (historical.home_avg_goals_against * histWeight);
      stats.away_avg_goals_for = (stats.away_avg_goals_for * rollingWeight) + (historical.away_avg_goals_for * histWeight);
      stats.away_avg_goals_against = (stats.away_avg_goals_against * rollingWeight) + (historical.away_avg_goals_against * histWeight);
      stats.avg_goals_for = (stats.avg_goals_for * rollingWeight) + (historical.avg_goals_for * histWeight);
      stats.avg_goals_against = (stats.avg_goals_against * rollingWeight) + (historical.avg_goals_against * histWeight);
      stats.data_source = `hybrid (${Math.round(rollingWeight * 100)}% rolling, ${Math.round(histWeight * 100)}% historical)`;
    }
  }
  return stats;
}

async function getTeamHistoricalStats(teamName, competition) {
  let { data } = await supabase.from('team_stats').select('*').eq('team_name', teamName).eq('competition', competition).single();
  if (!data) {
    const { data: allStats } = await supabase.from('team_stats').select('*').eq('competition', competition);
    if (allStats) data = allStats.find(s => teamName.toLowerCase().includes(s.team_name.toLowerCase()) || s.team_name.toLowerCase().includes(teamName.toLowerCase()));
  }
  if (data) data.data_source = 'historical (2024-25 season)';
  return data;
}

async function getLeagueRollingAverages(competition) {
  const { data: allMatches } = await supabase.from('fixtures').select('*').eq('competition_code', competition).eq('status', 'FT').order('match_date', { ascending: false }).limit(200);
  if (!allMatches || allMatches.length === 0) return { avgHomeGoalsFor: 1.5, avgHomeGoalsAgainst: 1.2, avgAwayGoalsFor: 1.2, avgAwayGoalsAgainst: 1.5, avgTotalGoals: 2.7, source: 'default' };
  const homeGoals = allMatches.reduce((s, m) => s + (m.home_goals || 0), 0);
  const awayGoals = allMatches.reduce((s, m) => s + (m.away_goals || 0), 0);
  const count = allMatches.length;
  return { avgHomeGoalsFor: homeGoals / count, avgHomeGoalsAgainst: awayGoals / count, avgAwayGoalsFor: awayGoals / count, avgAwayGoalsAgainst: homeGoals / count, avgTotalGoals: (homeGoals + awayGoals) / count, source: `rolling (${count} matches)` };
}

// ============ FORM VALIDATION ============
function validateForm(homeStats, awayStats, market) {
  const homeForm = homeStats?.form_string || '';
  const awayForm = awayStats?.form_string || '';

  if (market === '1') {
    if (homeForm.startsWith('LLL')) return { valid: false, reason: 'Home team lost last 3' };
    if ((homeStats?.home_losses || 0) > (homeStats?.home_wins || 0) * 1.5) return { valid: false, reason: 'Home team loses more than wins at home' };
  }
  if (market === '2') {
    if (awayForm.startsWith('LLL')) return { valid: false, reason: 'Away team lost last 3' };
    if ((awayStats?.away_wins || 0) < (awayStats?.away_losses || 0)) return { valid: false, reason: 'Away team loses more than wins away' };
  }
  if (market === 'Over 2.5') {
    const homeAvg = homeStats?.avg_goals_for || 0;
    const awayAvg = awayStats?.avg_goals_for || 0;
    if (homeAvg < 1.2 && awayAvg < 1.2) return { valid: false, reason: `Both teams average <1.2 goals (${homeAvg.toFixed(1)} vs ${awayAvg.toFixed(1)})` };
    const homeConcede = homeStats?.avg_goals_against || 0;
    const awayConcede = awayStats?.avg_goals_against || 0;
    if (homeConcede < 1.0 && awayConcede < 1.0) return { valid: false, reason: 'Both teams defend too well' };
  }
  if (market === 'BTTS Yes') {
    const homeScores = (homeStats?.home_avg_goals_for || 0) > 0.8;
    const awayScores = (awayStats?.away_avg_goals_for || 0) > 0.8;
    const homeConcedes = (homeStats?.home_avg_goals_against || 0) > 0.8;
    const awayConcedes = (awayStats?.away_avg_goals_against || 0) > 0.8;
    if (!homeScores || !awayScores) return { valid: false, reason: 'One or both teams struggle to score' };
    if (!homeConcedes || !awayConcedes) return { valid: false, reason: 'One or both teams keep too many clean sheets' };
  }
  return { valid: true };
}

// ============ MAIN PREDICTION ============
async function predictMatch(homeTeam, awayTeam, competition) {
  const homeStats = await getTeamRollingStats(homeTeam, competition);
  const awayStats = await getTeamRollingStats(awayTeam, competition);
  const leagueAvgs = await getLeagueRollingAverages(competition);

  const homeGames = homeStats?.games_played || 0;
  const awayGames = awayStats?.games_played || 0;
  const dataQuality = Math.min((homeGames + awayGames) / (MIN_MATCHES_FOR_PREDICTION * 2), 1.0);

  if (dataQuality < DATA_QUALITY_GATES.MIN_FOR_ANY_PREDICTION) {
    return {
      home_team: homeTeam, away_team: awayTeam, best_pick: null,
      all_predictions: [], top_picks: [],
      reasoning: `Insufficient data (${Math.round(dataQuality * 100)}%). Need ${MIN_MATCHES_FOR_PREDICTION}+ matches per team.`,
      data_quality: Math.round(dataQuality * 100), status: 'NO_PICK',
      data_source: { home: homeStats?.data_source, away: awayStats?.data_source }
    };
  }

  let homeXg, awayXg;
  if (homeStats && awayStats) {
    const homeAttack = (homeStats.home_avg_goals_for || leagueAvgs.avgHomeGoalsFor) / leagueAvgs.avgHomeGoalsFor;
    const homeDefense = (homeStats.home_avg_goals_against || leagueAvgs.avgHomeGoalsAgainst) / leagueAvgs.avgHomeGoalsAgainst;
    const awayAttack = (awayStats.away_avg_goals_for || leagueAvgs.avgAwayGoalsFor) / leagueAvgs.avgAwayGoalsFor;
    const awayDefense = (awayStats.away_avg_goals_against || leagueAvgs.avgAwayGoalsAgainst) / leagueAvgs.avgAwayGoalsAgainst;
    homeXg = homeAttack * awayDefense * leagueAvgs.avgHomeGoalsFor;
    awayXg = awayAttack * homeDefense * leagueAvgs.avgAwayGoalsFor;
  } else {
    homeXg = leagueAvgs.avgHomeGoalsFor;
    awayXg = leagueAvgs.avgAwayGoalsFor;
  }

  if (homeStats?.form_points !== undefined) {
    const formBoost = Math.min((homeStats.form_points / 15) * 0.15, 0.15);
    homeXg *= (1 + formBoost);
  }
  if (awayStats?.form_points !== undefined) {
    const formBoost = Math.min((awayStats.form_points / 15) * 0.15, 0.15);
    awayXg *= (1 + formBoost);
  }

  const homeDist = poissonDistribution(homeXg, 10);
  const awayDist = poissonDistribution(awayXg, 10);

  let homeWin = 0, draw = 0, awayWin = 0, over15 = 0, over25 = 0, btts = 0;
  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const prob = homeDist[h] * awayDist[a];
      if (h > a) homeWin += prob;
      else if (h === a) draw += prob;
      else awayWin += prob;
      if (h + a > 1.5) over15 += prob;
      if (h + a > 2.5) over25 += prob;
      if (h > 0 && a > 0) btts += prob;
    }
  }

  const adjust = (prob) => prob * dataQuality + 0.5 * (1 - dataQuality);

  const rawProbs = {
    '1': homeWin, '2': awayWin,
    '1X': homeWin + draw, 'X2': draw + awayWin,
    'Over 1.5': over15, 'Over 2.5': over25,
    'BTTS Yes': btts
  };

  const adjustedProbs = {};
  for (const [market, prob] of Object.entries(rawProbs)) {
    adjustedProbs[market] = adjust(prob);
  }

  const isStrictMode = dataQuality < DATA_QUALITY_GATES.STRICT_MODE_THRESHOLD;
  const thresholdBonus = isStrictMode ? 0.05 : 0;

  const allPredictions = [];
  const qualifiedPicks = [];

  for (const [marketCode, config] of Object.entries(MARKETS)) {
    const prob = adjustedProbs[marketCode];
    const minProb = config.minProb + thresholdBonus;

    // Add to ALL predictions (regardless of threshold)
    allPredictions.push({
      market: config.name,
      marketCode,
      probability: parseFloat(prob.toFixed(3)),
      odds: parseFloat((1 / prob).toFixed(2)),
      meetsThreshold: prob >= minProb,
      minRequired: minProb
    });

    // Only add to qualified picks if it passes ALL checks
    if (prob >= minProb) {
      const formCheck = validateForm(homeStats, awayStats, marketCode);
      if (formCheck.valid) {
        let confidence = 'LOW';
        if (prob >= 0.70 && dataQuality >= DATA_QUALITY_GATES.HIGH_CONFIDENCE_THRESHOLD) confidence = 'HIGH';
        else if (prob >= 0.62) confidence = 'MEDIUM';

        if (confidence !== 'LOW') {
          qualifiedPicks.push({
            market: config.name,
            marketCode,
            probability: parseFloat(prob.toFixed(3)),
            confidence,
            odds: parseFloat((1 / prob).toFixed(2)),
            minRequired: minProb
          });
        }
      }
    }
  }

  // Sort by probability descending
  allPredictions.sort((a, b) => b.probability - a.probability);
  qualifiedPicks.sort((a, b) => b.probability - a.probability);

  // Get today's day for top picks limit
  const today = new Date();
  const dayOfWeek = today.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
  const maxTopPicks = isWeekend ? MAX_PICKS_WEEKEND : MAX_PICKS_WEEKDAY;

  const topPicks = qualifiedPicks.slice(0, maxTopPicks).map((p, i) => ({
    rank: i + 1,
    ...p
  }));

  const bestPick = qualifiedPicks.length > 0 ? qualifiedPicks[0] : null;

  let reasoning = '';
  reasoning += `${homeTeam}: ${homeStats.games_played} games (${homeStats.data_source}). `;
  reasoning += `Home: ${homeStats.home_avg_goals_for?.toFixed(1)} GF, ${homeStats.home_avg_goals_against?.toFixed(1)} GA/game. `;
  reasoning += `${awayTeam}: ${awayStats.games_played} games (${awayStats.data_source}). `;
  reasoning += `Away: ${awayStats.away_avg_goals_for?.toFixed(1)} GF, ${awayStats.away_avg_goals_against?.toFixed(1)} GA/game. `;
  if (homeStats.form_string) {
    reasoning += `Form: ${homeTeam} ${homeStats.form_string.replace(/,/g, '')} vs ${awayTeam} ${awayStats.form_string?.replace(/,/g, '') || 'N/A'}. `;
  }
  reasoning += `League avg: ${leagueAvgs.source}. `;
  reasoning += `Data quality: ${Math.round(dataQuality * 100)}%. `;

  if (bestPick) {
    reasoning += `${bestPick.market} @ ${Math.round(bestPick.probability * 100)}% (${bestPick.confidence}). `;
    if (isStrictMode) reasoning += `Strict mode (+5%).`;
  } else {
    reasoning += `No market met minimum thresholds.`;
  }

  return {
    home_team: homeTeam,
    away_team: awayTeam,
    home_xg: parseFloat(homeXg.toFixed(2)),
    away_xg: parseFloat(awayXg.toFixed(2)),
    best_pick: bestPick,
    all_predictions: allPredictions,
    top_picks: topPicks,
    qualified_count: qualifiedPicks.length,
    reasoning,
    data_quality: Math.round(dataQuality * 100),
    strict_mode: isStrictMode,
    status: bestPick ? 'PICK' : 'NO_PICK',
    is_weekend: isWeekend,
    max_picks_today: maxTopPicks,
    data_source: { home: homeStats.data_source, away: awayStats.data_source },
    league_source: leagueAvgs.source,
    raw_probabilities: {
      home_win: parseFloat((homeWin * 100).toFixed(1)),
      draw: parseFloat((draw * 100).toFixed(1)),
      away_win: parseFloat((awayWin * 100).toFixed(1)),
      over_15: parseFloat((over15 * 100).toFixed(1)),
      over_25: parseFloat((over25 * 100).toFixed(1)),
      btts: parseFloat((btts * 100).toFixed(1))
    }
  };
}

// ============ AUTO-UPDATE TEAM STATS ============
async function updateTeamStatsAfterMatch(fixtureId) {
  const { data: fixture } = await supabase.from('fixtures').select('*').eq('id', fixtureId).single();
  if (!fixture || fixture.status !== 'FT') return;

  const homeStats = await getTeamRollingStats(fixture.home_team, fixture.competition_code);
  const awayStats = await getTeamRollingStats(fixture.away_team, fixture.competition_code);

  await supabase.from('team_stats').upsert([{
    team_name: fixture.home_team, competition: fixture.competition_code,
    ...homeStats, updated_at: new Date().toISOString()
  }], { onConflict: 'team_name,competition' });

  await supabase.from('team_stats').upsert([{
    team_name: fixture.away_team, competition: fixture.competition_code,
    ...awayStats, updated_at: new Date().toISOString()
  }], { onConflict: 'team_name,competition' });

  console.log(`✅ Updated rolling stats for ${fixture.home_team} and ${fixture.away_team}`);
}

// ============ STREAK TRACKER ============
async function getStreakTracker(days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data: results } = await supabase
    .from('prediction_results').select('*')
    .gte('created_at', cutoff.toISOString())
    .order('created_at', { ascending: false });

  if (!results || results.length === 0) {
    return { period: `${days} days`, total_picks: 0, wins: 0, losses: 0, win_rate: 0, current_streak: 0, streak_type: 'NONE', best_streak: 0, worst_streak: 0, roi: 0, by_market: [] };
  }

  const wins = results.filter(r => r.result === 'WIN').length;
  const losses = results.filter(r => r.result === 'LOSS').length;
  const total = results.length;

  let currentStreak = 0, streakType = 'NONE';
  for (const r of results) {
    if (r.result === 'WIN') { if (streakType === 'WIN' || streakType === 'NONE') { currentStreak++; streakType = 'WIN'; } else break; }
    else if (r.result === 'LOSS') { if (streakType === 'LOSS' || streakType === 'NONE') { currentStreak++; streakType = 'LOSS'; } else break; }
  }

  let bestStreak = 0, worstStreak = 0, currentBest = 0, currentWorst = 0;
  for (const r of [...results].reverse()) {
    if (r.result === 'WIN') { currentBest++; currentWorst = 0; bestStreak = Math.max(bestStreak, currentBest); }
    else { currentWorst++; currentBest = 0; worstStreak = Math.max(worstStreak, currentWorst); }
  }

  const byMarket = {};
  results.forEach(r => {
    const m = r.market || 'Unknown';
    if (!byMarket[m]) byMarket[m] = { total: 0, wins: 0 };
    byMarket[m].total++;
    if (r.result === 'WIN') byMarket[m].wins++;
  });

  const avgOdds = 1.80;
  const profit = (wins * avgOdds) - total;
  const roi = total > 0 ? ((profit / total) * 100).toFixed(1) : 0;

  return {
    period: `${days} days`, total_picks: total, wins, losses,
    win_rate: total > 0 ? Math.round((wins / total) * 100) : 0,
    current_streak: currentStreak, streak_type: streakType,
    best_streak: bestStreak, worst_streak: worstStreak,
    roi,
    by_market: Object.entries(byMarket).map(([market, stats]) => ({
      market, total: stats.total, wins: stats.wins, win_rate: Math.round((stats.wins / stats.total) * 100)
    }))
  };
}

// ============ GET ALL PICKS + TOP PICKS ============
async function getAllPicks() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
  const maxTopPicks = isWeekend ? MAX_PICKS_WEEKEND : MAX_PICKS_WEEKDAY;

  const todayStr = today.toISOString().split('T')[0];
  const threeDaysLater = new Date();
  threeDaysLater.setDate(threeDaysLater.getDate() + 3);

  const { data: fixtures } = await supabase
    .from('fixtures').select('*')
    .gte('match_date', `${todayStr}T00:00:00`)
    .lte('match_date', threeDaysLater.toISOString())
    .order('match_date', { ascending: true });

  if (!fixtures || fixtures.length === 0) {
    return { date: todayStr, is_weekend: isWeekend, max_picks: maxTopPicks, all_predictions: [], top_picks: [], total_found: 0 };
  }

  const allPredictions = [];
  const allQualified = [];

  for (const fixture of fixtures) {
    const pred = await predictMatch(fixture.home_team, fixture.away_team, fixture.competition_code || 'PL');

    // Add ALL predictions for this match
    allPredictions.push({
      fixture_id: fixture.id,
      match: `${fixture.home_team} vs ${fixture.away_team}`,
      league: fixture.league,
      date: fixture.match_date,
      all_markets: pred.all_predictions,
      best_pick: pred.best_pick,
      reasoning: pred.reasoning,
      data_quality: pred.data_quality,
      status: pred.status
    });

    // Add qualified picks to the pool
    if (pred.top_picks && pred.top_picks.length > 0) {
      pred.top_picks.forEach(p => {
        allQualified.push({
          fixture_id: fixture.id,
          match: `${fixture.home_team} vs ${fixture.away_team}`,
          league: fixture.league,
          date: fixture.match_date,
          ...p
        });
      });
    }
  }

  // Sort all qualified by probability and take top N
  allQualified.sort((a, b) => b.probability - a.probability);
  const topPicks = allQualified.slice(0, maxTopPicks).map((p, i) => ({ rank: i + 1, ...p }));

  return {
    date: todayStr,
    is_weekend: isWeekend,
    max_picks: maxTopPicks,
    all_predictions: allPredictions,
    top_picks: topPicks,
    total_qualified: allQualified.length,
    total_found: topPicks.length
  };
}

module.exports = { predictMatch, getStreakTracker, getAllPicks, updateTeamStatsAfterMatch, getTeamRollingStats, getLeagueRollingAverages };