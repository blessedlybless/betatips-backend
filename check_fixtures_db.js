const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  console.log('=== CHECKING DATABASE FIXTURES ===');
  console.log('Today:', new Date().toISOString());
  console.log();

  // Check ALL fixtures (any status)
  const { data: all, error: allErr } = await supabase
    .from('fixtures')
    .select('*')
    .eq('competition_code', 'BSA')
    .order('match_date', { ascending: true });

  if (allErr) {
    console.log('Error:', allErr.message);
    return;
  }

  console.log('Total BSA fixtures in database:', all ? all.length : 0);
  console.log();

  // Show upcoming (status = NS)
  const upcoming = all ? all.filter(f => f.status === 'NS') : [];
  console.log('Upcoming (status=NS):', upcoming.length);

  if (upcoming.length > 0) {
    upcoming.forEach(f => {
      console.log('  ' + f.home_team + ' vs ' + f.away_team + ' | ' + f.match_date + ' | status=' + f.status);
    });
  } else {
    console.log('  No upcoming fixtures found');
  }

  console.log();

  // Show finished (status = FT)
  const finished = all ? all.filter(f => f.status === 'FT') : [];
  console.log('Finished (status=FT):', finished.length);

  // Check if any have future dates but wrong status
  const now = new Date().toISOString();
  const futureButNotNS = all ? all.filter(f => f.match_date >= now && f.status !== 'NS') : [];
  console.log();
  console.log('Future dates but not status=NS:', futureButNotNS.length);
  futureButNotNS.forEach(f => {
    console.log('  ' + f.home_team + ' vs ' + f.away_team + ' | ' + f.match_date + ' | status=' + f.status);
  });
}

check().catch(console.error);