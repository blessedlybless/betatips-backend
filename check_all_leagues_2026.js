const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const COMPETITIONS = {
  'BSA': { name: 'Campeonato Brasileiro Série A', seasonStart: '2026-04-01' },
  'PL': { name: 'Premier League', seasonStart: '2026-08-15' },
  'PD': { name: 'Primera Division', seasonStart: '2026-08-15' },
  'BL1': { name: 'Bundesliga', seasonStart: '2026-08-22' },
  'SA': { name: 'Serie A', seasonStart: '2026-08-22' },
  'FL1': { name: 'Ligue 1', seasonStart: '2026-08-15' },
  'DED': { name: 'Eredivisie', seasonStart: '2026-08-08' },
  'PPL': { name: 'Primeira Liga', seasonStart: '2026-08-08' },
  'ELC': { name: 'Championship', seasonStart: '2026-08-08' }
};

async function checkAll() {
  console.log('=== CHECKING ALL LEAGUES FOR WRONG 2026 DATA ===\n');
  console.log('Leagues that JUST started should have 0-2 finished 2026 matches.\n');

  let hasProblems = false;

  for (const [code, info] of Object.entries(COMPETITIONS)) {
    const { data, error } = await supabase
      .from('fixtures')
      .select('*')
      .eq('competition_code', code)
      .eq('season', '2026')
      .eq('status', 'FT')
      .order('match_date', { ascending: false });

    if (error) {
      console.log(`${code}: Error - ${error.message}`);
      continue;
    }

    const count = data ? data.length : 0;

    if (count === 0) {
      console.log(`${code}: ✅ 0 finished 2026 matches (correct for early season)`);
      continue;
    }

    // Check dates
    const newest = data[0];
    const newestDate = new Date(newest.match_date);
    const seasonStart = new Date(info.seasonStart);
    const today = new Date('2026-08-08');

    const daysSinceStart = Math.floor((today - seasonStart) / (1000 * 60 * 60 * 24));
    const expectedMax = Math.max(0, Math.floor(daysSinceStart / 7) * 2); // ~2 matches per week

    console.log(`\n${code} - ${info.name}:`);
    console.log(`   Season starts: ${info.seasonStart}`);
    console.log(`   Finished 2026 matches: ${count}`);
    console.log(`   Newest match: ${newest.match_date.substring(0,10)} | ${newest.home_team} vs ${newest.away_team}`);
    console.log(`   Expected max: ~${expectedMax} matches`);

    if (newestDate < seasonStart) {
      console.log(`   ❌ PROBLEM: Newest match is BEFORE season start!`);
      console.log(`      These are OLD matches saved as 2026. NEEDS CLEANUP.`);
      hasProblems = true;
    } else if (count > expectedMax + 5) {
      console.log(`   ❌ PROBLEM: Way too many matches for early season!`);
      console.log(`      Expected ~${expectedMax}, found ${count}. NEEDS CLEANUP.`);
      hasProblems = true;
    } else {
      console.log(`   ✅ Looks correct`);
    }
  }

  console.log('\n========================================');
  if (hasProblems) {
    console.log('❌ PROBLEMS FOUND');
    console.log('Run: node clean_all_2026.js to fix all leagues');
  } else {
    console.log('✅ ALL LEAGUES LOOK CORRECT');
  }
  console.log('========================================');
}

checkAll().catch(console.error);