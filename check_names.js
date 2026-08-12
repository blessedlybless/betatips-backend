const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  console.log('=== TEAM NAME MATCHING CHECK ===\n');

  // Get all team stats for PL
  const { data: teams } = await supabase
    .from('team_stats')
    .select('team_name, competition')
    .eq('competition', 'PL');

  console.log('PL teams in database:');
  teams?.forEach(t => console.log(`  "${t.team_name}"`));

  // Check if "Man City" exists
  const manCity = teams?.find(t => t.team_name.toLowerCase().includes('man city') || t.team_name.toLowerCase().includes('manchester city'));
  console.log('\nMan City match:', manCity ? `"${manCity.team_name}"` : 'NOT FOUND');

  // Check if "Liverpool" exists
  const liverpool = teams?.find(t => t.team_name.toLowerCase().includes('liverpool'));
  console.log('Liverpool match:', liverpool ? `"${liverpool.team_name}"` : 'NOT FOUND');

  // Check Arsenal
  const arsenal = teams?.find(t => t.team_name.toLowerCase().includes('arsenal'));
  console.log('Arsenal match:', arsenal ? `"${arsenal.team_name}"` : 'NOT FOUND');

  // Check Chelsea
  const chelsea = teams?.find(t => t.team_name.toLowerCase().includes('chelsea'));
  console.log('Chelsea match:', chelsea ? `"${chelsea.team_name}"` : 'NOT FOUND');
}

check().catch(console.error);
