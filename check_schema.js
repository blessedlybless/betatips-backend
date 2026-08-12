const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSchema() {
  console.log('=== CHECKING DATABASE SCHEMA ===\n');

  // Check fixtures table
  console.log('1. Fixtures table sample:');
  const { data: fixtures, error: fErr } = await supabase
    .from('fixtures')
    .select('*')
    .limit(3);

  if (fErr) {
    console.log('   Error:', fErr.message);
  } else if (fixtures && fixtures.length > 0) {
    console.log('   Columns:', Object.keys(fixtures[0]).join(', '));
    console.log('   Sample row:', JSON.stringify(fixtures[0], null, 2));
  } else {
    console.log('   No fixtures found');
  }

  // Check team_stats table
  console.log('\n2. Team_stats table sample:');
  const { data: stats, error: sErr } = await supabase
    .from('team_stats')
    .select('*')
    .limit(3);

  if (sErr) {
    console.log('   Error:', sErr.message);
  } else if (stats && stats.length > 0) {
    console.log('   Columns:', Object.keys(stats[0]).join(', '));
    console.log('   Sample row:', JSON.stringify(stats[0], null, 2));
  } else {
    console.log('   No team_stats found');
  }

  // Check if competition column exists with different name
  console.log('\n3. Checking for competition-related columns...');
  if (fixtures && fixtures.length > 0) {
    const keys = Object.keys(fixtures[0]);
    const compCols = keys.filter(k => k.includes('comp') || k.includes('league') || k.includes('code'));
    console.log('   Possible competition columns:', compCols.length > 0 ? compCols.join(', ') : 'None found');
  }
}

checkSchema().catch(console.error);