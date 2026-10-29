export const DESIGNATED_ADMIN_UID = '37Qpvpp1kpfcvkYiVpLRU1EGwE52';
export const DESIGNATED_ADMIN_PHONE = '+919804154302';
export const DESIGNATED_ADMIN_RAW_PHONE = '9804154302';
export const DESIGNATED_ADMIN_EMAIL = 'samrat.edu86@gmail.com';

export type UserRole = 'passenger' | 'driver' | 'conductor' | 'admin';

export interface UserProfile {
  uid: string;
  phone: string;
  email?: string;
  photoURL?: string;
  displayName: string;
  roles: UserRole[];
  currentRole: UserRole;
  createdAt: string;
  subscription: UserSubscription;
}

export type SubscriptionStatus = 'trial' | 'active' | 'cancelled' | 'expired';

export interface UserSubscription {
  id: string;
  subscriberId: string;
  type: 'passenger' | 'bus';
  status: SubscriptionStatus;
  trialStartDate: string;
  trialEndDate: string;
  paidThroughDate: string;
  autoRenew: boolean;
  monthlyAmountInr: number;
  cancellationDate?: string;
  lastPaymentId?: string;
}

export interface BusStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  sequence: number;
  distanceFromStartKm: number;
  landmark?: string;
  isTerminal?: boolean;
}

export interface BusRoute {
  id: string;
  routeNumber: string; // e.g. "S-12", "AC-12", "230"
  name: string; // e.g. "Howrah Station - New Town Eco Space"
  origin: string;
  destination: string;
  category: 'government' | 'private' | 'ac_express';
  color: string;
  stops: BusStop[];
  firstBus: string;
  lastBus: string;
  frequencyMins: number;
  fareStartingInr: number;
  isActive: boolean;
}

export interface BusStand {
  id: string;
  name: string;
  location: string;
  lat: number;
  lng: number;
  capacityBuses: number;
  amenities: string[];
  routesOriginating: string[];
}

export type BusApprovalStatus = 'pending' | 'approved' | 'rejected' | 'deactivated';

export interface BusCrewMember {
  uid: string;
  phone: string;
  displayName: string;
  role: 'driver' | 'conductor';
  joinedAt: string;
  isVerified: boolean;
}

export interface BusRegistration {
  id: string;
  busNumber: string; // Display format, e.g. "WB 04 G 4589"
  normalizedBusNumber: string; // "WB04G4589" for duplicate detection
  modelNumber: string;
  frontPhotoUrl: string;
  assignedRouteId: string;
  routeNumber: string;
  ownerUid: string;
  ownerName: string;
  ownerPhone: string;
  approvalStatus: BusApprovalStatus;
  rejectionReason?: string;
  appliedAt: string;
  approvedAt?: string;
  crew: BusCrewMember[];
  subscription: UserSubscription;
  currentTripId?: string;
  isActive: boolean;
}

export type TripStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';

export interface LiveGPSPing {
  busId: string;
  tripId: string;
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
  timestamp: string;
  accuracyMeters: number;
  currentStopId?: string;
  nextStopId?: string;
}

export interface Trip {
  id: string;
  busId: string;
  busNumber: string;
  routeId: string;
  routeNumber: string;
  driverUid: string;
  driverName: string;
  conductorUid?: string;
  conductorName?: string;
  status: TripStatus;
  startTime: string;
  endTime?: string;
  currentLocation?: LiveGPSPing;
  completedStops: string[];
}

export interface OnboardPassenger {
  id: string; // Deterministic or unique: `${passengerUid}_${busId}_${tripId}`
  passengerUid: string;
  passengerName: string;
  passengerPhone: string;
  busId: string;
  busNumber: string;
  routeId: string;
  routeNumber: string;
  tripId: string;
  originStopId: string;
  originStopName: string;
  destinationStopId: string;
  destinationStopName: string;
  boardedAt: string;
  status: 'onboard' | 'completed' | 'cancelled';
  alightedAt?: string;
  notifyBeforeStops?: number;
}

export interface WaitSignal {
  id: string; // Deterministic: `${passengerUid}_${busId}_${tripId}`
  passengerUid: string;
  passengerName?: string;
  passengerPhone: string;
  busId: string;
  busNumber: string;
  tripId: string;
  routeId: string;
  stopId: string;
  stopName: string;
  timestamp: string;
  status: 'active' | 'boarded' | 'expired' | 'cancelled';
}

export interface BusStopWaitAggregate {
  id: string; // `${busId}_${stopId}`
  tripId: string;
  busId: string;
  stopId: string;
  stopName: string;
  count: number;
  passengerUids: string[];
  alertSentToCrew: boolean;
  lastUpdated: string;
}

export interface AdminAuditLog {
  id: string;
  adminUid: string;
  adminName: string;
  action: 'approve_bus' | 'reject_bus' | 'deactivate_bus' | 'delete_bus' | 'create_route' | 'update_route' | 'delete_route' | 'assign_role' | 'import_dataset' | 'manage_stand';
  targetType: 'bus' | 'route' | 'crew' | 'stand' | 'passenger' | 'system';
  targetId: string;
  details: string;
  timestamp: string;
  ipAddress?: string;
}

export interface PaymentRecord {
  id: string;
  subscriberId: string;
  userPhone: string;
  type: 'passenger' | 'bus';
  amountInr: number;
  currency: 'INR';
  status: 'captured' | 'failed' | 'refunded';
  provider: 'razorpay' | 'stripe';
  providerPaymentId: string;
  providerSignature?: string;
  createdAt: string;
  paidPeriodStart: string;
  paidPeriodEnd: string;
}

export interface UserFileRecord {
  id: string;
  userId: string;
  userEmail?: string;
  userPhone?: string;
  fileName: string;
  downloadUrl: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  fileCategory: 'avatar' | 'vehicle_photo' | 'document' | 'kyc';
  uploadedAt: string;
}

