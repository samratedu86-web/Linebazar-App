import React, { useState, useEffect, useRef } from 'react';
import { BusRegistration, BusRoute, Trip, UserProfile, WaitSignal, OnboardPassenger } from '../../types';
import { store } from '../../services/store';
import { uploadBusPhotoToStorage, broadcastLiveGpsToRTDB, removeLiveGpsFromRTDB } from '../../services/firestoreSync';
import { FileUpload } from '../common/FileUpload';

interface CrewViewProps {
  currentUser: UserProfile | null;
  buses: BusRegistration[];
  routes: BusRoute[];
  trips: Trip[];
  waitSignals: WaitSignal[];
  onboardPassengers: OnboardPassenger[];
  onOpenAuth: () => void;
  onOpenSubscription: () => void;
}

export const CrewView: React.FC<CrewViewProps> = ({
  currentUser,
  buses,
  routes,
  trips,
  waitSignals,
  onboardPassengers,
  onOpenAuth,
  onOpenSubscription,
}) => {
  const [activeTab, setActiveTab] = useState<'my-bus' | 'register' | 'join'>('my-bus');

  // Registration Form State
  const [busNumber, setBusNumber] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [frontPhotoUrl, setFrontPhotoUrl] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState(routes[0]?.id || '');
  const [crewRole, setCrewRole] = useState<'driver' | 'conductor'>('driver');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Join Crew Form State
  const [joinBusId, setJoinBusId] = useState('');
  const [joinRole, setJoinRole] = useState<'driver' | 'conductor'>('conductor');
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Live GPS tracking and Ending Stoppage state
  const watchIdRef = useRef<number | null>(null);
  const simulationIntervalRef = useRef<any>(null);
  const [gpsActive, setGpsActive] = useState(false);
  const [tripStoppedFeedback, setTripStoppedFeedback] = useState<string | null>(null);
  const [currentProgressIndex, setCurrentProgressIndex] = useState<number>(0);

  // Bus Photo Upload state for Driver / Conductor
  const busPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Client-side canvas compression for high-performance and lightweight Firestore storage
  const compressImageFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 800;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleBusPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !primaryBus) return;

    if (!file.type.startsWith('image/')) {
      setPhotoFeedback({
        type: 'error',
        message: 'অনুগ্রহ করে শুধুমাত্র ছবি ফাইল (JPG, PNG, WebP) সিলেক্ট করুন।',
      });
      return;
    }

    setIsUploadingPhoto(true);
    setPhotoFeedback(null);

    try {
      // 1. Instant client-side compression to lightweight JPEG (<80KB)
      const compressedDataUrl = await compressImageFile(file);

      // 2. Attempt Firebase Storage upload if authenticated and online
      let finalPhotoUrl = compressedDataUrl;
      try {
        const storageUrl = await uploadBusPhotoToStorage(file, primaryBus.id);
        if (storageUrl && storageUrl.startsWith('http')) {
          finalPhotoUrl = storageUrl;
        }
      } catch (storageErr) {
        console.warn('Storage bucket upload bypassed, using high-performance compressed photo:', storageErr);
      }

      // 3. Save to Store and Firestore
      const res = store.updateBusPhoto(primaryBus.id, finalPhotoUrl);
      if (res.success) {
        setPhotoFeedback({
          type: 'success',
          message: `🎉 বাসের ছবি সফলভাবে আপলোড হয়েছে! বাস ${primaryBus.busNumber} এর আসল ছবি এখন সংরক্ষিত।`,
        });
      } else {
        setPhotoFeedback({
          type: 'error',
          message: res.error || 'ছবি সেভ করতে সমস্যা হয়েছে।',
        });
      }
    } catch (err: any) {
      setPhotoFeedback({
        type: 'error',
        message: err.message || 'ছবি আপলোড ব্যর্থ হয়েছে।',
      });
    } finally {
      setIsUploadingPhoto(false);
      if (busPhotoInputRef.current) {
        busPhotoInputRef.current.value = '';
      }
    }
  };

  const handleDeleteBusPhoto = () => {
    if (!primaryBus) return;
    if (window.confirm(`আপনি কি বাস ${primaryBus.busNumber} এর ছবি ডিলিট করতে চান?`)) {
      store.deleteBusPhoto(primaryBus.id);
      setPhotoFeedback({
        type: 'success',
        message: `বাসের ছবি সফলভাবে ডিলিট করা হয়েছে।`,
      });
    }
  };

  // Audio tone generator for 10-Passenger Alert
  const playAlertSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
      osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      // AudioContext not permitted before user gesture
    }
  };

  // Find bus where current user is in crew
  const myBuses = buses.filter((b) =>
    b.crew.some((c) => c.uid === currentUser?.uid || c.phone === currentUser?.phone)
  );
  const primaryBus = myBuses[0] || buses[0]; // fallback for demo testing

  // Current active trip for this bus
  const activeTrip = trips.find((t) => t.busId === primaryBus?.id && t.status === 'active');
  const assignedRoute = routes.find((r) => r.id === primaryBus?.assignedRouteId);

  // Ending stoppage: The final stop on the assigned route
  const stopsList = assignedRoute?.stops || [];
  const endingStoppage = stopsList.length > 0 ? stopsList[stopsList.length - 1] : null;
  const currentStopObj = stopsList.find((s) => s.id === activeTrip?.currentLocation?.currentStopId) || stopsList[0];
  const nextStopObj = stopsList.find((s) => s.id === activeTrip?.currentLocation?.nextStopId) || stopsList[1] || endingStoppage;

  // Has the bus arrived at or near the ending stoppage?
  const isAtEndingStoppage = Boolean(
    activeTrip &&
    endingStoppage &&
    (activeTrip.currentLocation?.currentStopId === endingStoppage.id ||
      activeTrip.currentLocation?.nextStopId === endingStoppage.id ||
      currentProgressIndex >= stopsList.length - 1)
  );

  // Clean up GPS watchers on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (simulationIntervalRef.current) {
        clearInterval(simulationIntervalRef.current);
      }
    };
  }, []);

  // Sync GPS active status with activeTrip
  useEffect(() => {
    if (activeTrip) {
      setGpsActive(true);
    } else {
      setGpsActive(false);
    }
  }, [activeTrip?.id]);

  // Real-time waiting signals for this bus or its assigned route
  const relevantWaitSignals = waitSignals.filter(
    (s) =>
      (s.busId === primaryBus?.id || s.routeId === assignedRoute?.id) &&
      s.status === 'active'
  );

  // Stops on this route where passengers are currently waiting
  const stopsWithWaitingPassengers = assignedRoute?.stops
    .map((stop) => {
      const signals = relevantWaitSignals.filter((s) => s.stopId === stop.id);
      return {
        stop,
        count: signals.length,
        signals,
      };
    })
    .filter((item) => item.count > 0) || [];

  const totalWaitingCount = stopsWithWaitingPassengers.reduce((sum, item) => sum + item.count, 0);

  // Check 10-Passenger threshold on upcoming stops
  const highDemandStops = stopsWithWaitingPassengers.filter((item) => item.count >= 10);

  // Waiting count at the immediate next stop
  const nextStopWaitingCount = nextStopObj
    ? relevantWaitSignals.filter((s) => s.stopId === nextStopObj.id).length
    : 0;

  // Trigger alert when threshold reached
  useEffect(() => {
    if (highDemandStops && highDemandStops.length > 0) {
      playAlertSound();
    }
  }, [highDemandStops?.length]);

  // Handle Bus Registration (Driver or Conductor login allowed)
  const handleRegisterBus = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    setFormError(null);
    setFormSuccess(null);

    const result = store.requestBusRegistration({
      busNumber,
      modelNumber,
      frontPhotoUrl: frontPhotoUrl ? frontPhotoUrl.trim() : '',
      assignedRouteId: selectedRouteId,
      role: crewRole,
    });

    if (result.success) {
      // Auto-approve newly created bus for seamless testability
      if (result.bus?.id) {
        store.approveBus(result.bus.id, '3-month-trial');
      }

      setFormSuccess(
        `বাস ${busNumber.toUpperCase()} সফলভাবে রেজিস্ট্রেশন হয়েছে! আপনি এই বাসের ${crewRole === 'driver' ? 'Driver' : 'Conductor'} হিসেবে যুক্ত হয়েছেন। ৩ মাসের ফ্রি ট্রায়াল সক্রিয় করা হয়েছে।`
      );
      setBusNumber('');
      setModelNumber('');
      setFrontPhotoUrl('');
      setActiveTab('my-bus');
    } else {
      setFormError(result.error || 'Failed to register bus.');
    }
  };

  // Handle Joining Existing Drivers/Conductor Team
  const handleJoinCrew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    if (!joinBusId) {
      setJoinError('Please select a bus to join.');
      return;
    }

    setJoinError(null);
    setJoinSuccess(null);

    const result = store.joinCrewRequest(joinBusId, joinRole);
    if (result.success) {
      setJoinSuccess(`You have joined bus ${joinRole} team successfully!`);
      setActiveTab('my-bus');
    } else {
      setJoinError(result.error || 'Failed to join crew.');
    }
  };

  // --- BUS STARTING OPTION (বাস স্টার্ট করুন) ---
  const handleStartTrip = () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!primaryBus) {
      setFormError('No bus vehicle assigned or found.');
      return;
    }

    // Auto-approve bus if not approved to prevent locking in demo
    if (primaryBus.approvalStatus !== 'approved') {
      store.approveBus(primaryBus.id, '3-month-trial');
    }

    const result = store.startTrip(primaryBus.id);
    if (!result.success) {
      setFormError(result.error || 'Cannot start trip.');
      return;
    }

    setFormError(null);
    setTripStoppedFeedback(null);
    setGpsActive(true);
    setCurrentProgressIndex(0);

    // 1. ACTIVATE REAL HARDWARE GPS (geolocation watchPosition)
    if ('geolocation' in navigator) {
      try {
        const watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const speedKmh = pos.coords.speed ? Math.max(15, Math.round(pos.coords.speed * 3.6)) : 26;
            const heading = pos.coords.heading || 85;

            // Compute nearest stops along route
            let closestStop = stopsList[0];
            let nextStop = stopsList[1] || closestStop;

            if (stopsList.length > 0) {
              let minDistance = Infinity;
              stopsList.forEach((st, idx) => {
                const dist = Math.hypot(st.lat - lat, st.lng - lng);
                if (dist < minDistance) {
                  minDistance = dist;
                  closestStop = st;
                  nextStop = stopsList[Math.min(idx + 1, stopsList.length - 1)];
                }
              });
            }

            const ping = {
              lat,
              lng,
              speedKmh,
              heading,
              currentStopId: closestStop?.id,
              nextStopId: nextStop?.id,
              timestamp: new Date().toISOString(),
              accuracyMeters: pos.coords.accuracy || 8,
            };

            store.updateBusGPS(primaryBus.id, ping);
            broadcastLiveGpsToRTDB(primaryBus.id, {
              busId: primaryBus.id,
              routeNumber: primaryBus.routeNumber,
              lat,
              lng,
              speedKmh,
              heading,
              currentStop: closestStop?.name,
              nextStop: nextStop?.name,
              isActive: true,
            }).catch(() => {});
          },
          (err) => {
            console.warn('Hardware GPS watcher notice (using smooth route simulator):', err);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
        watchIdRef.current = watchId;
      } catch (e) {
        console.warn('Geolocation invocation error:', e);
      }
    }

    // 2. ACTIVATE ROUTE PROGRESSION SIMULATOR
    // Ensures real-time moving coordinates are broadcast even when stationary or testing inside browser
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current);
    }

    if (stopsList.length > 0) {
      let currentIndex = 0;
      let stepFraction = 0;

      simulationIntervalRef.current = setInterval(() => {
        if (currentIndex >= stopsList.length - 1) {
          // Bus reached ending stoppage
          const endStop = stopsList[stopsList.length - 1];
          store.updateBusGPS(primaryBus.id, {
            lat: endStop.lat,
            lng: endStop.lng,
            speedKmh: 0,
            heading: 0,
            currentStopId: endStop.id,
            nextStopId: endStop.id,
          });
          setCurrentProgressIndex(stopsList.length - 1);
          return;
        }

        stepFraction += 0.25;
        if (stepFraction >= 1) {
          stepFraction = 0;
          currentIndex++;
        }

        setCurrentProgressIndex(currentIndex);
        const fromStop = stopsList[currentIndex];
        const toStop = stopsList[Math.min(currentIndex + 1, stopsList.length - 1)];

        const simLat = fromStop.lat + (toStop.lat - fromStop.lat) * stepFraction;
        const simLng = fromStop.lng + (toStop.lng - fromStop.lng) * stepFraction;
        const simSpeed = Math.floor(24 + Math.random() * 12);
        const simHeading = Math.round(
          (Math.atan2(toStop.lng - fromStop.lng, toStop.lat - fromStop.lat) * 180) / Math.PI
        );

        store.updateBusGPS(primaryBus.id, {
          lat: simLat,
          lng: simLng,
          speedKmh: simSpeed,
          heading: simHeading,
          currentStopId: fromStop.id,
          nextStopId: toStop.id,
        });

        broadcastLiveGpsToRTDB(primaryBus.id, {
          busId: primaryBus.id,
          routeNumber: primaryBus.routeNumber,
          lat: simLat,
          lng: simLng,
          speedKmh: simSpeed,
          heading: simHeading,
          currentStop: fromStop.name,
          nextStop: toStop.name,
          isActive: true,
        }).catch(() => {});
      }, 3500);
    }
  };

  // --- FAST FORWARD TO ENDING STOPPAGE (Testing Helper) ---
  const handleFastForwardToEndingStop = () => {
    if (!activeTrip || !endingStoppage || stopsList.length === 0) return;
    const lastIdx = stopsList.length - 1;
    setCurrentProgressIndex(lastIdx);
    store.updateBusGPS(primaryBus.id, {
      lat: endingStoppage.lat,
      lng: endingStoppage.lng,
      speedKmh: 0,
      heading: 0,
      currentStopId: endingStoppage.id,
      nextStopId: endingStoppage.id,
    });
  };

  // --- BUS STOP OPTION (বাস স্টপ করুন - নির্দিষ্ট Ending Stoppage এ) ---
  const handleEndTrip = () => {
    if (!activeTrip) return;

    // 1. Terminate GPS hardware watcher immediately
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    // 2. Terminate simulation timer
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current);
      simulationIntervalRef.current = null;
    }

    // 3. Clear location in store & mark trip completed
    store.endTrip(activeTrip.id);
    setGpsActive(false);

    // 4. Remove active location from RTDB
    removeLiveGpsFromRTDB(primaryBus.id).catch(() => {});

    // 5. Provide prominent feedback confirming GPS cut-off
    const endingStopName = endingStoppage?.name || 'Ending Stoppage';
    setTripStoppedFeedback(
      `বাসটি নির্দিষ্ট Ending Stoppage (${endingStopName}) এ পৌঁছে সফলভাবে স্টপ করা হয়েছে। জিপিএস ট্র্যাকিং বন্ধ হয়েছে এবং যাত্রীরা আর কোনো লাইভ লোকেশন দেখতে পাবেন না।`
    );
  };

  return (
    <div className="space-y-6">
      {/* 10-Passenger High Wait Alarm Banner */}
      {highDemandStops && highDemandStops.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-500 text-slate-950 border-2 border-slate-950 shadow-lg animate-pulse flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <div className="text-xs uppercase tracking-wider font-extrabold text-slate-900">
                High Passenger Demand Alert (10+ Waiting)
              </div>
              <div className="text-sm font-black mt-0.5">
                {highDemandStops.map((h) => `${h.count} passengers waiting at ${h.stop.name}`).join(' | ')}
              </div>
            </div>
          </div>
          <button
            onClick={playAlertSound}
            className="px-3 py-1.5 rounded-lg bg-slate-950 text-white text-xs font-bold whitespace-nowrap"
          >
            Acknowledge Alert
          </button>
        </div>
      )}

      {/* Confirmation Banner when Bus Stopped at Ending Stoppage */}
      {tripStoppedFeedback && (
        <div className="p-4 rounded-2xl bg-slate-900 text-white border-2 border-emerald-500 shadow-xl flex items-start justify-between gap-3 animate-fade-in">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🛑</span>
            <div>
              <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                বাস স্টপ সম্পন্ন হয়েছে · জিপিএস নিষ্ক্রিয় (Bus Stopped & GPS Terminated)
              </div>
              <p className="text-sm font-medium text-slate-200 mt-1">
                {tripStoppedFeedback}
              </p>
              <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>
                <span>যাত্রীদের ম্যাপ এবং রুট ভিউ থেকে এই বাসের লাইভ ট্র্যাকিং সম্পূর্ণ বন্ধ রয়েছে।</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setTripStoppedFeedback(null)}
            className="text-slate-400 hover:text-white text-sm p-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Drivers/Conductor Top Sub-Nav */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white rounded-2xl border border-slate-200 p-2 shadow-xs gap-2">
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setActiveTab('my-bus')}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition ${
              activeTab === 'my-bus'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            My Bus & Trip Console
          </button>
          <button
            onClick={() => setActiveTab('register')}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition ${
              activeTab === 'register'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Register Bus (Driver/Conductor)
          </button>
          <button
            onClick={() => setActiveTab('join')}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition ${
              activeTab === 'join'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Join as Driver/Conductor
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 pr-2 px-1">
          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-[11px]">
            Drivers/Conductor Portal
          </span>
          <span>·</span>
          {currentUser ? (
            <span className="font-mono text-slate-700">
              {currentUser.displayName} ({currentUser.currentRole.toUpperCase()})
            </span>
          ) : (
            <button
              onClick={onOpenAuth}
              className="text-amber-700 font-semibold underline hover:text-amber-800"
            >
              Sign In to Operate
            </button>
          )}
        </div>
      </div>

      {formError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800 flex items-center justify-between">
          <span>{formError}</span>
          <button onClick={() => setFormError(null)}>✕</button>
        </div>
      )}

      {formSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex items-center justify-between">
          <span>{formSuccess}</span>
          <button onClick={() => setFormSuccess(null)}>✕</button>
        </div>
      )}

      {/* TAB 1: MY BUS & TRIP CONSOLE */}
      {activeTab === 'my-bus' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Bus Profile & Driver/Conductor Assignment */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                    Assigned Bus Vehicle
                  </div>
                  <h2 className="text-xl font-black text-slate-950 mt-0.5">
                    {primaryBus ? primaryBus.busNumber : 'No Bus Assigned'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {primaryBus?.modelNumber} · Route {primaryBus?.routeNumber}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                      primaryBus?.approvalStatus === 'approved'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : primaryBus?.approvalStatus === 'pending'
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {primaryBus?.approvalStatus.toUpperCase()}
                  </span>
                  {primaryBus?.approvalStatus !== 'approved' && (
                    <button
                      onClick={() => store.approveBus(primaryBus.id, '3-month-trial')}
                      className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 hover:bg-amber-100"
                      title="Instant approval for testing"
                    >
                      ✓ 1-Click Approve
                    </button>
                  )}
                </div>
              </div>

              {/* BUS PHOTO SECTION: REAL UPLOAD BY DRIVER/CONDUCTOR ONLY (NO STOCK PHOTOS) */}
              <div className="mt-4 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span>📷 বাসের ছবি (Vehicle Photo)</span>
                  </div>
                  {primaryBus?.frontPhotoUrl && (
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                      ✓ আপলোড করা হয়েছে
                    </span>
                  )}
                </div>

                {/* Feedback notification toast */}
                {photoFeedback && (
                  <div
                    className={`mb-3 p-2.5 rounded-xl border text-xs font-medium flex items-center justify-between ${
                      photoFeedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    <span>{photoFeedback.message}</span>
                    <button
                      type="button"
                      onClick={() => setPhotoFeedback(null)}
                      className="text-xs font-bold px-1 ml-2 text-slate-500 hover:text-slate-800"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {primaryBus?.frontPhotoUrl ? (
                  /* Display Real Uploaded Bus Photo */
                  <div className="space-y-2.5">
                    <div className="relative rounded-xl overflow-hidden border border-slate-200 h-48 bg-slate-900 group">
                      <img
                        src={primaryBus.frontPhotoUrl}
                        alt={`Bus ${primaryBus.busNumber}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-2 left-2 px-2 py-1 bg-slate-950/75 backdrop-blur-xs text-white text-[10px] font-bold rounded-md flex items-center gap-1">
                        <span>📷</span>
                        <span>{primaryBus.busNumber}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isUploadingPhoto}
                        onClick={() => busPhotoInputRef.current?.click()}
                        className="flex-1 py-2 px-3 text-xs font-bold rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 transition flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 disabled:opacity-50"
                      >
                        <span>📷</span>
                        <span>{isUploadingPhoto ? 'আপলোড হচ্ছে...' : 'ছবি পরিবর্তন করুন'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isUploadingPhoto}
                        onClick={handleDeleteBusPhoto}
                        className="py-2 px-3 text-xs font-bold rounded-lg bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition flex items-center justify-center gap-1 shadow-2xs active:scale-95 disabled:opacity-50"
                        title="বাসের ছবি মুছে ফেলুন"
                      >
                        <span>🗑️</span>
                        <span>ডিলিট</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Clean Placeholder when no photo has been uploaded by Driver/Conductor */
                  <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/70 p-4 text-center space-y-2.5">
                    <div className="w-12 h-12 rounded-full bg-slate-200/80 mx-auto flex items-center justify-center text-2xl text-slate-600">
                      🚌
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-800">
                        কোনো বাসের ছবি আপলোড করা হয়নি
                      </div>
                      <p className="text-[11px] text-slate-500 max-w-xs mx-auto mt-0.5 leading-relaxed">
                        ড্রাইভার/কন্ডাক্টর হিসেবে আপনার নিজের বাসের ছবি আপলোড করুন যাতে যাত্রীরা বাসটি দেখেই সহজে চিনতে পারেন।
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isUploadingPhoto}
                      onClick={() => busPhotoInputRef.current?.click()}
                      className="w-full py-2.5 px-3 rounded-lg text-xs font-black bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow-2xs flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
                    >
                      {isUploadingPhoto ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
                          <span>ছবি প্রসেস হচ্ছে...</span>
                        </>
                      ) : (
                        <>
                          <span className="text-base">📷</span>
                          <span>নিজের বাসের ছবি আপলোড করুন</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Hidden File Input supporting direct camera snapshot on mobile */}
                <input
                  ref={busPhotoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/*"
                  onChange={handleBusPhotoSelect}
                  className="hidden"
                />
              </div>

              {/* Approval & Subscription Guard */}
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Route Path:</span>
                  <span className="font-semibold text-slate-900 text-right">
                    {assignedRoute?.origin} → {assignedRoute?.destination}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Ending Stoppage:</span>
                  <span className="font-bold text-slate-950 bg-slate-100 px-2 py-0.5 rounded">
                    🏁 {endingStoppage?.name || 'Terminal'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Bus Subscription:</span>
                  <span className="font-semibold text-emerald-700">
                    3-Month Free Trial Active
                  </span>
                </div>

                <button
                  onClick={onOpenSubscription}
                  className="w-full mt-2 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                >
                  Manage Bus Subscription & Billing
                </button>
              </div>

              {/* Registered Drivers / Conductors */}
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-600 mb-2">
                  Registered Drivers & Conductors:
                </div>
                <div className="space-y-1.5">
                  {primaryBus?.crew.map((member) => (
                    <div
                      key={member.uid}
                      className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-bold text-slate-900">{member.displayName}</span>{' '}
                        <span className="text-amber-700 font-semibold uppercase text-[10px] px-1.5 py-0.5 rounded bg-amber-100 ml-1">
                          {member.role}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500">{member.phone}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Live Trip Controller & Ending Stoppage Operations */}
          <div className="lg:col-span-7 space-y-5">
            {/* Live Trip Controller */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
                <div>
                  <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
                    <span>Trip Operations Console</span>
                    <span className="text-xs font-normal text-slate-500 font-mono">
                      (Route {primaryBus?.routeNumber})
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    {assignedRoute?.origin} ➔ {endingStoppage?.name || assignedRoute?.destination}
                  </p>
                </div>
                {activeTrip ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                    <span>GPS Active & Transmitting</span>
                  </span>
                ) : (
                  <span className="text-xs font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
                    Standby / Parked at Depot
                  </span>
                )}
              </div>

              {/* Trip Controls Box */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                {activeTrip ? (
                  <div className="space-y-4">
                    {/* Live Transmission Banner */}
                    <div className="p-3 bg-emerald-500 text-slate-950 rounded-xl font-medium text-xs flex items-center justify-between shadow-xs">
                      <div className="flex items-center gap-2.5">
                        <span className="w-3 h-3 rounded-full bg-white animate-pulse"></span>
                        <div>
                          <div className="font-black text-slate-950 uppercase tracking-wide">
                            GPS Live Broadcasting Activated
                          </div>
                          <div className="text-[11px] text-slate-900">
                            যাত্রীরা এখন আপনার বাসের লাইভ অবস্থান ও স্টপ দেখতে পাচ্ছেন।
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-[11px] font-bold bg-white/40 px-2 py-0.5 rounded">
                        Route {primaryBus?.routeNumber}
                      </span>
                    </div>

                    {/* Live Telemetry Grid */}
                    <div className="grid grid-cols-3 gap-2.5 text-center">
                      <div className="bg-white p-3 rounded-xl border border-slate-200">
                        <div className="text-[10px] text-slate-400 uppercase font-bold">Speed (গতি)</div>
                        <div className="text-lg font-black font-mono tabular-nums text-slate-900 mt-0.5">
                          {activeTrip.currentLocation?.speedKmh || 26} <span className="text-xs font-normal">km/h</span>
                        </div>
                      </div>
                      <div className="bg-white p-3 rounded-xl border border-slate-200">
                        <div className="text-[10px] text-slate-400 uppercase font-bold">Current Stop</div>
                        <div className="text-xs font-bold text-slate-800 truncate mt-1">
                          {currentStopObj?.name || 'In Transit'}
                        </div>
                      </div>
                      <div className="bg-white p-3 rounded-xl border border-slate-200">
                        <div className="text-[10px] text-slate-400 uppercase font-bold">Next Stop</div>
                        <div className="text-xs font-bold text-amber-700 truncate mt-1">
                          {nextStopObj?.name || endingStoppage?.name}
                        </div>
                        {nextStopWaitingCount > 0 ? (
                          <div className="text-[10px] font-bold text-amber-950 bg-amber-200 px-1.5 py-0.5 rounded mt-1 inline-block animate-pulse">
                            👥 {nextStopWaitingCount} জন অপেক্ষা করছেন
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-400 mt-1">
                            ০ জন অপেক্ষমাণ
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress to Ending Stoppage */}
                    <div className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-medium">
                          গন্তব্যের অগ্রগতি (Progress to Ending Stoppage):
                        </span>
                        <span className="font-bold text-slate-900">
                          {Math.min(currentProgressIndex + 1, stopsList.length)} of {stopsList.length} Stops
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-amber-500 to-emerald-500 h-2.5 rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(10, ((currentProgressIndex + 1) / (stopsList.length || 1)) * 100)
                            )}%`,
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                        <span>🏁 অন্তিম স্টপেজ: <strong className="text-slate-800">{endingStoppage?.name}</strong></span>
                        {/* Testing Fast Forward */}
                        {!isAtEndingStoppage && (
                          <button
                            onClick={handleFastForwardToEndingStop}
                            className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 underline"
                            title="টেস্টিং এর জন্য অন্তিম স্টপেজে পৌঁছানোর সিমুলেশন করুন"
                          >
                            Fast Forward to End Stop (Test) ⏩
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Ending Stoppage Alert Banner */}
                    {isAtEndingStoppage && (
                      <div className="p-3 rounded-xl bg-amber-100 border-2 border-amber-500 text-slate-950 text-xs font-medium flex items-center gap-2 animate-bounce">
                        <span className="text-lg">🎯</span>
                        <div>
                          <strong>বাসটি নির্দিষ্ট ending stoppage ({endingStoppage?.name}) এ পৌঁছেছে!</strong>
                          <div>অনুগ্রহ করে নিচে 'বাস স্টপ করুন' অপশন চাপুন।</div>
                        </div>
                      </div>
                    )}

                    {/* BUS STOP OPTION BUTTON (বাস স্টপ করুন) */}
                    <div className="pt-2">
                      <button
                        onClick={handleEndTrip}
                        className={`w-full py-3.5 px-4 font-black text-sm rounded-xl text-white transition shadow-md flex items-center justify-center gap-2 ${
                          isAtEndingStoppage
                            ? 'bg-rose-600 hover:bg-rose-700 ring-4 ring-rose-300 animate-pulse'
                            : 'bg-rose-600 hover:bg-rose-500'
                        }`}
                      >
                        <span className="text-lg">🛑</span>
                        <span>বাস স্টপ করুন (Bus Stop Option - End Trip)</span>
                      </button>
                      <p className="text-[11px] text-center text-slate-500 mt-1.5">
                        * বাস স্টপ অপশন ক্লিক করার সাথে সাথে জিপিএস ট্র্যাকিং বন্ধ হবে এবং যাত্রীরা আর লোকেশন দেখতে পাবে না।
                      </p>
                    </div>
                  </div>
                ) : (
                  /* BUS STARTING OPTION BUTTON (বাস স্টার্ট করুন) */
                  <div className="text-center py-6 px-2 space-y-4">
                    <div className="max-w-md mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center text-2xl mx-auto mb-3 shadow-xs">
                        🚌
                      </div>
                      <h4 className="text-base font-black text-slate-900">
                        বাস স্টার্ট অপশন (Bus Starting Option)
                      </h4>
                      <p className="text-xs text-slate-600 mt-1">
                        লগইন থাকা অবস্থায় ডিপো বা প্রথম স্টপেজ থেকে বাস ছাড়ার সময় স্টার্ট করুন।
                        বাস স্টার্ট অপশনে ক্লিক করার সাথে সাথে ডিভাইস GPS সক্রিয় হবে এবং যাত্রীরা ম্যাপে আপনার বাসের লাইভ লোকেশন দেখতে পাবেন।
                      </p>
                    </div>

                    <div className="pt-1">
                      <button
                        onClick={handleStartTrip}
                        className="py-3.5 px-8 text-sm font-black rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 transition shadow-md hover:shadow-lg inline-flex items-center gap-2.5 active:scale-95"
                      >
                        <span className="text-lg">▶️</span>
                        <span>বাস স্টার্ট করুন (Start Bus Trip)</span>
                      </button>
                    </div>

                    <div className="text-[11px] text-slate-500 flex items-center justify-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                      <span>
                        Route {primaryBus?.routeNumber}: {assignedRoute?.origin} → {endingStoppage?.name}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Onboard Headcount & Stop Drop-Off Coordination */}
              {(() => {
                const busOnboardList = onboardPassengers.filter(
                  (o) => o.busId === primaryBus?.id && o.status === 'onboard'
                );

                return (
                  <div className="mt-5 space-y-4">
                    {/* 1. Onboard Passengers Headcount Banner */}
                    <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl">👥</span>
                        <div>
                          <div className="text-xs font-black text-emerald-950 uppercase tracking-wide">
                            Passengers Currently Onboard (বাসে আছেন)
                          </div>
                          <div className="text-[11px] text-emerald-700">
                            Real-time headcount confirmed by "I am in the Bus"
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-lg font-black font-mono text-emerald-950 px-2.5 py-1 rounded-lg bg-emerald-100 border border-emerald-300">
                          {busOnboardList.length} onboard
                        </span>
                      </div>
                    </div>

                    {/* 2. DEDICATED REAL-TIME WAITING PASSENGERS MONITOR */}
                    <div className="p-4 rounded-xl bg-gradient-to-r from-amber-50/80 via-white to-amber-50/40 border-2 border-amber-300 shadow-2xs space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🚏</span>
                          <div>
                            <h4 className="text-xs md:text-sm font-black text-slate-950 flex items-center gap-2">
                              <span>যাত্রী অপেক্ষার রিয়েল-টাইম মনিটর</span>
                              <span className="text-[11px] text-amber-800 font-bold bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                                Route {assignedRoute?.routeNumber}
                              </span>
                            </h4>
                            <p className="text-[11px] text-slate-600">
                              যাত্রী বাস স্টপে দাঁড়িয়ে "I am waiting" ক্লিক করার সাথে সাথে Drivers/Conductor এখানে লাইভ দেখতে পাবেন।
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-black font-mono tabular-nums ${
                            totalWaitingCount > 0
                              ? 'bg-amber-400 text-slate-950 shadow-xs animate-pulse'
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            <span>👥</span>
                            <span>{totalWaitingCount} জন যাত্রী অপেক্ষা করছেন</span>
                          </span>
                        </div>
                      </div>

                      {/* Summary Cards of Stops Where Passengers are Currently Waiting */}
                      {stopsWithWaitingPassengers.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                          {stopsWithWaitingPassengers.map(({ stop, count, signals }) => {
                            const isHigh = count >= 10;
                            return (
                              <div
                                key={stop.id}
                                className={`p-3 rounded-xl border transition ${
                                  isHigh
                                    ? 'bg-amber-100/90 border-amber-500 text-slate-950 shadow-xs'
                                    : 'bg-white border-amber-300 text-slate-900 shadow-2xs'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-1">
                                  <div>
                                    <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">
                                      স্টপ #{stop.sequence} · {stop.distanceFromStartKm} কিমি
                                    </div>
                                    <div className="text-sm font-black text-slate-950 mt-0.5">
                                      {stop.name}
                                    </div>
                                  </div>
                                  <span
                                    className={`text-xs font-black px-2.5 py-1 rounded-lg shrink-0 ${
                                      isHigh
                                        ? 'bg-amber-500 text-slate-950 shadow-xs'
                                        : 'bg-amber-100 text-amber-950 border border-amber-300'
                                    }`}
                                  >
                                    👥 {count} জন অপেক্ষা করছেন
                                  </span>
                                </div>

                                <div className="mt-2 text-[11px] text-slate-600 flex items-center justify-between border-t border-slate-100 pt-1.5">
                                  <span className="truncate">
                                    যাত্রী: {signals.map((s) => s.passengerName || s.passengerPhone || 'Passenger').slice(0, 3).join(', ')}
                                    {signals.length > 3 ? ` +${signals.length - 3} জন` : ''}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-mono shrink-0 ml-1">
                                    {new Date(signals[0]?.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs flex items-center gap-2">
                          <span className="text-base">ℹ️</span>
                          <span>
                            বর্তমানে Route {assignedRoute?.routeNumber} এর স্টপে কোনো যাত্রী অপেক্ষার সংকেত দেননি। যাত্রীরা স্টপে দাঁড়িয়ে <strong>"I am waiting"</strong> প্রেস করলেই ড্রাইভার/কন্ডাক্টর এখানে দেখতে পাবেন।
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 3. Detailed Route Stoppage List */}
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between">
                        <span>স্টপ অনুযায়ী যাত্রী চাহিদা ও ড্রপ-অফ ({assignedRoute?.routeNumber}):</span>
                        <span className="text-[10px] text-slate-500 font-normal">Waiting vs Alighting</span>
                      </div>

                      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                        {assignedRoute?.stops.map((stop, idx) => {
                          const matchingWaitSignals = waitSignals.filter(
                            (s) =>
                              (s.busId === primaryBus?.id || s.routeId === assignedRoute?.id) &&
                              s.stopId === stop.id &&
                              s.status === 'active'
                          );
                          const count = matchingWaitSignals.length;

                          const alighting = busOnboardList.filter(
                            (o) => o.destinationStopId === stop.id
                          ).length;

                          const isHighAlert = count >= 10;
                          const isEndStop = idx === assignedRoute.stops.length - 1;

                          return (
                            <div
                              key={stop.id}
                              className={`p-3 rounded-xl border flex items-center justify-between text-xs transition ${
                                isHighAlert
                                  ? 'bg-amber-100/90 border-amber-500 font-bold text-slate-950 shadow-xs'
                                  : count > 0
                                  ? 'bg-amber-50/60 border-amber-300 text-slate-900 shadow-2xs'
                                  : alighting > 0
                                  ? 'bg-white border-slate-300 text-slate-800 shadow-2xs'
                                  : 'bg-slate-50/60 border-slate-200 text-slate-600'
                              }`}
                            >
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-slate-900">Stop #{stop.sequence}:</span>
                                  <span className="font-semibold">{stop.name}</span>
                                  {isEndStop && (
                                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 uppercase">
                                      Ending Stop
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  {stop.distanceFromStartKm} km from terminal
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {alighting > 0 && (
                                  <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-300">
                                    🚶 {alighting} alight
                                  </span>
                                )}

                                <span
                                  className={`font-mono font-bold text-xs tabular-nums px-2.5 py-0.5 rounded-md ${
                                    isHighAlert
                                      ? 'bg-amber-500 text-slate-950'
                                      : count > 0
                                      ? 'bg-amber-200 text-amber-950 border border-amber-400'
                                      : 'bg-slate-100 text-slate-500'
                                  }`}
                                >
                                  👥 {count} waiting
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: REGISTER NEW BUS (Driver OR Conductor any one logged in) */}
      {activeTab === 'register' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-2xl mx-auto shadow-xs">
          <div className="border-b border-slate-100 pb-4 mb-5">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-700 uppercase tracking-wider mb-1">
              <span>🚌 বাস রেজিস্ট্রেশন আবেদন</span>
              <span>·</span>
              <span>Drivers/Conductor Portal</span>
            </div>
            <h2 className="text-xl font-black text-slate-950">
              Bus Registration (Driver or Conductor Login)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              একটি বাস registration করার সময় Driver অথবা Conductor যেকোনো একজন লগইন অবস্থায় থাকতে পারবেন।
              অনুমোদনের সাথে সাথে ৩ মাসের ফ্রি ট্রায়াল সক্রিয় হবে এবং ট্রিপ পরিচালনা করা যাবে।
            </p>
          </div>

          {/* Current Auth Status Notice */}
          {!currentUser ? (
            <div className="mb-5 p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs">
              <div className="font-bold text-sm mb-1">লগইন প্রয়োজন (Sign-in Required)</div>
              <p>
                বাস রেজিস্ট্রেশন করতে ড্রাইভার অথবা কন্ডাক্টর যেকোনো একজন লগইন অবস্থায় থাকতে হবে।
                অনুগ্রহ করে নিচের বোতাম চেপে লগইন বা সাইন আপ করুন।
              </p>
              <button
                type="button"
                onClick={onOpenAuth}
                className="mt-3 py-2 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shadow-xs text-xs"
              >
                ড্রাইভার / কন্ডাক্টর হিসেবে লগইন করুন →
              </button>
            </div>
          ) : (
            <div className="mb-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">👤</span>
                <div>
                  <span className="font-bold">{currentUser.displayName}</span>
                  <span className="text-emerald-700 ml-1.5 font-mono">({currentUser.phone})</span>
                  <div className="text-[11px] text-emerald-800">
                    লগইন আছেন: <strong className="uppercase">{currentUser.currentRole}</strong> হিসেবে।
                  </div>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 font-bold text-[11px]">
                Active Session
              </span>
            </div>
          )}

          <form onSubmit={handleRegisterBus} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Bus Registration Number (বাস নম্বর, যেমন: WB 04 G 4589)
              </label>
              <input
                type="text"
                required
                value={busNumber}
                onChange={(e) => setBusNumber(e.target.value)}
                placeholder="WB 04 G 4589"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 uppercase font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Duplicates are normalized and verified. If this bus exists, use "Join as Driver/Conductor".
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Bus Model & Chassis (বাস মডেল ও বিবরণ)
              </label>
              <input
                type="text"
                required
                value={modelNumber}
                onChange={(e) => setModelNumber(e.target.value)}
                placeholder="e.g. Tata Marcopolo BS-VI Low Floor / Ashok Leyland Lynx"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <FileUpload
              label="Bus Front Vehicle Photo (বাসের সামনের ছবি)"
              helperText="Upload official front view photo of this bus vehicle to Firebase Storage (max 10MB)."
              storagePathPrefix="bus_photos"
              currentUrl={frontPhotoUrl}
              onUploadSuccess={(url) => setFrontPhotoUrl(url)}
              onRequireAuth={onOpenAuth}
            />

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assigned Transit Route (নির্ধারিত বাস রুট)
              </label>
              <select
                value={selectedRouteId}
                onChange={(e) => setSelectedRouteId(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    Route {r.routeNumber} ({r.origin} → {r.destination}) - {r.stops.length} Stops
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Your Operational Role (আপনি কোন ভূমিকায় বাসটি রেজিস্টার করছেন)
              </label>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setCrewRole('driver')}
                  className={`py-2.5 px-3 rounded-lg border font-bold transition flex items-center justify-center gap-2 ${
                    crewRole === 'driver'
                      ? 'border-amber-500 bg-amber-50 text-slate-950 ring-2 ring-amber-400'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>🛞 Driver (ড্রাইভার)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCrewRole('conductor')}
                  className={`py-2.5 px-3 rounded-lg border font-bold transition flex items-center justify-center gap-2 ${
                    crewRole === 'conductor'
                      ? 'border-amber-500 bg-amber-50 text-slate-950 ring-2 ring-amber-400'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>🎟️ Conductor (কন্ডাক্টর)</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                ড্রাইভার বা কন্ডাক্টর যেকোনো একজন লগইন অবস্থায় বাস রেজিস্টার করতে পারবেন। পরবর্তীতে অপরজন "Join as Driver/Conductor" অপশন দিয়ে যুক্ত হতে পারবেন।
              </p>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 text-sm font-bold rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm mt-3"
            >
              বাস রেজিস্ট্রেশন নিশ্চিত করুন (Submit Registration)
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: JOIN EXISTING CREW (Driver or Conductor) */}
      {activeTab === 'join' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-xl mx-auto shadow-xs">
          <div className="border-b border-slate-100 pb-4 mb-5">
            <h2 className="text-lg font-bold text-slate-950">Join as Driver / Conductor</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              যদি আপনার বাসের ড্রাইভার বা কন্ডাক্টরের মধ্যে যেকোনো একজন ইতিমধ্যেই বাসটি রেজিস্টার করে থাকেন, তবে নিচের তালিকা থেকে বাসটি নির্বাচন করে নিজের প্রোফাইল যুক্ত করুন।
            </p>
          </div>

          {joinError && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {joinError}
            </div>
          )}

          {joinSuccess && (
            <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
              {joinSuccess}
            </div>
          )}

          <form onSubmit={handleJoinCrew} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Select Existing Registered Bus
              </label>
              <select
                value={joinBusId}
                onChange={(e) => setJoinBusId(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
              >
                <option value="">-- Select a Bus --</option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.busNumber} (Route {b.routeNumber}) - {b.modelNumber}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Joining As
              </label>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setJoinRole('driver')}
                  className={`py-2 px-3 rounded-lg border font-semibold transition ${
                    joinRole === 'driver'
                      ? 'border-amber-500 bg-amber-50 text-slate-900 ring-2 ring-amber-400'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  Driver (ড্রাইভার)
                </button>
                <button
                  type="button"
                  onClick={() => setJoinRole('conductor')}
                  className={`py-2 px-3 rounded-lg border font-semibold transition ${
                    joinRole === 'conductor'
                      ? 'border-amber-500 bg-amber-50 text-slate-900 ring-2 ring-amber-400'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  Conductor (কন্ডাক্টর)
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 text-sm font-bold rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow-sm"
            >
              Join Bus Team (টিমে যুক্ত হন)
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
