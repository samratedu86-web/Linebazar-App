import React, { useState } from 'react';
import {
  AdminAuditLog,
  BusRegistration,
  BusRoute,
  BusStand,
  BusStop,
  Trip,
  UserProfile,
  WaitSignal,
} from '../../types';
import { KolkataTransitMap } from '../map/KolkataTransitMap';
import { store } from '../../services/store';
import { firestoreSync } from '../../services/firestoreSync';
import { CsvRouteImporterModal } from './CsvRouteImporterModal';
import { KNOWN_KOLKATA_COORDS } from '../../data/kolkataCoordinates';

interface AdminViewProps {
  currentUser: UserProfile | null;
  buses: BusRegistration[];
  routes: BusRoute[];
  stands: BusStand[];
  trips: Trip[];
  waitSignals: WaitSignal[];
  auditLogs: AdminAuditLog[];
}

export const AdminView: React.FC<AdminViewProps> = ({
  currentUser,
  buses,
  routes,
  stands,
  trips,
  waitSignals,
  auditLogs,
}) => {
  const [adminTab, setAdminTab] = useState<
    'dashboard' | 'live-map' | 'buses' | 'drivers' | 'routes' | 'stands' | 'passengers' | 'firebase-guide'
  >('dashboard');

  const [rejectModalBusId, setRejectModalBusId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [newRouteModalOpen, setNewRouteModalOpen] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [newRouteNumber, setNewRouteNumber] = useState('');
  const [newRouteName, setNewRouteName] = useState('');
  const [newOrigin, setNewOrigin] = useState('');
  const [newDestination, setNewDestination] = useState('');
  const [intermediateStops, setIntermediateStops] = useState<string[]>([]);
  const [newStopInput, setNewStopInput] = useState('');
  const [existingStopCoords, setExistingStopCoords] = useState<Record<string, { lat: number; lng: number }>>({});
  const [newCategory, setNewCategory] = useState<'government' | 'private' | 'ac_express'>('government');
  const [newFrequency, setNewFrequency] = useState('15');
  const [newFare, setNewFare] = useState('10');
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Bus creation modal state
  const [newBusModalOpen, setNewBusModalOpen] = useState(false);
  const [newBusNumber, setNewBusNumber] = useState('');
  const [newBusModel, setNewBusModel] = useState('Tata Marcopolo BS-VI CNG');
  const [newBusRouteId, setNewBusRouteId] = useState('');
  const [newBusOwnerName, setNewBusOwnerName] = useState('');
  const [newBusOwnerPhone, setNewBusOwnerPhone] = useState('+91');
  const [newBusDriverName, setNewBusDriverName] = useState('');
  const [newBusDriverPhone, setNewBusDriverPhone] = useState('+91');
  const [newBusConductorName, setNewBusConductorName] = useState('');
  const [newBusConductorPhone, setNewBusConductorPhone] = useState('+91');

  // Crew / Passenger creation modal state
  const [newUserModalOpen, setNewUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('+91');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'passenger' | 'driver' | 'conductor'>('driver');
  const [newUserTargetBusId, setNewUserTargetBusId] = useState('');

  const adminName = currentUser?.displayName || 'Linebazar Admin';
  const adminUid = currentUser?.uid || '';

  // Actions
  const handleApprove = (busId: string) => {
    store.adminApproveBus(busId, adminUid, adminName);
  };

  const handleReject = () => {
    if (!rejectModalBusId) return;
    store.adminRejectBus(rejectModalBusId, rejectReason || 'Incomplete registration documents', adminUid, adminName);
    setRejectModalBusId(null);
    setRejectReason('');
  };

  const handleToggleActive = (busId: string, currentActive: boolean) => {
    store.adminToggleBusActive(busId, !currentActive, adminUid, adminName);
  };

  const handleDeleteBus = (busId: string) => {
    if (confirm('Are you sure you want to delete this bus registration?')) {
      store.adminDeleteBus(busId, adminUid, adminName);
      setImportStatus('Bus registration deleted from fleet successfully.');
      setTimeout(() => setImportStatus(null), 3000);
    }
  };

  const handleAdminAddBusSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBusNumber.trim()) return;
    const targetRoute = routes.find((r) => r.id === newBusRouteId) || routes[0];
    store.adminAddBus(
      {
        busNumber: newBusNumber.trim(),
        modelNumber: newBusModel.trim() || 'Tata Marcopolo BS-VI',
        routeNumber: targetRoute ? targetRoute.routeNumber : 'S-12',
        assignedRouteId: targetRoute ? targetRoute.id : 'route-s12',
        ownerName: newBusOwnerName.trim() || adminName,
        ownerPhone: newBusOwnerPhone.trim() || '+919804154302',
        driverName: newBusDriverName.trim() || undefined,
        driverPhone: newBusDriverPhone.trim() || undefined,
        conductorName: newBusConductorName.trim() || undefined,
        conductorPhone: newBusConductorPhone.trim() || undefined,
      },
      adminUid,
      adminName
    );
    setNewBusModalOpen(false);
    setNewBusNumber('');
    setImportStatus(`Bus ${newBusNumber.toUpperCase()} added to fleet successfully!`);
    setTimeout(() => setImportStatus(null), 4000);
  };

  const handleAdminAddUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserPhone.trim() || newUserPhone.trim() === '+91') return;
    try {
      const created = await store.adminAddUser(
        {
          displayName: newUserName.trim(),
          phone: newUserPhone.trim(),
          email: newUserEmail.trim() || undefined,
          role: newUserRole,
          status: 'trial',
        },
        adminUid,
        adminName
      );

      // If user selected a bus to assign crew to
      if (newUserTargetBusId && (newUserRole === 'driver' || newUserRole === 'conductor')) {
        const bus = buses.find((b) => b.id === newUserTargetBusId);
        if (bus) {
          bus.crew.push({
            uid: created.uid,
            displayName: created.displayName,
            phone: created.phone,
            role: newUserRole,
            joinedAt: new Date().toISOString(),
            isVerified: true,
          });
          firestoreSync.syncBusRegistration(bus).catch(() => {});
        }
      }

      setNewUserModalOpen(false);
      setNewUserName('');
      setNewUserPhone('+91');
      setNewUserEmail('');
      setImportStatus(`New ${newUserRole} "${newUserName}" created and synced successfully!`);
      setTimeout(() => setImportStatus(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Failed to add user');
    }
  };

  const handleRemoveCrewMember = (busId: string, crewUid: string, crewName: string) => {
    if (confirm(`Are you sure you want to remove ${crewName} from this bus crew?`)) {
      const bus = buses.find((b) => b.id === busId);
      if (bus) {
        bus.crew = bus.crew.filter((c) => c.uid !== crewUid);
        firestoreSync.syncBusRegistration(bus).catch(() => {});
        store.adminDeleteUser(crewUid, adminUid, adminName).catch(() => {});
        setImportStatus(`Crew member ${crewName} removed successfully.`);
        setTimeout(() => setImportStatus(null), 3000);
      }
    }
  };

  // Batch Route Import from Curated Dataset
  const handleImportCuratedDataset = () => {
    const count = store.adminImportBatchRoutes(routes, adminUid, adminName);
    setImportStatus(`Successfully verified and imported ${count} Kolkata bus routes!`);
    setTimeout(() => setImportStatus(null), 4000);
  };

  const [seeding, setSeeding] = useState(false);

  const handleSeedToFirestore = async () => {
    try {
      setSeeding(true);
      const res = await store.seedToFirestore();
      setImportStatus(`Successfully persisted ${res.routes} routes, ${res.stands} terminals, and ${res.buses} buses to Cloud Firestore!`);
      setSeeding(false);
      setTimeout(() => setImportStatus(null), 5000);
    } catch (e: any) {
      setSeeding(false);
      setImportStatus('Error syncing with Cloud Firestore.');
    }
  };

  const handleOpenCreateRoute = () => {
    setEditingRouteId(null);
    setNewRouteNumber('');
    setNewRouteName('');
    setNewOrigin('');
    setNewDestination('');
    setNewCategory('government');
    setNewFrequency('15');
    setNewFare('10');
    setIntermediateStops([]);
    setNewStopInput('');
    setExistingStopCoords({});
    setNewRouteModalOpen(true);
  };

  const handleOpenEditRoute = (route: BusRoute) => {
    setEditingRouteId(route.id);
    setNewRouteNumber(route.routeNumber);
    setNewRouteName(route.name);
    setNewOrigin(route.origin);
    setNewDestination(route.destination);
    setNewCategory(route.category);
    setNewFrequency(String(route.frequencyMins || 15));
    setNewFare(String(route.fareStartingInr || 10));

    // Intermediate stops (all stops between origin and destination)
    if (route.stops && route.stops.length > 2) {
      setIntermediateStops(route.stops.slice(1, -1).map((s) => s.name));
    } else {
      setIntermediateStops([]);
    }

    // Preserve existing stop coords
    const coordsMap: Record<string, { lat: number; lng: number }> = {};
    route.stops?.forEach((s) => {
      coordsMap[s.name.toLowerCase().trim()] = { lat: s.lat, lng: s.lng };
    });
    setExistingStopCoords(coordsMap);

    setNewStopInput('');
    setNewRouteModalOpen(true);
  };

  const handleCloseRouteModal = () => {
    setNewRouteModalOpen(false);
    setEditingRouteId(null);
    setIntermediateStops([]);
    setNewStopInput('');
  };

  const handleAddIntermediateStop = () => {
    const trimmed = newStopInput.trim();
    if (!trimmed) return;
    setIntermediateStops((prev) => [...prev, trimmed]);
    setNewStopInput('');
  };

  const handleRemoveIntermediateStop = (idx: number) => {
    setIntermediateStops((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateIntermediateStop = (idx: number, val: string) => {
    setIntermediateStops((prev) => {
      const copy = [...prev];
      copy[idx] = val;
      return copy;
    });
  };

  const handleMoveStop = (idx: number, direction: 'up' | 'down') => {
    setIntermediateStops((prev) => {
      const copy = [...prev];
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= copy.length) return prev;
      const temp = copy[idx];
      copy[idx] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy;
    });
  };

  const handleSaveRoute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRouteNumber.trim() || !newOrigin.trim() || !newDestination.trim()) {
      alert('Please fill in route number, origin and destination.');
      return;
    }

    const originName = newOrigin.trim();
    const destinationName = newDestination.trim();
    const stopNames = [
      originName,
      ...intermediateStops.map((s) => s.trim()).filter(Boolean),
      destinationName,
    ];

    const originKey = originName.toLowerCase();
    const destKey = destinationName.toLowerCase();

    const startCoord =
      existingStopCoords[originKey] ||
      KNOWN_KOLKATA_COORDS[originKey] || { lat: 22.5726, lng: 88.3639 };
    const endCoord =
      existingStopCoords[destKey] ||
      KNOWN_KOLKATA_COORDS[destKey] || { lat: 22.585, lng: 88.42 };

    const totalStops = stopNames.length;
    const stops: BusStop[] = stopNames.map((name, idx) => {
      const nameKey = name.toLowerCase();
      let lat = 22.5726;
      let lng = 88.3639;

      if (idx === 0) {
        lat = startCoord.lat;
        lng = startCoord.lng;
      } else if (idx === totalStops - 1) {
        lat = endCoord.lat;
        lng = endCoord.lng;
      } else if (existingStopCoords[nameKey]) {
        lat = existingStopCoords[nameKey].lat;
        lng = existingStopCoords[nameKey].lng;
      } else if (KNOWN_KOLKATA_COORDS[nameKey]) {
        lat = KNOWN_KOLKATA_COORDS[nameKey].lat;
        lng = KNOWN_KOLKATA_COORDS[nameKey].lng;
      } else {
        const t = totalStops > 1 ? idx / (totalStops - 1) : 0;
        lat = startCoord.lat + (endCoord.lat - startCoord.lat) * t;
        lng = startCoord.lng + (endCoord.lng - startCoord.lng) * t;
      }

      return {
        id: `stop-${idx + 1}-${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        name,
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        sequence: idx + 1,
        distanceFromStartKm: Number((idx * (14 / (totalStops - 1 || 1))).toFixed(1)),
        isTerminal: idx === 0 || idx === totalStops - 1,
      };
    });

    const categoryColor =
      newCategory === 'government'
        ? '#0284c7'
        : newCategory === 'ac_express'
        ? '#7c3aed'
        : '#d97706';

    if (editingRouteId) {
      const existing = routes.find((r) => r.id === editingRouteId);
      const updatedRoute: BusRoute = {
        id: editingRouteId,
        routeNumber: newRouteNumber.trim().toUpperCase(),
        name: newRouteName.trim() || `${originName} to ${destinationName}`,
        origin: originName,
        destination: destinationName,
        category: newCategory,
        color: existing?.color || categoryColor,
        firstBus: existing?.firstBus || '05:30 AM',
        lastBus: existing?.lastBus || '10:00 PM',
        frequencyMins: parseInt(newFrequency) || 15,
        fareStartingInr: parseInt(newFare) || 10,
        isActive: existing?.isActive ?? true,
        stops,
      };

      store.adminUpdateRoute(updatedRoute, adminUid, adminName);
      setImportStatus(`Route ${updatedRoute.routeNumber} has been updated successfully!`);
    } else {
      const newRoute: BusRoute = {
        id: `route-${Date.now()}`,
        routeNumber: newRouteNumber.trim().toUpperCase(),
        name: newRouteName.trim() || `${originName} to ${destinationName}`,
        origin: originName,
        destination: destinationName,
        category: newCategory,
        color: categoryColor,
        firstBus: '05:30 AM',
        lastBus: '10:00 PM',
        frequencyMins: parseInt(newFrequency) || 15,
        fareStartingInr: parseInt(newFare) || 10,
        isActive: true,
        stops,
      };

      store.adminCreateRoute(newRoute, adminUid, adminName);
      setImportStatus(`Route ${newRoute.routeNumber} has been successfully created!`);
    }

    handleCloseRouteModal();
    setTimeout(() => setImportStatus(null), 4000);
  };

  const handleDeleteRoute = (routeId: string, routeNumber: string) => {
    if (confirm(`Are you sure you want to delete Route ${routeNumber}?`)) {
      store.adminDeleteRoute(routeId, adminUid, adminName);
      setImportStatus(`Route ${routeNumber} has been deleted.`);
      setTimeout(() => setImportStatus(null), 4000);
    }
  };

  const pendingBuses = buses.filter((b) => b.approvalStatus === 'pending');
  const activeTripsCount = trips.filter((t) => t.status === 'active').length;
  const activeSignalsCount = waitSignals.filter((s) => s.status === 'active').length;

  return (
    <div className="space-y-6">
      {/* Admin Top Dashboard Bar */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 md:p-6 shadow-md border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
              <span className="text-xs font-mono uppercase tracking-wider text-amber-400">
                Server-Authoritative Control Panel
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-black mt-1">Linebazar Kolkata Transit Authority</h1>
            <p className="text-xs text-slate-300 mt-0.5">
              Admin Session: <span className="font-semibold text-white">{adminName}</span> · All mutations logged to immutable audit records
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSeedToFirestore}
              disabled={seeding}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
            >
              <span>{seeding ? 'Syncing to Firestore...' : '☁️ Seed to Cloud Firestore'}</span>
            </button>
            <button
              onClick={() => setCsvModalOpen(true)}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition flex items-center gap-1.5 shadow-xs"
            >
              <span>📁 Upload Routes CSV</span>
            </button>
            <button
              onClick={handleImportCuratedDataset}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              Sync Local Routes
            </button>
            <button
              onClick={() => setNewRouteModalOpen(true)}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold transition shadow-xs"
            >
              + Add New Transit Route
            </button>
          </div>
        </div>

        {/* Admin Navigation Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto mt-6 pt-4 border-t border-slate-800 scrollbar-none text-xs">
          {[
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'live-map', label: 'Live Map' },
            { id: 'buses', label: `Buses (${buses.length})`, badge: pendingBuses.length > 0 ? `${pendingBuses.length} Pending` : undefined },
            { id: 'drivers', label: 'Drivers/Conductor' },
            { id: 'routes', label: `Routes (${routes.length})` },
            { id: 'stands', label: `Stands (${stands.length})` },
            { id: 'passengers', label: 'Passengers & Subscriptions' },
            { id: 'firebase-guide', label: 'Firebase Architecture & Rules' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setAdminTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition flex items-center gap-1.5 ${
                adminTab === tab.id
                  ? 'bg-amber-400 text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="bg-rose-500 text-white font-mono text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {importStatus && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900 flex items-center justify-between">
          <span>{importStatus}</span>
          <button onClick={() => setImportStatus(null)}>✕</button>
        </div>
      )}

      {/* 1. DASHBOARD */}
      {adminTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Live Active Trips</div>
              <div className="text-2xl font-black font-mono tabular-nums text-slate-900 mt-1">
                {activeTripsCount}
              </div>
              <div className="text-[11px] text-emerald-700 font-medium mt-1">Transmitting real-time GPS</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Pending Bus Approvals</div>
              <div className="text-2xl font-black font-mono tabular-nums text-amber-600 mt-1">
                {pendingBuses.length}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Awaiting document verification</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Active Waiting Signals</div>
              <div className="text-2xl font-black font-mono tabular-nums text-slate-900 mt-1">
                {activeSignalsCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Passenger stop requests</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Total Registered Buses</div>
              <div className="text-2xl font-black font-mono tabular-nums text-slate-900 mt-1">
                {buses.length}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {routes.length} transit routes covered
              </div>
            </div>
          </div>

          {/* Pending Bus Approvals Alert Card */}
          {pendingBuses.length > 0 && (
            <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  <h3 className="text-sm font-bold text-slate-900">
                    Buses Requiring Admin Approval ({pendingBuses.length})
                  </h3>
                </div>
                <button
                  onClick={() => setAdminTab('buses')}
                  className="text-xs font-semibold text-amber-800 hover:underline"
                >
                  View All in Buses Tab →
                </button>
              </div>

              <div className="space-y-3">
                {pendingBuses.map((bus) => (
                  <div
                    key={bus.id}
                    className="bg-white rounded-xl border border-amber-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                        {bus.frontPhotoUrl ? (
                          <img
                            src={bus.frontPhotoUrl}
                            alt="Front"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-xl">🚌</span>
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">
                          {bus.busNumber}{' '}
                          <span className="text-xs font-medium text-slate-500 font-normal">
                            ({bus.modelNumber})
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Route {bus.routeNumber} · Applied by {bus.ownerName} ({bus.ownerPhone})
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleApprove(bus.id)}
                        className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition"
                      >
                        Approve Bus (Start 90-Day Trial)
                      </button>
                      <button
                        onClick={() => setRejectModalBusId(bus.id)}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 transition"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Mini Fleet Map & Recent Audit Logs */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-slate-900">Kolkata Live Fleet Overview</span>
                <button
                  onClick={() => setAdminTab('live-map')}
                  className="text-xs font-semibold text-amber-700 hover:underline"
                >
                  Expand Full Map →
                </button>
              </div>
              <KolkataTransitMap
                routes={routes}
                trips={trips}
                buses={buses}
                stands={stands}
                waitSignals={waitSignals}
                className="h-[340px] w-full rounded-xl overflow-hidden border border-slate-200"
              />
            </div>

            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
              <div className="text-sm font-bold text-slate-900 mb-3">Recent Admin Audit Activity</div>
              <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                {auditLogs.slice(0, 8).map((log) => (
                  <div key={log.id} className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 uppercase text-[10px] tracking-wide text-amber-700">
                        {log.action.replace('_', ' ')}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-slate-600 mt-1">{log.details}</p>
                    <div className="text-[10px] text-slate-400 mt-1">Admin: {log.adminName}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. FULL LIVE MAP */}
      {adminTab === 'live-map' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Live GPS Fleet Control Map</h2>
              <p className="text-xs text-slate-500">
                Displaying real-time transit telemetry across Kolkata, Howrah, Bidhannagar & Dum Dum
              </p>
            </div>
            <div className="text-xs font-mono text-slate-500">
              Active Trips: {activeTripsCount}
            </div>
          </div>

          <KolkataTransitMap
            routes={routes}
            trips={trips}
            buses={buses}
            stands={stands}
            waitSignals={waitSignals}
            className="h-[600px] w-full rounded-xl overflow-hidden border border-slate-200"
          />
        </div>
      )}

      {/* 3. BUSES MANAGEMENT */}
      {adminTab === 'buses' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Registered Buses Fleet</h2>
              <p className="text-xs text-slate-500">
                Manage bus approvals, crew members, trial statuses, and operational active flags
              </p>
            </div>
            <button
              type="button"
              onClick={() => setNewBusModalOpen(true)}
              className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-xs transition flex items-center gap-1.5 self-start sm:self-auto"
            >
              <span>➕ Add New Bus (নতুন বাস যোগ করুন)</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-semibold text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-3">Bus Vehicle</th>
                  <th className="py-3 px-3">Route</th>
                  <th className="py-3 px-3">Owner / Drivers & Conductor</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Subscription</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {buses.map((bus) => (
                  <tr key={bus.id} className="hover:bg-slate-50/50 transition">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                          {bus.frontPhotoUrl ? (
                            <img
                              src={bus.frontPhotoUrl}
                              alt="Front"
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-base">🚌</span>
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 font-mono">{bus.busNumber}</div>
                          <div className="text-[11px] text-slate-500">{bus.modelNumber}</div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      <span className="font-bold text-slate-800">Route {bus.routeNumber}</span>
                    </td>

                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{bus.ownerName}</div>
                      <div className="font-mono text-[11px] text-slate-500">{bus.ownerPhone}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{bus.crew.length} crew registered</div>
                    </td>

                    <td className="py-3 px-3">
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          bus.approvalStatus === 'approved'
                            ? 'bg-emerald-50 text-emerald-700'
                            : bus.approvalStatus === 'pending'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-rose-50 text-rose-800'
                        }`}
                      >
                        {bus.approvalStatus.toUpperCase()}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-800">
                        {bus.subscription.status === 'trial' ? '3-Mo Free Trial' : '₹99/mo Active'}
                      </div>
                      {bus.subscription.trialEndDate && (
                        <div className="font-mono text-[10px] text-slate-400">
                          Till {new Date(bus.subscription.trialEndDate).toLocaleDateString()}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-3 text-right space-x-1.5 whitespace-nowrap">
                      {bus.approvalStatus === 'pending' && (
                        <button
                          onClick={() => handleApprove(bus.id)}
                          className="px-2.5 py-1 text-xs font-bold rounded bg-emerald-600 text-white hover:bg-emerald-500"
                        >
                          Approve
                        </button>
                      )}
                      <button
                        onClick={() => handleToggleActive(bus.id, bus.isActive)}
                        className={`px-2.5 py-1 text-xs font-semibold rounded border ${
                          bus.isActive
                            ? 'border-slate-300 text-slate-700 hover:bg-slate-100'
                            : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {bus.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDeleteBus(bus.id)}
                        className="px-2 py-1 text-xs font-semibold text-rose-600 hover:text-rose-800"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. DRIVERS & CREW */}
      {adminTab === 'drivers' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Drivers & Conductors Directory</h2>
              <p className="text-xs text-slate-500">
                Verified transit personnel linked to Kolkata bus fleet operations
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setNewUserRole('driver');
                setNewUserModalOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-xs transition flex items-center gap-1.5 self-start sm:self-auto"
            >
              <span>➕ Add Driver / Conductor (নতুন চালক/কন্ডাক্টর)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {buses.flatMap((bus) =>
              bus.crew.map((member) => (
                <div
                  key={`${bus.id}_${member.uid}`}
                  className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-sm text-slate-900">{member.displayName}</div>
                      <div className="font-mono text-xs text-slate-500 mt-0.5">{member.phone}</div>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-800 px-2 py-0.5 rounded">
                      {member.role}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                    <span>Assigned: <strong className="font-mono">{bus.busNumber}</strong></span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCrewMember(bus.id, member.uid, member.displayName)}
                      className="text-[11px] font-bold text-rose-600 hover:text-rose-800 px-2 py-0.5 rounded hover:bg-rose-50 transition"
                      title="Remove crew member"
                    >
                      🗑️ Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 5. ROUTES */}
      {adminTab === 'routes' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Kolkata Bus Routes & Stop Sequences</h2>
              <p className="text-xs text-slate-500">
                Official urban transit lines across North, Central, South Kolkata, Howrah, and Salt Lake
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCsvModalOpen(true)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors"
              >
                📥 Import CSV (CSV থেকে ইম্পোর্ট)
              </button>
              <button
                onClick={handleOpenCreateRoute}
                className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-amber-400 text-slate-950 hover:bg-amber-300 shadow-xs transition-colors flex items-center gap-1.5"
              >
                <span>➕</span> Add Route (নতুন রুট যোগ করুন)
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {routes.slice(0, 60).map((route) => (
              <div key={route.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="px-2.5 py-1 rounded-md text-xs font-bold text-white shadow-xs"
                      style={{ backgroundColor: route.color || '#0284c7' }}
                    >
                      {route.routeNumber}
                    </span>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900">{route.name}</h4>
                      <p className="text-xs text-slate-500">
                        {route.origin} → {route.destination} · {route.category.replace('_', ' ').toUpperCase()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="text-xs text-slate-500 font-mono tabular-nums text-right hidden sm:block">
                      Every {route.frequencyMins}m · Fare: ₹{route.fareStartingInr}
                    </div>

                    <button
                      onClick={() => handleOpenEditRoute(route)}
                      className="px-2.5 py-1 text-xs font-semibold text-amber-800 hover:text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded transition-colors flex items-center gap-1"
                      title="Edit route details and stop sequence"
                    >
                      <span>✏️</span> Edit
                    </button>

                    <button
                      onClick={() => handleDeleteRoute(route.id, route.routeNumber)}
                      className="px-2 py-1 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Stops sequence */}
                <div className="pt-2 border-t border-slate-200">
                  <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
                    Stop Sequence ({route.stops.length} stops):
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {route.stops.map((stop) => (
                      <span
                        key={stop.id}
                        className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded text-[11px]"
                      >
                        #{stop.sequence} {stop.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {routes.length > 60 && (
              <div className="p-3 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                Showing top 60 of {routes.length.toLocaleString()} routes. All routes are active in the system.
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. STANDS */}
      {adminTab === 'stands' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">Bus Terminals & Stands</h2>
            <p className="text-xs text-slate-500">
              Major interchange hubs and terminus points in Kolkata metropolitan area
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stands.map((stand) => (
              <div key={stand.id} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-start justify-between">
                  <h4 className="font-bold text-sm text-slate-900">{stand.name}</h4>
                  <span className="text-[10px] font-mono font-bold bg-slate-200 px-1.5 py-0.5 rounded">
                    {stand.capacityBuses} Bays
                  </span>
                </div>
                <p className="text-xs text-slate-600">{stand.location}</p>
                <div className="text-xs text-slate-500">
                  Originating: <strong className="text-slate-800">{stand.routesOriginating.join(', ')}</strong>
                </div>
                <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-1">
                  {stand.amenities.map((a, i) => (
                    <span key={i} className="text-[10px] text-slate-500 bg-white border border-slate-200 px-1.5 py-0.2 rounded">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. PASSENGERS & AUDIT LOGS */}
      {adminTab === 'passengers' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Recent Passenger Wait Activity</h2>
                <p className="text-xs text-slate-500">
                  Server-enforced deterministic wait signals: Max 1 signal per passenger per bus trip
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setNewUserRole('passenger');
                  setNewUserModalOpen(true);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-xs transition flex items-center gap-1.5 self-start sm:self-auto"
              >
                <span>➕ Add Passenger (নতুন যাত্রী যোগ করুন)</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Passenger</th>
                    <th className="py-2.5 px-3">Bus Vehicle</th>
                    <th className="py-2.5 px-3">Boarding Stop</th>
                    <th className="py-2.5 px-3">Signal ID</th>
                    <th className="py-2.5 px-3">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {waitSignals.slice(0, 15).map((sig) => (
                    <tr key={sig.id}>
                      <td className="py-2.5 px-3 font-mono text-slate-800">{sig.passengerPhone}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">{sig.busNumber}</td>
                      <td className="py-2.5 px-3 text-slate-700">{sig.stopName}</td>
                      <td className="py-2.5 px-3 font-mono text-[10px] text-slate-400 max-w-[150px] truncate">
                        {sig.id}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500">
                        {new Date(sig.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Immutable Admin Audit Trail</h3>
            <div className="space-y-2">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs flex items-start justify-between gap-4">
                  <div>
                    <span className="font-bold text-slate-900 uppercase text-[10px] bg-slate-200 px-1.5 py-0.5 rounded">
                      {log.action}
                    </span>
                    <span className="text-slate-700 ml-2">{log.details}</span>
                  </div>
                  <span className="font-mono text-slate-400 text-[10px] shrink-0">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 8. FIREBASE ARCHITECTURE & SETUP GUIDE */}
      {adminTab === 'firebase-guide' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-slate-950">Firebase Production Integration & Deployment Checklist</h2>
            <p className="text-xs text-slate-500 mt-1">
              Detailed step-by-step instructions for Firebase Console, Cloud Functions, and payment webhooks.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-700">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <h4 className="font-bold text-slate-900 text-sm">1. Dev & Production Environment Separation</h4>
              <p>• <strong>Dev Project:</strong> <code>linebazar-dev</code> for staging & test OTP numbers.</p>
              <p>• <strong>Prod Project:</strong> <code>linebazar-prod</code> with verified SMS sender ID & production webhooks.</p>
              <p>• <strong>App Check:</strong> Enable reCAPTCHA Enterprise on Web & Play Integrity on Android to stop API abuse.</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <h4 className="font-bold text-slate-900 text-sm">2. Firebase Services & Billing Breakdown</h4>
              <p>• <strong>Firebase Auth:</strong> 10k phone verifications free/month, then ~$0.01–$0.06 per verification in India.</p>
              <p>• <strong>Cloud Firestore:</strong> Free tier 50k reads/day. Trips, routes, crew profiles, wait aggregates.</p>
              <p>• <strong>Realtime Database (RTDB):</strong> High-frequency live GPS pings (bypasses Firestore write limits & cost).</p>
              <p>• <strong>Cloud Storage:</strong> Bus front photos (5MB max, image/* only).</p>
              <p>• <strong>Blaze Plan:</strong> Required for Cloud Functions and outbound payment webhook verification.</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <h4 className="font-bold text-slate-900 text-sm">3. Security Rules & Default-Deny Policy</h4>
              <p>• Role escalation strictly blocked in <code>firestore.rules</code>.</p>
              <p>• Deterministic ID constraint ensures 1 passenger wait signal per bus per trip.</p>
              <p>• Subscriptions & admin audits can only be written by trusted Cloud Functions Admin SDK.</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <h4 className="font-bold text-slate-900 text-sm">4. Verified Payment Webhook Architecture</h4>
              <p>• Razorpay / Stripe webhook handler on <code>/api/paymentWebhook</code>.</p>
              <p>• Validates HMAC-SHA256 signature against secret.</p>
              <p>• Client redirects are NEVER treated as proof of payment; only webhook updates <code>paidThroughDate</code>.</p>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModalBusId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">Reject Bus Registration</h3>
            <p className="text-xs text-slate-500 mt-1">Specify reason for crew notification.</p>

            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Invalid bus registration plate, front photo is blurred, or route permit mismatch."
              rows={3}
              className="w-full mt-3 p-3 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-400"
            />

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setRejectModalBusId(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-500"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Route Modal */}
      {newRouteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingRouteId ? `Edit Bus Route (${newRouteNumber || 'Draft'})` : 'Create New Bus Route'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {editingRouteId
                    ? 'Update route information, fare, and stop sequence'
                    : 'Add a new urban bus route with origin, destination and intermediate stoppages'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseRouteModal}
                className="text-slate-400 hover:text-slate-600 text-lg p-1 rounded-md"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRoute} className="space-y-3.5 mt-4 text-xs overflow-y-auto pr-1 flex-1">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Route Number / Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. S-12, AC-4B, 215A"
                  value={newRouteNumber}
                  onChange={(e) => setNewRouteNumber(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Route Name (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Howrah Station to New Town"
                  value={newRouteName}
                  onChange={(e) => setNewRouteName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Origin Terminus</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Howrah Station"
                    value={newOrigin}
                    onChange={(e) => setNewOrigin(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Destination Terminus</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Karunamoyee"
                    value={newDestination}
                    onChange={(e) => setNewDestination(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>

              {/* Stoppages between Origin & Destination */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <span>Stoppages / স্টপেজ তালিকা</span>
                    <span className="text-[10px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">
                      {intermediateStops.length + 2} stops
                    </span>
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Origin → Sequential Stops → Destination
                  </span>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
                  {/* Origin stop indicator */}
                  <div className="flex items-center gap-2 p-1.5 bg-white rounded-lg border border-slate-200 text-xs">
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      1
                    </span>
                    <div className="flex-1 font-semibold text-slate-800 truncate">
                      {newOrigin.trim() ? newOrigin : <span className="text-slate-400 italic">Enter Origin above</span>}
                    </div>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Origin / প্রারম্ভিক
                    </span>
                  </div>

                  {/* Intermediate stops list */}
                  {intermediateStops.length > 0 ? (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {intermediateStops.map((stopName, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 p-1.5 bg-white rounded-lg border border-slate-200 text-xs shadow-2xs"
                        >
                          <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                            {idx + 2}
                          </span>
                          <input
                            type="text"
                            value={stopName}
                            onChange={(e) => handleUpdateIntermediateStop(idx, e.target.value)}
                            placeholder={`Stoppage #${idx + 2} name`}
                            className="flex-1 px-2.5 py-1 text-xs bg-slate-50 rounded border border-slate-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveStop(idx, 'up')}
                              title="Move Stop Up"
                              className="w-6 h-6 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-25 flex items-center justify-center text-xs"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              disabled={idx === intermediateStops.length - 1}
                              onClick={() => handleMoveStop(idx, 'down')}
                              title="Move Stop Down"
                              className="w-6 h-6 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-25 flex items-center justify-center text-xs"
                            >
                              ▼
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveIntermediateStop(idx)}
                              title="Remove Stoppage"
                              className="w-6 h-6 rounded text-rose-500 hover:bg-rose-50 flex items-center justify-center font-bold text-xs"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 italic py-1 text-center bg-white/60 rounded-lg border border-dashed border-slate-200">
                      মাঝের কোনো স্টপেজ যোগ করা নেই। নিচের বক্সে নাম লিখে &apos;+ Add Stop&apos; চাপুন।
                    </p>
                  )}

                  {/* Add next stoppage input */}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newStopInput}
                      onChange={(e) => setNewStopInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddIntermediateStop();
                        }
                      }}
                      placeholder="Add stoppage name (e.g. Esplanade, Ultadanga)..."
                      className="flex-1 px-3 py-1.5 text-xs bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button
                      type="button"
                      onClick={handleAddIntermediateStop}
                      className="px-3.5 py-1.5 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg shrink-0 flex items-center gap-1 shadow-xs transition-colors"
                    >
                      <span>➕</span> Add Stop
                    </button>
                  </div>

                  {/* Destination stop indicator */}
                  <div className="flex items-center gap-2 p-1.5 bg-white rounded-lg border border-slate-200 text-xs">
                    <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      {intermediateStops.length + 2}
                    </span>
                    <div className="flex-1 font-semibold text-slate-800 truncate">
                      {newDestination.trim() ? newDestination : <span className="text-slate-400 italic">Enter Destination above</span>}
                    </div>
                    <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                      Destination / গন্তব্য
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as any)}
                    className="w-full px-2 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  >
                    <option value="government">Govt</option>
                    <option value="private">Private</option>
                    <option value="ac_express">AC Express</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Frequency (mins)</label>
                  <input
                    type="number"
                    min="5"
                    max="120"
                    value={newFrequency}
                    onChange={(e) => setNewFrequency(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Fare (₹)</label>
                  <input
                    type="number"
                    min="5"
                    max="100"
                    value={newFare}
                    onChange={(e) => setNewFare(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={handleCloseRouteModal}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-amber-400 text-slate-950 hover:bg-amber-300 shadow-xs transition-colors"
                >
                  {editingRouteId ? 'Update Route' : 'Save Route'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Route Importer Modal */}
      <CsvRouteImporterModal
        isOpen={csvModalOpen}
        onClose={() => setCsvModalOpen(false)}
        onImportSuccess={(count) => setImportStatus(`Successfully imported ${count} routes from CSV into Linebazar and Cloud Firestore!`)}
      />

      {/* Add Bus Modal in AdminView */}
      {newBusModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 bg-gradient-to-r from-amber-500/20 to-slate-50 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-black text-slate-950">Add New Bus / নতুন বাস যুক্ত করুন</h3>
                <p className="text-xs text-slate-600">Register vehicle, route assignment, and operational crew</p>
              </div>
              <button
                type="button"
                onClick={() => setNewBusModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAdminAddBusSubmit} className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
              <div>
                <label className="block font-bold text-slate-800 mb-1">Bus Registration Number: *</label>
                <input
                  type="text"
                  required
                  value={newBusNumber}
                  onChange={(e) => setNewBusNumber(e.target.value)}
                  placeholder="e.g. WB 04 G 4589"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white font-mono uppercase"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Model / Make:</label>
                <input
                  type="text"
                  value={newBusModel}
                  onChange={(e) => setNewBusModel(e.target.value)}
                  placeholder="Tata Marcopolo BS-VI CNG"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Assigned Route:</label>
                <select
                  value={newBusRouteId}
                  onChange={(e) => setNewBusRouteId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">Select Route or Route S-12 (Default)</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      Route {r.routeNumber} — {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Owner Name:</label>
                  <input
                    type="text"
                    value={newBusOwnerName}
                    onChange={(e) => setNewBusOwnerName(e.target.value)}
                    placeholder="Owner / Fleet Name"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Owner Phone:</label>
                  <input
                    type="tel"
                    value={newBusOwnerPhone}
                    onChange={(e) => setNewBusOwnerPhone(e.target.value)}
                    placeholder="+919830112233"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="font-bold text-slate-900">Assigned Driver:</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newBusDriverName}
                    onChange={(e) => setNewBusDriverName(e.target.value)}
                    placeholder="Driver Name"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white"
                  />
                  <input
                    type="tel"
                    value={newBusDriverPhone}
                    onChange={(e) => setNewBusDriverPhone(e.target.value)}
                    placeholder="Driver Phone"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="font-bold text-slate-900">Assigned Conductor:</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newBusConductorName}
                    onChange={(e) => setNewBusConductorName(e.target.value)}
                    placeholder="Conductor Name"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white"
                  />
                  <input
                    type="tel"
                    value={newBusConductorPhone}
                    onChange={(e) => setNewBusConductorPhone(e.target.value)}
                    placeholder="Conductor Phone"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setNewBusModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-xs transition"
                >
                  Add Bus to Fleet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add User Modal in AdminView */}
      {newUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden my-auto">
            <div className="px-6 py-4 bg-gradient-to-r from-amber-500/20 to-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-950">
                  Add New {newUserRole === 'passenger' ? 'Passenger' : newUserRole === 'driver' ? 'Driver' : 'Conductor'}
                </h3>
                <p className="text-xs text-slate-600">Register into Linebazar transit database & Firestore</p>
              </div>
              <button
                type="button"
                onClick={() => setNewUserModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAdminAddUserSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-800 mb-1">User Role:</label>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  {(['passenger', 'driver', 'conductor'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setNewUserRole(r)}
                      className={`flex-1 py-1.5 rounded-lg capitalize font-bold text-center transition ${
                        newUserRole === r
                          ? 'bg-amber-500 text-slate-950 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Full Name: *</label>
                <input
                  type="text"
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="e.g. Aloke Roy"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Mobile Phone Number: *</label>
                <input
                  type="tel"
                  required
                  value={newUserPhone}
                  onChange={(e) => setNewUserPhone(e.target.value)}
                  placeholder="+919830112233"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Email Address (Optional):</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="name@transit.org"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                />
              </div>

              {newUserRole !== 'passenger' && (
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Assign to Bus Fleet (Optional):</label>
                  <select
                    value={newUserTargetBusId}
                    onChange={(e) => setNewUserTargetBusId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="">No bus assigned yet</option>
                    {buses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.busNumber} (Route {b.routeNumber})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setNewUserModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-xs transition"
                >
                  Create & Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
