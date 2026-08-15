require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const MIN_MATCHES_FOR_PREDICTION = 5;
const MARKETS = {
  '1': { name: 'Home Win', minProb: 0.58 },
  '2': { name: 'Away Win', minProb: 0.58 },
  '1X': { name: 'Home Win or Draw', minProb: 0.68 },
  'X2': { name: 'Away Win or Draw', minProb: 0.68 },
  'Over 1.5': { name: 'Over 1.5 Goals', minProb: 0.72 },
  'Over 2.5': { name: 'Over 2.5 Goals', minProb: 0.62 },
  'BTTS Yes': { name: 'Both Teams To Score', minProb: 0.60 }
};

function factorial(n) {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function poissonProb(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function poissonDistribution(lambda, maxGoals = 10) {
  const dist = [];
  for (let i = 0; i <= maxGoals; i++) dist.push(poissonProb(lambda, i));
  return dist;
}

async function findTeamStatsFlexible(teamName, competition) {
  try {
    const { data, error } = await supabase.rpc('get_team_stats', {
      p_team_name: teamName,
      p_competition: competition
    });
    if (error) { console.error('RPC error:', error.message); return null; }
    if (!data || !data.found) return null;
    return {
      team_name: data.team_name,
      games_played: data.games_played,
      avg_goals_for: data.avg_goals_for,
      avg_goals_against: data.avg_goals_against,
      home_avg_goals_for: data.home_avg_goals_for,
      home_avg_goals_against: data.home_avg_goals_against,
      away_avg_goals_for: data.away_avg_goals_for,
      away_avg_goals_against: data.away_avg_goals_against,
      data_source: data.data_source
    };
  } catch (e) { return null; }
}

async function getLeagueAveragesFromDB(competition) {
  const { data, error } = await supabase.rpc('get_league_stats', {
    p_competition: competition
  });
  if (error || !data || !data.found) return null;
  return {
    avgHomeGoalsFor: data.home_avg_goals_for || 1.4,
    avgHomeGoalsAgainst: data.home_avg_goals_against || 1.2,
    avgAwayGoalsFor: data.away_avg_goals_for || 1.2,
    avgAwayGoalsAgainst: data.away_avg_goals_against || 1.4,
    source: data.data_source
  };
}

async function getLeagueRollingAverages(competition) {
  const { data: allMatches } = await supabase
    .from('fixtures').select('*')
    .eq('competition_code', competition)
    .eq('status', 'FT').eq('season', '2026')
    .order('match_date', { ascending: false }).limit(200);
  if (!allMatches || allMatches.length === 0) return null;
  const homeGoals = allMatches.reduce((s, m) => s + (m.home_goals || 0), 0);
  const awayGoals = allMatches.reduce((s, m) => s + (m.away_goals || 0), 0);
  const count = allMatches.length;
  if (count < 5 || (homeGoals === 0 && awayGoals === 0)) return null;
  return {
    avgHomeGoalsFor: homeGoals / count,
    avgHomeGoalsAgainst: awayGoals / count,
    avgAwayGoalsFor: awayGoals / count,
    avgAwayGoalsAgainst: homeGoals / count,
    source: 'rolling (' + count + ' matches)'
  };
}

function validateForm(homeStats, awayStats, market) {
  if (market === 'Over 2.5') {
    const h = homeStats ? (homeStats.avg_goals_for || 0) : 0;
    const a = awayStats ? (awayStats.avg_goals_for || 0) : 0;
    if (h < 1.2 && a < 1.2) return { valid: false, reason: 'Low scoring teams' };
  }
  if (market === 'BTTS Yes') {
    const hs = (homeStats ? (homeStats.home_avg_goals_for || 0) : 0) > 0.8;
    const as = (awayStats ? (awayStats.away_avg_goals_for || 0) : 0) > 0.8;
    const hc = (homeStats ? (homeStats.home_avg_goals_against || 0) : 0) > 0.8;
    const ac = (awayStats ? (awayStats.away_avg_goals_against || 0) : 0) > 0.8;
    if (!hs || !as) return { valid: false, reason: 'Low attack' };
    if (!hc || !ac) return { valid: false, reason: 'Good defense' };
  }
  return { valid: true };
}

async function predictMatch(homeTeam, awayTeam, competition) {
  const homeStats = await findTeamStatsFlexible(homeTeam, competition);
  const awayStats = await findTeamStatsFlexible(awayTeam, competition);
  let leagueAvgs = await getLeagueRollingAverages(competition);
  if (!leagueAvgs) leagueAvgs = await getLeagueAveragesFromDB(competition);

  if (!leagueAvgs) {
    return {
      home_team: homeTeam, away_team: awayTeam, best_pick: null,
      all_predictions: [], top_picks: [],
      reasoning: 'No league data for ' + competition,
      data_quality: 0, status: 'NO_PICK',
      data_source: { home: 'none', away: 'none' },
      league_source: 'none', home_xg: 0, away_xg: 0,
      raw_probabilities: {}, confidence: 'none'
    };
  }

  const homeGames = homeStats ? (homeStats.games_played || 0) : 0;
  const awayGames = awayStats ? (awayStats.games_played || 0) : 0;
  const dataQuality = Math.min((homeGames + awayGames) / 10, 1.0);

  if (dataQuality < 0.30) {
    return {
      home_team: homeTeam, away_team: awayTeam, best_pick: null,
      all_predictions: [], top_picks: [],
      reasoning: 'Insufficient data (' + Math.round(dataQuality * 100) + '%)',
      data_quality: Math.round(dataQuality * 100), status: 'NO_PICK',
      data_source: { home: homeStats ? homeStats.data_source : 'none', away: awayStats ? awayStats.data_source : 'none' }
    };
  }

  let homeXg, awayXg;
  if (homeStats && awayStats) {
    const hA = (homeStats.home_avg_goals_for || leagueAvgs.avgHomeGoalsFor) / leagueAvgs.avgHomeGoalsFor;
    const hD = (homeStats.home_avg_goals_against || leagueAvgs.avgHomeGoalsAgainst) / leagueAvgs.avgHomeGoalsAgainst;
    const aA = (awayStats.away_avg_goals_for || leagueAvgs.avgAwayGoalsFor) / leagueAvgs.avgAwayGoalsFor;
    const aD = (awayStats.away_avg_goals_against || leagueAvgs.avgAwayGoalsAgainst) / leagueAvgs.avgAwayGoalsAgainst;
    homeXg = hA * aD * leagueAvgs.avgHomeGoalsFor;
    awayXg = aA * hD * leagueAvgs.avgAwayGoalsFor;
  } else {
    homeXg = leagueAvgs.avgHomeGoalsFor;
    awayXg = leagueAvgs.avgAwayGoalsFor;
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
  const rawProbs = { '1': homeWin, '2': awayWin, '1X': homeWin + draw, 'X2': draw + awayWin, 'Over 1.5': over15, 'Over 2.5': over25, 'BTTS Yes': btts };
  const adjustedProbs = {};
  for (const [m, p] of Object.entries(rawProbs)) adjustedProbs[m] = adjust(p);

  const isStrict = dataQuality < 0.60;
  const bonus = isStrict ? 0.05 : 0;

  const allPredictions = [];
  const qualifiedPicks = [];

  for (const [code, cfg] of Object.entries(MARKETS)) {
    const prob = adjustedProbs[code];
    const minProb = cfg.minProb + bonus;
    allPredictions.push({ market: cfg.name, marketCode: code, probability: parseFloat(prob.toFixed(3)), odds: prob > 0 ? parseFloat((1 / prob).toFixed(2)) : null, meetsThreshold: prob >= minProb, minRequired: minProb });
    if (prob >= minProb) {
      const check = validateForm(homeStats, awayStats, code);
      if (check.valid) {
        let conf = 'LOW';
        if (prob >= 0.70 && dataQuality >= 0.70) conf = 'HIGH';
        else if (prob >= 0.62) conf = 'MEDIUM';
        if (conf !== 'LOW') qualifiedPicks.push({ market: cfg.name, marketCode: code, probability: parseFloat(prob.toFixed(3)), confidence: conf, odds: prob > 0 ? parseFloat((1 / prob).toFixed(2)) : null, minRequired: minProb });
      }
    }
  }

  allPredictions.sort((a, b) => b.probability - a.probability);
  qualifiedPicks.sort((a, b) => b.probability - a.probability);

  const today = new Date();
  const isWeekend = [0, 5, 6].includes(today.getDay());
  const maxTop = isWeekend ? 5 : 3;

  const topPicks = qualifiedPicks.slice(0, maxTop).map((p, i) => ({
    rank: i + 1, market: p.market, marketCode: p.marketCode,
    probability: p.probability, confidence: p.confidence,
    odds: p.odds, minRequired: p.minRequired
  }));

  const bestPick = qualifiedPicks.length > 0 ? qualifiedPicks[0] : null;

  let reasoning = '';
  if (homeStats) reasoning += homeTeam + ': ' + homeStats.games_played + ' games (' + homeStats.data_source + '). Home: ' + (homeStats.home_avg_goals_for || 0).toFixed(1) + ' GF, ' + (homeStats.home_avg_goals_against || 0).toFixed(1) + ' GA. ';
  if (awayStats) reasoning += awayTeam + ': ' + awayStats.games_played + ' games (' + awayStats.data_source + '). Away: ' + (awayStats.away_avg_goals_for || 0).toFixed(1) + ' GF, ' + (awayStats.away_avg_goals_against || 0).toFixed(1) + ' GA. ';
  reasoning += 'League: ' + leagueAvgs.source + '. DQ: ' + Math.round(dataQuality * 100) + '%. ';
  if (bestPick) reasoning += bestPick.market + ' @ ' + Math.round(bestPick.probability * 100) + '% (' + bestPick.confidence + ').';
  else reasoning += 'No market met thresholds.';

  return {
    home_team: homeTeam, away_team: awayTeam,
    home_xg: parseFloat(homeXg.toFixed(2)), away_xg: parseFloat(awayXg.toFixed(2)),
    best_pick: bestPick, all_predictions: allPredictions, top_picks: topPicks,
    qualified_count: qualifiedPicks.length, reasoning,
    data_quality: Math.round(dataQuality * 100), strict_mode: isStrict,
    status: bestPick ? 'PICK' : 'NO_PICK', is_weekend: isWeekend,
    max_picks_today: maxTop,
    data_source: { home: homeStats ? homeStats.data_source : 'none', away: awayStats ? awayStats.data_source : 'none' },
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

async function getAllPicks() {
  const today = new Date();
  const isWeekend = [0, 5, 6].includes(today.getDay());
  const maxTop = isWeekend ? 5 : 3;
  const todayStr = today.toISOString().split('T')[0];
  const later = new Date(); later.setDate(later.getDate() + 14);

  const { data: fixtures } = await supabase
    .from('fixtures').select('*')
    .gte('match_date', todayStr + 'T00:00:00')
    .lte('match_date', later.toISOString())
    .order('match_date', { ascending: true });

  if (!fixtures || fixtures.length === 0) {
    return { date: todayStr, is_weekend: isWeekend, max_picks: maxTop, all_predictions: [], top_picks: [], total_qualified: 0, total_found: 0 };
  }

  const allPredictions = [];
  const allQualified = [];

  for (const f of fixtures) {
    const pred = await predictMatch(f.home_team, f.away_team, f.competition_code || 'PL');
    allPredictions.push({
      fixture_id: f.id, match: f.home_team + ' vs ' + f.away_team,
      league: f.league, date: f.match_date,
      all_markets: pred.all_predictions, best_pick: pred.best_pick,
      reasoning: pred.reasoning, data_quality: pred.data_quality, status: pred.status
    });
    if (pred.top_picks) {
      pred.top_picks.forEach(p => {
        allQualified.push({ fixture_id: f.id, match: f.home_team + ' vs ' + f.away_team, league: f.league, date: f.match_date, market: p.market, marketCode: p.marketCode, probability: p.probability, confidence: p.confidence, odds: p.odds, minRequired: p.minRequired });
      });
    }
  }

  allQualified.sort((a, b) => b.probability - a.probability);
  const seen = new Set();
  const deduped = [];
  for (const p of allQualified) {
    if (seen.has(p.fixture_id)) continue;
    seen.add(p.fixture_id);
    deduped.push(p);
    if (deduped.length >= maxTop) break;
  }

  const topPicks = deduped.map((p, i) => ({
    rank: i + 1, fixture_id: p.fixture_id, match: p.match, league: p.league,
    date: p.date, market: p.market, marketCode: p.marketCode,
    probability: p.probability, confidence: p.confidence, odds: p.odds, minRequired: p.minRequired
  }));

  return { date: todayStr, is_weekend: isWeekend, max_picks: maxTop, all_predictions: allPredictions, top_picks: topPicks, total_qualified: allQualified.length, total_found: allPredictions.length };
}

async function getStreakTracker(days = 30) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const { data: results } = await supabase.from('prediction_results').select('*').gte('created_at', cutoff.toISOString()).order('created_at', { ascending: false });
  if (!results || results.length === 0) return { period: days + ' days', total_picks: 0, wins: 0, losses: 0, win_rate: 0, roi: 0 };
  const wins = results.filter(r => r.result === 'WIN').length;
  const total = results.length;
  const profit = (wins * 1.80) - total;
  return { period: days + ' days', total_picks: total, wins, losses: total - wins, win_rate: total > 0 ? Math.round((wins / total) * 100) : 0, roi: total > 0 ? ((profit / total) * 100).toFixed(1) : 0 };
}

async function updateTeamStatsAfterMatch(fixtureId) {
  const { data: fixture } = await supabase.from('fixtures').select('*').eq('id', fixtureId).single();
  if (!fixture || fixture.status !== 'FT') return;
  const homeStats = await findTeamStatsFlexible(fixture.home_team, fixture.competition_code);
  const awayStats = await findTeamStatsFlexible(fixture.away_team, fixture.competition_code);
  if (homeStats) {
    await supabase.from('team_stats').upsert([{ team_name: fixture.home_team, competition: fixture.competition_code, games_played: homeStats.games_played, goals_for: homeStats.goals_for, goals_against: homeStats.goals_against, data_source: homeStats.data_source, updated_at: new Date().toISOString() }], { onConflict: 'team_name,competition' });
  }
  if (awayStats) {
    await supabase.from('team_stats').upsert([{ team_name: fixture.away_team, competition: fixture.competition_code, games_played: awayStats.games_played, goals_for: awayStats.goals_for, goals_against: awayStats.goals_against, data_source: awayStats.data_source, updated_at: new Date().toISOString() }], { onConflict: 'team_name,competition' });
  }
}

module.exports = { predictMatch, getStreakTracker, getAllPicks, updateTeamStatsAfterMatch };