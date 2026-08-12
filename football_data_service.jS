const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const BASE_URL = 'https://api.football-data.org/v4';

const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    'X-Auth-Token': API_KEY
  },
  timeout: 15000
});

// Rate limit: 10 requests per minute
let lastRequestTime = 0;
const MIN_DELAY_MS = 7000; // 7 seconds between requests

async function rateLimitedRequest(config) {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_DELAY_MS) {
    const wait = MIN_DELAY_MS - timeSinceLast;
    console.log(`  Rate limit: waiting ${wait}ms...`);
    await new Promise(r => setTimeout(r, wait));
  }
  lastRequestTime = Date.now();

  try {
    const response = await apiClient(config);
    return response.data;
  } catch (error) {
    if (error.response?.status === 429) {
      console.log('  ⚠️ Rate limited. Waiting 30s...');
      await new Promise(r => setTimeout(r, 30000));
      lastRequestTime = Date.now();
      const response = await apiClient(config);
      return response.data;
    }
    throw error;
  }
}

// Competition codes for free tier
const COMPETITIONS = {
  'PL': { name: 'Premier League', country: 'England' },
  'PD': { name: 'La Liga', country: 'Spain' },
  'BL1': { name: 'Bundesliga', country: 'Germany' },
  'SA': { name: 'Serie A', country: 'Italy' },
  'FL1': { name: 'Ligue 1', country: 'France' },
  'CL': { name: 'Champions League', country: 'Europe' },
  'EL': { name: 'Europa League', country: 'Europe' },
  'EC': { name: 'European Championship', country: 'Europe' },
  'WC': { name: 'World Cup', country: 'World' },
  'BSA': { name: 'Campeonato Brasileiro', country: 'Brazil' },
  'DED': { name: 'Eredivisie', country: 'Netherlands' },
  'PPL': { name: 'Primeira Liga', country: 'Portugal' }
};

async function getCompetitions() {
  return rateLimitedRequest({ method: 'GET', url: '/competitions' });
}

async function getStandings(competitionCode, season = null) {
  const url = season 
    ? `/competitions/${competitionCode}/standings?season=${season}`
    : `/competitions/${competitionCode}/standings`;
  return rateLimitedRequest({ method: 'GET', url });
}

async function getMatches(competitionCode, status = null, dateFrom = null, dateTo = null, season = null) {
  let url = `/competitions/${competitionCode}/matches`;
  const params = [];
  if (status) params.push(`status=${status}`);
  if (dateFrom) params.push(`dateFrom=${dateFrom}`);
  if (dateTo) params.push(`dateTo=${dateTo}`);
  if (season) params.push(`season=${season}`);
  if (params.length > 0) url += '?' + params.join('&');

  return rateLimitedRequest({ method: 'GET', url });
}

async function getTeamMatches(teamId, dateFrom = null, dateTo = null) {
  let url = `/teams/${teamId}/matches`;
  const params = [];
  if (dateFrom) params.push(`dateFrom=${dateFrom}`);
  if (dateTo) params.push(`dateTo=${dateTo}`);
  if (params.length > 0) url += '?' + params.join('&');

  return rateLimitedRequest({ method: 'GET', url });
}

module.exports = {
  getCompetitions,
  getStandings,
  getMatches,
  getTeamMatches,
  COMPETITIONS,
  rateLimitedRequest
};
