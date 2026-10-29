import {
  AdminAuditLog,
  BusApprovalStatus,
  BusRegistration,
  BusRoute,
  BusStand,
  BusStopWaitAggregate,
  LiveGPSPing,
  PaymentRecord,
  Trip,
  UserProfile,
  UserRole,
  UserSubscription,
  WaitSignal,
  OnboardPassenger,
  DESIGNATED_ADMIN_UID,
  DESIGNATED_ADMIN_PHONE,
  DESIGNATED_ADMIN_RAW_PHONE,
  DESIGNATED_ADMIN_EMAIL,
} from '../types';
import { INITIAL_BUSES, KOLKATA_BUS_STANDS, KOLKATA_ROUTES } from '../data/kolkataRoutes';
import { firestoreSync, removeLiveGpsFromRTDB } from './firestoreSync';
import { auth } from '../lib/firebase';

const STORAGE_KEYS = {
  USER: 'linebazar_user',
  BUSES: 'linebazar_buses',
  ROUTES: 'linebazar_routes',
  STANDS: 'linebazar_stands',
  TRIPS: 'linebazar_trips',
  GPS_LOCATIONS: 'linebazar_gps_locations',
  WAIT_SIGNALS: 'linebazar_wait_signals',
  ONBOARD_PASSENGERS: 'linebazar_onboard_passengers',
  AUDIT_LOGS: 'linebazar_audit_logs',
  PAYMENTS: 'linebazar_payments',
};

// Initial default trips
const INITIAL_TRIPS: Trip[] = [
  {
    id: 'trip-live-01',
    busId: 'bus-s12-01',
    busNumber: 'WB 04 G 4589',
    routeId: 'route-s12',
    routeNumber: 'S-12',
    driverUid: 'crew-user-1',
    driverName: 'Subhasish Banerjee',
    conductorUid: 'crew-user-2',
    conductorName: 'Tapan Ghosh',
    status: 'active',
    startTime: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
    completedStops: ['s12-1', 's12-2', 's12-3'],
    currentLocation: {
      busId: 'bus-s12-01',
      tripId: 'trip-live-01',
      lat: 22.5697,
      lng: 88.3714,
      heading: 84,
      speedKmh: 34,
      timestamp: new Date().toISOString(),
      accuracyMeters: 8,
      currentStopId: 's12-5',
      nextStopId: 's12-6',
    },
  },
  {
    id: 'trip-live-02',
    busId: 'bus-ac12-01',
    busNumber: 'WB 19 B 1204',
    routeId: 'route-ac12',
    routeNumber: 'AC-12',
    driverUid: 'crew-user-3',
    driverName: 'Pritam Sengupta',
    status: 'active',
    startTime: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    completedStops: ['ac12-1', 'ac12-2'],
    currentLocation: {
      busId: 'bus-ac12-01',
      tripId: 'trip-live-02',
      lat: 22.5678,
      lng: 88.3985,
      heading: 96,
      speedKmh: 28,
      timestamp: new Date().toISOString(),
      accuracyMeters: 6,
      currentStopId: 'ac12-4',
      nextStopId: 'ac12-5',
    },
  },
  {
    id: 'trip-live-03',
    busId: 'bus-230-01',
    busNumber: 'WB 07 C 8841',
    routeId: 'route-230',
    routeNumber: '230',
    driverUid: 'crew-user-4',
    driverName: 'Amal Roy',
    status: 'active',
    startTime: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    completedStops: ['r230-1', 'r230-2', 'r230-3', 'r230-4'],
    currentLocation: {
      busId: 'bus-230-01',
      tripId: 'trip-live-03',
      lat: 22.5398,
      lng: 88.3492,
      heading: 12,
      speedKmh: 22,
      timestamp: new Date().toISOString(),
      accuracyMeters: 10,
      currentStopId: 'r230-5',
      nextStopId: 'r230-6',
    },
  },
  {
    id: 'trip-live-1a-01',
    busId: 'bus-1a-01',
    busNumber: 'WB 02 Y 3391',
    routeId: 'route-1a_ramnagar_mukundapur',
    routeNumber: '1A',
    driverUid: 'crew-user-6',
    driverName: 'Debabrata Mondal',
    status: 'active',
    startTime: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
    completedStops: ['1a-1', '1a-2', '1a-3', '1a-4', '1a-5', '1a-6', '1a-7', '1a-8', '1a-9'],
    currentLocation: {
      busId: 'bus-1a-01',
      tripId: 'trip-live-1a-01',
      lat: 22.5175,
      lng: 88.3510,
      heading: 140,
      speedKmh: 24,
      timestamp: new Date().toISOString(),
      accuracyMeters: 6,
      currentStopId: '1a-10', // Rashbehari
      nextStopId: '1a-11',    // Rabindra Sarovar
    },
  },
];

// Seed initial waiting signals (including a stop with 9 people so passenger adding makes it 10!)
const INITIAL_WAIT_SIGNALS: WaitSignal[] = [
  ...Array.from({ length: 9 }).map((_, i) => ({
    id: `pax-seed-${i}_bus-s12-01_trip-live-01`,
    passengerUid: `pax-seed-${i}`,
    passengerPhone: `+91983000000${i}`,
    busId: 'bus-s12-01',
    busNumber: 'WB 04 G 4589',
    tripId: 'trip-live-01',
    routeId: 'route-s12',
    stopId: 's12-6', // Maniktala Crossing
    stopName: 'Maniktala Crossing',
    timestamp: new Date(Date.now() - (15 - i) * 60 * 1000).toISOString(),
    status: 'active' as const,
  })),
  {
    id: 'pax-seed-10_bus-230-01_trip-live-03',
    passengerUid: 'pax-seed-10',
    passengerPhone: '+919830000010',
    busId: 'bus-230-01',
    busNumber: 'WB 07 C 8841',
    tripId: 'trip-live-03',
    routeId: 'route-230',
    stopId: 'r230-7',
    stopName: 'Esplanade (Dharmatala)',
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    status: 'active',
  },
  {
    id: 'pax-seed-1a_bus-1a-01_trip-live-1a-01',
    passengerUid: 'pax-seed-1a',
    passengerPhone: '+919830000099',
    busId: 'bus-1a-01',
    busNumber: 'WB 02 Y 3391',
    tripId: 'trip-live-1a-01',
    routeId: 'route-1a_ramnagar_mukundapur',
    stopId: '1a-16', // Jadavpur 8B
    stopName: 'Jadavpur 8B',
    timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    status: 'active',
  },
];

const INITIAL_AUDIT_LOGS: AdminAuditLog[] = [
  {
    id: 'audit-01',
    adminUid: 'admin-linebazar-root',
    adminName: 'Super Admin',
    action: 'approve_bus',
    targetType: 'bus',
    targetId: 'bus-s12-01',
    details: 'Approved Tata Marcopolo WB 04 G 4589 for Route S-12 and initiated 90-day trial.',
    timestamp: '2026-08-15T11:00:00Z',
  },
  {
    id: 'audit-02',
    adminUid: 'admin-linebazar-root',
    adminName: 'Super Admin',
    action: 'approve_bus',
    targetType: 'bus',
    targetId: 'bus-ac12-01',
    details: 'Approved Volvo 8400 WB 19 B 1204 for Route AC-12 and initiated 90-day trial.',
    timestamp: '2026-08-20T09:30:00Z',
  },
];

