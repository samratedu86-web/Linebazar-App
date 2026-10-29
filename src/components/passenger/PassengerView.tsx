import React, { useState, useMemo } from 'react';
import { Clock, Navigation, MapPin, Gauge, Bus, ArrowRight, Sparkles, Filter, CheckCircle2, AlertTriangle, Compass } from 'lucide-react';
import { BusRegistration, BusRoute, BusStand, Trip, UserProfile, WaitSignal, OnboardPassenger } from '../../types';
import { KolkataTransitMap } from '../map/KolkataTransitMap';
import { store } from '../../services/store';
import { calculateBusEta, getBusesApproachingStand, BusEtaResult } from '../../utils/etaCalculator';

interface PassengerViewProps {
  currentUser: UserProfile | null;
  routes: BusRoute[];
  trips: Trip[];
  buses: BusRegistration[];
  stands: BusStand[];
  waitSignals: WaitSignal[];
  onboardPassengers: OnboardPassenger[];
  onOpenAuth: () => void;
  onOpenSubscription: () => void;
}

export const PassengerView: React.FC<PassengerViewProps> = ({
  currentUser,
  routes,
  trips,
  buses,
  stands,
  waitSignals,
  onboardPassengers,
  onOpenAuth,
  onOpenSubscription,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState<string>(routes[0]?.id || '');
  const [selectedStopId, setSelectedStopId] = useState<string>('');
  const [selectedBusIdsForWait, setSelectedBusIdsForWait] = useState<string[]>([]);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Boarding modal & in-transit states
  const [isBoardModalOpen, setIsBoardModalOpen] = useState(false);
  const [busToBoard, setBusToBoard] = useState<BusRegistration | null>(null);
  const [boardOriginStopId, setBoardOriginStopId] = useState<string>('');
  const [boardDestinationStopId, setBoardDestinationStopId] = useState<string>('');
  const [notifyBeforeStop, setNotifyBeforeStop] = useState(true);

  // In-transit actions
  const [isChangeDestModalOpen, setIsChangeDestModalOpen] = useState(false);
  const [newDestinationStopId, setNewDestinationStopId] = useState<string>('');
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Check if current user is actively on board a bus
  const myActiveOnboard = onboardPassengers.find(
    (p) => p.passengerUid === currentUser?.uid && p.status === 'onboard'
  );

  // Find live trip for the active onboard bus
  const activeOnboardTrip = myActiveOnboard
    ? trips.find((t) => t.busId === myActiveOnboard.busId && t.status === 'active')
    : null;

  // Filter routes by query
  const filteredRoutes = routes.filter((r) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      r.routeNumber.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.origin.toLowerCase().includes(q) ||
      r.destination.toLowerCase().includes(q) ||
      r.stops.some((s) => s.name.toLowerCase().includes(q))
    );
  });

  const currentRoute = routes.find((r) => r.id === selectedRouteId) || routes[0];

  // Active trips for this route
  const activeTripsForRoute = trips.filter(
    (t) => t.routeId === currentRoute?.id && t.status === 'active' && Boolean(t.currentLocation)
  );

  // Selected stop object
  const currentStop = currentRoute?.stops.find((s) => s.id === selectedStopId) || currentRoute?.stops[0];

  // Bus Stand ETA calculation states
  const [transitViewTab, setTransitViewTab] = useState<'routes' | 'stands'>('routes');
  const [selectedStandId, setSelectedStandId] = useState<string>(stands[0]?.id || 'stand-howrah');
  const [standSearchQuery, setStandSearchQuery] = useState('');

  // Selected stand object
  const selectedStand = stands.find((s) => s.id === selectedStandId) || stands[0];

  // Calculate ETAs for all active trips approaching the selected bus stand
  const standApproachingBuses = useMemo(() => {
    if (!selectedStand) return [];
    return getBusesApproachingStand(trips, selectedStand, routes);
  }, [trips, selectedStand, routes]);

  // Filter approaching buses by query (route number, driver, destination)
  const filteredStandBuses = useMemo(() => {
    if (!standSearchQuery) return standApproachingBuses;
    const q = standSearchQuery.toLowerCase().trim();
    return standApproachingBuses.filter(({ trip, route }) =>
      trip.busNumber.toLowerCase().includes(q) ||
      trip.routeNumber.toLowerCase().includes(q) ||
      trip.driverName.toLowerCase().includes(q) ||
      route?.destination.toLowerCase().includes(q) ||
      route?.origin.toLowerCase().includes(q)
    );
  }, [standApproachingBuses, standSearchQuery]);

  // Toggle bus selection for multi-bus wait signal
  const toggleBusSelection = (busId: string) => {
    setSelectedBusIdsForWait((prev) =>
      prev.includes(busId) ? prev.filter((id) => id !== busId) : [...prev, busId]
    );
  };

  // Open "I am in the Bus" boarding modal
  const handleOpenBoardModal = (preferredBus?: BusRegistration) => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    const targetBus =
      preferredBus ||
      (activeTripsForRoute.length > 0 ? buses.find((b) => b.id === activeTripsForRoute[0].busId) : null) ||
      buses.find((b) => b.assignedRouteId === currentRoute.id) ||
      buses[0];

    if (!targetBus) {
      setNotification({
        type: 'error',
        message: 'No registered buses found for this route.',
      });
      return;
    }

    setBusToBoard(targetBus);

    // Initial origin stop
    const initialOriginId = currentStop ? currentStop.id : currentRoute.stops[0]?.id || '';
    setBoardOriginStopId(initialOriginId);

    // Initial destination stop: next stop or last stop on route
    const originIdx = currentRoute.stops.findIndex((s) => s.id === initialOriginId);
    const candidateDest =
      originIdx >= 0 && originIdx < currentRoute.stops.length - 1
        ? currentRoute.stops[originIdx + 1].id
        : currentRoute.stops[currentRoute.stops.length - 1]?.id || '';

    setBoardDestinationStopId(candidateDest);
    setIsBoardModalOpen(true);
  };

  // Confirm Boarding ("I am in the Bus")
  const handleConfirmBoardBus = () => {
    if (!busToBoard) return;

    if (!boardDestinationStopId) {
      setNotification({
        type: 'error',
        message: 'Please choose your destination stop along this route.',
      });
      return;
    }

    if (boardOriginStopId === boardDestinationStopId) {
      setNotification({
        type: 'error',
        message: 'Origin stop and destination stop cannot be the same.',
      });
      return;
    }

    const result = store.boardBus({
      busId: busToBoard.id,
      originStopId: boardOriginStopId,
      destinationStopId: boardDestinationStopId,
      notifyBeforeStops: notifyBeforeStop ? 1 : 0,
    });

    if (result.success && result.onboard) {
      setNotification({
        type: 'success',
        message: `🎉 বাসে ওঠার তথ্য নিশ্চিত হয়েছে! You are now onboard Bus ${result.onboard.busNumber} heading to ${result.onboard.destinationStopName}.`,
      });
      setIsBoardModalOpen(false);
      // Auto-switch selected route to this bus route so passenger sees their bus
      setSelectedRouteId(result.onboard.routeId);
    } else {
      setNotification({
        type: 'error',
        message: result.error || 'Failed to confirm boarding.',
      });
    }
  };

  // Alight from Bus ("বাস থেকে নেমেছি")
  const handleAlightBus = () => {
    if (!myActiveOnboard) return;
    const result = store.alightBus(myActiveOnboard.id);
    if (result.success) {
      setNotification({
        type: 'success',
        message: `✓ যাত্রা সমাপ্ত হয়েছে। You have safely alighted from Bus ${myActiveOnboard.busNumber} at ${myActiveOnboard.destinationStopName}. Have a safe journey ahead!`,
      });
    } else {
      setNotification({
        type: 'error',
        message: result.error || 'Could not complete ride.',
      });
    }
  };

  // Change destination while on the bus
  const handleChangeDestinationConfirm = () => {
    if (!myActiveOnboard || !newDestinationStopId) return;
    const result = store.changeOnboardDestination(myActiveOnboard.id, newDestinationStopId);
    if (result.success) {
      setNotification({
        type: 'success',
        message: `✓ আপনার নতুন গন্তব্য আপডেট করা হয়েছে! New destination updated.`,
      });
      setIsChangeDestModalOpen(false);
    } else {
      setNotification({
        type: 'error',
        message: result.error || 'Failed to update destination.',
      });
    }
  };

  // Copy share link
  const handleCopyShareLink = () => {
    if (!myActiveOnboard) return;
    const shareText = `I am currently traveling on Kolkata Bus ${myActiveOnboard.busNumber} (Route ${myActiveOnboard.routeNumber}) from ${myActiveOnboard.originStopName} to ${myActiveOnboard.destinationStopName}. Track live on Linebazar: ${window.location.href}`;
    navigator.clipboard.writeText(shareText);
    setNotification({
      type: 'success',
      message: '✓ লাইভ ট্রিপের তথ্য ক্লিপবোর্ডে কপি হয়েছে! Live trip details copied to clipboard.',
    });
    setIsShareModalOpen(false);
  };

  // Send "I am waiting" signal
  const handleSendWaitSignal = (targetBusId?: string) => {
    if (!currentUser) {
      setNotification({
        type: 'error',
        message: 'বাসের জন্য অপেক্ষা করার সংকেত পাঠাতে অনুগ্রহ করে প্রথমে লগইন করুন (Please log in to send waiting signal).',
      });
      onOpenAuth();
      return;
    }

    if (!currentStop) {
      setNotification({ type: 'error', message: 'অনুগ্রহ করে আপনি যে বাস স্টপে দাঁড়িয়ে আছেন সেটি নির্বাচন করুন।' });
      return;
    }

    // Determine target buses: specific bus, checked buses, active buses, or route buses
    let busIdsToSend: string[] = [];
    if (targetBusId) {
      busIdsToSend = [targetBusId];
    } else if (selectedBusIdsForWait.length > 0) {
      busIdsToSend = selectedBusIdsForWait;
    } else if (activeTripsForRoute.length > 0) {
      busIdsToSend = activeTripsForRoute.map((t) => t.busId);
    } else {
      const routeBuses = buses.filter((b) => b.assignedRouteId === currentRoute.id);
      busIdsToSend = routeBuses.map((b) => b.id);
    }

    try {
      const result = store.sendWaitSignals(currentStop.id, currentStop.name, busIdsToSend, currentRoute.id);
      if (result.sent.length > 0) {
        setNotification({
          type: 'success',
          message: `✓ আপনার অপেক্ষার সংকেত পাঠানো হয়েছে! Drivers/Conductor রা দেখতে পাবেন আপনি ${currentStop.name} স্টপে বাসের জন্য অপেক্ষা করছেন।`,
        });
        setSelectedBusIdsForWait([]);
      } else if (result.skipped.length > 0) {
        setNotification({
          type: 'error',
          message: `আপনি ইতিমধ্যে ${currentStop.name} স্টপে এই বাসের জন্য অপেক্ষার সংকেত পাঠিয়েছেন।`,
        });
      }
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error sending wait signal.' });
    }
  };

  // Send wait signal from Bus Stand ETA view
  const handleSendWaitSignalForStand = (targetTrip: Trip, stand: BusStand) => {
    if (!currentUser) {
      setNotification({
        type: 'error',
        message: 'বাসের জন্য অপেক্ষা করার সংকেত পাঠাতে অনুগ্রহ করে প্রথমে লগইন করুন (Please log in to send waiting signal).',
      });
      onOpenAuth();
      return;
    }

    try {
      const result = store.sendWaitSignals(stand.id, stand.name, [targetTrip.busId], targetTrip.routeId);
      if (result.sent.length > 0) {
        setNotification({
          type: 'success',
          message: `✓ ${stand.name}-এ Bus ${targetTrip.busNumber} (Route ${targetTrip.routeNumber}) এর জন্য অপেক্ষার সংকেত সফলভাবে পাঠানো হয়েছে!`,
        });
      } else {
        setNotification({
          type: 'error',
          message: `আপনি ইতিমধ্যে ${stand.name}-এ এই বাসের জন্য অপেক্ষার সংকেত পাঠিয়েছেন।`,
        });
      }
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error sending wait signal.' });
    }
  };

  // Cancel waiting signal
  const handleCancelWaitSignal = (stopId?: string, signalId?: string) => {
    if (!currentUser) return;
    if (signalId) {
      store.cancelWaitSignal(signalId);
      setNotification({
        type: 'success',
        message: '✓ অপেক্ষার সংকেত বাতিল করা হয়েছে। Waiting signal cancelled.',
      });
      return;
    }

    const targetStopId = stopId || currentStop?.id;
    if (targetStopId) {
      const ok = store.cancelWaitSignalForStop(targetStopId, currentRoute.id);
      if (ok) {
        setNotification({
          type: 'success',
          message: '✓ এই স্টপের অপেক্ষার সংকেত বাতিল করা হয়েছে। Waiting signal cancelled.',
        });
      }
    }
  };

  // Calculate remaining stops for onboard passenger
  const getRemainingStopsCount = (): number => {
    if (!myActiveOnboard) return 0;
    const onboardRoute = routes.find((r) => r.id === myActiveOnboard.routeId);
    if (!onboardRoute) return 0;

    const destIdx = onboardRoute.stops.findIndex((s) => s.id === myActiveOnboard.destinationStopId);
    if (destIdx === -1) return 0;

    const currentStopId = activeOnboardTrip?.currentLocation?.currentStopId;
    const nextStopId = activeOnboardTrip?.currentLocation?.nextStopId;

    let currentIdx = -1;
    if (nextStopId) {
      currentIdx = onboardRoute.stops.findIndex((s) => s.id === nextStopId);
    } else if (currentStopId) {
      currentIdx = onboardRoute.stops.findIndex((s) => s.id === currentStopId);
    }

    if (currentIdx === -1) {
      const originIdx = onboardRoute.stops.findIndex((s) => s.id === myActiveOnboard.originStopId);
      return Math.max(0, destIdx - (originIdx >= 0 ? originIdx : 0));
    }

    return Math.max(0, destIdx - currentIdx);
  };

  const remainingStopsCount = getRemainingStopsCount();
  const isApproachingDestination = remainingStopsCount <= 1;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------- */}
      {/* 0. ACTIVE ON-BOARD MODE (বাসে যাত্রা চলছে)                     */}
      {/* ------------------------------------------------------------- */}
      {myActiveOnboard && (
        <div className="rounded-2xl border-2 border-emerald-500 bg-gradient-to-r from-emerald-50 via-teal-50/60 to-white p-5 md:p-6 shadow-md relative overflow-hidden">
          {/* Glowing pulse indicator */}
          <div className="absolute top-0 right-0 transform translate-x-4 -translate-y-4 w-32 h-32 bg-emerald-400/10 rounded-full blur-2xl pointer-events-none" />

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-600 text-white shadow-xs">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                  Currently Onboard · বাসে আছেন
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-white border border-emerald-200 text-emerald-900 text-xs font-bold">
                  Route {myActiveOnboard.routeNumber}
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  Boarded at {new Date(myActiveOnboard.boardedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <div className="mt-2.5 flex items-baseline gap-2 flex-wrap">
                <h2 className="text-xl md:text-2xl font-black text-slate-950">
                  {myActiveOnboard.busNumber}
                </h2>
                <span className="text-sm text-slate-600 font-semibold">
                  (Travelling to: <span className="text-emerald-700 font-bold underline decoration-emerald-300 underline-offset-4">{myActiveOnboard.destinationStopName}</span>)
                </span>
              </div>

              {/* Origin to Destination Route Path */}
              <div className="mt-2 text-xs flex items-center gap-2 text-slate-600">
                <span className="font-semibold text-slate-700">From:</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200 font-medium">
                  {myActiveOnboard.originStopName}
                </span>
                <span className="text-emerald-600 font-bold">➔</span>
                <span className="font-semibold text-slate-700">Destination:</span>
                <span className="bg-emerald-100/80 text-emerald-900 px-2 py-0.5 rounded border border-emerald-300 font-bold">
                  {myActiveOnboard.destinationStopName}
                </span>
              </div>
            </div>

            {/* Quick In-Transit Action Buttons */}
            <div className="flex items-center gap-2.5 flex-wrap shrink-0">
              <button
                onClick={() => {
                  setNewDestinationStopId(myActiveOnboard.destinationStopId);
                  setIsChangeDestModalOpen(true);
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition shadow-2xs flex items-center gap-1.5"
              >
                <span>📍</span>
                <span>Change Destination</span>
              </button>

              <button
                onClick={() => setIsShareModalOpen(true)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition shadow-2xs flex items-center gap-1.5"
              >
                <span>🔗</span>
                <span>Share Ride</span>
              </button>

              <button
                onClick={handleAlightBus}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition flex items-center gap-1.5 active:scale-95"
              >
                <span>🛑</span>
                <span>Get Off Bus (নেমে গেছি)</span>
              </button>
            </div>
          </div>

          {/* Real-time Transit Telemetry & Destination Alert */}
          <div className="mt-4 pt-4 border-t border-emerald-200/70 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white/90 rounded-xl p-3 border border-emerald-200/80">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Remaining to Destination</div>
              <div className="text-base font-black text-slate-900 mt-0.5 font-mono">
                {remainingStopsCount > 0 ? (
                  <span className="text-emerald-700">{remainingStopsCount} stop{remainingStopsCount > 1 ? 's' : ''} left</span>
                ) : (
                  <span className="text-amber-600 animate-pulse">At Destination Stop!</span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Target: {myActiveOnboard.destinationStopName}
              </div>
            </div>

            <div className="bg-white/90 rounded-xl p-3 border border-emerald-200/80">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Next Approaching Stop</div>
              <div className="text-base font-bold text-slate-900 mt-0.5 truncate">
                {activeOnboardTrip?.currentLocation?.nextStopId
                  ? routes
                      .find((r) => r.id === myActiveOnboard.routeId)
                      ?.stops.find((s) => s.id === activeOnboardTrip.currentLocation?.nextStopId)?.name || 'In Transit'
                  : 'En Route'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>Live GPS Connected</span>
              </div>
            </div>

            <div className="bg-white/90 rounded-xl p-3 border border-emerald-200/80">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Current Speed & Drivers/Conductor</div>
              <div className="text-base font-black text-slate-900 mt-0.5 font-mono">
                {activeOnboardTrip?.currentLocation?.speedKmh || 26} <span className="text-xs font-normal text-slate-500">km/h</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                Driver: {activeOnboardTrip?.driverName || 'Designated Driver'}
              </div>
            </div>
          </div>

          {/* Proximity Banner if close to destination */}
          {isApproachingDestination && (
            <div className="mt-3.5 p-3 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-between gap-2 shadow-xs animate-pulse">
              <div className="flex items-center gap-2">
                <span className="text-base">🔔</span>
                <span>
                  আপনার গন্তব্য নিকটবর্তী! You are approaching <strong>{myActiveOnboard.destinationStopName}</strong>. Please prepare to alight!
                </span>
              </div>
              <button
                onClick={handleAlightBus}
                className="px-3 py-1 bg-slate-950 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 shrink-0"
              >
                Confirm Alighted (নেমেছি)
              </button>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 1. PASSENGER HERO & SEARCH HEADER                             */}
      {/* ------------------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 md:p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div>
            <div className="text-xs font-semibold text-amber-600 uppercase tracking-wider">
              Kolkata Bus Transport
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-950 mt-0.5">
              Find Buses, Signal Waiting & Board Rides
            </h1>
            <p className="text-xs md:text-sm text-slate-600 mt-1">
              Search government and private buses, view live GPS coordinates, signal waiting to incoming crews, or mark yourself on board with destination tracking.
            </p>
          </div>

          {/* Subscription Status Card */}
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-200/80 rounded-xl p-3 shrink-0">
            <div>
              <div className="text-[11px] text-slate-500 font-medium">Passenger Pass</div>
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>
                  {currentUser?.subscription.status === 'trial'
                    ? '3-Month Free Trial'
                    : currentUser?.subscription.status === 'active'
                    ? 'Paid Active'
                    : 'Access Inactive'}
                </span>
              </div>
            </div>
            <button
              onClick={onOpenSubscription}
              className="text-xs font-semibold text-amber-700 bg-amber-100/70 hover:bg-amber-200/80 px-2.5 py-1.5 rounded-lg transition"
            >
              Manage
            </button>
          </div>
        </div>

        {/* Navigation Switcher: Route Tracking vs Bus Stand Live ETA Hub */}
        <div className="mt-5 flex border border-slate-200 bg-slate-100/90 p-1 rounded-xl gap-1.5 shadow-2xs">
          <button
            type="button"
            onClick={() => setTransitViewTab('routes')}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition flex items-center justify-center gap-2 ${
              transitViewTab === 'routes'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Navigation className="w-3.5 h-3.5 text-amber-500" />
            <span>Route & Stop Tracking (রুট ও স্টপ ভিত্তিক)</span>
          </button>
          <button
            type="button"
            onClick={() => setTransitViewTab('stands')}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition flex items-center justify-center gap-2 ${
              transitViewTab === 'stands'
                ? 'bg-white text-slate-950 shadow-xs ring-1 ring-emerald-500/30'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
            <span>Bus Stand Live ETA Hub (বাস স্ট্যান্ড আগমন সূচি)</span>
            <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 text-[9px] rounded-full font-bold uppercase tracking-wider">
              Live ETA
            </span>
          </button>
        </div>

        {transitViewTab === 'routes' && (
          /* Search Bar & Route Selector */
          <div className="mt-5 space-y-4">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by route (e.g. S-12, AC-12, 230), stop (e.g. Esplanade, Ultadanga, Howrah), or landmark..."
                className="w-full pl-10 pr-4 py-3 text-sm rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              />
              <span className="absolute left-3.5 top-3.5 text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-3 text-xs text-slate-400 hover:text-slate-600 px-1"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Route Horizontal Carousel */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-slate-500">
                  Available Kolkata Routes ({filteredRoutes.length.toLocaleString()} routes):
                </div>
                {filteredRoutes.length > 50 && (
                  <span className="text-[11px] text-slate-400">
                    Showing top 50 • search above for all {filteredRoutes.length.toLocaleString()} routes
                  </span>
                )}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {(() => {
                  const topSlice = filteredRoutes.slice(0, 50);
                  const selectedInTop = topSlice.some((r) => r.id === selectedRouteId);
                  const selectedRouteObj = !selectedInTop ? filteredRoutes.find((r) => r.id === selectedRouteId) : null;
                  const routesToDisplay = selectedRouteObj ? [selectedRouteObj, ...topSlice.slice(0, 49)] : topSlice;

                  return routesToDisplay.map((r) => {
                    const isSelected = r.id === selectedRouteId;
                    const activeCount = trips.filter((t) => t.routeId === r.id && t.status === 'active').length;

                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          setSelectedRouteId(r.id);
                          setSelectedStopId(r.stops[0]?.id || '');
                          setSelectedBusIdsForWait([]);
                        }}
                        className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-left border transition whitespace-nowrap shrink-0 ${
                          isSelected
                            ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded ${
                            isSelected ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          {r.routeNumber}
                        </span>
                        <span className="text-xs font-medium max-w-[160px] truncate">{r.origin} → {r.destination}</span>
                        <span
                          className={`text-[11px] font-mono tabular-nums ${
                            isSelected ? 'text-amber-300' : 'text-slate-400'
                          }`}
                        >
                          {activeCount} live
                        </span>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Notification Toast */}
      {notification && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-medium ${
            notification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <span>{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="text-xs font-bold px-1.5 py-0.5 rounded hover:bg-black/5"
          >
            ✕
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 2. MAIN TRANSIT VIEW (ROUTES vs BUS STAND LIVE ETA HUB)      */}
      {/* ------------------------------------------------------------- */}
      {transitViewTab === 'routes' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (Map & Stop Sequences): 7 Columns on Desktop */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>Live Route Tracking</span>
                <span className="text-xs font-semibold text-slate-500 font-mono">
                  Route {currentRoute.routeNumber}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {activeTripsForRoute.length} bus{activeTripsForRoute.length !== 1 ? 'es' : ''} on road
              </div>
            </div>

            <KolkataTransitMap
              routes={routes}
              trips={trips}
              buses={buses}
              stands={stands}
              waitSignals={waitSignals}
              selectedRouteId={selectedRouteId}
              onSelectStop={(stopId) => setSelectedStopId(stopId)}
              className="h-[400px] w-full rounded-xl overflow-hidden border border-slate-200"
            />
          </div>

          {/* Route Stop Sequence Chips */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
            <div className="text-xs font-semibold text-slate-600 mb-2.5">
              Select Your Boarding Stop along Route {currentRoute.routeNumber}:
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {currentRoute.stops.map((stop) => {
                const isSelected = (selectedStopId || currentRoute.stops[0].id) === stop.id;
                const stopWaits = waitSignals.filter(
                  (w) => w.stopId === stop.id && w.status === 'active'
                ).length;
                const onboardCount = onboardPassengers.filter(
                  (o) => o.destinationStopId === stop.id && o.status === 'onboard'
                ).length;

                return (
                  <button
                    key={stop.id}
                    onClick={() => setSelectedStopId(stop.id)}
                    className={`px-3 py-2 rounded-xl text-left border transition shrink-0 ${
                      isSelected
                        ? 'border-amber-500 bg-amber-50/70 text-slate-950 font-semibold'
                        : 'border-slate-200 bg-slate-50/50 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-[11px] text-slate-500">Stop #{stop.sequence}</div>
                    <div className="text-xs font-bold max-w-[130px] truncate">{stop.name}</div>
                    <div className="text-[10px] font-mono text-slate-500 tabular-nums mt-0.5 flex items-center gap-1.5">
                      <span>{stop.distanceFromStartKm} km</span>
                      <span>·</span>
                      <span className="text-amber-700 font-semibold">{stopWaits} waiting</span>
                      {onboardCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-emerald-700 font-semibold">{onboardCount} alighting</span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Approaching Buses, Boarding & Wait Signal Drawer (5 Columns) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Stop Details Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                  Current Boarding Point
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  {currentStop ? currentStop.name : 'Select a Stop'}
                </h3>
                <p className="text-xs text-slate-500">
                  Route {currentRoute.routeNumber} · {currentStop?.distanceFromStartKm} km from start terminal
                </p>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">Waiting Passengers</div>
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                  {waitSignals.filter((w) => w.stopId === currentStop?.id && w.status === 'active').length}
                </div>
              </div>
            </div>

            {/* Live Incoming Buses for this Stop */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                Approaching Buses on Route {currentRoute.routeNumber}:
              </div>

              {activeTripsForRoute.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 text-center text-xs text-slate-500">
                  No active buses currently transmitting GPS on Route {currentRoute.routeNumber}.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {activeTripsForRoute.map((trip) => {
                    const bus = buses.find((b) => b.id === trip.busId);
                    const isSelected = selectedBusIdsForWait.includes(trip.busId);
                    const speed = trip.currentLocation?.speedKmh || 25;
                    const busOnboardCount = onboardPassengers.filter(
                      (o) => o.busId === trip.busId && o.status === 'onboard'
                    ).length;

                    return (
                      <div
                        key={trip.id}
                        className={`p-3 rounded-xl border transition flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'border-amber-500 bg-amber-50/60 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div
                          onClick={() => toggleBusSelection(trip.busId)}
                          className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                              <span>{trip.busNumber}</span>
                              <span className="text-[10px] text-slate-500 font-normal">
                                ({bus?.modelNumber?.split(' ')[0] || 'Bus'})
                              </span>
                              {busOnboardCount > 0 && (
                                <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded-full">
                                  {busOnboardCount} onboard
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                              Driver: {trip.driverName} · Speed: <span className="font-mono tabular-nums">{speed} km/h</span>
                            </div>
                            {(() => {
                              const stopEta = currentStop && trip.currentLocation
                                ? calculateBusEta(
                                    trip.currentLocation,
                                    { id: currentStop.id, name: currentStop.name, lat: currentStop.lat, lng: currentStop.lng },
                                    currentRoute
                                  )
                                : null;

                              if (!stopEta) return null;

                              return (
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  <span
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      stopEta.status === 'arrived'
                                        ? 'bg-emerald-100 text-emerald-900 border border-emerald-300 animate-pulse'
                                        : stopEta.status === 'approaching'
                                        ? 'bg-amber-100 text-amber-950 border border-amber-300'
                                        : 'bg-sky-50 text-sky-900 border border-sky-200'
                                    }`}
                                  >
                                    <Clock className="w-2.5 h-2.5" />
                                    <span>ETA: {stopEta.formattedEta}</span>
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                                    📍 {stopEta.formattedDistance} ({stopEta.formattedArrivalTime})
                                  </span>
                                </div>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Direct Action Buttons for this approaching bus */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSendWaitSignal(trip.busId);
                            }}
                            className="px-2 py-1.5 text-xs font-bold rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-2xs transition flex items-center gap-1 active:scale-95"
                            title="আমি এই নির্দিষ্ট বাসের জন্য অপেক্ষা করছি"
                          >
                            <span>🕒</span>
                            <span className="hidden sm:inline">Wait</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (bus) handleOpenBoardModal(bus);
                            }}
                            className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-2xs transition flex items-center gap-1 active:scale-95"
                            title="আমি এই বাসে উঠেছি (I am in this Bus)"
                          >
                            <span>🚌</span>
                            <span className="hidden sm:inline">I am in the Bus</span>
                            <span className="sm:hidden">Board</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ACTION BUTTONS: "I am Waiting" AND "I am in the Bus" */}
            {(() => {
              const isUserWaitingHere = Boolean(
                currentUser &&
                  currentStop &&
                  waitSignals.some(
                    (s) =>
                      s.passengerUid === currentUser.uid &&
                      s.stopId === currentStop.id &&
                      s.status === 'active'
                  )
              );

              if (isUserWaitingHere) {
                return (
                  <div className="mt-5 pt-4 border-t border-slate-100">
                    <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-400 space-y-3">
                      <div className="flex items-start gap-2.5">
                        <span className="text-xl">🕒</span>
                        <div>
                          <div className="text-xs font-black text-amber-950 uppercase tracking-wide">
                            আপনি এই স্টপে অপেক্ষা করছেন (Waiting Signal Active)
                          </div>
                          <div className="text-xs font-semibold text-amber-900 mt-0.5">
                            {currentStop?.name} স্টপে Route {currentRoute.routeNumber} এর জন্য আপনার অপেক্ষার তথ্য ড্রাইভার ও কন্ডাক্টর দেখতে পাচ্ছেন।
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleCancelWaitSignal(currentStop?.id)}
                          className="py-2.5 px-3 rounded-lg text-xs font-bold bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 transition flex items-center justify-center gap-1.5 shadow-2xs active:scale-95"
                        >
                          <span>🛑</span>
                          <span>অপেক্ষা বাতিল করুন</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenBoardModal()}
                          className="py-2.5 px-3 rounded-lg text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center justify-center gap-1.5 shadow-xs active:scale-95"
                        >
                          <span>🚌</span>
                          <span>বাসে উঠেছি (Board)</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div className="mt-5 pt-4 border-t border-slate-100 space-y-2.5">
                  {!currentUser && (
                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between gap-2">
                      <span className="font-medium">🔑 বাসের জন্য অপেক্ষা জানাতে অনুগ্রহ করে লগইন করুন</span>
                      <button
                        type="button"
                        onClick={onOpenAuth}
                        className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 shrink-0"
                      >
                        লগইন করুন
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {/* 1. Primary "I am in the Bus" Action */}
                    <button
                      type="button"
                      onClick={() => handleOpenBoardModal()}
                      className="py-3 px-3 rounded-xl font-black text-xs md:text-sm bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-sm active:scale-[0.99] flex items-center justify-center gap-2"
                    >
                      <span className="text-base">🚌</span>
                      <span>I am in the Bus (বাসে উঠেছি)</span>
                    </button>

                    {/* 2. "I am Waiting" Signal Action */}
                    <button
                      type="button"
                      onClick={() => handleSendWaitSignal()}
                      className="py-3 px-3 rounded-xl font-bold text-xs md:text-sm bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow-sm active:scale-[0.99] flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
                      </svg>
                      <span className="truncate">
                        {selectedBusIdsForWait.length > 0
                          ? `I am Waiting (${selectedBusIdsForWait.length} বাসে)`
                          : 'I am Waiting (আমি অপেক্ষা করছি)'}
                      </span>
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                    যাত্রী বাস স্টপে দাঁড়িয়ে <strong>"I am waiting"</strong> প্রেস করলে Drivers/Conductor রা দেখতে পাবেন কোন স্টপে কতজন অপেক্ষা করছেন।
                  </p>
                </div>
              );
            })()}
          </div>

          {/* Recent Signals Sent by Current User */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
            <div className="text-xs font-semibold text-slate-700 mb-2">Your Active Waiting Signals:</div>
            {waitSignals.filter((s) => s.passengerUid === currentUser?.uid && s.status === 'active').length === 0 ? (
              <div className="text-xs text-slate-400 py-2">No active waiting signals sent yet.</div>
            ) : (
              <div className="space-y-2">
                {waitSignals
                  .filter((s) => s.passengerUid === currentUser?.uid && s.status === 'active')
                  .map((sig) => (
                    <div
                      key={sig.id}
                      className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-bold text-slate-800">{sig.busNumber}</div>
                        <div className="text-[11px] text-slate-500">At {sig.stopName}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleCancelWaitSignal(undefined, sig.id)}
                          className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-200 text-slate-700 hover:bg-rose-100 hover:text-rose-800 transition"
                          title="অপেক্ষা বাতিল করুন"
                        >
                          বাতিল
                        </button>
                        <button
                          onClick={() => {
                            const matchedBus = buses.find((b) => b.id === sig.busId);
                            if (matchedBus) handleOpenBoardModal(matchedBus);
                          }}
                          className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-600 text-white hover:bg-emerald-500 transition"
                        >
                          Board Now
                        </button>
                        <span className="font-mono text-[10px] text-slate-400">
                          {new Date(sig.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
      ) : (
        /* ------------------------------------------------------------- */
        /* BUS STAND LIVE ETA HUB (বাস স্ট্যান্ডে বাসের লাইভ আগমন সূচি) */
        /* ------------------------------------------------------------- */
        <div className="space-y-6">
          {/* 1. Bus Stand Selector Carousel */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  Kolkata Bus Stand & Terminal Selector
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  Select Your Bus Stand (বাস স্ট্যান্ড নির্বাচন করুন)
                </h3>
                <p className="text-xs text-slate-500">
                  নির্বাচিত বাস স্ট্যান্ড থেকে কত দূরে এবং কখন বাসগুলো এসে পৌঁছাবে তার নিখুঁত হিসাব (Live ETA)
                </p>
              </div>
              <div className="text-xs text-slate-500 font-medium">
                {stands.length} Terminals Available
              </div>
            </div>

            <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-none">
              {stands.map((stand) => {
                const isSelected = stand.id === selectedStand.id;
                const closeBusesCount = trips.filter((t) => {
                  if (!t.currentLocation || t.status !== 'active') return false;
                  return true;
                }).length;

                return (
                  <button
                    key={stand.id}
                    onClick={() => setSelectedStandId(stand.id)}
                    className={`p-3.5 rounded-xl border text-left transition shrink-0 min-w-[220px] flex flex-col justify-between ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/70 shadow-sm ring-2 ring-emerald-500/20'
                        : 'border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                        }`}>
                          TERMINAL
                        </span>
                        <span className="text-[11px] font-mono font-semibold text-emerald-700">
                          {stand.routesOriginating.length} Routes
                        </span>
                      </div>
                      <div className="font-bold text-xs text-slate-900 mt-2 line-clamp-1">{stand.name}</div>
                      <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{stand.location}</div>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                      <span>Capacity: {stand.capacityBuses}</span>
                      <span className="text-emerald-700 font-bold">Select Stand ➔</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Selected Stand Telemetry & Live Map */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Live Map & Stand Amenities (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800">
                      <MapPin className="w-4 h-4" />
                    </span>
                    <div>
                      <div className="text-sm font-bold text-slate-900">{selectedStand.name}</div>
                      <div className="text-[11px] text-slate-500">{selectedStand.location}</div>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-200">
                    Terminal Area
                  </span>
                </div>

                <KolkataTransitMap
                  routes={routes}
                  trips={trips}
                  buses={buses}
                  stands={stands}
                  waitSignals={waitSignals}
                  className="h-[380px] w-full rounded-xl overflow-hidden border border-slate-200"
                />
              </div>

              {/* Stand Details Card */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
                <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Stand Facilities & Originating Routes (টার্মিনাল বিবরণ)</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {selectedStand.amenities.map((amenity, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200/60">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>{amenity}</span>
                    </span>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <div className="text-xs font-semibold text-slate-600 mb-1.5">
                    Routes originating or connecting at {selectedStand.name}:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedStand.routesOriginating.map((rNum) => (
                      <span key={rNum} className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-950 font-mono font-bold text-xs border border-amber-300">
                        {rNum}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: LIVE ETA BOARD for this Stand (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
                <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
                      <Clock className="w-3 h-3 animate-spin text-emerald-600" />
                      Live Bus Stand ETA Board
                    </span>
                    <h3 className="text-base font-black text-slate-950 mt-0.5">
                      {selectedStand.name}
                    </h3>
                    <p className="text-xs text-slate-500">
                      দূরত্ব ও ট্রাফিকের ভিত্তিতে আগমনের আনুমানিক সময়
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block font-medium">Buses Tracked</span>
                    <span className="text-lg font-black font-mono text-emerald-700 tabular-nums">
                      {filteredStandBuses.length}
                    </span>
                  </div>
                </div>

                {/* Quick Filter */}
                <div className="mt-3">
                  <input
                    type="text"
                    value={standSearchQuery}
                    onChange={(e) => setStandSearchQuery(e.target.value)}
                    placeholder="Filter approaching buses (e.g. S-12, AC-12, Howrah)..."
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-sans"
                  />
                </div>

                {/* List of Approaching Buses sorted by ETA */}
                <div className="mt-3 space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                  {filteredStandBuses.length === 0 ? (
                    <div className="p-6 rounded-xl bg-slate-50 text-center text-xs text-slate-500 space-y-1">
                      <Bus className="w-6 h-6 mx-auto text-slate-400" />
                      <div className="font-semibold text-slate-700">কোনো বাস বর্তমানে কাছাকাছি নেই</div>
                      <div className="text-[11px]">
                        No active GPS buses are currently approaching {selectedStand.name}. Check originating routes above.
                      </div>
                    </div>
                  ) : (
                    filteredStandBuses.map(({ trip, eta, route }) => {
                      const bus = buses.find((b) => b.id === trip.busId);
                      const isVeryClose = eta.status === 'arrived' || eta.estimatedMinutes <= 2;
                      const isApproaching = eta.status === 'approaching' || eta.estimatedMinutes <= 6;

                      return (
                        <div
                          key={trip.id}
                          className={`p-3.5 rounded-xl border transition shadow-2xs space-y-2 ${
                            isVeryClose
                              ? 'border-emerald-500 bg-emerald-50/70'
                              : isApproaching
                              ? 'border-amber-400 bg-amber-50/50'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          {/* Top Row: Route, ETA Badge & Distance */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-xs font-black tracking-wide">
                                Route {trip.routeNumber}
                              </span>
                              <span className="text-xs font-bold text-slate-900 truncate">
                                {trip.busNumber}
                              </span>
                            </div>

                            {/* Prominent ETA pill */}
                            <div className="text-right">
                              <div
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black shadow-2xs ${
                                  isVeryClose
                                    ? 'bg-emerald-600 text-white animate-pulse'
                                    : isApproaching
                                    ? 'bg-amber-400 text-slate-950 font-bold'
                                    : 'bg-slate-100 text-slate-900 border border-slate-200'
                                }`}
                              >
                                <Clock className="w-3 h-3" />
                                <span>{eta.formattedEta}</span>
                              </div>
                            </div>
                          </div>

                          {/* Middle Row: Route Path & Distance Breakdown */}
                          <div className="text-xs text-slate-600 flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1 text-[11px] text-slate-700 truncate">
                              <span className="font-semibold">{route?.origin || 'Start'}</span>
                              <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                              <span className="font-semibold text-emerald-800">{route?.destination || 'Terminus'}</span>
                            </div>

                            <div className="text-[11px] font-mono font-bold text-slate-700 tabular-nums">
                              📍 {eta.formattedDistance} away ({eta.formattedArrivalTime})
                            </div>
                          </div>

                          {/* Bottom Row: Traffic & Action Buttons */}
                          <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 font-mono">
                                {eta.effectiveSpeedKmh} km/h
                              </span>
                              <span className={`px-1.5 py-0.5 rounded font-semibold ${
                                eta.trafficCondition === 'smooth'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : eta.trafficCondition === 'congested'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}>
                                {eta.trafficLabel.split('(')[0].trim()}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleSendWaitSignalForStand(trip, selectedStand)}
                                className="px-2 py-1 text-xs font-bold rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-2xs transition flex items-center gap-1 active:scale-95"
                                title="আমি এই বাসটির জন্য স্ট্যান্ডে অপেক্ষা করছি"
                              >
                                <span>🕒</span>
                                <span>Wait</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  if (bus) handleOpenBoardModal(bus);
                                }}
                                className="px-2 py-1 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-2xs transition flex items-center gap-1 active:scale-95"
                                title="আমি এই বাসে উঠেছি"
                              >
                                <span>🚌</span>
                                <span>Board</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 3. MODAL: "I AM IN THE BUS" (বাসে ওঠার পর গন্তব্য নিশ্চিতকরণ) */}
      {/* ------------------------------------------------------------- */}
      {isBoardModalOpen && busToBoard && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-lg w-full shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 font-black flex items-center justify-center text-xl shrink-0">
                  🚌
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-950">
                    I am in the Bus · বাসে উঠেছি
                  </h3>
                  <p className="text-xs text-slate-500">
                    Select your destination stop so the conductor & driver know where you will alight.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsBoardModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            {/* Bus Info Card */}
            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                  Route {busToBoard.routeNumber}
                </span>
                <div className="text-sm font-black text-slate-900 mt-1">
                  {busToBoard.busNumber}
                </div>
                <div className="text-xs text-slate-500">
                  {busToBoard.modelNumber}
                </div>
              </div>

              {/* Selector for other available buses on route */}
              {buses.filter((b) => b.assignedRouteId === currentRoute.id).length > 1 && (
                <div className="text-right">
                  <label className="text-[10px] text-slate-500 block mb-0.5 font-medium">Switch Bus:</label>
                  <select
                    value={busToBoard.id}
                    onChange={(e) => {
                      const next = buses.find((b) => b.id === e.target.value);
                      if (next) setBusToBoard(next);
                    }}
                    className="text-xs font-semibold py-1 px-2 rounded-lg border border-slate-300 bg-white"
                  >
                    {buses
                      .filter((b) => b.assignedRouteId === currentRoute.id)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.busNumber}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>

            {/* Boarding Form */}
            <div className="space-y-4">
              {/* Origin / Boarding Stop */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  1. Boarding From (কোথা থেকে উঠেছেন):
                </label>
                <select
                  value={boardOriginStopId}
                  onChange={(e) => {
                    const newOrig = e.target.value;
                    setBoardOriginStopId(newOrig);
                    // Adjust destination if needed
                    const origIdx = currentRoute.stops.findIndex((s) => s.id === newOrig);
                    if (origIdx >= 0 && origIdx < currentRoute.stops.length - 1) {
                      setBoardDestinationStopId(currentRoute.stops[origIdx + 1].id);
                    }
                  }}
                  className="w-full text-xs font-medium px-3 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {currentRoute.stops.map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      Stop #{stop.sequence}: {stop.name} ({stop.distanceFromStartKm} km)
                    </option>
                  ))}
                </select>
              </div>

              {/* Destination Stop (REQUIRED) */}
              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1 flex items-center justify-between">
                  <span>2. Destination Stop (কোথায় নামবেন - নির্দিষ্ট গন্তব্য): *</span>
                  <span className="text-[11px] text-emerald-700 font-semibold">Required</span>
                </label>
                <select
                  value={boardDestinationStopId}
                  onChange={(e) => setBoardDestinationStopId(e.target.value)}
                  className="w-full text-xs font-bold text-slate-900 px-3 py-2.5 rounded-xl border-2 border-emerald-500 bg-emerald-50/40 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="" disabled>
                    -- Select Destination Stop --
                  </option>
                  {currentRoute.stops
                    .filter((stop) => {
                      const originIdx = currentRoute.stops.findIndex((s) => s.id === boardOriginStopId);
                      const thisIdx = currentRoute.stops.findIndex((s) => s.id === stop.id);
                      return originIdx === -1 || thisIdx > originIdx;
                    })
                    .map((stop) => (
                      <option key={stop.id} value={stop.id}>
                        Stop #{stop.sequence}: {stop.name} ({stop.distanceFromStartKm} km)
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  বোর্ডিং স্টপের পরের স্টপগুলো তালিকায় দেখানো হয়েছে।
                </p>
              </div>

              {/* Alert Toggle */}
              <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <input
                  id="notifyToggle"
                  type="checkbox"
                  checked={notifyBeforeStop}
                  onChange={(e) => setNotifyBeforeStop(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <label htmlFor="notifyToggle" className="text-xs font-medium text-slate-700 cursor-pointer">
                  🔔 গন্তব্যের ১টি স্টপ আগে অ্যালার্ট দিন (Alert me 1 stop before reaching destination)
                </label>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsBoardModalOpen(false)}
                className="px-4 py-2.5 text-xs font-semibold rounded-xl text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBoardBus}
                className="px-5 py-2.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition flex items-center gap-2"
              >
                <span>✓</span>
                <span>Confirm: I am in the Bus (কনফার্ম)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 4. MODAL: CHANGE DESTINATION (গন্তব্য পরিবর্তন)              */}
      {/* ------------------------------------------------------------- */}
      {isChangeDestModalOpen && myActiveOnboard && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Change Destination · গন্তব্য পরিবর্তন
                </h3>
                <p className="text-xs text-slate-500">
                  Current: {myActiveOnboard.destinationStopName}
                </p>
              </div>
              <button
                onClick={() => setIsChangeDestModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Select New Destination Stop:
              </label>
              <select
                value={newDestinationStopId}
                onChange={(e) => setNewDestinationStopId(e.target.value)}
                className="w-full text-xs font-bold text-slate-900 px-3 py-2.5 rounded-xl border border-slate-300 bg-white"
              >
                {routes
                  .find((r) => r.id === myActiveOnboard.routeId)
                  ?.stops.map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      Stop #{stop.sequence}: {stop.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsChangeDestModalOpen(false)}
                className="px-3 py-2 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleChangeDestinationConfirm}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"
              >
                Update Destination
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 5. MODAL: SHARE TRIP (রাইড শেয়ার)                            */}
      {/* ------------------------------------------------------------- */}
      {isShareModalOpen && myActiveOnboard && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Share Your Bus Journey · রাইড শেয়ার
                </h3>
                <p className="text-xs text-slate-500">
                  Share live transit status with friends and family for safety.
                </p>
              </div>
              <button
                onClick={() => setIsShareModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed font-mono">
              "I am traveling on Kolkata Bus {myActiveOnboard.busNumber} (Route {myActiveOnboard.routeNumber}) from {myActiveOnboard.originStopName} to {myActiveOnboard.destinationStopName}."
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsShareModalOpen(false)}
                className="px-3 py-2 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
              <button
                onClick={handleCopyShareLink}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800 flex items-center gap-1.5"
              >
                <span>📋</span>
                <span>Copy Share Details</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
