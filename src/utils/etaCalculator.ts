import { BusStand, BusRoute, Trip } from '../types';

export interface BusLocationInput {
  lat: number;
  lng: number;
  speedKmh?: number;
  timestamp?: string;
  currentStopId?: string;
  nextStopId?: string;
}

export interface BusEtaResult {
  busStandId: string;
  busStandName: string;
  directDistanceKm: number;
  roadDistanceKm: number;
  formattedDistance: string;
  estimatedMinutes: number;
  formattedEta: string;
  arrivalTime: Date;
  formattedArrivalTime: string;
  status: 'arrived' | 'approaching' | 'in_transit' | 'distant';
  statusLabel: string;
  trafficCondition: 'smooth' | 'moderate' | 'congested';
  trafficLabel: string;
  effectiveSpeedKmh: number;
  intermediateStopsCount?: number;
}

/**
 * Calculates Haversine spherical distance between two geographic coordinates in kilometers.
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates estimated arrival time (ETA) for a bus arriving at a target bus stand or stop.
 * Takes into account road detour winding factors, intermediate stop dwell times, and Kolkata traffic dynamics.
 */
export function calculateBusEta(
  busLocation: BusLocationInput,
  targetStand: { id: string; name: string; lat: number; lng: number },
  route?: BusRoute
): BusEtaResult {
  // 1. Direct Euclidean distance
  const directDistanceKm = calculateHaversineDistanceKm(
    busLocation.lat,
    busLocation.lng,
    targetStand.lat,
    targetStand.lng
  );

  // 2. Kolkata road curvature / detour coefficient (typically ~1.28x direct distance in urban street grids)
  const roadDetourFactor = 1.28;
  const roadDistanceKm = Number((directDistanceKm * roadDetourFactor).toFixed(2));

  // 3. Traffic Speed Model
  // Urban Kolkata average speed ranges from 16 to 28 km/h
  const rawSpeed = busLocation.speedKmh ?? 22;
  let effectiveSpeedKmh = 22; // urban default fallback
  let trafficCondition: 'smooth' | 'moderate' | 'congested' = 'moderate';
  let trafficLabel = 'স্বাভাবিক ট্রাফিক (Normal Traffic)';

  if (rawSpeed <= 8) {
    // Bus is halted or in signal queue; assume sluggish movement + impending motion
    effectiveSpeedKmh = 14;
    trafficCondition = 'congested';
    trafficLabel = 'ধীরগতি / সিগন্যাল জ্যাম (Heavy Traffic)';
  } else if (rawSpeed > 26) {
    effectiveSpeedKmh = Math.min(35, rawSpeed);
    trafficCondition = 'smooth';
    trafficLabel = 'দ্রুত / ক্লিয়ার রোড (Clear Road)';
  } else {
    effectiveSpeedKmh = rawSpeed;
    trafficCondition = 'moderate';
    trafficLabel = 'চলমান ট্রাফিক (Moderate Traffic)';
  }

  // 4. Intermediate stops dwell time (assume 35-45 sec per stop if route is known)
  let intermediateStopsCount = 0;
  if (route && route.stops && route.stops.length > 0) {
    const targetIdx = route.stops.findIndex(
      (s) => s.id === targetStand.id || s.name.toLowerCase() === targetStand.name.toLowerCase()
    );
    if (targetIdx !== -1) {
      // Find current/next stop index
      let currentIdx = -1;
      if (busLocation.nextStopId) {
        currentIdx = route.stops.findIndex((s) => s.id === busLocation.nextStopId);
      } else if (busLocation.currentStopId) {
        currentIdx = route.stops.findIndex((s) => s.id === busLocation.currentStopId);
      }

      if (currentIdx !== -1 && targetIdx >= currentIdx) {
        intermediateStopsCount = targetIdx - currentIdx;
      }
    }
  }

  // Intermediate dwell time addition (0.6 minutes per stop)
  const dwellMinutes = intermediateStopsCount * 0.6;

  // 5. Total ETA Minutes calculation
  const travelHours = roadDistanceKm / effectiveSpeedKmh;
  const rawMinutes = travelHours * 60 + dwellMinutes;
  let estimatedMinutes = Math.max(1, Math.round(rawMinutes));

  // If extremely close (< 180 meters)
  if (directDistanceKm < 0.18) {
    estimatedMinutes = 1;
  }

  // 6. Arrival Clock Time
  const arrivalTime = new Date(Date.now() + estimatedMinutes * 60 * 1000);
  const formattedArrivalTime = arrivalTime.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  // 7. Status classification
  let status: 'arrived' | 'approaching' | 'in_transit' | 'distant' = 'in_transit';
  let statusLabel = 'পথে রয়েছে (In Transit)';

  if (directDistanceKm < 0.25 || estimatedMinutes <= 1) {
    status = 'arrived';
    statusLabel = 'এখনই আসছে (Arriving Now)';
  } else if (directDistanceKm < 2.0 || estimatedMinutes <= 6) {
    status = 'approaching';
    statusLabel = 'কাছাকাছি আসছে (Approaching)';
  } else if (directDistanceKm >= 8.0) {
    status = 'distant';
    statusLabel = 'দূরবর্তী (Far Out)';
  }

  // 8. Formatted strings
  const formattedDistance =
    directDistanceKm < 1
      ? `${Math.round(directDistanceKm * 1000)} m`
      : `${directDistanceKm.toFixed(1)} km`;

  const formattedEta =
    estimatedMinutes <= 1
      ? 'এখনই (Now)'
      : `${estimatedMinutes} মিনিট (${estimatedMinutes} mins)`;

  return {
    busStandId: targetStand.id,
    busStandName: targetStand.name,
    directDistanceKm,
    roadDistanceKm,
    formattedDistance,
    estimatedMinutes,
    formattedEta,
    arrivalTime,
    formattedArrivalTime,
    status,
    statusLabel,
    trafficCondition,
    trafficLabel,
    effectiveSpeedKmh,
    intermediateStopsCount,
  };
}

/**
 * Sorts and filters approaching buses to a given bus stand by ETA ascending.
 */
export function getBusesApproachingStand(
  trips: Trip[],
  stand: BusStand,
  routes: BusRoute[]
): Array<{
  trip: Trip;
  eta: BusEtaResult;
  route?: BusRoute;
}> {
  return trips
    .filter((t) => t.status === 'active' && Boolean(t.currentLocation))
    .map((trip) => {
      const route = routes.find((r) => r.id === trip.routeId);
      const eta = calculateBusEta(trip.currentLocation!, stand, route);
      return { trip, eta, route };
    })
    .sort((a, b) => a.eta.estimatedMinutes - b.eta.estimatedMinutes);
}
