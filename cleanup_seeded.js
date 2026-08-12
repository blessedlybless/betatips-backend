const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function cleanup() {
  console.log('=== CLEANING UP SEEDED FIXTURES ===');
  console.log();

  // Show all upcoming fixtures before cleanup
  const { data: before, error: beforeErr } = await supabase
    .from('fixtures')
    .select('*')
    .eq('status', 'NS')
    .gte('match_date', new Date().toISOString())
    .order('match_date', { ascending: true });

  if (beforeErr) {
    console.log('Error reading fixtures:', beforeErr.message);
    return;
  }

  console.log('Before cleanup:', before.length, 'upcoming fixtures');
  before.forEach(f => {
    const source = f.home_team_id ? 'REAL (API)' : 'FAKE (seeded)';
    console.log('  [' + source + '] ' + f.home_team + ' vs ' + f.away_team + ' - ' + f.match_date);
  });
  console.log();

  // Delete fixtures WITHOUT team_id (these are the seeded fake ones)
  console.log('Deleting seeded fixtures (no team_id)...');
  const { data: deleted, error: delErr } = await supabase
    .from('fixtures')
    .delete()
    .eq('status', 'NS')
    .is('home_team_id', null);

  if (delErr) {
    console.log('Error deleting:', delErr.message);
    return;
  }

  console.log('Deleted seeded fixtures');
  console.log();

  // Show remaining fixtures
  const { data: after, error: afterErr } = await supabase
    .from('fixtures')
    .select('*')
    .eq('status', 'NS')
    .gte('match_date', new Date().toISOString())
    .order('match_date', { ascending: true });

  if (afterErr) {
    console.log('Error reading after:', afterErr.message);
    return;
  }

  console.log('After cleanup:', after.length, 'upcoming fixtures (all real)');
  after.forEach(f => {
    console.log('  [REAL] ' + f.home_team + ' vs ' + f.away_team + ' - ' + f.match_date);
  });

  console.log();
  console.log('Done! Restart your server and refresh frontend.');
}

cleanup().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});