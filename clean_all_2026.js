const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const COMPETITIONS = {
  'BSA': { seasonStart: '2026-04-01' },
  'PL': { seasonStart: '2026-08-15' },
  'PD': { seasonStart: '2026-08-15' },
  'BL1': { seasonStart: '2026-08-22' },
  'SA': { seasonStart: '2026-08-22' },
  'FL1': { seasonStart: '2026-08-15' },
  'DED': { seasonStart: '2026-08-08' },
  'PPL': { seasonStart: '2026-08-08' },
  'ELC': { seasonStart: '2026-08-08' }
};

async function cleanAll() {
  console.log('=== CLEANING WRONG 2026 DATA FOR ALL LEAGUES ===\n');
  console.log('Deleting any 2026 finished match with date BEFORE the season start date.\n');

  let totalDeleted = 0;

  for (const [code, info] of Object.entries(COMPETITIONS)) {
    console.log(`${code}: Deleting matches before ${info.seasonStart}...`);

    const { data, error } = await supabase
      .from('fixtures')
      .delete()
      .eq('competition_code', code)
      .eq('season', '2026')
      .eq('status', 'FT')
      .lt('match_date', info.seasonStart);

    if (error) {
      console.log(`   ❌ Error: ${error.message}`);
    } else {
      // Supabase delete doesn't return count easily, let's check
      const { count, error: countErr } = await supabase
        .from('fixtures')
        .select('*', { count: 'exact', head: true })
        .eq('competition_code', code)
        .eq('season', '2026')
        .eq('status', 'FT')
        .lt('match_date', info.seasonStart);

      if (!countErr && count === 0) {
        console.log(`   ✅ Cleaned`);
      } else {
        console.log(`   ⚠️ May still have ${count || '?'} old matches`);
      }
    }
  }

  console.log('\n========================================');
  console.log('CLEANUP COMPLETE');
  console.log('========================================');
  console.log('\nNext steps:');
  console.log('1. Run: node sync_2026_finished.js (fetches REAL 2026 matches)');
  console.log('2. Restart server: node server_v2.js');
  console.log('3. Check: node check_all_leagues_2026.js');
}

cleanAll().catch(console.error);