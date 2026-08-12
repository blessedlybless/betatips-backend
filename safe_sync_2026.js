const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

const COMPETITIONS = {
  'BSA': { id: 2013, name: 'Campeonato Brasileiro Série A', seasonStart: '2026-04-01' },
  'PL': { id: 2021, name: 'Premier League', seasonStart: '2026-08-15' },
  'PD': { id: 2014, name: 'Primera Division', seasonStart: '2026-08-15' },
  'BL1': { id: 2002, name: 'Bundesliga', seasonStart: '2026-08-22' },
  'SA': { id: 2019, name: 'Serie A', seasonStart: '2026-08-22' },
  'FL1': { id: 2015, name: 'Ligue 1', seasonStart: '2026-08-15' },
  'DED': { id: 2003, name: 'Eredivisie', seasonStart: '2026-08-08' },
  'PPL': { id: 2017, name: 'Primeira Liga', seasonStart: '2026-08-08' },
  'ELC': { id: 2016, name: 'Championship', seasonStart: '2026-08-08' }
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

async function safeSync() {
  console.log('=== SAFE SYNC 2026 FINISHED MATCHES ===\n');
  console.log('This version validates match dates to prevent saving');
  console.log('old season data as new season data.\n');

  let totalSaved = 0;
  let totalSkipped = 0;

  for (const [code, info] of Object.entries(COMPETITIONS)) {
    console.log(`📊 ${code} - ${info.name}`);
    console.log(`   Season starts: ${info.seasonStart}`);

    const matches = await fetchFinishedMatches(code, info.id);
    console.log(`   API returned ${matches.length} finished 2026 matches`);

    if (matches.length === 0) {
      console.log(`   ℹ️ No data`);
      await delay(6000);
      continue;
    }

    // Validate: only keep matches ON or AFTER season start date
    const validMatches = matches.filter(m => {
      const matchDate = new Date(m.utcDate);
      const seasonStart = new Date(info.seasonStart);
      return matchDate >= seasonStart;
    });

    const invalidCount = matches.length - validMatches.length;
    if (invalidCount > 0) {
      console.log(`   ⚠️ Filtered out ${invalidCount} matches from BEFORE ${info.seasonStart}`);
      console.log(`   (These would have been saved as wrong season data)`);
    }

    if (validMatches.length === 0) {
      console.log(`   ℹ️ No VALID 2026 matches yet`);
      await delay(6000);
      continue;
    }

    console.log(`   Valid matches to save: ${validMatches.length}`);

    // Check existing
    const { data: existing } = await supabase
      .from('fixtures')
      .select('home_team, away_team, match_date')
      .eq('competition_code', code)
      .eq('season', '2026');

    const keys = new Set();
    if (existing) existing.forEach(f => keys.add(`${f.home_team}|${f.away_team}|${f.match_date}`));

    const toInsert = [];
    for (const m of validMatches) {
      const key = `${m.homeTeam.name}|${m.awayTeam.name}|${m.utcDate}`;
      if (keys.has(key)) continue;

      toInsert.push({
        home_team: m.homeTeam.name,
        away_team: m.awayTeam.name,
        home_team_id: m.homeTeam.id,
        away_team_id: m.awayTeam.id,
        league: info.name,
        competition_code: code,
        match_date: m.utcDate,
        status: 'FT',
        home_goals: m.score.fullTime.home,
        away_goals: m.score.fullTime.away,
        season: '2026',
        matchday: m.matchday || null
      });
    }

    if (toInsert.length === 0) {
      console.log(`   ✅ All ${validMatches.length} already in database`);
    } else {
      const { error } = await supabase.from('fixtures').insert(toInsert);
      if (error) {
        console.log(`   ❌ Insert error: ${error.message}`);
      } else {
        console.log(`   ✅ Saved ${toInsert.length} new matches`);
        totalSaved += toInsert.length;
      }
    }

    await delay(6000);
  }

  console.log('\n========================================');
  console.log('SAFE SYNC COMPLETE');
  console.log(`Total new matches saved: ${totalSaved}`);
  console.log('========================================');
  console.log('\nNow run: node sync_2026_finished.js to rebuild team_stats');
}

safeSync().catch(console.error);