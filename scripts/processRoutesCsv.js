import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.resolve(__dirname, '../public/assets/aistudio/kolkata_bus_routes_complete-____________________f4287ffd.csv');
const rawCsv = fs.readFileSync(csvPath, 'utf-8');

// Known coordinates for Kolkata transit landmarks
const KNOWN_COORDS = {
  'howrah station': { lat: 22.5835, lng: 88.3426 },
  'howrah maidan': { lat: 22.5878, lng: 88.3289 },
  'esplanade': { lat: 22.5658, lng: 88.3512 },
  'park street': { lat: 22.5522, lng: 88.3518 },
  'maidan': { lat: 22.5565, lng: 88.3485 },
  'rabindra sadan': { lat: 22.5398, lng: 88.3492 },
  'exide': { lat: 22.5398, lng: 88.3492 },
  'hazra': { lat: 22.5245, lng: 88.3475 },
  'kalighat': { lat: 22.5186, lng: 88.3472 },
  'rashbehari': { lat: 22.5186, lng: 88.3524 },
  'deshapriya park': { lat: 22.5218, lng: 88.3524 },
  'gariahut': { lat: 22.5186, lng: 88.3653 },
  'golpark': { lat: 22.5123, lng: 88.3658 },
  'dhakuria': { lat: 22.5112, lng: 88.3685 },
  'jadavpur 8b': { lat: 22.4988, lng: 88.3718 },
  'jadavpur': { lat: 22.4988, lng: 88.3718 },
  'sealdah': { lat: 22.5697, lng: 88.3714 },
  'moulali': { lat: 22.5592, lng: 88.3681 },
  'rajabazar': { lat: 22.5742, lng: 88.3742 },
  'maniktala': { lat: 22.5852, lng: 88.3742 },
  'shyambazar': { lat: 22.6025, lng: 88.3719 },
  'ultadanga': { lat: 22.5975, lng: 88.3888 },
  'belgachia': { lat: 22.6075, lng: 88.3842 },
  'dunlop': { lat: 22.6521, lng: 88.3789 },
  'dakshineswar': { lat: 22.6542, lng: 88.3582 },
  'airport gate 1': { lat: 22.6547, lng: 88.4467 },
  'airport': { lat: 22.6547, lng: 88.4467 },
  'airport gate 3': { lat: 22.6489, lng: 88.4412 },
  'karunamoyee': { lat: 22.5872, lng: 88.4239 },
  'sector v': { lat: 22.5765, lng: 88.4344 },
  'college more': { lat: 22.5765, lng: 88.4344 },
  'newtown': { lat: 22.5812, lng: 88.4598 },
  'ecospace': { lat: 22.5932, lng: 88.4821 },
  'shapoorji': { lat: 22.6012, lng: 88.4988 },
  'ruby': { lat: 22.5134, lng: 88.3988 },
  'science city': { lat: 22.5392, lng: 88.3965 },
  'chingrighata': { lat: 22.5652, lng: 88.4012 },
  'barasat': { lat: 22.7234, lng: 88.4812 },
  'barasat chapadali': { lat: 22.7234, lng: 88.4812 },
  'madhyamgram': { lat: 22.6985, lng: 88.4621 },
  'birati': { lat: 22.6712, lng: 88.4418 },
  'behala chowrasta': { lat: 22.4935, lng: 88.3142 },
  'taratala': { lat: 22.5142, lng: 88.3195 },
  'kidderpore': { lat: 22.5375, lng: 88.3242 },
  'tollygunge metro': { lat: 22.4982, lng: 88.3458 },
  'kudghat': { lat: 22.4892, lng: 88.3452 },
  'bansdroni': { lat: 22.4785, lng: 88.3482 },
  'garia': { lat: 22.4645, lng: 88.3752 },
  'garia metro': { lat: 22.4645, lng: 88.3752 },
  'garia station': { lat: 22.4612, lng: 88.3842 },
  'santragachi': { lat: 22.5785, lng: 88.2812 },
  'nabanna': { lat: 22.5592, lng: 88.3285 },
};

