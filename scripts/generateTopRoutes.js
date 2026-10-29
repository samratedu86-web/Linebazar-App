import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const allRoutes = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../public/kolkata_complete_routes.json'), 'utf-8')
);

// Pick top 50 popular routes across government, private, ac_express, mini, and metro
const popularRouteNumbers = [
  'C', '1', '1A', '1B', '3B', '3C/1', '3D', '12', '12A', '12C', '13', '17', '18A', '21', '24A', '24B',
  '30B', '32A', '34B', '37', '39', '43', '44', '45', '45A', '46', '47/1', '51', '52', '54', '56',
  '78', '80A', '91', '201', '215A', '218', '222', '230', '234', '239', '253', 'S-12', 'AC-12', 'AC-9B',
  'S-4', 'S-5', 'S-9', 'AC-1', 'Metro Blue Line', 'Metro Green Line'
];

const selectedRoutes = [];
const seen = new Set();

for (const num of popularRouteNumbers) {
  const match = allRoutes.find((r) => r.routeNumber.toUpperCase() === num.toUpperCase());
  if (match && !seen.has(match.routeNumber)) {
    selectedRoutes.push(match);
    seen.add(match.routeNumber);
  }
}

// Fill up to 60 routes with other diverse routes
for (const r of allRoutes) {
  if (selectedRoutes.length >= 60) break;
  if (!seen.has(r.routeNumber)) {
    selectedRoutes.push(r);
    seen.add(r.routeNumber);
  }
}

console.log(`Selected ${selectedRoutes.length} top routes for default bundled active state.`);

const outputCode = `// Top 60 verified urban Kolkata bus routes generated from the complete 1,845 routes dataset
import { BusRoute } from '../types';

export const TOP_KOLKATA_ROUTES: BusRoute[] = ${JSON.stringify(selectedRoutes, null, 2)};
`;

fs.writeFileSync(path.resolve(__dirname, '../src/data/topRoutes.ts'), outputCode, 'utf-8');
console.log('Written to src/data/topRoutes.ts');
