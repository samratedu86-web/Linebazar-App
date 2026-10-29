import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { BusRegistration, BusRoute, BusStand, Trip, WaitSignal } from '../../types';

interface KolkataTransitMapProps {
  routes: BusRoute[];
  trips: Trip[];
  buses: BusRegistration[];
  stands: BusStand[];
  waitSignals: WaitSignal[];
  selectedRouteId?: string;
  selectedBusId?: string;
  onSelectBus?: (busId: string) => void;
  onSelectStop?: (stopId: string, stopName: string) => void;
  className?: string;
}

export const KolkataTransitMap: React.FC<KolkataTransitMapProps> = ({
  routes,
  trips,
  buses,
  stands,
  waitSignals,
  selectedRouteId,
  selectedBusId,
  onSelectBus,
  onSelectStop,
  className = 'h-[500px] w-full rounded-xl overflow-hidden shadow-sm border border-slate-200',
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const polylinesLayerRef = useRef<L.LayerGroup | null>(null);
  const [now, setNow] = useState(Date.now());

  // Heartbeat for "seconds ago"
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Kolkata Center Coordinates
    const map = L.map(mapContainerRef.current, {
      center: [22.5726, 88.3639],
      zoom: 12,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors | Linebazar Kolkata',
      maxZoom: 19,
    }).addTo(map);

    const polylinesLayer = L.layerGroup().addTo(map);
    const markersLayer = L.layerGroup().addTo(map);

    polylinesLayerRef.current = polylinesLayer;
    markersLayerRef.current = markersLayer;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Layers when data or selection changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const polylinesLayer = polylinesLayerRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !polylinesLayer || !markersLayer) return;

    polylinesLayer.clearLayers();
    markersLayer.clearLayers();

    // Determine active route or all routes
    const activeRoutes = selectedRouteId
      ? routes.filter((r) => r.id === selectedRouteId)
      : routes;

    // 1. Draw Route Polylines
    activeRoutes.forEach((route) => {
      if (!route.stops || route.stops.length < 2) return;
      const latlngs: [number, number][] = route.stops.map((s) => [s.lat, s.lng]);

      const isSelected = selectedRouteId === route.id;
      const polyline = L.polyline(latlngs, {
        color: route.color || '#0284c7',
        weight: isSelected ? 5 : 3,
        opacity: isSelected ? 0.95 : 0.65,
        dashArray: route.category === 'ac_express' ? undefined : undefined,
      });

      polyline.bindTooltip(
        `<div class="text-xs font-semibold">Route ${route.routeNumber}</div><div class="text-[11px] text-slate-500">${route.name}</div>`,
        { sticky: true }
      );

      polylinesLayer.addLayer(polyline);

      // Render Stop Markers for selected route
      if (isSelected || routes.length <= 2) {
        route.stops.forEach((stop) => {
          // Calculate wait count for this stop
          const stopWaitCount = waitSignals.filter(
            (w) => w.stopId === stop.id && w.status === 'active'
          ).length;

          const stopHtml = `
            <div class="relative group cursor-pointer flex items-center justify-center">
              <div class="w-6 h-6 rounded-full bg-white border-2 border-slate-700 shadow flex items-center justify-center text-[10px] font-bold text-slate-800">
                ${stop.sequence}
              </div>
              ${
                stopWaitCount > 0
                  ? `<span class="absolute -top-2 -right-2 bg-amber-500 text-slate-950 font-bold text-[9px] rounded-full px-1 border border-white shadow-sm tabular-nums">
                      ${stopWaitCount}
                    </span>`
                  : ''
              }
            </div>
          `;

          const stopIcon = L.divIcon({
            html: stopHtml,
            className: 'custom-stop-marker',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });

          const marker = L.marker([stop.lat, stop.lng], { icon: stopIcon });
          marker.bindPopup(`
            <div class="p-1 text-slate-900 font-sans">
              <div class="font-bold text-sm text-slate-900">${stop.name}</div>
              <div class="text-xs text-slate-500 mt-0.5">Route ${route.routeNumber} · Stop #${stop.sequence}</div>
              <div class="text-xs text-slate-600 mt-1">Distance: <span class="font-mono tabular-nums">${stop.distanceFromStartKm} km</span></div>
              ${
                stopWaitCount > 0
                  ? `<div class="mt-2 text-xs font-semibold text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                      ${stopWaitCount} passenger${stopWaitCount > 1 ? 's' : ''} currently waiting here
                     </div>`
                  : `<div class="mt-2 text-[11px] text-slate-400">No active wait signals</div>`
              }
              <button id="btn-select-stop-${stop.id}" class="mt-2 w-full py-1 px-2 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 transition">
                Select for Wait Signal
              </button>
            </div>
          `);

          marker.on('popupopen', () => {
            const btn = document.getElementById(`btn-select-stop-${stop.id}`);
            if (btn && onSelectStop) {
              btn.onclick = () => {
                onSelectStop(stop.id, stop.name);
                map.closePopup();
              };
            }
          });

          markersLayer.addLayer(marker);
        });
      }
    });

    // 2. Render Bus Stands (Terminals)
    stands.forEach((stand) => {
      const standHtml = `
        <div class="w-8 h-8 rounded-lg bg-slate-900 text-amber-400 border border-slate-700 shadow-md flex items-center justify-center font-bold text-xs" title="${stand.name}">
          ST
        </div>
      `;

      const standIcon = L.divIcon({
        html: standHtml,
        className: 'custom-stand-marker',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const marker = L.marker([stand.lat, stand.lng], { icon: standIcon });
      marker.bindPopup(`
        <div class="p-1 font-sans">
          <div class="text-xs font-bold uppercase tracking-wider text-amber-600">Bus Stand / Terminal</div>
          <div class="font-bold text-sm text-slate-900 mt-0.5">${stand.name}</div>
          <div class="text-xs text-slate-600 mt-1">${stand.location}</div>
          <div class="text-xs text-slate-500 mt-1">Capacity: <span class="font-mono tabular-nums">${stand.capacityBuses}</span> buses</div>
          <div class="text-xs text-slate-600 mt-1 font-semibold">Routes: ${stand.routesOriginating.join(', ')}</div>
        </div>
      `);
      markersLayer.addLayer(marker);
    });

    // 3. Render Active Buses with Live GPS Ping
    trips.forEach((trip) => {
      if (trip.status !== 'active' || !trip.currentLocation) return;
      const loc = trip.currentLocation;

      const isSelectedBus = selectedBusId === trip.busId;
      const bus = buses.find((b) => b.id === trip.busId);
      const route = routes.find((r) => r.id === trip.routeId);

      // Seconds ago calculation
      const pingTime = new Date(loc.timestamp).getTime();
      const secondsAgo = Math.max(0, Math.floor((now - pingTime) / 1000));

      const busHtml = `
        <div class="relative cursor-pointer transition-transform duration-300 ${isSelectedBus ? 'scale-125 z-50' : 'z-30'}">
          <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full shadow-lg border-2 ${
            isSelectedBus
              ? 'bg-amber-400 border-slate-900 text-slate-950 ring-2 ring-amber-300'
              : 'bg-slate-900 border-white text-white'
          }">
            <svg class="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 24 24">
              <path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/>
            </svg>
            <span class="text-xs font-bold tracking-tight whitespace-nowrap">${trip.routeNumber}</span>
          </div>
          <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45 border-r border-b border-white"></div>
        </div>
      `;

      const busIcon = L.divIcon({
        html: busHtml,
        className: 'custom-bus-marker',
        iconSize: [60, 28],
        iconAnchor: [30, 28],
      });

      const marker = L.marker([loc.lat, loc.lng], { icon: busIcon });

      marker.bindPopup(`
        <div class="p-1 font-sans text-slate-900 min-w-[200px]">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded">Route ${trip.routeNumber}</span>
            <span class="text-[11px] font-mono text-slate-500 tabular-nums">Updated ${secondsAgo}s ago</span>
          </div>
          <div class="font-bold text-base text-slate-900 mt-1">${trip.busNumber}</div>
          <div class="text-xs text-slate-500">${bus?.modelNumber || 'City Express'}</div>
          
          <div class="mt-2 pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
            <div>
              <div class="text-[10px] text-slate-400 uppercase">Speed</div>
              <div class="font-mono font-semibold tabular-nums text-slate-800">${loc.speedKmh} km/h</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-400 uppercase">Driver</div>
              <div class="font-semibold text-slate-800 truncate">${trip.driverName}</div>
            </div>
          </div>

          <div class="mt-2 text-xs text-slate-600 bg-slate-50 p-2 rounded">
            <div>Next Stop: <span class="font-semibold">${route?.stops.find((s) => s.id === loc.nextStopId)?.name || 'In Transit'}</span></div>
          </div>

          <button id="btn-view-bus-${trip.busId}" class="mt-2.5 w-full py-1.5 px-3 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 transition">
            View Live Details & Wait
          </button>
        </div>
      `);

      marker.on('popupopen', () => {
        const btn = document.getElementById(`btn-view-bus-${trip.busId}`);
        if (btn && onSelectBus) {
          btn.onclick = () => {
            onSelectBus(trip.busId);
            map.closePopup();
          };
        }
      });

      marker.on('click', () => {
        if (onSelectBus) onSelectBus(trip.busId);
      });

      markersLayer.addLayer(marker);
    });

    // If a specific route is selected, fit bounds smoothly
    if (selectedRouteId) {
      const selectedRoute = routes.find((r) => r.id === selectedRouteId);
      if (selectedRoute && selectedRoute.stops.length > 0) {
        const bounds = L.latLngBounds(selectedRoute.stops.map((s) => [s.lat, s.lng]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
    }
  }, [routes, trips, buses, stands, waitSignals, selectedRouteId, selectedBusId, now, onSelectBus, onSelectStop]);

  return (
    <div className="relative z-[1] isolate overflow-hidden rounded-xl">
      <div ref={mapContainerRef} className={className} />
      
      {/* Map Floating Legend */}
      <div className="absolute bottom-3 left-3 z-[5] bg-white/95 backdrop-blur-sm border border-slate-200/80 rounded-lg p-2.5 shadow-sm text-xs space-y-1.5 pointer-events-auto">
        <div className="font-semibold text-slate-800 text-[11px] uppercase tracking-wider">Kolkata Live Transit</div>
        <div className="flex items-center gap-2 text-slate-600 text-[11px]">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-900 border border-white"></span>
          <span>Live Bus (GPS active)</span>
        </div>
        <div className="flex items-center gap-2 text-slate-600 text-[11px]">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
          <span>Stop with Waiting Passengers</span>
        </div>
        <div className="flex items-center gap-2 text-slate-600 text-[11px]">
          <span className="w-2.5 h-2.5 rounded-sm bg-slate-900 text-amber-400 text-[8px] flex items-center justify-center font-bold">ST</span>
          <span>Bus Terminal / Stand</span>
        </div>
      </div>
    </div>
  );
};