const INITIAL_ONBOARD_PASSENGERS: OnboardPassenger[] = [
  {
    id: 'onboard-seed-1',
    passengerUid: 'pax-seed-101',
    passengerName: 'Anirban Mukherjee',
    passengerPhone: '+919830111222',
    busId: 'bus-s12-01',
    busNumber: 'WB 04 G 4589',
    routeId: 'route-s12',
    routeNumber: 'S-12',
    tripId: 'trip-live-01',
    originStopId: 's12-1',
    originStopName: 'Howrah Station',
    destinationStopId: 's12-9',
    destinationStopName: 'New Town Eco Space',
    boardedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    status: 'onboard',
    notifyBeforeStops: 1,
  },
  {
    id: 'onboard-seed-2',
    passengerUid: 'pax-seed-102',
    passengerName: 'Ritika Sen',
    passengerPhone: '+919830222333',
    busId: 'bus-s12-01',
    busNumber: 'WB 04 G 4589',
    routeId: 'route-s12',
    routeNumber: 'S-12',
    tripId: 'trip-live-01',
    originStopId: 's12-3',
    originStopName: 'College Street',
    destinationStopId: 's12-7',
    destinationStopName: 'Karunamoyee',
    boardedAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
    status: 'onboard',
    notifyBeforeStops: 1,
  },
];

export class LinebazarStore {
  private static instance: LinebazarStore;
  private listeners: Set<() => void> = new Set();

  private user: UserProfile | null = null;
  private buses: BusRegistration[] = [];
  private routes: BusRoute[] = [];
  private stands: BusStand[] = [];
  private trips: Trip[] = [];
  private waitSignals: WaitSignal[] = [];
  private onboardPassengers: OnboardPassenger[] = [];
  private auditLogs: AdminAuditLog[] = [];
  private payments: PaymentRecord[] = [];
  private gpsWatcherId: number | null = null;
  private simulationTimer: number | null = null;

  private constructor() {
    this.loadFromStorage();
    this.startGpsSimulation();
  }

  public static getInstance(): LinebazarStore {
    if (!LinebazarStore.instance) {
      LinebazarStore.instance = new LinebazarStore();
    }
    return LinebazarStore.instance;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
    this.saveToStorage();
  }

