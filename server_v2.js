require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { predictMatch, getStreakTracker, getAllPicks, updateTeamStatsAfterMatch } = require('./prediction_engine_v2');
const { getMatches, COMPETITIONS } = require('./football_data_service');

// Prediction cache - prevents re-computing on every request
const predictionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedPredictions() {
  const key = 'all_picks_' + new Date().toDateString();
  const cached = predictionCache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    console.log('✅ Returning cached predictions');
    return cached.data;
  }
  return null;
}

function setCachedPredictions(data) {
  const key = 'all_picks_' + new Date().toDateString();
  predictionCache.set(key, { data, time: Date.now() });
  console.log('✅ Predictions cached for 5 minutes');
}


const app = express();
const PORT = process.env.PORT || 3001;

//app.use(cors());

app.use(cors({
  origin: [
    'http://localhost:3000',           // Local React dev
    'http://localhost:5173',           // Vite dev
    'https://www.betatips.com.ng', // Production frontend (replace with yours)
    'https://beta-front-lnqk-pi.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);


const axios = require('axios');
const crypto = require('crypto');

// ============ PAYSTACK CONFIG ============
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// ============ 2SUREODD PAYWALL ============

// Price list — single source of truth. Amounts are in main units (₦ / $);
// Paystack gets them x100 (kobo / cents). The client only ever sends
// `plan` and `currency` — never the amount — so it can't be tampered with.
const PLANS = {
  weekly:  { label: 'Weekly',  days: 7,  prices: { NGN: 1500, USD: 2 } },
  monthly: { label: 'Monthly', days: 30, prices: { NGN: 4500, USD: 5 } }
};

const cleanEmail = (e) => String(e || '').toLowerCase().trim();

// Marks a payment as paid and starts the access window. Safe to call twice
// (verify + webhook can both fire for the same payment) — only activates once.
async function activateSubscription(reference) {
  const { data: sub } = await supabase
    .from('subscriptions_2sureodd')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();

  if (!sub) return null;
  if (sub.access_granted) return sub;

  const days = PLANS[sub.plan]?.days || 7;
  const expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { data: updated } = await supabase
    .from('subscriptions_2sureodd')
    .update({
      status: 'success',
      access_granted: true,
      expires_at,
      updated_at: new Date().toISOString()
    })
    .eq('reference', reference)
    .select()
    .maybeSingle();

  return updated;
}

// Initialize payment
app.post('/api/2sureodd/pay', async (req, res) => {
  const email = cleanEmail(req.body.email);
  const { plan = 'weekly', currency = 'NGN' } = req.body;

  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
  if (!PLANS[plan].prices[currency]) return res.status(400).json({ error: 'Invalid currency' });
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Paystack not configured' });

  const amount = PLANS[plan].prices[currency]; // price comes from the server, never the browser

  try {
    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email,
      amount: amount * 100,
      currency,
      callback_url: `${req.headers.origin || 'https://betatips.com.ng'}/2sureodd?verify=true`,
      metadata: {
        custom_fields: [
          { display_name: "Product", variable_name: "product", value: `2SureOdd ${PLANS[plan].label}` }
        ]
      }
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });

    const { data } = response.data;

    const { error: insertError } = await supabase.from('subscriptions_2sureodd').insert([{
      email,
      reference: data.reference,
      amount,
      currency,
      plan,
      status: 'pending',
      access_granted: false,
      expires_at: null
    }]);

    if (insertError) {
      console.error('Supabase insert error:', insertError);
    }

    res.json({ 
      success: true, 
      authorization_url: data.authorization_url,
      reference: data.reference 
    });

  } catch (err) {
    console.error('Paystack init error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

// Verify payment
app.get('/api/2sureodd/verify', async (req, res) => {
  const { reference } = req.query;
  
  if (!reference) return res.status(400).json({ error: 'Reference required' });
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Paystack not configured' });

  try {
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    const { data } = response.data;

    const { data: sub } = await supabase
      .from('subscriptions_2sureodd')
      .select('*')
      .eq('reference', reference)
      .maybeSingle();

    // Paystack fees can be passed on to the customer, so the amount charged
    // can legitimately be a bit more than what was requested — never less.
    const amountOk = sub && data.amount >= sub.amount * 100 && data.currency === sub.currency;
    const isSuccess = data.status === 'success' && amountOk;

    if (!isSuccess) {
      console.log('Verify mismatch for', reference, {
        paystack_status: data.status,
        paystack_amount: data.amount,
        paystack_currency: data.currency,
        saved_amount_x100: sub ? sub.amount * 100 : null,
        saved_currency: sub ? sub.currency : null,
        row_found: !!sub
      });
    }

    if (isSuccess) {
      await activateSubscription(reference);
    } else if (sub) {
      await supabase
        .from('subscriptions_2sureodd')
        .update({ status: data.status, updated_at: new Date().toISOString() })
        .eq('reference', reference);
    }

    res.json({ 
      success: isSuccess, 
      message: isSuccess ? 'Payment verified' : 'Payment failed',
      email: data.customer?.email,
      reference 
    });

  } catch (err) {
    console.error('Paystack verify error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Check access
app.post('/api/2sureodd/check-access', async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const { data } = await supabase
      .from('subscriptions_2sureodd')
      .select('*')
      .eq('email', email)
      .eq('access_granted', true)
      .gte('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({
      has_access: !!data,
      expires_at: data?.expires_at || null,
      plan: data?.plan || null,
      email
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get 2SureOdd picks (MANUAL — reads from your posted picks)
app.get('/api/2sureodd/picks', async (req, res) => {
  const email = cleanEmail(req.query.email);
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const { data: sub } = await supabase
      .from('subscriptions_2sureodd')
      .select('*')
      .eq('email', email)
      .eq('access_granted', true)
      .gte('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub) {
      return res.status(403).json({ error: 'Access denied. Please subscribe.' });
    }

    const today = new Date().toISOString().split('T')[0];
    const { data: rows } = await supabase
      .from('twosureodd_picks')
      .select('*')
      .gte('match_date', today)
      .eq('status', 'active')
      .order('match_date', { ascending: true })
      .limit(2);

    const picks = (rows || []).map(p => ({
      match: p.match,
      league: p.league,
      date: p.match_date,
      prediction: p.prediction,
      confidence: p.confidence,
      odds: p.odds
    }));

    res.json({
      access: true,
      expires_at: sub.expires_at,
      plan: sub.plan,
      picks
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public: Get 2SureOdd results (for tracking page)
app.get('/api/2sureodd/results', async (req, res) => {
  try {
    const { data } = await supabase
      .from('twosureodd_picks')
      .select('*')
      .order('match_date', { ascending: false })
      .limit(30);

    const stats = {
      total: data?.length || 0,
      wins: data?.filter(p => p.result === 'WIN').length || 0,
      losses: data?.filter(p => p.result === 'LOSS').length || 0,
      pending: data?.filter(p => p.result === 'PENDING').length || 0,
      win_rate: data?.filter(p => p.result !== 'PENDING').length > 0 
        ? ((data.filter(p => p.result === 'WIN').length / data.filter(p => p.result !== 'PENDING').length) * 100).toFixed(1) 
        : 0
    };

    res.json({ picks: data || [], stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Add a 2SureOdd pick
app.post('/api/admin/2sureodd/picks', async (req, res) => {
  const { admin_key, match, league, match_date, prediction, confidence, odds } = req.body;
  
  if (admin_key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data, error } = await supabase
      .from('twosureodd_picks')
      .insert([{ match, league, match_date, prediction, confidence, odds }]);
    
    if (error) throw error;
    res.json({ success: true, pick: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Update result of a 2SureOdd pick
app.post('/api/admin/2sureodd/result', async (req, res) => {
  const { admin_key, pick_id, result } = req.body;
  
  if (admin_key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!pick_id || !['WIN', 'LOSS', 'PENDING'].includes(result)) {
    return res.status(400).json({ error: 'Need pick_id and result (WIN/LOSS/PENDING)' });
  }

  try {
    const { data, error } = await supabase
      .from('twosureodd_picks')
      .update({ 
        result, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', pick_id)
      .select();

    if (error) throw error;
    
    res.json({ 
      success: true, 
      message: `Pick marked as ${result}`,
      pick: data 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Paystack Webhook
app.post('/api/paystack/webhook', async (req, res) => {
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET)
    .update(req.rawBody) // raw bytes — JSON.stringify(req.body) rarely matches Paystack's signature
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;

  if (event.event === 'charge.success') {
    await activateSubscription(event.data.reference);
  }

  res.sendStatus(200);
});






// ============ HEALTH ============
app.get('/api/health', (req, res) => {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    api: 'football-data.org',
    mode: 'V2 - ALL PREDICTIONS + TOP PICKS',
    today: today.toISOString().split('T')[0],
    is_weekend: isWeekend,
    max_picks_today: isWeekend ? 10 : 3
  });
});

// ============ ALL PREDICTIONS + TOP PICKS ============
app.get('/api/picks/all', async (req, res) => {
  // Check cache first
  const cached = getCachedPredictions();
  if (cached) {
    return res.json(cached);
  }

  try {
    const result = await getAllPicks();
    setCachedPredictions(result);
    res.json(result);
  } catch (error) {
    console.error('All picks error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ TOP PICKS ONLY (convenience endpoint) ============
app.get('/api/picks/top', async (req, res) => {
  try {
    const result = await getAllPicks();
    
    // DEDUPLICATE TOP PICKS - each fixture only once (keep highest probability)
    const seenFixtures = new Set();
    result.top_picks = result.top_picks.filter(p => {
      if (seenFixtures.has(p.fixture_id)) return false;
      seenFixtures.add(p.fixture_id);
      return true;
    });
    
    res.json({
      date: result.date,
      is_weekend: result.is_weekend,
      max_picks: result.max_picks,
      top_picks: result.top_picks,
      total_found: result.total_found
    });
  } catch (error) {
    console.error('Top picks error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ PREDICT SINGLE MATCH ============
app.post('/api/predict', async (req, res) => {
  try {
    const { home_team, away_team, competition } = req.body;
    const result = await predictMatch(home_team, away_team, competition || 'PL');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ STREAK TRACKER ============
app.get('/api/tracker', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const tracker = await getStreakTracker(days);
    res.json(tracker);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ TODAY'S FIXTURES ============
app.get('/api/fixtures/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: fixtures } = await supabase
      .from('fixtures').select('*')
      .gte('match_date', `${today}T00:00:00`)
      .lte('match_date', `${today}T23:59:59`)
      .order('match_date', { ascending: true });
    res.json({ date: today, fixtures: fixtures || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ UPCOMING FIXTURES ============
app.get('/api/fixtures/upcoming', async (req, res) => {
  try {
    const today = new Date().toISOString();
    const { data: fixtures } = await supabase
      .from('fixtures').select('*')
      .gte('match_date', today)
      .order('match_date', { ascending: true })
      .limit(20);
    res.json({ fixtures: fixtures || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ MATCH DETAIL ============
app.get('/api/fixtures/:id', async (req, res) => {
  try {
    const { data: fixture } = await supabase.from('fixtures').select('*').eq('id', req.params.id).single();
    if (!fixture) return res.status(404).json({ error: 'Fixture not found' });

    const pred = await predictMatch(fixture.home_team, fixture.away_team, fixture.competition_code || 'PL');
    res.json({ fixture, prediction: pred });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ UPDATE RESULT + AUTO-UPDATE STATS ============
app.post('/api/fixtures/:id/result', async (req, res) => {
  try {
    const { home_goals, away_goals } = req.body;
    const { data: fixture, error } = await supabase.from('fixtures').update({
      status: 'FT', home_goals, away_goals, updated_at: new Date().toISOString()
    }).eq('id', req.params.id).select().single();
    if (error) throw error;

    console.log('🔄 Auto-updating rolling stats...');
    await updateTeamStatsAfterMatch(req.params.id);

    const { data: predictions } = await supabase.from('predictions').select('*').eq('fixture_id', req.params.id);
    if (predictions && predictions.length > 0) {
      for (const pred of predictions) {
        let result = 'PENDING';
        const market = pred.best_market;
        const hg = home_goals; const ag = away_goals;
        if (market === 'Home Win' && hg > ag) result = 'WIN';
        else if (market === 'Away Win' && ag > hg) result = 'WIN';
        else if (market === 'Home Win or Draw' && hg >= ag) result = 'WIN';
        else if (market === 'Away Win or Draw' && ag >= hg) result = 'WIN';
        else if (market === 'Over 1.5 Goals' && (hg + ag) > 1.5) result = 'WIN';
        else if (market === 'Over 2.5 Goals' && (hg + ag) > 2.5) result = 'WIN';
        else if (market === 'Both Teams To Score' && hg > 0 && ag > 0) result = 'WIN';
        else result = 'LOSS';

        await supabase.from('prediction_results').insert({
          prediction_id: pred.id, fixture_id: req.params.id,
          market: pred.best_market, result, home_goals: hg, away_goals: ag,
          created_at: new Date().toISOString()
        });
      }
    }

    res.json({
      message: 'Result updated, rolling stats recalculated, predictions evaluated.',
      fixture
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ PERFORMANCE ============
app.get('/api/performance', async (req, res) => {
  try {
    const tracker = await getStreakTracker(30);
    res.json(tracker);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ SYNC FIXTURES FROM API ============
app.post('/api/sync/fixtures', async (req, res) => {
  try {
    const { competition_code, dateFrom, dateTo } = req.body;
    if (!competition_code || !COMPETITIONS[competition_code]) {
      return res.status(400).json({ error: 'Invalid competition code', available: Object.keys(COMPETITIONS) });
    }
    const matches = await getMatches(competition_code, null, dateFrom, dateTo);
    const fixtures = (matches.matches || [])
      .filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED')
      .map(m => ({
        home_team: m.homeTeam.shortName || m.homeTeam.name,
        away_team: m.awayTeam.shortName || m.awayTeam.name,
        match_date: m.utcDate, league: COMPETITIONS[competition_code].name,
        status: m.status === 'SCHEDULED' ? 'NS' : 'LIVE',
        home_team_id: m.homeTeam.id, away_team_id: m.awayTeam.id,
        competition_code, matchday: m.matchday || null,
        season: m.season?.startDate?.substring(0, 4) || '2025'
      }));
    if (fixtures.length > 0) {
      const { error } = await supabase.from('fixtures').upsert(fixtures, { onConflict: 'home_team,away_team,match_date' });
      if (error) throw error;
    }
    res.json({ message: `Synced ${fixtures.length} fixtures`, competition: COMPETITIONS[competition_code].name, fixtures_added: fixtures.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ SEED DEMO DATA ============
app.post('/api/seed/worldcup', async (req, res) => {
  try {
    const demoFixtures = [
      { home_team: 'DR Congo', away_team: 'Uzbekistan', match_date: '2026-07-25T15:00:00', league: 'World Cup 2026', status: 'NS', competition_code: 'WC' },
      { home_team: 'Jordan', away_team: 'Argentina', match_date: '2026-07-25T15:00:00', league: 'World Cup 2026', status: 'NS', competition_code: 'WC' },
      { home_team: 'Panama', away_team: 'England', match_date: '2026-07-25T18:00:00', league: 'World Cup 2026', status: 'NS', competition_code: 'WC' },
      { home_team: 'Algeria', away_team: 'Austria', match_date: '2026-07-25T18:00:00', league: 'World Cup 2026', status: 'NS', competition_code: 'WC' },
      { home_team: 'Croatia', away_team: 'Ghana', match_date: '2026-07-25T21:00:00', league: 'World Cup 2026', status: 'NS', competition_code: 'WC' },
      { home_team: 'Saudi Arabia', away_team: 'Italy', match_date: '2026-07-26T15:00:00', league: 'World Cup 2026', status: 'NS', competition_code: 'WC' },
      { home_team: 'Mexico', away_team: 'Netherlands', match_date: '2026-07-26T18:00:00', league: 'World Cup 2026', status: 'NS', competition_code: 'WC' },
      { home_team: 'Japan', away_team: 'Belgium', match_date: '2026-07-26T21:00:00', league: 'World Cup 2026', status: 'NS', competition_code: 'WC' }
    ];

    const { data: inserted, error: fixError } = await supabase.from('fixtures').upsert(demoFixtures, { onConflict: 'home_team,away_team,match_date' }).select();
    if (fixError) throw fixError;

    const predictions = [];
    for (const fixture of inserted || demoFixtures) {
      const pred = await predictMatch(fixture.home_team, fixture.away_team, 'WC');
      if (pred.best_pick && pred.status === 'PICK') {
        predictions.push({
          fixture_id: fixture.id, best_market: pred.best_pick.market,
          best_market_code: pred.best_pick.marketCode,
          best_probability: pred.best_pick.probability,
          confidence: pred.best_pick.confidence,
          all_probabilities: pred.raw_probabilities,
          reasoning: pred.reasoning, data_quality: pred.data_quality,
          strict_mode: pred.strict_mode,
          created_at: new Date().toISOString()
        });
      }
    }
    if (predictions.length > 0) await supabase.from('predictions').insert(predictions);

    res.json({
      message: 'World Cup fixtures seeded successfully',
      fixtures_added: demoFixtures.length,
      predictions_generated: predictions.length,
      note: 'V2 mode: All predictions shown + top picks separated'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DEBUG ENDPOINTS ============
app.get('/api/debug/team-stats', async (req, res) => {
  try {
    const { data } = await supabase.from('team_stats').select('*').order('goals_for', { ascending: false }).limit(20);
    res.json({ count: data?.length || 0, teams: data || [] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/debug/fixtures', async (req, res) => {
  try {
    const { data } = await supabase.from('fixtures').select('*').order('match_date', { ascending: false }).limit(20);
    res.json({ count: data?.length || 0, fixtures: data || [] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/debug/predictions', async (req, res) => {
  try {
    const { data } = await supabase.from('predictions').select('*').order('created_at', { ascending: false }).limit(20);
    res.json({ count: data?.length || 0, predictions: data || [] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============ START SERVER ============
app.listen(PORT, () => {
  console.log(`✅ HARDCORE Predictions Server - V2`);
  console.log(`   Port: ${PORT}`);
  console.log(`   API: Football-Data.org`);
  console.log(`   Mode: ALL PREDICTIONS + TOP PICKS`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET  /api/health');
  console.log('  GET  /api/picks/all          ← ALL predictions + top picks separated');
  console.log('  GET  /api/picks/top          ← Top picks only (3 weekday, 5 weekend)');
  console.log('  POST /api/predict            ← Single match prediction');
  console.log('  GET  /api/tracker            ← Streak tracker');
  console.log('  GET  /api/performance');
  console.log('  GET  /api/fixtures/today');
  console.log('  GET  /api/fixtures/upcoming');
  console.log('  GET  /api/fixtures/:id');
  console.log('  POST /api/sync/fixtures');
  console.log('  POST /api/seed/worldcup');
  console.log('  POST /api/fixtures/:id/result');
});
