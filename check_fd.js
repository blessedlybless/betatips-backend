const { getCompetitions, getStandings, getMatches, COMPETITIONS } = require('./football_data_service');
require('dotenv').config();

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

async function main() {
  console.log('=== Football-Data.org API Check ===\n');

  if (!API_KEY) {
    console.log('❌ FOOTBALL_DATA_API_KEY not found in .env');
    return;
  }
  console.log('✅ API key found');
  console.log(`Key: ${API_KEY.substring(0, 8)}...${API_KEY.substring(API_KEY.length - 4)}\n`);

  // Test 1: Competitions
  console.log('Test 1: Fetching competitions...');
  try {
    const comps = await getCompetitions();
    const freeComps = comps.competitions?.filter(c => 
      Object.keys(COMPETITIONS).includes(c.code)
    ) || [];
    console.log(`Found ${freeComps.length} free-tier competitions`);
    freeComps.slice(0, 5).forEach(c => {
      console.log(`  - ${c.name} (${c.code})`);
    });
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  // Test 2: Premier League matches (most reliable)
  console.log('\nTest 2: Fetching Premier League finished matches...');
  try {
    const matches = await getMatches('PL', 'FINISHED', '2024-08-01', '2025-06-30');
    const finished = matches.matches?.filter(m => m.status === 'FINISHED') || [];
    console.log(`Found ${finished.length} finished matches`);

    if (finished.length > 0) {
      const sample = finished[0];
      console.log(`\nSample match:`);
      console.log(`  ${sample.homeTeam.shortName || sample.homeTeam.name} vs ${sample.awayTeam.shortName || sample.awayTeam.name}`);
      console.log(`  Date: ${sample.utcDate}`);
      console.log(`  Score: ${sample.score.fullTime.home}-${sample.score.fullTime.away}`);
      console.log(`  Status: ${sample.status}`);
      console.log(`  Matchday: ${sample.matchday}`);

      // Show we can calculate stats
      console.log(`\n  Calculating team stats from ${finished.length} matches...`);
      const teamGoals = {};
      finished.forEach(m => {
        const hId = m.homeTeam.id;
        const aId = m.awayTeam.id;
        const hName = m.homeTeam.shortName || m.homeTeam.name;
        const aName = m.awayTeam.shortName || m.awayTeam.name;
        const hG = m.score.fullTime.home || 0;
        const aG = m.score.fullTime.away || 0;

        if (!teamGoals[hId]) teamGoals[hId] = { name: hName, for: 0, against: 0, games: 0 };
        if (!teamGoals[aId]) teamGoals[aId] = { name: aName, for: 0, against: 0, games: 0 };

        teamGoals[hId].for += hG;
        teamGoals[hId].against += aG;
        teamGoals[hId].games++;
        teamGoals[aId].for += aG;
        teamGoals[aId].against += hG;
        teamGoals[aId].games++;
      });

      const sorted = Object.values(teamGoals)
        .sort((a, b) => b.for - a.for)
        .slice(0, 5);

      console.log(`\nTop 5 scoring teams:`);
      sorted.forEach(t => {
        console.log(`  ${t.name}: ${t.for} goals in ${t.games} games (avg ${(t.for/t.games).toFixed(2)} GF/game)`);
      });
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
    if (e.response) {
      console.log(`Status: ${e.response.status}`);
      console.log(`Data: ${JSON.stringify(e.response.data)}`);
    }
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
