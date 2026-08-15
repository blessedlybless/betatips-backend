require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

supabase.from('team_stats').select('team_name,competition,games_played')
  .then(({ data }) => {
    data.filter(t => t.games_played === 0).forEach(t => console.log(t.competition, t.team_name));
  });