function getCoords(stopName, index, total, originCoords, destCoords) {
  const clean = stopName.toLowerCase().trim();
  for (const [key, val] of Object.entries(KNOWN_COORDS)) {
    if (clean.includes(key)) {
      return { lat: val.lat, lng: val.lng };
    }
  }

  // Linear interpolation between origin and destination with slight jitter
  if (originCoords && destCoords && total > 1) {
    const fraction = index / (total - 1);
    const lat = originCoords.lat + (destCoords.lat - originCoords.lat) * fraction + (Math.random() - 0.5) * 0.005;
    const lng = originCoords.lng + (destCoords.lng - originCoords.lng) * fraction + (Math.random() - 0.5) * 0.005;
    return { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) };
  }

  // Kolkata central fallback with spread
  const seed = (stopName.length * 13 + index * 17) % 100;
  return {
    lat: Number((22.5000 + (seed / 100) * 0.1500).toFixed(4)),
    lng: Number((88.3200 + ((100 - seed) / 100) * 0.1400).toFixed(4)),
  };
}

const lines = rawCsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
console.log(`Total CSV lines: ${lines.length}`);

const routesMap = new Map();

// Parse line by line
for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  
  // Custom CSV parser handling comma within fields
  const tokens = [];
  let inQuotes = false;
  let cur = '';
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) {
      tokens.push(cur.trim());
      cur = '';
    } else {
      cur += char;
    }
  }
  tokens.push(cur.trim());

  if (tokens.length < 9) continue;

  const [slNo, rawRouteNo, type, scope, destinationCol, originCol, destCol, totalStopsCol, allStopsStr] = tokens;
  
  if (!rawRouteNo || !allStopsStr) continue;

  const routeNo = rawRouteNo.trim().toUpperCase();
  const origin = (originCol || '').trim();
  const destination = (destCol || destinationCol || '').trim();
  const stopNames = allStopsStr.split('→').map((s) => s.trim()).filter((s) => s.length > 0);

  if (stopNames.length < 2) continue;

  // Key by routeNo + origin + destination to handle both return trips and route variants
  const routeKey = `${routeNo}_${origin}_${destination}`.replace(/[^A-Za-z0-9_-]/g, '_');

  if (!routesMap.has(routeKey)) {
    const originCoords = getCoords(origin, 0, 2);
    const destCoords = getCoords(destination, 1, 2);

    const stops = stopNames.map((name, idx) => {
      const coords = getCoords(name, idx, stopNames.length, originCoords, destCoords);
      return {
        id: `${routeNo.toLowerCase().replace(/[^a-z0-9]/g, '')}-${idx + 1}`,
        name,
        lat: coords.lat,
        lng: coords.lng,
        sequence: idx + 1,
        distanceFromStartKm: Number((idx * 1.8).toFixed(1)),
        isTerminal: idx === 0 || idx === stopNames.length - 1,
      };
    });

    const isAc = type.toLowerCase().includes('ac') || routeNo.includes('AC');
    const isGovt = type.toLowerCase().includes('government') || routeNo.startsWith('S-') || routeNo.startsWith('E-');

    routesMap.set(routeKey, {
      id: `route-${routeKey.toLowerCase().substring(0, 40)}`,
      routeNumber: routeNo,
      name: `${origin} to ${destination}`,
      origin: origin || stopNames[0],
      destination: destination || stopNames[stopNames.length - 1],
      category: isAc ? 'ac_express' : isGovt ? 'government' : 'private',
      color: isAc ? '#059669' : isGovt ? '#0284c7' : '#d97706',
      firstBus: '05:30 AM',
      lastBus: '10:00 PM',
      frequencyMins: Math.floor(10 + Math.random() * 10),
      fareStartingInr: isAc ? 25 : 12,
      stops,
      isActive: true,
    });
  }
}

const allRoutes = Array.from(routesMap.values());
console.log(`Parsed ${allRoutes.length} distinct routes from CSV!`);

// Save to JSON dataset
const outputPath = path.resolve(__dirname, '../src/data/kolkata_complete_routes.json');
fs.writeFileSync(outputPath, JSON.stringify(allRoutes, null, 2), 'utf-8');
console.log(`Saved ${allRoutes.length} routes to ${outputPath}`);