  private loadFromStorage() {
    try {
      const storedUser = localStorage.getItem(STORAGE_KEYS.USER);
      if (storedUser) {
        try {
          const parsed = JSON.parse(storedUser);
          // Security Sanitize: Verify if stored user has legitimate admin authority
          const isRealAdmin =
            parsed?.email?.toLowerCase() === DESIGNATED_ADMIN_EMAIL ||
            parsed?.phone?.replace(/\D/g, '').slice(-10) === DESIGNATED_ADMIN_RAW_PHONE;
          if (!isRealAdmin) {
            if (parsed.uid === DESIGNATED_ADMIN_UID) {
              parsed.uid = `pax-${Math.random().toString(36).substring(2, 8)}`;
            }
            parsed.roles = (parsed.roles || []).filter((r: string) => r !== 'admin');
            if (parsed.currentRole === 'admin') {
              parsed.currentRole = 'passenger';
            }
          }
          this.user = parsed;
        } catch {
          this.user = null;
        }
      } else {
        this.user = null;
      }

      const storedBuses = localStorage.getItem(STORAGE_KEYS.BUSES);
      if (storedBuses) {
        const parsedBuses: BusRegistration[] = JSON.parse(storedBuses);
        const busMap = new Map<string, BusRegistration>();
        parsedBuses.forEach((b) => {
          // Remove any automatic/stock bus photos that were previously displayed
          if (b.frontPhotoUrl && b.frontPhotoUrl.includes('images.unsplash.com')) {
            b.frontPhotoUrl = '';
          }
          busMap.set(b.id, b);
        });
        INITIAL_BUSES.forEach((b) => {
          if (!busMap.has(b.id)) {
            busMap.set(b.id, b);
          } else {
            const existing = busMap.get(b.id)!;
            if (existing.frontPhotoUrl && existing.frontPhotoUrl.includes('images.unsplash.com')) {
              existing.frontPhotoUrl = '';
            }
          }
        });
        this.buses = Array.from(busMap.values());
      } else {
        this.buses = INITIAL_BUSES;
      }

      const storedRoutes = localStorage.getItem(STORAGE_KEYS.ROUTES);
      if (storedRoutes) {
        try {
          const parsedRoutes: BusRoute[] = JSON.parse(storedRoutes);
          const routeMap = new Map<string, BusRoute>();
          // 1. Populate all official Kolkata routes (including all 1,845 verified routes)
          KOLKATA_ROUTES.forEach((r) => routeMap.set(r.id, r));
          // 2. Overlay any custom/user-added routes
          if (Array.isArray(parsedRoutes)) {
            parsedRoutes.forEach((r) => {
              if (r && r.id) routeMap.set(r.id, r);
            });
          }
          // 3. Ensure Route 1A remains verified
          const r1a = KOLKATA_ROUTES.find((r) => r.id === 'route-1a_ramnagar_mukundapur');
          if (r1a) {
            routeMap.set(r1a.id, r1a);
          }
          this.routes = Array.from(routeMap.values());
        } catch {
          this.routes = KOLKATA_ROUTES;
        }
      } else {
        this.routes = KOLKATA_ROUTES;
      }

      const storedStands = localStorage.getItem(STORAGE_KEYS.STANDS);
      if (storedStands) {
        const parsedStands: BusStand[] = JSON.parse(storedStands);
        const standMap = new Map<string, BusStand>();
        parsedStands.forEach((s) => standMap.set(s.id, s));
        KOLKATA_BUS_STANDS.forEach((s) => {
          if (!standMap.has(s.id)) standMap.set(s.id, s);
        });
        this.stands = Array.from(standMap.values());
      } else {
        this.stands = KOLKATA_BUS_STANDS;
      }

      const storedTrips = localStorage.getItem(STORAGE_KEYS.TRIPS);
      if (storedTrips) {
        const parsedTrips: Trip[] = JSON.parse(storedTrips);
        const tripMap = new Map<string, Trip>();
        parsedTrips.forEach((t) => tripMap.set(t.id, t));
        INITIAL_TRIPS.forEach((t) => {
          if (!tripMap.has(t.id)) tripMap.set(t.id, t);
        });
        this.trips = Array.from(tripMap.values());
      } else {
        this.trips = INITIAL_TRIPS;
      }

      const storedWaitSignals = localStorage.getItem(STORAGE_KEYS.WAIT_SIGNALS);
      this.waitSignals = storedWaitSignals ? JSON.parse(storedWaitSignals) : INITIAL_WAIT_SIGNALS;

      const storedOnboard = localStorage.getItem(STORAGE_KEYS.ONBOARD_PASSENGERS);
      this.onboardPassengers = storedOnboard ? JSON.parse(storedOnboard) : INITIAL_ONBOARD_PASSENGERS;

      // Auto-sync Route 1A to Firestore on store initialization
      const r1aRoute = this.routes.find((r) => r.id === 'route-1a_ramnagar_mukundapur');
      if (r1aRoute) {
        firestoreSync.syncRoute(r1aRoute).catch(() => {});
      }

      const storedAuditLogs = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS);
      this.auditLogs = storedAuditLogs ? JSON.parse(storedAuditLogs) : INITIAL_AUDIT_LOGS;

      const storedPayments = localStorage.getItem(STORAGE_KEYS.PAYMENTS);
      this.payments = storedPayments ? JSON.parse(storedPayments) : [];
    } catch (e) {
      console.error('Error loading Linebazar store from localStorage:', e);
      this.buses = INITIAL_BUSES;
      this.routes = KOLKATA_ROUTES;
      this.stands = KOLKATA_BUS_STANDS;
      this.trips = INITIAL_TRIPS;
      this.waitSignals = INITIAL_WAIT_SIGNALS;
      this.onboardPassengers = INITIAL_ONBOARD_PASSENGERS;
      this.auditLogs = INITIAL_AUDIT_LOGS;
    }
  }

  private saveToStorage() {
    try {
      if (this.user) {
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(this.user));
      } else {
        localStorage.removeItem(STORAGE_KEYS.USER);
      }
      localStorage.setItem(STORAGE_KEYS.BUSES, JSON.stringify(this.buses));
      // Save only custom/user-added routes to prevent exceeding browser localStorage 5MB quota
      const officialIds = new Set(KOLKATA_ROUTES.map((r) => r.id));
      const customRoutes = this.routes.filter((r) => !officialIds.has(r.id));
      localStorage.setItem(STORAGE_KEYS.ROUTES, JSON.stringify(customRoutes));
      localStorage.setItem(STORAGE_KEYS.STANDS, JSON.stringify(this.stands));
      localStorage.setItem(STORAGE_KEYS.TRIPS, JSON.stringify(this.trips));
      localStorage.setItem(STORAGE_KEYS.WAIT_SIGNALS, JSON.stringify(this.waitSignals));
      localStorage.setItem(STORAGE_KEYS.ONBOARD_PASSENGERS, JSON.stringify(this.onboardPassengers));
      localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(this.auditLogs));
      localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(this.payments));
    } catch (e) {
      console.error('Error persisting Linebazar store:', e);
    }
  }

  // --- Normalization Helpers ---
  public static normalizeBusNumber(raw: string): string {
    return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // --- Auth & Profile Management ---
  public createDefaultPassenger(phone: string, displayName: string): UserProfile {
    const trialStart = new Date();
    const trialEnd = new Date(trialStart);
    trialEnd.setDate(trialEnd.getDate() + 90); // 3 months free trial

    return {
      uid: 'pax-' + Math.random().toString(36).substring(2, 9),
      phone,
      displayName,
      roles: ['passenger'],
      currentRole: 'passenger',
      createdAt: trialStart.toISOString(),
      subscription: {
        id: 'sub-' + Math.random().toString(36).substring(2, 9),
        subscriberId: 'pax-' + Math.random().toString(36).substring(2, 9),
        type: 'passenger',
        status: 'trial',
        trialStartDate: trialStart.toISOString(),
        trialEndDate: trialEnd.toISOString(),
        paidThroughDate: trialEnd.toISOString(),
        autoRenew: true,
        monthlyAmountInr: 19,
      },
    };
  }

  public signIn(
    phone: string,
    displayName: string,
    role: UserRole,
    customUid?: string,
    email?: string,
    photoURL?: string
  ): UserProfile {
    const trialStart = new Date();
    const trialEnd = new Date(trialStart);
    trialEnd.setDate(trialEnd.getDate() + 90);

    // Strict Admin Authorization Check:
    // Only grant admin privileges if authenticated email matches verified admin email
    // or if the authenticated Firebase Auth user UID matches the designated admin UID.
    const currentAuthEmail = auth.currentUser?.email?.toLowerCase();
    const currentAuthUid = auth.currentUser?.uid;
    const currentAuthPhone = auth.currentUser?.phoneNumber?.replace(/\D/g, '').slice(-10);
    const inputPhone = phone?.replace(/\D/g, '').slice(-10);
    const isBootstrappedAdmin =
      email?.toLowerCase() === DESIGNATED_ADMIN_EMAIL ||
      currentAuthEmail === DESIGNATED_ADMIN_EMAIL ||
      inputPhone === DESIGNATED_ADMIN_RAW_PHONE ||
      currentAuthPhone === DESIGNATED_ADMIN_RAW_PHONE ||
      (customUid === DESIGNATED_ADMIN_UID && currentAuthUid === DESIGNATED_ADMIN_UID);

    // Prevent privilege escalation: If user requested admin but is not authorized, force to passenger
    const safeRole: UserRole = (role === 'admin' && !isBootstrappedAdmin) ? 'passenger' : role;
    const rolesList: UserRole[] = isBootstrappedAdmin
      ? Array.from(new Set(['admin' as UserRole, safeRole]))
      : [safeRole];
    const initialRole: UserRole = isBootstrappedAdmin ? 'admin' : safeRole;

    const newUser: UserProfile = {
      uid: customUid || `${safeRole}-${Math.random().toString(36).substring(2, 9)}`,
      phone,
      displayName,
      email,
      photoURL,
      roles: rolesList,
      currentRole: initialRole,
      createdAt: trialStart.toISOString(),
      subscription: {
        id: `sub-${Math.random().toString(36).substring(2, 9)}`,
        subscriberId: `sub-id-${Math.random().toString(36).substring(2, 9)}`,
        type: safeRole === 'passenger' ? 'passenger' : 'bus',
        status: 'trial',
        trialStartDate: trialStart.toISOString(),
        trialEndDate: trialEnd.toISOString(),
        paidThroughDate: trialEnd.toISOString(),
        autoRenew: true,
        monthlyAmountInr: safeRole === 'passenger' ? 19 : 99,
      },
    };

    this.user = newUser;
    this.saveToStorage();
    firestoreSync.syncUserProfile(newUser).catch(() => {});
    this.notify();
    return newUser;
  }

  public setUser(profile: UserProfile): void {
    const currentAuthEmail = auth.currentUser?.email?.toLowerCase();
    const currentAuthUid = auth.currentUser?.uid;
    const currentAuthPhone = auth.currentUser?.phoneNumber?.replace(/\D/g, '').slice(-10);
    const profilePhone = profile.phone?.replace(/\D/g, '').slice(-10);
    const isAuthorizedAdmin =
      profile.email?.toLowerCase() === DESIGNATED_ADMIN_EMAIL ||
      currentAuthEmail === DESIGNATED_ADMIN_EMAIL ||
      profilePhone === DESIGNATED_ADMIN_RAW_PHONE ||
      currentAuthPhone === DESIGNATED_ADMIN_RAW_PHONE ||
      (profile.uid === DESIGNATED_ADMIN_UID && currentAuthUid === DESIGNATED_ADMIN_UID);

    if (isAuthorizedAdmin) {
      if (!profile.roles.includes('admin')) {
        profile.roles.push('admin');
      }
      profile.currentRole = 'admin';
    } else {
      // Remove admin role if illegally injected into client profile
      profile.roles = (profile.roles || []).filter((r) => r !== 'admin');
      if (profile.currentRole === 'admin') {
        profile.currentRole = 'passenger';
      }
    }
    this.user = profile;
    this.saveToStorage();
    this.notify();
  }

  public switchRole(targetRole: UserRole) {
    if (!this.user) return;
    // Admin role enforcement: cannot switch to admin unless already an authorized admin
    if (targetRole === 'admin') {
      const currentAuthEmail = auth.currentUser?.email?.toLowerCase();
      const currentAuthUid = auth.currentUser?.uid;
      const currentAuthPhone = auth.currentUser?.phoneNumber?.replace(/\D/g, '').slice(-10);
      const userPhone = this.user.phone?.replace(/\D/g, '').slice(-10);
      const isAuthorizedAdmin =
        this.user.email?.toLowerCase() === DESIGNATED_ADMIN_EMAIL ||
        currentAuthEmail === DESIGNATED_ADMIN_EMAIL ||
        userPhone === DESIGNATED_ADMIN_RAW_PHONE ||
        currentAuthPhone === DESIGNATED_ADMIN_RAW_PHONE ||
        (this.user.uid === DESIGNATED_ADMIN_UID && currentAuthUid === DESIGNATED_ADMIN_UID);

      if (!isAuthorizedAdmin) {
        console.warn('Unauthorized attempt to switch to admin role was blocked.');
        return;
      }
    }
    this.user.currentRole = targetRole;
    this.saveToStorage();
    this.notify();
  }

  public signOut() {
    this.user = null;
    this.saveToStorage();
    try {
      import('../lib/firebase').then(({ auth }) => {
        auth.signOut().catch(() => {});
      });
    } catch (e) {}
    this.notify();
  }

  public getCurrentUser(): UserProfile | null {
    return this.user;
  }

  // --- Subscriptions & Entitlements ---
  public isSubscriptionActive(sub: UserSubscription): boolean {
    if (sub.status === 'trial') {
      if (sub.trialEndDate) {
        return new Date(sub.trialEndDate).getTime() > Date.now();
      }
      return true;
    }
    if (!sub.paidThroughDate) return false;
    const expiry = new Date(sub.paidThroughDate).getTime();
    return expiry > Date.now();
  }

  public cancelSubscription(subscriberId: string, type: 'passenger' | 'bus'): boolean {
    if (type === 'passenger' && this.user) {
      this.user.subscription.autoRenew = false;
      this.user.subscription.status = 'cancelled';
      this.user.subscription.cancellationDate = new Date().toISOString();
      this.notify();
      return true;
    } else if (type === 'bus') {
      const bus = this.buses.find((b) => b.id === subscriberId);
      if (bus) {
        bus.subscription.autoRenew = false;
        bus.subscription.status = 'cancelled';
        bus.subscription.cancellationDate = new Date().toISOString();
        this.notify();
        return true;
      }
    }
    return false;
  }

  public recordPayment(params: {
    subscriberId: string;
    type: 'passenger' | 'bus';
    amountInr: number;
    provider: 'razorpay' | 'stripe';
    providerPaymentId: string;
    monthsToAdd?: number;
  }): PaymentRecord {
    const months = params.monthsToAdd || 1;
    const now = new Date();

    let existingEnd = now;
    if (params.type === 'passenger' && this.user?.subscription.paidThroughDate) {
      const currentEnd = new Date(this.user.subscription.paidThroughDate);
      if (currentEnd > now) existingEnd = currentEnd;
    } else if (params.type === 'bus') {
      const bus = this.buses.find((b) => b.id === params.subscriberId);
      if (bus?.subscription.paidThroughDate) {
        const currentEnd = new Date(bus.subscription.paidThroughDate);
        if (currentEnd > now) existingEnd = currentEnd;
      }
    }

    const newEnd = new Date(existingEnd);
    newEnd.setMonth(newEnd.getMonth() + months);

    const payment: PaymentRecord = {
      id: `pay-${Math.random().toString(36).substring(2, 9)}`,
      subscriberId: params.subscriberId,
      userPhone: this.user?.phone || '+919830000000',
      type: params.type,
      amountInr: params.amountInr,
      currency: 'INR',
      status: 'captured',
      provider: params.provider,
      providerPaymentId: params.providerPaymentId,
      createdAt: now.toISOString(),
      paidPeriodStart: existingEnd.toISOString(),
      paidPeriodEnd: newEnd.toISOString(),
    };

    this.payments.unshift(payment);

    if (params.type === 'passenger' && this.user) {
      this.user.subscription.status = 'active';
      this.user.subscription.paidThroughDate = newEnd.toISOString();
      this.user.subscription.autoRenew = true;
      this.user.subscription.lastPaymentId = payment.id;
    } else if (params.type === 'bus') {
      const bus = this.buses.find((b) => b.id === params.subscriberId);
      if (bus) {
        bus.subscription.status = 'active';
        bus.subscription.paidThroughDate = newEnd.toISOString();
        bus.subscription.autoRenew = true;
        bus.subscription.lastPaymentId = payment.id;
      }
    }

    this.notify();
    return payment;
  }

  // --- Bus Registration & Crew ---
  public requestBusRegistration(data: {
    busNumber: string;
    modelNumber: string;
    frontPhotoUrl: string;
    assignedRouteId: string;
    role: 'driver' | 'conductor';
  }): { success: boolean; error?: string; bus?: BusRegistration } {
    if (!this.user) {
      return {
        success: false,
        error: 'বাস রেজিস্ট্রেশন করার জন্য ড্রাইভার অথবা কন্ডাক্টর যেকোনো একজন লগইন অবস্থায় থাকা আবশ্যক (Either Driver or Conductor must be logged in).',
      };
    }

    // Ensure user role reflects their operational role (driver or conductor)
    if (this.user.currentRole === 'passenger') {
      this.user.currentRole = data.role;
      if (!this.user.roles.includes(data.role)) {
        this.user.roles.push(data.role);
      }
      this.setUser(this.user);
      firestoreSync.syncUserProfile(this.user).catch(() => {});
    }

    const normalized = LinebazarStore.normalizeBusNumber(data.busNumber);
    if (!normalized || normalized.length < 5) {
      return { success: false, error: 'Invalid bus registration number format' };
    }

    // Check for duplicate bus
    const existingBus = this.buses.find((b) => b.normalizedBusNumber === normalized);
    if (existingBus) {
      return {
        success: false,
        error: `Bus ${existingBus.busNumber} is already registered. You can request to join its crew instead of creating a duplicate.`,
      };
    }

    const route = this.routes.find((r) => r.id === data.assignedRouteId);
    if (!route) {
      return { success: false, error: 'Selected route not found' };
    }

    const busId = `bus-${Math.random().toString(36).substring(2, 9)}`;
    const newBus: BusRegistration = {
      id: busId,
      busNumber: data.busNumber.toUpperCase().trim(),
      normalizedBusNumber: normalized,
      modelNumber: data.modelNumber.trim(),
      frontPhotoUrl: data.frontPhotoUrl ? data.frontPhotoUrl.trim() : '',
      assignedRouteId: route.id,
      routeNumber: route.routeNumber,
      ownerUid: this.user.uid,
      ownerName: this.user.displayName,
      ownerPhone: this.user.phone,
      approvalStatus: 'pending',
      appliedAt: new Date().toISOString(),
      crew: [
        {
          uid: this.user.uid,
          phone: this.user.phone,
          displayName: this.user.displayName,
          role: data.role,
          joinedAt: new Date().toISOString(),
          isVerified: true,
        },
      ],
      subscription: {
        id: `sub-${busId}`,
        subscriberId: busId,
        type: 'bus',
        status: 'trial',
        trialStartDate: '',
        trialEndDate: '',
        paidThroughDate: '',
        autoRenew: true,
        monthlyAmountInr: 99,
      },
      isActive: false,
    };

    this.buses.unshift(newBus);
    firestoreSync.syncBusRegistration(newBus).catch(() => {});
    this.notify();
    return { success: true, bus: newBus };
  }

  public joinCrewRequest(busId: string, role: 'driver' | 'conductor'): { success: boolean; error?: string } {
    if (!this.user) return { success: false, error: 'Sign-in required' };

    const bus = this.buses.find((b) => b.id === busId);
    if (!bus) return { success: false, error: 'Bus not found' };

    const alreadyInCrew = bus.crew.some((c) => c.uid === this.user?.uid);
    if (alreadyInCrew) return { success: false, error: 'You are already registered in this bus crew' };

    bus.crew.push({
      uid: this.user.uid,
      phone: this.user.phone,
      displayName: this.user.displayName,
      role,
      joinedAt: new Date().toISOString(),
      isVerified: true,
    });

    this.notify();
    return { success: true };
  }

  // --- Bus Photo Management by Driver / Conductor ---
  public updateBusPhoto(busId: string, photoUrl: string): { success: boolean; error?: string } {
    const bus = this.buses.find((b) => b.id === busId);
    if (!bus) return { success: false, error: 'Bus not found' };

    bus.frontPhotoUrl = photoUrl;
    this.saveToStorage();
    firestoreSync.updateBusPhoto(busId, photoUrl).catch(() => {});
    this.notify();
    return { success: true };
  }

  public deleteBusPhoto(busId: string): { success: boolean; error?: string } {
    return this.updateBusPhoto(busId, '');
  }

  // --- Wait Signals & 10-Passenger Alert ---
  public sendWaitSignals(stopId: string, stopName: string, selectedBusIds: string[], targetRouteId?: string): {
    sent: WaitSignal[];
    skipped: string[];
    alertTriggeredBusIds: string[];
  } {
    if (!this.user) {
      throw new Error('You must be signed in to signal waiting.');
    }

    const sent: WaitSignal[] = [];
    const skipped: string[] = [];
    const alertTriggeredBusIds: string[] = [];

    // If specific bus IDs provided, use those; otherwise find all buses on target route
    let busIdsToProcess = [...selectedBusIds];
    if (busIdsToProcess.length === 0 && targetRouteId) {
      const routeBuses = this.buses.filter((b) => b.assignedRouteId === targetRouteId);
      if (routeBuses.length > 0) {
        busIdsToProcess = routeBuses.map((b) => b.id);
      }
    }

    // Fallback: If still empty but route exists, create a route-level placeholder signal
    if (busIdsToProcess.length === 0 && targetRouteId) {
      const route = this.routes.find((r) => r.id === targetRouteId);
      const deterministicId = `${this.user.uid}_route_${targetRouteId}_${stopId}`;
      const alreadySignaled = this.waitSignals.some(
        (s) => s.id === deterministicId && s.status === 'active'
      );

      if (!alreadySignaled) {
        const signal: WaitSignal = {
          id: deterministicId,
          passengerUid: this.user.uid,
          passengerName: this.user.displayName || 'Passenger',
          passengerPhone: this.user.phone,
          busId: `route-${targetRouteId}`,
          busNumber: route ? `Route ${route.routeNumber}` : 'Route Bus',
          tripId: 'all-trips',
          routeId: targetRouteId,
          stopId,
          stopName,
          timestamp: new Date().toISOString(),
          status: 'active',
        };
        this.waitSignals.unshift(signal);
        sent.push(signal);
        firestoreSync.syncWaitSignal(signal).catch(() => {});
      } else {
        skipped.push(`route-${targetRouteId}`);
      }

      this.notify();
      return { sent, skipped, alertTriggeredBusIds };
    }

    busIdsToProcess.forEach((busId) => {
      const bus = this.buses.find((b) => b.id === busId);
      if (!bus) {
        skipped.push(busId);
        return;
      }

      // Check active trip
      const activeTrip = this.trips.find((t) => t.busId === busId && t.status === 'active');
      const tripId = activeTrip ? activeTrip.id : 'no-active-trip';

      // Deterministic wait signal ID: ${passengerUid}_${busId}_${tripId}_${stopId}
      const deterministicId = `${this.user!.uid}_${busId}_${tripId}_${stopId}`;

      // Enforce: Max 1 active wait signal per passenger per bus per stop
      const alreadySignaled = this.waitSignals.some(
        (s) => (s.id === deterministicId || (s.passengerUid === this.user!.uid && s.busId === busId && s.stopId === stopId)) && s.status === 'active'
      );

      if (alreadySignaled) {
        skipped.push(busId);
        return;
      }

      const signal: WaitSignal = {
        id: deterministicId,
        passengerUid: this.user!.uid,
        passengerName: this.user!.displayName || 'Passenger',
        passengerPhone: this.user!.phone,
        busId: bus.id,
        busNumber: bus.busNumber,
        tripId,
        routeId: bus.assignedRouteId,
        stopId,
        stopName,
        timestamp: new Date().toISOString(),
        status: 'active',
      };

      this.waitSignals.unshift(signal);
      sent.push(signal);
      firestoreSync.syncWaitSignal(signal).catch(() => {});

      // Check count at this stop for this bus/route
      const currentStopCount = this.waitSignals.filter(
        (s) => (s.busId === busId || s.routeId === bus.assignedRouteId) && s.stopId === stopId && s.status === 'active'
      ).length;

      if (currentStopCount >= 10) {
        alertTriggeredBusIds.push(busId);
      }
    });

    this.notify();
    return { sent, skipped, alertTriggeredBusIds };
  }

  public cancelWaitSignal(signalId: string): boolean {
    const signal = this.waitSignals.find((s) => s.id === signalId);
    if (!signal) return false;
    signal.status = 'cancelled';
    firestoreSync.syncWaitSignal(signal).catch(() => {});
    this.notify();
    return true;
  }

  public cancelWaitSignalForStop(stopId: string, routeId?: string): boolean {
    if (!this.user) return false;
    let cancelledCount = 0;
    this.waitSignals.forEach((s) => {
      if (
        s.passengerUid === this.user!.uid &&
        s.stopId === stopId &&
        (!routeId || s.routeId === routeId) &&
        s.status === 'active'
      ) {
        s.status = 'cancelled';
        firestoreSync.syncWaitSignal(s).catch(() => {});
        cancelledCount++;
      }
    });
    if (cancelledCount > 0) {
      this.notify();
      return true;
    }
    return false;
  }

  public getWaitCountForStop(busId: string, stopId: string): number {
    return this.waitSignals.filter(
      (s) => s.busId === busId && s.stopId === stopId && s.status === 'active'
    ).length;
  }

  public getWaitCountForBusOrRoute(busId: string, routeId: string, stopId: string): number {
    // Unique passengers waiting at this stop for this bus or route
    const matchingSignals = this.waitSignals.filter(
      (s) =>
        (s.busId === busId || s.routeId === routeId) &&
        s.stopId === stopId &&
        s.status === 'active'
    );
    // Deduplicate by passengerUid to give precise human headcount
    const uniqueUids = new Set(matchingSignals.map((s) => s.passengerUid));
    return uniqueUids.size;
  }

  public getWaitSignalsForBusOrRoute(busId: string, routeId: string): WaitSignal[] {
    return this.waitSignals.filter(
      (s) =>
        (s.busId === busId || s.routeId === routeId) &&
        s.status === 'active'
    );
  }

  public getWaitSignalsForTrip(tripId: string): WaitSignal[] {
    return this.waitSignals.filter((s) => s.tripId === tripId && s.status === 'active');
  }

  public isPassengerWaitingAtStop(passengerUid: string, stopId: string, routeId?: string): boolean {
    return this.waitSignals.some(
      (s) =>
        s.passengerUid === passengerUid &&
        s.stopId === stopId &&
        (!routeId || s.routeId === routeId) &&
        s.status === 'active'
    );
  }

  // --- Onboard Passengers ("I am in the Bus") ---
  public getOnboardPassengers(): OnboardPassenger[] {
    return this.onboardPassengers;
  }

  public getActiveOnboardPassenger(passengerUid?: string): OnboardPassenger | null {
    const uid = passengerUid || this.user?.uid;
    if (!uid) return null;
    return this.onboardPassengers.find((p) => p.passengerUid === uid && p.status === 'onboard') || null;
  }

  public getOnboardPassengersForBus(busId: string): OnboardPassenger[] {
    return this.onboardPassengers.filter((p) => p.busId === busId && p.status === 'onboard');
  }

  public getOnboardPassengersForTrip(tripId: string): OnboardPassenger[] {
    return this.onboardPassengers.filter((p) => p.tripId === tripId && p.status === 'onboard');
  }

  public boardBus(params: {
    busId: string;
    destinationStopId: string;
    originStopId?: string;
    notifyBeforeStops?: number;
  }): { success: boolean; error?: string; onboard?: OnboardPassenger } {
    if (!this.user) {
      return { success: false, error: 'Please sign in to board the bus.' };
    }

    const bus = this.buses.find((b) => b.id === params.busId);
    if (!bus) {
      return { success: false, error: 'Selected bus was not found.' };
    }

    const route = this.routes.find((r) => r.id === bus.assignedRouteId);
    if (!route) {
      return { success: false, error: 'Route not found for this bus.' };
    }

    const destinationStop = route.stops.find((s) => s.id === params.destinationStopId);
    if (!destinationStop) {
      return { success: false, error: 'Please select a valid destination stop along this route.' };
    }

    const originStop = params.originStopId
      ? route.stops.find((s) => s.id === params.originStopId)
      : route.stops[0];

    const activeTrip = this.trips.find((t) => t.busId === bus.id && t.status === 'active');
    const tripId = activeTrip ? activeTrip.id : `trip-virtual-${bus.id}`;

    // Mark previous active onboards for this user as completed
    this.onboardPassengers.forEach((p) => {
      if (p.passengerUid === this.user!.uid && p.status === 'onboard') {
        p.status = 'completed';
        p.alightedAt = new Date().toISOString();
        firestoreSync.syncOnboardPassenger(p).catch(() => {});
      }
    });

    // Mark any active waitSignal for this user on this bus as 'boarded'
    this.waitSignals.forEach((w) => {
      if (w.passengerUid === this.user!.uid && w.busId === bus.id && w.status === 'active') {
        w.status = 'boarded';
        firestoreSync.syncWaitSignal(w).catch(() => {});
      }
    });

    const onboardRecord: OnboardPassenger = {
      id: `onboard-${this.user.uid}-${bus.id}-${Date.now()}`,
      passengerUid: this.user.uid,
      passengerName: this.user.displayName || 'Passenger',
      passengerPhone: this.user.phone || '',
      busId: bus.id,
      busNumber: bus.busNumber,
      routeId: route.id,
      routeNumber: route.routeNumber,
      tripId,
      originStopId: originStop ? originStop.id : route.stops[0].id,
      originStopName: originStop ? originStop.name : route.stops[0].name,
      destinationStopId: destinationStop.id,
      destinationStopName: destinationStop.name,
      boardedAt: new Date().toISOString(),
      status: 'onboard',
      notifyBeforeStops: params.notifyBeforeStops ?? 1,
    };

    this.onboardPassengers.unshift(onboardRecord);
    firestoreSync.syncOnboardPassenger(onboardRecord).catch(() => {});

    this.notify();
    return { success: true, onboard: onboardRecord };
  }

  public alightBus(onboardId?: string): { success: boolean; error?: string } {
    if (!this.user) return { success: false, error: 'Sign-in required' };

    const target = onboardId
      ? this.onboardPassengers.find((p) => p.id === onboardId)
      : this.onboardPassengers.find((p) => p.passengerUid === this.user!.uid && p.status === 'onboard');

    if (!target) {
      return { success: false, error: 'No active onboard trip found.' };
    }

    target.status = 'completed';
    target.alightedAt = new Date().toISOString();
    firestoreSync.syncOnboardPassenger(target).catch(() => {});

    this.notify();
    return { success: true };
  }

  public changeOnboardDestination(onboardId: string, newDestinationStopId: string): { success: boolean; error?: string } {
    const target = this.onboardPassengers.find((p) => p.id === onboardId);
    if (!target) return { success: false, error: 'Onboard ride not found.' };

    const route = this.routes.find((r) => r.id === target.routeId);
    const newStop = route?.stops.find((s) => s.id === newDestinationStopId);
    if (!newStop) return { success: false, error: 'Destination stop not found on route.' };

    target.destinationStopId = newStop.id;
    target.destinationStopName = newStop.name;
    firestoreSync.syncOnboardPassenger(target).catch(() => {});

    this.notify();
    return { success: true };
  }

  // --- Trips & Live GPS ---
  public startTrip(busId: string): { success: boolean; error?: string; trip?: Trip } {
    if (!this.user) return { success: false, error: 'Sign-in required' };

    const bus = this.buses.find((b) => b.id === busId);
    if (!bus) return { success: false, error: 'Bus not found' };

    if (bus.approvalStatus !== 'approved') {
      return { success: false, error: 'Bus must be approved by Linebazar Admin before starting a trip' };
    }

    if (!this.isSubscriptionActive(bus.subscription)) {
      return { success: false, error: 'Bus subscription is expired or inactive. Please renew subscription.' };
    }

    // Check if trip already running
    const existingTrip = this.trips.find((t) => t.busId === busId && t.status === 'active');
    if (existingTrip) {
      return { success: false, error: 'This bus already has an active trip in progress' };
    }

    const route = this.routes.find((r) => r.id === bus.assignedRouteId);
    if (!route || route.stops.length === 0) {
      return { success: false, error: 'Route stops configuration is incomplete' };
    }

    const firstStop = route.stops[0];
    const secondStop = route.stops[1] || firstStop;

    const trip: Trip = {
      id: `trip-${Math.random().toString(36).substring(2, 9)}`,
      busId: bus.id,
      busNumber: bus.busNumber,
      routeId: route.id,
      routeNumber: route.routeNumber,
      driverUid: this.user.uid,
      driverName: this.user.displayName,
      status: 'active',
      startTime: new Date().toISOString(),
      completedStops: [],
      currentLocation: {
        busId: bus.id,
        tripId: '',
        lat: firstStop.lat,
        lng: firstStop.lng,
        heading: 90,
        speedKmh: 15,
        timestamp: new Date().toISOString(),
        accuracyMeters: 5,
        currentStopId: firstStop.id,
        nextStopId: secondStop.id,
      },
    };
    trip.currentLocation!.tripId = trip.id;

    bus.currentTripId = trip.id;
    this.trips.unshift(trip);
    this.notify();
    return { success: true, trip };
  }

  public endTrip(tripId: string): { success: boolean; error?: string } {
    const trip = this.trips.find((t) => t.id === tripId);
    if (!trip) return { success: false, error: 'Trip not found' };

    trip.status = 'completed';
    trip.endTime = new Date().toISOString();
    trip.currentLocation = undefined; // Live location cleared: passengers will no longer see the location

    const bus = this.buses.find((b) => b.id === trip.busId);
    if (bus && bus.currentTripId === tripId) {
      bus.currentTripId = undefined;
    }

    removeLiveGpsFromRTDB(trip.busId).catch(() => {});
    this.notify();
    return { success: true };
  }

  public updateBusGPS(busId: string, ping: Partial<LiveGPSPing>) {
    const trip = this.trips.find((t) => t.busId === busId && t.status === 'active');
    if (!trip) return;

    if (!trip.currentLocation) {
      trip.currentLocation = {
        busId,
        tripId: trip.id,
        lat: ping.lat || 22.5726,
        lng: ping.lng || 88.3639,
        heading: ping.heading || 0,
        speedKmh: ping.speedKmh || 0,
        timestamp: new Date().toISOString(),
        accuracyMeters: ping.accuracyMeters || 10,
      };
    } else {
      trip.currentLocation = {
        ...trip.currentLocation,
        ...ping,
        timestamp: new Date().toISOString(),
      };
    }

    this.notify();
  }

  // Live GPS simulation loop
  private startGpsSimulation() {
    if (this.simulationTimer) clearInterval(this.simulationTimer);

    this.simulationTimer = window.setInterval(() => {
      let changed = false;
      this.trips.forEach((trip) => {
        if (trip.status !== 'active' || !trip.currentLocation) return;

        const route = this.routes.find((r) => r.id === trip.routeId);
        if (!route || route.stops.length < 2) return;

        // Progress simulation along route stops
        const currentIdx = route.stops.findIndex((s) => s.id === trip.currentLocation?.nextStopId);
        const targetStop = route.stops[currentIdx >= 0 ? currentIdx : 1];

        // Step coordinates closer to target stop
        const currentLat = trip.currentLocation.lat;
        const currentLng = trip.currentLocation.lng;
        const dLat = targetStop.lat - currentLat;
        const dLng = targetStop.lng - currentLng;
        const distance = Math.sqrt(dLat * dLat + dLng * dLng);

        if (distance < 0.002) {
          // Reached stop, move to next stop
          const nextIdx = (currentIdx + 1) % route.stops.length;
          trip.currentLocation.currentStopId = targetStop.id;
          trip.currentLocation.nextStopId = route.stops[nextIdx].id;
          if (!trip.completedStops.includes(targetStop.id)) {
            trip.completedStops.push(targetStop.id);
          }
        } else {
          // Step ~0.0003 deg each cycle (~30m)
          const step = 0.0003;
          trip.currentLocation.lat = currentLat + (dLat / distance) * step;
          trip.currentLocation.lng = currentLng + (dLng / distance) * step;
          trip.currentLocation.speedKmh = Math.floor(20 + Math.random() * 18);
          trip.currentLocation.heading = Math.round((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360;
        }

        trip.currentLocation.timestamp = new Date().toISOString();
        changed = true;
      });

      if (changed) {
        this.notify();
      }
    }, 4000);
  }

  // --- Admin Operations ---
  public approveBus(busId: string, _type?: string): boolean {
    const adminUid = this.user?.uid || 'system-admin';
    const adminName = this.user?.displayName || 'System Admin';
    return this.adminApproveBus(busId, adminUid, adminName);
  }

  public adminApproveBus(busId: string, adminUid: string, adminName: string): boolean {
    const bus = this.buses.find((b) => b.id === busId);
    if (!bus) return false;

    const trialStart = new Date();
    const trialEnd = new Date(trialStart);
    trialEnd.setDate(trialEnd.getDate() + 90); // 3 months free trial from approval

    bus.approvalStatus = 'approved';
    bus.approvedAt = trialStart.toISOString();
    bus.isActive = true;
    bus.subscription = {
      id: `sub-${bus.id}`,
      subscriberId: bus.id,
      type: 'bus',
      status: 'trial',
      trialStartDate: trialStart.toISOString(),
      trialEndDate: trialEnd.toISOString(),
      paidThroughDate: trialEnd.toISOString(),
      autoRenew: true,
      monthlyAmountInr: 99,
    };

    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid,
      adminName,
      action: 'approve_bus',
      targetType: 'bus',
      targetId: bus.id,
      details: `Approved bus ${bus.busNumber} (${bus.modelNumber}) for Route ${bus.routeNumber}. 90-day free trial active.`,
      timestamp: new Date().toISOString(),
    });

    this.notify();
    return true;
  }

  public adminRejectBus(busId: string, reason: string, adminUid: string, adminName: string): boolean {
    const bus = this.buses.find((b) => b.id === busId);
    if (!bus) return false;

    bus.approvalStatus = 'rejected';
    bus.rejectionReason = reason;
    bus.isActive = false;

    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid,
      adminName,
      action: 'reject_bus',
      targetType: 'bus',
      targetId: bus.id,
      details: `Rejected registration for bus ${bus.busNumber}. Reason: ${reason}`,
      timestamp: new Date().toISOString(),
    });

    this.notify();
    return true;
  }

  public adminToggleBusActive(busId: string, active: boolean, adminUid: string, adminName: string): boolean {
    const bus = this.buses.find((b) => b.id === busId);
    if (!bus) return false;

    bus.isActive = active;
    bus.approvalStatus = active ? 'approved' : 'deactivated';

    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid,
      adminName,
      action: 'deactivate_bus',
      targetType: 'bus',
      targetId: bus.id,
      details: `${active ? 'Activated' : 'Deactivated'} fleet operation for bus ${bus.busNumber}`,
      timestamp: new Date().toISOString(),
    });

    this.notify();
    return true;
  }

  public adminAddBus(
    busData: {
      busNumber: string;
      modelNumber: string;
      routeNumber: string;
      assignedRouteId?: string;
      ownerName?: string;
      ownerPhone?: string;
      driverName?: string;
      driverPhone?: string;
      conductorName?: string;
      conductorPhone?: string;
      frontPhotoUrl?: string;
    },
    adminUid: string,
    adminName: string
  ): BusRegistration {
    const normalized = LinebazarStore.normalizeBusNumber(busData.busNumber);
    const busId = `bus-${normalized.toLowerCase()}-${Math.random().toString(36).substring(2, 6)}`;
    
    // Find matching route or use default
    const matchingRoute = this.routes.find(
      (r) => r.id === busData.assignedRouteId || r.routeNumber.toUpperCase() === busData.routeNumber.toUpperCase()
    );
    const routeId = matchingRoute ? matchingRoute.id : (busData.assignedRouteId || 'route-s12');
    const routeNumber = matchingRoute ? matchingRoute.routeNumber : busData.routeNumber;

    const trialStart = new Date();
    const trialEnd = new Date(trialStart);
    trialEnd.setDate(trialEnd.getDate() + 90);

    const crew: BusRegistration['crew'] = [];
    if (busData.driverName && busData.driverPhone) {
      crew.push({
        uid: `driver-${Math.random().toString(36).substring(2, 8)}`,
        displayName: busData.driverName.trim(),
        phone: busData.driverPhone.trim(),
        role: 'driver',
        joinedAt: trialStart.toISOString(),
        isVerified: true,
      });
    }
    if (busData.conductorName && busData.conductorPhone) {
      crew.push({
        uid: `conductor-${Math.random().toString(36).substring(2, 8)}`,
        displayName: busData.conductorName.trim(),
        phone: busData.conductorPhone.trim(),
        role: 'conductor',
        joinedAt: trialStart.toISOString(),
        isVerified: true,
      });
    }

    const newBus: BusRegistration = {
      id: busId,
      busNumber: busData.busNumber.toUpperCase().trim(),
      normalizedBusNumber: normalized,
      modelNumber: busData.modelNumber.trim() || 'Kolkata Stage Carriage Bus',
      frontPhotoUrl: busData.frontPhotoUrl ? busData.frontPhotoUrl.trim() : '',
      assignedRouteId: routeId,
      routeNumber: routeNumber,
      ownerUid: adminUid,
      ownerName: busData.ownerName?.trim() || adminName,
      ownerPhone: busData.ownerPhone?.trim() || DESIGNATED_ADMIN_PHONE,
      approvalStatus: 'approved',
      approvedAt: trialStart.toISOString(),
      appliedAt: trialStart.toISOString(),
      crew,
      subscription: {
        id: `sub-${busId}`,
        subscriberId: busId,
        type: 'bus',
        status: 'trial',
        trialStartDate: trialStart.toISOString(),
        trialEndDate: trialEnd.toISOString(),
        paidThroughDate: trialEnd.toISOString(),
        autoRenew: true,
        monthlyAmountInr: 99,
      },
      isActive: true,
    };

    this.buses.unshift(newBus);

    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid,
      adminName,
      action: 'approve_bus',
      targetType: 'bus',
      targetId: busId,
      details: `Admin added bus ${newBus.busNumber} (${newBus.modelNumber}) for Route ${newBus.routeNumber} with active status.`,
      timestamp: new Date().toISOString(),
    });

    // Sync to Cloud Firestore
    firestoreSync.syncBusRegistration(newBus).catch(() => {});

    this.notify();
    return newBus;
  }

  public adminDeleteBus(busId: string, adminUid: string, adminName: string): boolean {
    const idx = this.buses.findIndex((b) => b.id === busId);
    if (idx < 0) return false;

    const [deleted] = this.buses.splice(idx, 1);

    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid,
      adminName,
      action: 'delete_bus',
      targetType: 'bus',
      targetId: busId,
      details: `Permanently removed bus record ${deleted.busNumber}`,
      timestamp: new Date().toISOString(),
    });

    // Delete from Cloud Firestore
    firestoreSync.deleteBusRegistration(busId).catch(() => {});

    this.notify();
    return true;
  }

  public async adminAddUser(
    userData: {
      displayName: string;
      phone: string;
      email?: string;
      role: UserRole;
      status?: 'active' | 'trial';
    },
    adminUid: string,
    adminName: string
  ): Promise<UserProfile> {
    const uid = `usr-${userData.role}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date();
    const expiry = new Date(now);
    expiry.setMonth(expiry.getMonth() + (userData.role === 'passenger' ? 3 : 1));

    const newUser: UserProfile = {
      uid,
      displayName: userData.displayName.trim(),
      phone: userData.phone.trim(),
      email: userData.email?.trim() || '',
      roles: [userData.role],
      currentRole: userData.role,
      createdAt: now.toISOString(),
      subscription: {
        id: `sub-${uid}`,
        subscriberId: uid,
        type: userData.role === 'passenger' ? 'passenger' : 'bus',
        status: userData.status || 'trial',
        trialStartDate: now.toISOString(),
        trialEndDate: expiry.toISOString(),
        paidThroughDate: expiry.toISOString(),
        autoRenew: true,
        monthlyAmountInr: userData.role === 'passenger' ? 19 : 99,
      },
    };

    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid,
      adminName,
      action: 'create_route', // general administrative creation
      targetType: 'system',
      targetId: uid,
      details: `Admin added new ${userData.role}: ${newUser.displayName} (${newUser.phone})`,
      timestamp: now.toISOString(),
    });

    // Sync to Cloud Firestore
    await firestoreSync.syncUserProfile(newUser);

    this.notify();
    return newUser;
  }

  public async adminDeleteUser(targetUid: string, adminUid: string, adminName: string): Promise<boolean> {
    // Designated Super Admin cannot be deleted
    if (targetUid === DESIGNATED_ADMIN_UID) {
      throw new Error('Designated SuperAdmin account cannot be deleted.');
    }

    // Remove user from bus crew if member
    let crewRemoved = false;
    this.buses.forEach((b) => {
      const initialCrewCount = b.crew.length;
      b.crew = b.crew.filter((c) => c.uid !== targetUid);
      if (b.crew.length !== initialCrewCount) {
        crewRemoved = true;
      }
    });

    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid,
      adminName,
      action: 'delete_bus',
      targetType: 'system',
      targetId: targetUid,
      details: `Admin deleted user profile UID ${targetUid}${crewRemoved ? ' and unlinked from bus crews' : ''}`,
      timestamp: new Date().toISOString(),
    });

    // Delete from Cloud Firestore
    await firestoreSync.deleteUserProfile(targetUid);

    this.notify();
    return true;
  }

  public adminCreateRoute(route: BusRoute, adminUid: string, adminName: string): BusRoute {
    this.routes.unshift(route);

    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid,
      adminName,
      action: 'create_route',
      targetType: 'route',
      targetId: route.id,
      details: `Created new transit route ${route.routeNumber} (${route.name}) with ${route.stops.length} stops.`,
      timestamp: new Date().toISOString(),
    });

    // Sync to Cloud Firestore
    firestoreSync.syncRoute(route);

    this.notify();
    return route;
  }

  public adminUpdateRoute(route: BusRoute, adminUid: string, adminName: string): boolean {
    const idx = this.routes.findIndex((r) => r.id === route.id);
    if (idx < 0) return false;

    this.routes[idx] = route;

    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid,
      adminName,
      action: 'update_route',
      targetType: 'route',
      targetId: route.id,
      details: `Updated transit route ${route.routeNumber} stops and schedules.`,
      timestamp: new Date().toISOString(),
    });

    // Sync to Cloud Firestore
    firestoreSync.syncRoute(route);

    this.notify();
    return true;
  }

  public adminDeleteRoute(routeId: string, adminUid: string, adminName: string): boolean {
    const idx = this.routes.findIndex((r) => r.id === routeId);
    if (idx < 0) return false;

    const [deleted] = this.routes.splice(idx, 1);

    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid,
      adminName,
      action: 'delete_route',
      targetType: 'route',
      targetId: routeId,
      details: `Deleted route ${deleted.routeNumber} (${deleted.name})`,
      timestamp: new Date().toISOString(),
    });

    // Remove from Cloud Firestore
    firestoreSync.deleteRoute(routeId);

    this.notify();
    return true;
  }

  public adminImportBatchRoutes(newRoutes: BusRoute[], adminUid: string, adminName: string): number {
    let imported = 0;
    newRoutes.forEach((route) => {
      const existingIdx = this.routes.findIndex(
        (r) => r.routeNumber.toUpperCase() === route.routeNumber.toUpperCase()
      );
      if (existingIdx >= 0) {
        this.routes[existingIdx] = route;
      } else {
        this.routes.push(route);
      }
      imported++;
    });

    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid,
      adminName,
      action: 'import_dataset',
      targetType: 'system',
      targetId: 'routes_batch',
      details: `Imported / synced ${imported} Kolkata bus routes from verified dataset.`,
      timestamp: new Date().toISOString(),
    });

    this.notify();
    return imported;
  }

  // --- Getters ---
  public getBuses(): BusRegistration[] {
    return this.buses;
  }

  public getRoutes(): BusRoute[] {
    return this.routes;
  }

  public getStands(): BusStand[] {
    return this.stands;
  }

  public getTrips(): Trip[] {
    return this.trips;
  }

  public getWaitSignals(): WaitSignal[] {
    return this.waitSignals;
  }

  public getAuditLogs(): AdminAuditLog[] {
    return this.auditLogs;
  }

  public async seedToFirestore(): Promise<{ routes: number; stands: number; buses: number }> {
    const result = await firestoreSync.seedKolkataDataset();
    this.auditLogs.unshift({
      id: `audit-${Math.random().toString(36).substring(2, 9)}`,
      adminUid: this.user?.uid || 'admin-root',
      adminName: this.user?.displayName || 'Admin',
      action: 'import_dataset',
      targetType: 'system',
      targetId: 'firestore_cloud_db',
      details: `Persisted ${result.routes} routes, ${result.stands} terminals, and ${result.buses} buses directly into Cloud Firestore.`,
      timestamp: new Date().toISOString(),
    });
    this.notify();
    return result;
  }

  public getPayments(): PaymentRecord[] {
    return this.payments;
  }
}

export const store = LinebazarStore.getInstance();
