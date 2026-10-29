import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import { Plus, Minus, Crosshair, RotateCcw } from 'lucide-react';
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

const KOLKATA_CENTER: [number, number] = [22.5726, 88.3639];
const DEFAULT_ZOOM = 12;

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
  className = 'h-[520px] w-full rounded-xl overflow-hidden shadow-sm border border-slate-200',
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const polylinesLayerRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const lastFittedRouteRef = useRef<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [locating, setLocating] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);

  // Heartbeat for "seconds ago" updates
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(timer);
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Clean up any stale leaflet ID if hot-reloaded or re-mounted
    if ((mapContainerRef.current as any)._leaflet_id) {
      delete (mapContainerRef.current as any)._leaflet_id;
    }

    // Initialize Leaflet Map with full interactive zoom & drag enabled
    const map = L.map(mapContainerRef.current, {
      center: KOLKATA_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false, // Accessible custom floating controls
      scrollWheelZoom: true,
      touchZoom: true,
      doubleClickZoom: true,
      boxZoom: true,
      dragging: true,
      keyboard: true,
    });

    // Standard OpenStreetMap tiles (100% free, colorful with blue river, green parks, no API key required)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors | Linebazar Kolkata',
      maxZoom: 19,
      minZoom: 9,
    }).addTo(map);

    const polylinesLayer = L.layerGroup().addTo(map);
    const markersLayer = L.layerGroup().addTo(map);

    polylinesLayerRef.current = polylinesLayer;
    markersLayerRef.current = markersLayer;
    mapInstanceRef.current = map;

    // Track current zoom level
    map.on('zoomend', () => {
      setCurrentZoom(map.getZoom());
    });

    // Multiple staggered invalidateSize to ensure correct bounds in all rendering phases
    const t0 = setTimeout(() => map.invalidateSize(), 50);
    const t1 = setTimeout(() => map.invalidateSize(), 200);
    const t2 = setTimeout(() => map.invalidateSize(), 600);

    // ResizeObserver ensures map recalculates if tabs switch or container dynamically resizes
    let resizeObserver: ResizeObserver | null = null;
    if (window.ResizeObserver && mapContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      map.remove();
      mapInstanceRef.current = null;
      if (mapContainerRef.current && (mapContainerRef.current as any)._leaflet_id) {
        delete (mapContainerRef.current as any)._leaflet_id;
      }
    };
  }, []);

  // Handle Route Bounds fitting ONLY when selectedRouteId genuinely changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (selectedRouteId) {
      if (lastFittedRouteRef.current !== selectedRouteId) {
        lastFittedRouteRef.current = selectedRouteId;
        const selectedRoute = routes.find((r) => r.id === selectedRouteId);
        if (selectedRoute && selectedRoute.stops.length > 0) {
          const bounds = L.latLngBounds(selectedRoute.stops.map((s) => [s.lat, s.lng]));
          if (bounds.isValid()) {
            map.invalidateSize();
            const fit = () => {
              try {
                if (mapInstanceRef.current) {
                  mapInstanceRef.current.fitBounds(bounds, { padding: [45, 45], maxZoom: 14, animate: true });
                }
              } catch (e) {
                console.warn('fitBounds error:', e);
              }
            };
            if (map.getSize().x > 0 && map.getSize().y > 0) {
              fit();
            } else {
              setTimeout(fit, 150);
            }
          }
        }
      }
    } else {
      lastFittedRouteRef.current = null;
    }
  }, [selectedRouteId, routes]);

  // Update Layers when data changes (WITHOUT resetting user's manual zoom or pan)
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
      });

      polyline.bindTooltip(
        `<div class="text-xs font-semibold">Route ${route.routeNumber}</div><div class="text-[11px] text-slate-500">${route.name}</div>`,
        { sticky: true }
      );

      polylinesLayer.addLayer(polyline);

      // Render Stop Markers for selected route
      if (isSelected || routes.length <= 2) {
        route.stops.forEach((stop) => {
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
  }, [routes, trips, buses, stands, waitSignals, selectedRouteId, selectedBusId, now, onSelectBus, onSelectStop]);

  // Zoom In Handler
  const handleZoomIn = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomIn();
    }
  }, []);

  // Zoom Out Handler
  const handleZoomOut = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomOut();
    }
  }, []);

  // Reset to Kolkata Center or Active Route
  const handleResetView = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const map = mapInstanceRef.current;
    if (!map) return;

    if (selectedRouteId) {
      const selectedRoute = routes.find((r) => r.id === selectedRouteId);
      if (selectedRoute && selectedRoute.stops.length > 0) {
        const bounds = L.latLngBounds(selectedRoute.stops.map((s) => [s.lat, s.lng]));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14, animate: true });
        return;
      }
    }
    map.setView(KOLKATA_CENTER, DEFAULT_ZOOM, { animate: true });
  }, [selectedRouteId, routes]);

  // User Geolocation Handler
  const handleLocateUser = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const map = mapInstanceRef.current;
    if (!map || !navigator.geolocation) return;

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        map.setView([latitude, longitude], 15, { animate: true });

        // Add or move user marker
        if (userMarkerRef.current) {
          userMarkerRef.current.setLatLng([latitude, longitude]);
        } else {
          const userIcon = L.divIcon({
            html: `
              <div class="relative flex items-center justify-center">
                <span class="animate-ping absolute inline-flex h-6 w-6 rounded-full bg-sky-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-4 w-4 bg-sky-600 border-2 border-white shadow-md"></span>
              </div>
            `,
            className: 'user-location-marker',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });
          userMarkerRef.current = L.marker([latitude, longitude], { icon: userIcon }).addTo(map);
          userMarkerRef.current.bindPopup('<div class="font-bold text-xs">Your Current Location</div>').openPopup();
        }
      },
      (err) => {
        setLocating(false);
        console.warn('Geolocation error:', err.message);
        alert('Could not detect location. Please grant location permissions in your browser.');
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }, []);

  return (
    <div
      className={`relative isolate rounded-xl overflow-hidden bg-slate-100 ${className}`}
      style={{ minHeight: '400px' }}
    >
      {/* Map DOM Element with strict minHeight guarantees */}
      <div
        ref={mapContainerRef}
        className="w-full h-full"
        style={{ width: '100%', height: '100%', minHeight: '400px' }}
      />

      {/* Floating Modern Map Controls (Top Right) */}
      <div
        className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5 shadow-md rounded-lg overflow-hidden border border-slate-200/90 bg-white/95 backdrop-blur-sm p-1"
        style={{ pointerEvents: 'auto' }}
      >
        <button
          type="button"
          onClick={handleZoomIn}
          title="Zoom In"
          aria-label="Zoom in map"
          className="w-8 h-8 flex items-center justify-center rounded text-slate-700 hover:text-slate-950 hover:bg-slate-100 active:bg-slate-200 transition-colors"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
        </button>

        <div className="h-px bg-slate-200 w-full" />

        <button
          type="button"
          onClick={handleZoomOut}
          title="Zoom Out"
          aria-label="Zoom out map"
          className="w-8 h-8 flex items-center justify-center rounded text-slate-700 hover:text-slate-950 hover:bg-slate-100 active:bg-slate-200 transition-colors"
        >
          <Minus className="w-4 h-4 stroke-[2.5]" />
        </button>

        <div className="h-px bg-slate-200 w-full" />

        <button
          type="button"
          onClick={handleLocateUser}
          title="Find My Location"
          aria-label="Find my current location"
          disabled={locating}
          className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
            locating
              ? 'text-sky-600 bg-sky-50 animate-pulse'
              : 'text-slate-700 hover:text-sky-600 hover:bg-slate-100 active:bg-slate-200'
          }`}
        >
          <Crosshair className="w-4 h-4 stroke-[2.2]" />
        </button>

        <div className="h-px bg-slate-200 w-full" />

        <button
          type="button"
          onClick={handleResetView}
          title="Reset / Center Map"
          aria-label="Reset map view"
          className="w-8 h-8 flex items-center justify-center rounded text-slate-700 hover:text-amber-600 hover:bg-slate-100 active:bg-slate-200 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5 stroke-[2.2]" />
        </button>
      </div>

      {/* Floating Bottom Legend */}
      <div
        className="absolute bottom-3 left-3 z-[900] bg-white/95 backdrop-blur-sm border border-slate-200/80 rounded-lg p-2.5 shadow-sm text-xs space-y-1.5 pointer-events-auto"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-slate-800 text-[11px] uppercase tracking-wider">Kolkata Transit</span>
          <span className="text-[10px] text-slate-400 font-mono">Zoom: {currentZoom}x</span>
        </div>
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
