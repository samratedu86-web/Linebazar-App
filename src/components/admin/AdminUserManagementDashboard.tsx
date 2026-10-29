import React, { useState, useEffect } from 'react';
import { UserProfile, UserRole, UserFileRecord, BusRegistration, BusRoute, BusStop, Trip, WaitSignal, AdminAuditLog } from '../../types';
import { db, auth } from '../../lib/firebase';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { store } from '../../services/store';
import { firestoreSync } from '../../services/firestoreSync';
import { KolkataTransitMap } from '../map/KolkataTransitMap';
import { CsvRouteImporterModal } from './CsvRouteImporterModal';
import { KNOWN_KOLKATA_COORDS } from '../../data/kolkataCoordinates';

interface AdminUserManagementDashboardProps {
  currentUser: UserProfile | null;
  buses: BusRegistration[];
  routes: BusRoute[];
  trips: Trip[];
  waitSignals: WaitSignal[];
  auditLogs: AdminAuditLog[];
}

export const DESIGNATED_ADMIN_UID = '37Qpvpp1kpfcvkYiVpLRU1EGwE52';

export const AdminUserManagementDashboard: React.FC<AdminUserManagementDashboardProps> = ({
  currentUser,
  buses,
  routes,
  trips,
  waitSignals,
  auditLogs,
}) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userFiles, setUserFiles] = useState<UserFileRecord[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<'all' | UserRole>('all');
  const [activeAdminSubTab, setActiveAdminSubTab] = useState<'users' | 'fleet' | 'routes' | 'map'>('users');
  const [jsonViewOpen, setJsonViewOpen] = useState(false);

  // Management modals & action state
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [isAddBusModalOpen, setIsAddBusModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [busToDelete, setBusToDelete] = useState<BusRegistration | null>(null);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Route Management State
  const [isAddRouteModalOpen, setIsAddRouteModalOpen] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [newRouteNumber, setNewRouteNumber] = useState('');
  const [newRouteName, setNewRouteName] = useState('');
  const [newRouteOrigin, setNewRouteOrigin] = useState('');
  const [newRouteDestination, setNewRouteDestination] = useState('');
  const [intermediateStops, setIntermediateStops] = useState<string[]>([]);
  const [newStopInput, setNewStopInput] = useState('');
  const [existingStopCoords, setExistingStopCoords] = useState<Record<string, { lat: number; lng: number }>>({});
  const [newRouteCategory, setNewRouteCategory] = useState<'government' | 'private' | 'ac_express'>('government');
  const [newRouteFrequency, setNewRouteFrequency] = useState('15');
  const [newRouteFare, setNewRouteFare] = useState('10');
  const [newRouteFirstBus, setNewRouteFirstBus] = useState('05:30 AM');
  const [newRouteLastBus, setNewRouteLastBus] = useState('10:00 PM');
  const [newRouteColor, setNewRouteColor] = useState('#0284c7');
  const [isSubmittingRoute, setIsSubmittingRoute] = useState(false);
  const [routeToDelete, setRouteToDelete] = useState<BusRoute | null>(null);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [routeSearchTerm, setRouteSearchTerm] = useState('');
  const [routeCategoryFilter, setRouteCategoryFilter] = useState<'all' | 'government' | 'private' | 'ac_express'>('all');
  const [expandedRouteIds, setExpandedRouteIds] = useState<Set<string>>(new Set());

  // New user form state
  const [newUserName, setNewUserName] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('+91');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('passenger');
  const [newUserStatus, setNewUserStatus] = useState<'trial' | 'active'>('trial');
  const [newUserLicense, setNewUserLicense] = useState('');
  const [isSubmittingUser, setIsSubmittingUser] = useState(false);

  // New bus form state
  const [newBusNumber, setNewBusNumber] = useState('');
  const [newBusModel, setNewBusModel] = useState('Tata Marcopolo BS-VI CNG');
  const [newBusRouteId, setNewBusRouteId] = useState('');
  const [newBusOwnerName, setNewBusOwnerName] = useState('');
  const [newBusOwnerPhone, setNewBusOwnerPhone] = useState('+91');
  const [newBusDriverName, setNewBusDriverName] = useState('');
  const [newBusDriverPhone, setNewBusDriverPhone] = useState('+91');
  const [newBusConductorName, setNewBusConductorName] = useState('');
  const [newBusConductorPhone, setNewBusConductorPhone] = useState('+91');
  const [newBusPhotoUrl, setNewBusPhotoUrl] = useState('');
  const [isSubmittingBus, setIsSubmittingBus] = useState(false);

  // Initial demo users with realistic creation dates & emails to ensure rich data
  const SEED_USERS: UserProfile[] = [
    {
      uid: DESIGNATED_ADMIN_UID,
      displayName: 'Linebazar SuperAdmin',
      email: 'samrat.edu86@gmail.com',
      phone: '+919804154302',
      roles: ['admin', 'passenger'],
      currentRole: 'admin',
      createdAt: '2026-07-15T09:00:00.000Z',
      subscription: {
        id: 'sub-admin-root',
        subscriberId: DESIGNATED_ADMIN_UID,
        type: 'passenger',
        status: 'active',
        trialStartDate: '2026-07-15T09:00:00.000Z',
        trialEndDate: '2027-07-15T09:00:00.000Z',
        paidThroughDate: '2027-07-15T09:00:00.000Z',
        autoRenew: true,
        monthlyAmountInr: 0,
      },
    },
    {
      uid: 'crew-user-1',
      displayName: 'Subhasish Banerjee',
      email: 'subhasish.banerjee@kolkatatransit.org',
      phone: '+919830114589',
      roles: ['driver'],
      currentRole: 'driver',
      createdAt: '2026-08-10T11:20:00.000Z',
      subscription: {
        id: 'sub-driver-1',
        subscriberId: 'crew-user-1',
        type: 'bus',
        status: 'active',
        trialStartDate: '2026-08-10T11:20:00.000Z',
        trialEndDate: '2026-11-10T11:20:00.000Z',
        paidThroughDate: '2026-12-31T23:59:59.000Z',
        autoRenew: true,
        monthlyAmountInr: 99,
      },
    },
    {
      uid: 'crew-user-2',
      displayName: 'Tapan Ghosh',
      email: 'tapan.conductor@kolkatatransit.org',
      phone: '+919830992134',
      roles: ['conductor'],
      currentRole: 'conductor',
      createdAt: '2026-08-18T14:45:00.000Z',
      subscription: {
        id: 'sub-conductor-1',
        subscriberId: 'crew-user-2',
        type: 'bus',
        status: 'active',
        trialStartDate: '2026-08-18T14:45:00.000Z',
        trialEndDate: '2026-11-18T14:45:00.000Z',
        paidThroughDate: '2026-12-31T23:59:59.000Z',
        autoRenew: true,
        monthlyAmountInr: 99,
      },
    },
    {
      uid: 'pax-sourav-ganguly',
      displayName: 'Sourav Ganguly',
      email: 'sourav.commuter@bengaltransit.in',
      phone: '+919830198765',
      roles: ['passenger'],
      currentRole: 'passenger',
      createdAt: '2026-09-02T10:15:00.000Z',
      subscription: {
        id: 'sub-pax-1',
        subscriberId: 'pax-sourav-ganguly',
        type: 'passenger',
        status: 'trial',
        trialStartDate: '2026-09-02T10:15:00.000Z',
        trialEndDate: '2026-12-02T10:15:00.000Z',
        paidThroughDate: '2026-12-02T10:15:00.000Z',
        autoRenew: true,
        monthlyAmountInr: 19,
      },
    },
    {
      uid: 'pax-anirban-mukherjee',
      displayName: 'Anirban Mukherjee',
      email: 'anirban.kolkata@gmail.com',
      phone: '+919830112233',
      roles: ['passenger'],
      currentRole: 'passenger',
      createdAt: '2026-09-24T16:05:00.000Z',
      subscription: {
        id: 'sub-pax-2',
        subscriberId: 'pax-anirban-mukherjee',
        type: 'passenger',
        status: 'trial',
        trialStartDate: '2026-09-24T16:05:00.000Z',
        trialEndDate: '2026-12-24T16:05:00.000Z',
        paidThroughDate: '2026-12-24T16:05:00.000Z',
        autoRenew: true,
        monthlyAmountInr: 19,
      },
    },
  ];

  // Seed sample files so file counts and documents are immediately visible
  const SEED_FILES: UserFileRecord[] = [
    {
      id: 'file-subhasish-permit',
      userId: 'crew-user-1',
      userEmail: 'subhasish.banerjee@kolkatatransit.org',
      userPhone: '+919830114589',
      fileName: 'WB_Commercial_Transport_Permit_S12.pdf',
      downloadUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=800',
      storagePath: 'uploads/crew-user-1/WB_Commercial_Transport_Permit_S12.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1245000,
      fileCategory: 'document',
      uploadedAt: '2026-08-11T12:00:00.000Z',
    },
    {
      id: 'file-subhasish-busphoto',
      userId: 'crew-user-1',
      userEmail: 'subhasish.banerjee@kolkatatransit.org',
      userPhone: '+919830114589',
      fileName: 'Bus_WB04G4589_FrontView.jpg',
      downloadUrl: 'https://images.unsplash.com/photo-1570125909232-eb263c188f7e?w=800',
      storagePath: 'bus_photos/bus-s12-01/front_photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2450000,
      fileCategory: 'vehicle_photo',
      uploadedAt: '2026-08-12T15:30:00.000Z',
    },
    {
      id: 'file-subhasish-license',
      userId: 'crew-user-1',
      userEmail: 'subhasish.banerjee@kolkatatransit.org',
      userPhone: '+919830114589',
      fileName: 'Heavy_Vehicle_Driving_License_WB.jpg',
      downloadUrl: 'https://images.unsplash.com/photo-1626285861696-9f0bf5a49c6d?w=800',
      storagePath: 'uploads/crew-user-1/Heavy_Vehicle_Driving_License_WB.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 980000,
      fileCategory: 'kyc',
      uploadedAt: '2026-08-13T09:15:00.000Z',
    },
    {
      id: 'file-tapan-badge',
      userId: 'crew-user-2',
      userEmail: 'tapan.conductor@kolkatatransit.org',
      userPhone: '+919830992134',
      fileName: 'Government_Conductor_Badge_Certificate.pdf',
      downloadUrl: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=800',
      storagePath: 'uploads/crew-user-2/Government_Conductor_Badge_Certificate.pdf',
      contentType: 'application/pdf',
      sizeBytes: 850000,
      fileCategory: 'document',
      uploadedAt: '2026-08-19T10:00:00.000Z',
    },
    {
      id: 'file-sourav-avatar',
      userId: 'pax-sourav-ganguly',
      userEmail: 'sourav.commuter@bengaltransit.in',
      userPhone: '+919830198765',
      fileName: 'sourav_ganguly_avatar.jpg',
      downloadUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',
      storagePath: 'user_profiles/pax-sourav-ganguly/avatar.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 420000,
      fileCategory: 'avatar',
      uploadedAt: '2026-09-02T10:20:00.000Z',
    },
    {
      id: 'file-sourav-concession',
      userId: 'pax-sourav-ganguly',
      userEmail: 'sourav.commuter@bengaltransit.in',
      userPhone: '+919830198765',
      fileName: 'Metro_Kolkata_Concession_ID.pdf',
      downloadUrl: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800',
      storagePath: 'uploads/pax-sourav-ganguly/Metro_Kolkata_Concession_ID.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1120000,
      fileCategory: 'document',
      uploadedAt: '2026-09-05T14:10:00.000Z',
    },
    {
      id: 'file-admin-seal',
      userId: DESIGNATED_ADMIN_UID,
      userEmail: 'samrat.edu86@gmail.com',
      userPhone: '+919804154302',
      fileName: 'linebazar_kolkata_authority_seal.png',
      downloadUrl: 'https://images.unsplash.com/photo-1562774053-701939374585?w=800',
      storagePath: 'uploads/37Qpvpp1kpfcvkYiVpLRU1EGwE52/authority_seal.png',
      contentType: 'image/png',
      sizeBytes: 650000,
      fileCategory: 'document',
      uploadedAt: '2026-07-16T12:00:00.000Z',
    },
  ];

  // Fetch all users and file records from Firestore safely
  const fetchFirestoreData = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch user profiles from Firestore (only attempt if authenticated admin is present)
      const isAuthAdmin = Boolean(
        auth.currentUser && (
          auth.currentUser.uid === DESIGNATED_ADMIN_UID ||
          auth.currentUser.email === 'samrat.edu86@gmail.com'
        )
      );

      const fetchedProfiles: UserProfile[] = [];

      if (isAuthAdmin) {
        try {
          const profilesSnapshot = await getDocs(collection(db, 'profiles'));
          if (profilesSnapshot && !profilesSnapshot.empty) {
            profilesSnapshot.forEach((docSnap) => {
              fetchedProfiles.push(docSnap.data() as UserProfile);
            });
          }
        } catch (err) {
          console.warn('Could not list profiles from Firestore (using local/seed data):', err);
        }
      }

      // Merge with SEED_USERS for rich inspection
      const userMap = new Map<string, UserProfile>();
      SEED_USERS.forEach((u) => userMap.set(u.uid, u));
      fetchedProfiles.forEach((u) => userMap.set(u.uid, u));

      // Also ensure current logged in user is in list
      if (currentUser) {
        userMap.set(currentUser.uid, currentUser);
      }

      const mergedUsers = Array.from(userMap.values());
      setUsers(mergedUsers);

      // 2. Fetch user uploaded files from Firestore
      const fetchedFiles: UserFileRecord[] = [];
      if (isAuthAdmin) {
        try {
          const filesSnapshot = await getDocs(collection(db, 'userFiles'));
          if (filesSnapshot && !filesSnapshot.empty) {
            filesSnapshot.forEach((docSnap) => {
              fetchedFiles.push(docSnap.data() as UserFileRecord);
            });
          }
        } catch (err) {
          console.warn('Could not list userFiles from Firestore (using local/seed data):', err);
        }
      }

      // Merge files with seed files
      const fileMap = new Map<string, UserFileRecord>();
      SEED_FILES.forEach((f) => fileMap.set(f.id, f));
      fetchedFiles.forEach((f) => fileMap.set(f.id, f));
      setUserFiles(Array.from(fileMap.values()));

      setIsLoading(false);
    } catch (e) {
      console.warn('Error loading admin Firestore data (using offline cache):', e);
      setUsers(SEED_USERS);
      setUserFiles(SEED_FILES);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFirestoreData();
  }, []);

  // Filtered Users
  const filteredUsers = users.filter((u) => {
    const matchesRole = selectedRoleFilter === 'all' || u.currentRole === selectedRoleFilter || u.roles.includes(selectedRoleFilter);
    const query = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !query ||
      u.displayName.toLowerCase().includes(query) ||
      (u.email && u.email.toLowerCase().includes(query)) ||
      u.phone.includes(query) ||
      u.uid.toLowerCase().includes(query);

    return matchesRole && matchesSearch;
  });

  // Calculate file counts per user
  const getFileCountForUser = (userId: string): number => {
    return userFiles.filter((f) => f.userId === userId).length;
  };

  // Get uploaded files for the selected user
  const selectedUserFiles = selectedUser ? userFiles.filter((f) => f.userId === selectedUser.uid) : [];

  // Get wait signals inserted by selected user
  const selectedUserWaitSignals = selectedUser
    ? waitSignals.filter((s) => s.passengerUid === selectedUser.uid)
    : [];

  // Get bus registrations owned or crewed by selected user
  const selectedUserBuses = selectedUser
    ? buses.filter((b) => b.ownerUid === selectedUser.uid || b.crew.some((c) => c.uid === selectedUser.uid))
    : [];

  const formatDate = (isoString?: string) => {
    if (!isoString) return 'N/A';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 KB';
    if (bytes >= 1024 * 1024) {
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }
    return Math.round(bytes / 1024) + ' KB';
  };

  const adminName = currentUser?.displayName || 'Linebazar SuperAdmin';
  const adminUid = currentUser?.uid || DESIGNATED_ADMIN_UID;

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserPhone.trim() || newUserPhone.trim() === '+91') {
      setActionNotice({ type: 'error', text: 'Name and a valid Phone number are required.' });
      return;
    }
    setIsSubmittingUser(true);
    try {
      const created = await store.adminAddUser(
        {
          displayName: newUserName.trim(),
          phone: newUserPhone.trim(),
          email: newUserEmail.trim() || undefined,
          role: newUserRole,
          status: newUserStatus,
        },
        adminUid,
        adminName
      );
      setUsers((prev) => [created, ...prev]);
      setIsAddUserModalOpen(false);
      setNewUserName('');
      setNewUserPhone('+91');
      setNewUserEmail('');
      setNewUserRole('passenger');
      setNewUserStatus('trial');
      setNewUserLicense('');
      setActionNotice({
        type: 'success',
        text: `✓ User "${created.displayName}" (${created.currentRole}) added successfully to Firestore!`,
      });
      setTimeout(() => setActionNotice(null), 5000);
    } catch (err: any) {
      setActionNotice({ type: 'error', text: err.message || 'Failed to add user.' });
    } finally {
      setIsSubmittingUser(false);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete) return;
    if (userToDelete.uid === DESIGNATED_ADMIN_UID) {
      setActionNotice({ type: 'error', text: 'Designated SuperAdmin account cannot be deleted.' });
      setUserToDelete(null);
      return;
    }
    try {
      await store.adminDeleteUser(userToDelete.uid, adminUid, adminName);
      setUsers((prev) => prev.filter((u) => u.uid !== userToDelete.uid));
      if (selectedUser?.uid === userToDelete.uid) {
        setSelectedUser(null);
      }
      setActionNotice({
        type: 'success',
        text: `✓ User "${userToDelete.displayName}" has been permanently deleted from Firestore.`,
      });
      setTimeout(() => setActionNotice(null), 5000);
    } catch (err: any) {
      setActionNotice({ type: 'error', text: err.message || 'Failed to delete user.' });
    } finally {
      setUserToDelete(null);
    }
  };

  const handleCreateBus = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBusNumber.trim()) {
      setActionNotice({ type: 'error', text: 'Bus Registration Number is required.' });
      return;
    }
    setIsSubmittingBus(true);
    try {
      const targetRoute = routes.find((r) => r.id === newBusRouteId) || routes[0];
      const newBus = store.adminAddBus(
        {
          busNumber: newBusNumber.trim(),
          modelNumber: newBusModel.trim() || 'Tata Marcopolo BS-VI CNG',
          routeNumber: targetRoute ? targetRoute.routeNumber : 'S-12',
          assignedRouteId: targetRoute ? targetRoute.id : 'route-s12',
          ownerName: newBusOwnerName.trim() || adminName,
          ownerPhone: newBusOwnerPhone.trim() || '+919804154302',
          driverName: newBusDriverName.trim() || undefined,
          driverPhone: newBusDriverPhone.trim() || undefined,
          conductorName: newBusConductorName.trim() || undefined,
          conductorPhone: newBusConductorPhone.trim() || undefined,
          frontPhotoUrl: newBusPhotoUrl.trim() || undefined,
        },
        adminUid,
        adminName
      );
      setIsAddBusModalOpen(false);
      setNewBusNumber('');
      setNewBusModel('Tata Marcopolo BS-VI CNG');
      setNewBusRouteId('');
      setNewBusOwnerName('');
      setNewBusOwnerPhone('+91');
      setNewBusDriverName('');
      setNewBusDriverPhone('+91');
      setNewBusConductorName('');
      setNewBusConductorPhone('+91');
      setNewBusPhotoUrl('');
      setActionNotice({
        type: 'success',
        text: `✓ Bus ${newBus.busNumber} (Route ${newBus.routeNumber}) added to fleet with Active status!`,
      });
      setTimeout(() => setActionNotice(null), 5000);
    } catch (err: any) {
      setActionNotice({ type: 'error', text: err.message || 'Failed to add bus.' });
    } finally {
      setIsSubmittingBus(false);
    }
  };

  const handleConfirmDeleteBus = () => {
    if (!busToDelete) return;
    try {
      store.adminDeleteBus(busToDelete.id, adminUid, adminName);
      setActionNotice({
        type: 'success',
        text: `✓ Bus ${busToDelete.busNumber} deleted permanently from fleet and Firestore.`,
      });
      setTimeout(() => setActionNotice(null), 5000);
    } catch (err: any) {
      setActionNotice({ type: 'error', text: err.message || 'Failed to delete bus.' });
    } finally {
      setBusToDelete(null);
    }
  };

  const handleToggleBusActive = (busId: string, currentActive: boolean) => {
    store.adminToggleBusActive(busId, !currentActive, adminUid, adminName);
  };

  const handleApproveBus = (busId: string) => {
    store.adminApproveBus(busId, adminUid, adminName);
  };

  // --- Route Handlers ---
  const handleOpenCreateRoute = () => {
    setEditingRouteId(null);
    setNewRouteNumber('');
    setNewRouteName('');
    setNewRouteOrigin('');
    setNewRouteDestination('');
    setNewRouteCategory('government');
    setNewRouteFrequency('15');
    setNewRouteFare('10');
    setNewRouteFirstBus('05:30 AM');
    setNewRouteLastBus('10:00 PM');
    setNewRouteColor('#0284c7');
    setIntermediateStops([]);
    setNewStopInput('');
    setExistingStopCoords({});
    setIsAddRouteModalOpen(true);
  };

  const handleOpenEditRoute = (route: BusRoute) => {
    setEditingRouteId(route.id);
    setNewRouteNumber(route.routeNumber);
    setNewRouteName(route.name);
    setNewRouteOrigin(route.origin);
    setNewRouteDestination(route.destination);
    setNewRouteCategory(route.category);
    setNewRouteFrequency(String(route.frequencyMins || 15));
    setNewRouteFare(String(route.fareStartingInr || 10));
    setNewRouteFirstBus(route.firstBus || '05:30 AM');
    setNewRouteLastBus(route.lastBus || '10:00 PM');
    setNewRouteColor(route.color || '#0284c7');

    if (route.stops && route.stops.length > 2) {
      setIntermediateStops(route.stops.slice(1, -1).map((s) => s.name));
    } else {
      setIntermediateStops([]);
    }

    const coordsMap: Record<string, { lat: number; lng: number }> = {};
    route.stops?.forEach((s) => {
      coordsMap[s.name.toLowerCase().trim()] = { lat: s.lat, lng: s.lng };
    });
    setExistingStopCoords(coordsMap);

    setNewStopInput('');
    setIsAddRouteModalOpen(true);
  };

  const handleCloseRouteModal = () => {
    setIsAddRouteModalOpen(false);
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
    if (!newRouteNumber.trim() || !newRouteOrigin.trim() || !newRouteDestination.trim()) {
      setActionNotice({ type: 'error', text: 'Route number, origin and destination are required.' });
      return;
    }

    setIsSubmittingRoute(true);
    try {
      const originName = newRouteOrigin.trim();
      const destinationName = newRouteDestination.trim();
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
        newRouteCategory === 'government'
          ? '#0284c7'
          : newRouteCategory === 'ac_express'
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
          category: newRouteCategory,
          color: newRouteColor || existing?.color || categoryColor,
          firstBus: newRouteFirstBus || existing?.firstBus || '05:30 AM',
          lastBus: newRouteLastBus || existing?.lastBus || '10:00 PM',
          frequencyMins: parseInt(newRouteFrequency) || 15,
          fareStartingInr: parseInt(newRouteFare) || 10,
          isActive: existing?.isActive ?? true,
          stops,
        };

        store.adminUpdateRoute(updatedRoute, adminUid, adminName);
        setActionNotice({
          type: 'success',
          text: `✓ Route ${updatedRoute.routeNumber} has been updated & synced to Firestore!`,
        });
      } else {
        const newRoute: BusRoute = {
          id: `route-${Date.now()}`,
          routeNumber: newRouteNumber.trim().toUpperCase(),
          name: newRouteName.trim() || `${originName} to ${destinationName}`,
          origin: originName,
          destination: destinationName,
          category: newRouteCategory,
          color: newRouteColor || categoryColor,
          firstBus: newRouteFirstBus || '05:30 AM',
          lastBus: newRouteLastBus || '10:00 PM',
          frequencyMins: parseInt(newRouteFrequency) || 15,
          fareStartingInr: parseInt(newRouteFare) || 10,
          isActive: true,
          stops,
        };

        store.adminCreateRoute(newRoute, adminUid, adminName);
        setActionNotice({
          type: 'success',
          text: `✓ Route ${newRoute.routeNumber} successfully created and published in Linebazar!`,
        });
      }

      handleCloseRouteModal();
      setTimeout(() => setActionNotice(null), 5000);
    } catch (err: any) {
      setActionNotice({ type: 'error', text: err.message || 'Failed to save route.' });
    } finally {
      setIsSubmittingRoute(false);
    }
  };

  const handleConfirmDeleteRoute = () => {
    if (!routeToDelete) return;
    try {
      store.adminDeleteRoute(routeToDelete.id, adminUid, adminName);
      setActionNotice({
        type: 'success',
        text: `✓ Route ${routeToDelete.routeNumber} was deleted from Linebazar and Cloud Firestore.`,
      });
      setTimeout(() => setActionNotice(null), 5000);
    } catch (err: any) {
      setActionNotice({ type: 'error', text: err.message || 'Failed to delete route.' });
    } finally {
      setRouteToDelete(null);
    }
  };

  const toggleRouteExpand = (routeId: string) => {
    setExpandedRouteIds((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) {
        next.delete(routeId);
      } else {
        next.add(routeId);
      }
      return next;
    });
  };

  const filteredRoutes = routes.filter((r) => {
    const matchesSearch =
      !routeSearchTerm ||
      r.routeNumber.toLowerCase().includes(routeSearchTerm.toLowerCase()) ||
      r.name.toLowerCase().includes(routeSearchTerm.toLowerCase()) ||
      r.origin.toLowerCase().includes(routeSearchTerm.toLowerCase()) ||
      r.destination.toLowerCase().includes(routeSearchTerm.toLowerCase()) ||
      r.stops.some((s) => s.name.toLowerCase().includes(routeSearchTerm.toLowerCase()));

    const matchesCategory =
      routeCategoryFilter === 'all' || r.category === routeCategoryFilter;

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------- */}
      {/* 1. TOP ADMIN BADGE & INDICATOR BANNER                          */}
      {/* ------------------------------------------------------------- */}
      <div className="bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-slate-100 border-2 border-amber-500/40 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-500 text-slate-950 font-black flex items-center justify-center text-xl shadow-md shrink-0">
              👑
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950 font-black text-xs uppercase tracking-wider shadow-2xs">
                  Admin View
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Full Firestore & Storage Access
                </span>
              </div>
              <h1 className="text-lg sm:text-xl font-black text-slate-950 mt-1">
                Linebazar Authority Admin Console
              </h1>
              <p className="text-xs text-slate-600 mt-0.5">
                Authorized Admin Session:{' '}
                <span className="font-semibold text-slate-900 bg-white/90 px-1.5 py-0.5 rounded border border-amber-300">
                  {currentUser?.email || 'samrat.edu86@gmail.com'} (Secured Authority)
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            <button
              onClick={fetchFirestoreData}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-600' : 'text-slate-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{isLoading ? 'Syncing...' : 'Sync Firestore'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 2. STATS CARDS OVERVIEW                                       */}
      {/* ------------------------------------------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Total Users (Firestore)
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono tabular-nums">
            {users.length}
          </div>
          <div className="text-[11px] text-emerald-600 font-medium mt-1">
            ✓ Complete collection read
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Total Uploaded Files
          </div>
          <div className="text-2xl font-black text-amber-600 mt-1 font-mono tabular-nums">
            {userFiles.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Cloud Storage bucket records
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Transit Fleet Buses
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono tabular-nums">
            {buses.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {buses.filter((b) => b.approvalStatus === 'approved').length} approved & operational
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Active Wait Signals
          </div>
          <div className="text-2xl font-black text-blue-600 mt-1 font-mono tabular-nums">
            {waitSignals.filter((s) => s.status === 'active').length}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {waitSignals.length} total historical signals
          </div>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionNotice && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-semibold shadow-xs ${
            actionNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <span>{actionNotice.text}</span>
          <button
            onClick={() => setActionNotice(null)}
            className="text-slate-400 hover:text-slate-700 font-bold ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* Admin Sub-Tabs Navigation */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveAdminSubTab('users')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 ${
            activeAdminSubTab === 'users'
              ? 'bg-amber-500 text-slate-950 shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <span>👥 Users Management (যাত্রী, চালক ও কন্ডাক্টর)</span>
          <span className="bg-black/10 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold">
            {users.length}
          </span>
        </button>

        <button
          onClick={() => setActiveAdminSubTab('fleet')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 ${
            activeAdminSubTab === 'fleet'
              ? 'bg-amber-500 text-slate-950 shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <span>🚌 Bus Fleet Management (বাসের তালিকা ও নিয়ন্ত্রণ)</span>
          <span className="bg-black/10 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold">
            {buses.length}
          </span>
        </button>

        <button
          onClick={() => setActiveAdminSubTab('routes')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 ${
            activeAdminSubTab === 'routes'
              ? 'bg-amber-500 text-slate-950 shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <span>🗺️ Routes ({routes.length})</span>
        </button>

        <button
          onClick={() => setActiveAdminSubTab('map')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 ${
            activeAdminSubTab === 'map'
              ? 'bg-amber-500 text-slate-950 shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <span>📍 Live Transit Map</span>
        </button>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 3. TAB 1: USER MANAGEMENT (PASSENGER, DRIVER, CONDUCTOR)      */}
      {/* ------------------------------------------------------------- */}
      {activeAdminSubTab === 'users' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          {/* Table Controls Header */}
          <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>Registered Users (Passengers, Drivers, Conductors)</span>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                    {filteredUsers.length} Users
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-xs transition flex items-center gap-1.5"
                >
                  <span>➕ Add New User (নতুন ইউজার)</span>
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Admin can add or delete passengers, drivers, and conductors. Data syncs with Cloud Firestore.
              </p>
            </div>

            {/* Search & Filters */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search user, email, phone..."
                  className="w-full sm:w-52 pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 bg-white"
                />
                <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              {/* Role Filter Buttons */}
              <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs font-medium">
                {(['all', 'passenger', 'driver', 'conductor', 'admin'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setSelectedRoleFilter(r)}
                    className={`px-2 py-1 rounded capitalize text-[11px] font-semibold transition ${
                      selectedRoleFilter === r
                        ? 'bg-white text-slate-900 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {r === 'all' ? 'All' : r}
                  </button>
                ))}
              </div>
            </div>
          </div>

        {/* Users Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-4">User / Name</th>
                <th className="py-3 px-4">Email Address</th>
                <th className="py-3 px-4">Account Creation Date</th>
                <th className="py-3 px-4 text-center">Uploaded Files</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Pass Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                    No users matching criteria found in Firestore.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const fileCount = getFileCountForUser(user.uid);
                  const isCurrentAdmin = user.uid === DESIGNATED_ADMIN_UID;

                  return (
                    <tr
                      key={user.uid}
                      onClick={() => setSelectedUser(user)}
                      className={`hover:bg-amber-50/40 cursor-pointer transition ${
                        selectedUser?.uid === user.uid ? 'bg-amber-50/70 ring-1 ring-amber-300' : ''
                      }`}
                    >
                      {/* Name & Avatar */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          {user.photoURL ? (
                            <img
                              src={user.photoURL}
                              alt={user.displayName}
                              referrerPolicy="no-referrer"
                              className="w-8 h-8 rounded-full border border-amber-300 object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-amber-100 border border-amber-200 text-amber-900 font-bold text-xs flex items-center justify-center shrink-0">
                              {user.displayName ? user.displayName[0].toUpperCase() : 'U'}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 flex items-center gap-1.5 truncate">
                              <span>{user.displayName || 'Unnamed User'}</span>
                              {isCurrentAdmin && (
                                <span className="px-1.5 py-0.2 rounded bg-amber-500 text-slate-950 font-black text-[9px] uppercase">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 truncate max-w-[130px]">
                              {user.uid}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">
                          {user.email || <span className="text-slate-400 italic">No email linked</span>}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {user.phone}
                        </div>
                      </td>

                      {/* Account Creation Date */}
                      <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                        {formatDate(user.createdAt)}
                      </td>

                      {/* Uploaded Files Count */}
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold font-mono ${
                            fileCount > 0
                              ? 'bg-amber-100 text-amber-900 border border-amber-200'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span>{fileCount} {fileCount === 1 ? 'file' : 'files'}</span>
                        </span>
                      </td>

                      {/* Role */}
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-md font-bold uppercase text-[10px] tracking-wider ${
                            user.currentRole === 'admin'
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : user.currentRole === 'driver'
                              ? 'bg-blue-100 text-blue-900 border border-blue-200'
                              : user.currentRole === 'conductor'
                              ? 'bg-purple-100 text-purple-900 border border-purple-200'
                              : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                          }`}
                        >
                          {user.currentRole}
                        </span>
                      </td>

                      {/* Subscription Status */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              user.subscription?.status === 'active' || user.subscription?.status === 'trial'
                                ? 'bg-emerald-500'
                                : 'bg-rose-500'
                            }`}
                          />
                          <span className="capitalize font-semibold text-slate-800">
                            {user.subscription?.status || 'Active'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Expires: {formatDate(user.subscription?.paidThroughDate).split(',')[0]}
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedUser(user);
                            }}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition shadow-2xs"
                          >
                            Inspect
                          </button>
                          {!isCurrentAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setUserToDelete(user);
                              }}
                              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition shadow-2xs"
                              title="Delete user from database"
                            >
                              🗑️ Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 2: BUS FLEET MANAGEMENT (ADD, DELETE, APPROVE, OPERATE)   */}
      {/* ------------------------------------------------------------- */}
      {activeAdminSubTab === 'fleet' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden space-y-4 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900">Kolkata Bus Fleet Registry</h2>
                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                  {buses.length} Buses
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddBusModalOpen(true)}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-xs transition flex items-center gap-1.5"
                >
                  <span>➕ Add New Bus (নতুন বাস যোগ করুন)</span>
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Admin can add new buses, assign routes, drivers, and conductors, and delete buses permanently.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-semibold text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-3">Bus Vehicle</th>
                  <th className="py-3 px-3">Route</th>
                  <th className="py-3 px-3">Owner & Drivers/Conductor</th>
                  <th className="py-3 px-3">Approval Status</th>
                  <th className="py-3 px-3">Fleet Active</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {buses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No buses registered in fleet yet. Click "+ Add New Bus" to add one.
                    </td>
                  </tr>
                ) : (
                  buses.map((bus) => (
                    <tr key={bus.id} className="hover:bg-slate-50/60 transition">
                      {/* Vehicle */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
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
                            <div className="font-bold text-slate-900 font-mono text-sm">{bus.busNumber}</div>
                            <div className="text-[11px] text-slate-500">{bus.modelNumber}</div>
                          </div>
                        </div>
                      </td>

                      {/* Route */}
                      <td className="py-3 px-3">
                        <span className="font-bold text-slate-900 bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded">
                          Route {bus.routeNumber}
                        </span>
                      </td>

                      {/* Owner & Crew */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">{bus.ownerName}</div>
                        <div className="font-mono text-[11px] text-slate-500">{bus.ownerPhone}</div>
                        <div className="text-[10px] text-slate-500 mt-1 flex flex-wrap gap-1">
                          {bus.crew.map((c) => (
                            <span key={c.uid} className="bg-slate-100 border border-slate-200 px-1.5 py-0.2 rounded">
                              {c.role === 'driver' ? '🚗' : '🎫'} {c.displayName}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Approval Status */}
                      <td className="py-3 px-3">
                        <span
                          className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                            bus.approvalStatus === 'approved'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : bus.approvalStatus === 'pending'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : 'bg-rose-100 text-rose-800 border border-rose-300'
                          }`}
                        >
                          {bus.approvalStatus.toUpperCase()}
                        </span>
                      </td>

                      {/* Active Status */}
                      <td className="py-3 px-3">
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                            bus.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {bus.isActive ? '● Operational' : '○ Standby'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-right space-x-1.5 whitespace-nowrap">
                        {bus.approvalStatus === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleApproveBus(bus.id)}
                            className="px-2.5 py-1 text-xs font-bold rounded bg-emerald-600 text-white hover:bg-emerald-500"
                          >
                            Approve
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleBusActive(bus.id, bus.isActive)}
                          className={`px-2.5 py-1 text-xs font-semibold rounded border transition ${
                            bus.isActive
                              ? 'border-slate-300 text-slate-700 hover:bg-slate-100'
                              : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                          }`}
                        >
                          {bus.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setBusToDelete(bus)}
                          className="px-2.5 py-1 text-xs font-bold rounded bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition shadow-2xs"
                        >
                          🗑️ Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 3: ROUTES & STOPS MANAGEMENT                              */}
      {/* ------------------------------------------------------------- */}
      {activeAdminSubTab === 'routes' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          {/* Header with Title and Action Buttons */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>Kolkata Bus Routes & Stop Sequences (বাস রুট ও স্টপেজ)</span>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                    {filteredRoutes.length} / {routes.length} Routes
                  </span>
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Official urban transit lines across North, Central, South Kolkata, Howrah, and Salt Lake.
              </p>
            </div>

            {/* Action Buttons: Import CSV and Add Route */}
            <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
              <button
                type="button"
                onClick={() => setCsvModalOpen(true)}
                className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300 transition shadow-2xs flex items-center gap-1.5"
                title="Import bus routes from CSV spreadsheet"
              >
                <span>📥 Import CSV (CSV থেকে ইম্পোর্ট)</span>
              </button>

              <button
                type="button"
                onClick={handleOpenCreateRoute}
                className="px-4 py-2 text-xs font-black rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-xs transition flex items-center gap-1.5"
                title="Add a new bus route with custom stoppages and timings"
              >
                <span className="text-sm">➕</span>
                <span>Add Route (নতুন রুট যোগ করুন)</span>
              </button>
            </div>
          </div>

          {/* Search and Category Filter Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                value={routeSearchTerm}
                onChange={(e) => setRouteSearchTerm(e.target.value)}
                placeholder="Search route (e.g. S-12, AC-9), stoppage, or terminal..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              />
              <svg
                className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs font-medium self-start sm:self-auto overflow-x-auto">
              {(
                [
                  { id: 'all', label: 'All', bn: 'সকল' },
                  { id: 'government', label: 'Govt / WBTC', bn: 'সরকারি' },
                  { id: 'private', label: 'Private', bn: 'বেসরকারি' },
                  { id: 'ac_express', label: 'AC Express', bn: 'এসি' },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setRouteCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition shrink-0 ${
                    routeCategoryFilter === cat.id
                      ? 'bg-white text-slate-900 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Routes Cards Grid */}
          <div className="space-y-3.5">
            {filteredRoutes.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                <p className="text-sm font-semibold text-slate-600">কোনো রুট পাওয়া যায়নি (No matching routes found)</p>
                <p className="text-xs text-slate-400 mt-1">Try adjusting your search terms or click &apos;Add Route&apos; to create one.</p>
                <button
                  type="button"
                  onClick={handleOpenCreateRoute}
                  className="mt-3 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5"
                >
                  <span>➕ Add Route (নতুন রুট যোগ করুন)</span>
                </button>
              </div>
            ) : (
              filteredRoutes.slice(0, 80).map((route) => {
                const isExpanded = expandedRouteIds.has(route.id);
                const categoryBadge =
                  route.category === 'government'
                    ? { bg: 'bg-blue-100 text-blue-900 border-blue-200', text: 'Govt / WBTC' }
                    : route.category === 'ac_express'
                    ? { bg: 'bg-purple-100 text-purple-900 border-purple-200', text: 'AC Express' }
                    : { bg: 'bg-amber-100 text-amber-900 border-amber-200', text: 'Private' };

                return (
                  <div
                    key={route.id}
                    className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition shadow-2xs space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-start sm:items-center gap-3">
                        <span
                          className="px-3 py-1 rounded-lg text-xs font-black text-white shadow-xs shrink-0 tracking-wide font-mono"
                          style={{ backgroundColor: route.color || '#0284c7' }}
                        >
                          {route.routeNumber}
                        </span>

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-sm text-slate-900">{route.name}</h4>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${categoryBadge.bg}`}>
                              {categoryBadge.text}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5 flex items-center gap-1">
                            <span className="font-medium text-slate-800">{route.origin}</span>
                            <span className="text-slate-400">→</span>
                            <span className="font-medium text-slate-800">{route.destination}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        <div className="text-right hidden md:block text-[11px] text-slate-500 font-mono pr-2">
                          <div>Freq: <strong>Every {route.frequencyMins}m</strong></div>
                          <div>Fare: <strong>₹{route.fareStartingInr}+</strong></div>
                        </div>

                        {/* Edit Route Button */}
                        <button
                          type="button"
                          onClick={() => handleOpenEditRoute(route)}
                          className="px-2.5 py-1.5 text-xs font-bold text-amber-900 hover:text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-colors flex items-center gap-1 shadow-2xs"
                          title="Edit route and change stops"
                        >
                          <span>✏️ Edit</span>
                        </button>

                        {/* Delete Route Button */}
                        <button
                          type="button"
                          onClick={() => setRouteToDelete(route)}
                          className="px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-1 shadow-2xs"
                          title="Delete route"
                        >
                          <span>🗑️ Delete</span>
                        </button>
                      </div>
                    </div>

                    {/* Operational Details Bar */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2 px-3 bg-slate-50 rounded-lg border border-slate-100 text-[11px]">
                      <div>
                        <span className="text-slate-400">First Bus:</span>{' '}
                        <strong className="text-slate-700 font-mono">{route.firstBus || '05:30 AM'}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Last Bus:</span>{' '}
                        <strong className="text-slate-700 font-mono">{route.lastBus || '10:00 PM'}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Interval:</span>{' '}
                        <strong className="text-slate-700 font-mono">{route.frequencyMins} mins</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Base Fare:</span>{' '}
                        <strong className="text-emerald-700 font-mono">₹{route.fareStartingInr}</strong>
                      </div>
                    </div>

                    {/* Stop Sequence Section */}
                    <div className="pt-1 border-t border-slate-100">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-semibold text-slate-700 text-[11px]">
                          Route Stoppages ({route.stops.length} stops in sequence):
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleRouteExpand(route.id)}
                          className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 underline"
                        >
                          {isExpanded ? 'Collapse ▲' : 'View all stops ▼'}
                        </button>
                      </div>

                      {/* Display preview or full sequence */}
                      <div className="flex flex-wrap gap-1 text-[11px]">
                        {(isExpanded ? route.stops : route.stops.slice(0, 8)).map((stop, sIdx) => {
                          const isFirst = sIdx === 0;
                          const isLast = sIdx === route.stops.length - 1;
                          return (
                            <span
                              key={stop.id || sIdx}
                              className={`px-2 py-0.5 rounded border text-[11px] font-medium flex items-center gap-1 ${
                                isFirst
                                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                  : isLast
                                  ? 'bg-rose-50 border-rose-300 text-rose-800'
                                  : 'bg-slate-50 border-slate-200 text-slate-700'
                              }`}
                            >
                              <span className="font-mono text-[9px] text-slate-400">#{stop.sequence}</span>
                              <span>{stop.name}</span>
                              {isFirst && <span className="text-[9px] font-bold text-emerald-700 font-sans">Start</span>}
                              {isLast && <span className="text-[9px] font-bold text-rose-700 font-sans">End</span>}
                            </span>
                          );
                        })}
                        {!isExpanded && route.stops.length > 8 && (
                          <button
                            type="button"
                            onClick={() => toggleRouteExpand(route.id)}
                            className="text-[11px] text-slate-500 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded border border-slate-200 font-semibold"
                          >
                            +{route.stops.length - 8} more...
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {filteredRoutes.length > 80 && (
              <div className="p-3 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                Showing top 80 of {filteredRoutes.length.toLocaleString()} routes. Use the search bar above to view any specific route.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 4: LIVE TRANSIT MAP                                       */}
      {/* ------------------------------------------------------------- */}
      {activeAdminSubTab === 'map' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Live GPS Fleet Tracking Map</h2>
            <div className="text-xs font-mono text-slate-500">Active Fleet: {buses.filter(b => b.isActive).length} Buses</div>
          </div>
          <KolkataTransitMap
            routes={routes}
            trips={trips}
            buses={buses}
            stands={[]}
            waitSignals={waitSignals}
            className="h-[600px] w-full rounded-xl overflow-hidden border border-slate-200"
          />
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 4. USER DATA INSPECTOR DRAWER / MODAL                         */}
      {/* ------------------------------------------------------------- */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-amber-50/40 shrink-0">
              <div className="flex items-center gap-3">
                {selectedUser.photoURL ? (
                  <img
                    src={selectedUser.photoURL}
                    alt={selectedUser.displayName}
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-full border border-amber-300 object-cover shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-amber-100 border border-amber-200 text-amber-900 font-bold text-sm flex items-center justify-center shrink-0">
                    {selectedUser.displayName ? selectedUser.displayName[0].toUpperCase() : 'U'}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{selectedUser.displayName}</h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300">
                      {selectedUser.currentRole}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono">
                    UID: {selectedUser.uid} • Created: {formatDate(selectedUser.createdAt)}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSelectedUser(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition"
              >
                ✕
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-6 space-y-6 overflow-y-auto flex-1 text-xs">
              {/* User Overview Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <span className="text-slate-500 font-medium">Email Address:</span>
                  <div className="font-bold text-slate-900 mt-0.5 font-mono">
                    {selectedUser.email || 'None provided'}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Phone Number:</span>
                  <div className="font-bold text-slate-900 mt-0.5 font-mono">
                    {selectedUser.phone}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Assigned Roles:</span>
                  <div className="font-semibold text-slate-900 mt-0.5 capitalize">
                    {selectedUser.roles?.join(', ') || selectedUser.currentRole}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Pass Subscription:</span>
                  <div className="font-semibold text-emerald-700 mt-0.5">
                    {selectedUser.subscription?.status === 'trial' ? '3-Month Free Pass' : 'Active Pass'} (Valid till {formatDate(selectedUser.subscription?.paidThroughDate).split(',')[0]})
                  </div>
                </div>
              </div>

              {/* -------------------------------------------------------- */}
              {/* SECTION: USER UPLOADED FILES                             */}
              {/* -------------------------------------------------------- */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <span>Uploaded Files & Documents ({selectedUserFiles.length})</span>
                    <span className="text-[10px] font-mono text-slate-400">Firebase Storage</span>
                  </h4>
                </div>

                {selectedUserFiles.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-slate-400">
                    No files uploaded yet by this user.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedUserFiles.map((file) => (
                      <div
                        key={file.id}
                        className="p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition flex flex-col justify-between gap-2 shadow-2xs"
                      >
                        <div className="flex items-start gap-2.5">
                          {file.contentType.startsWith('image/') ? (
                            <img
                              src={file.downloadUrl}
                              alt={file.fileName}
                              className="w-12 h-12 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-center font-bold text-xs shrink-0">
                              PDF
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900 truncate" title={file.fileName}>
                              {file.fileName}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                              {formatFileSize(file.sizeBytes)} • {file.fileCategory}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {formatDate(file.uploadedAt)}
                            </div>
                          </div>
                        </div>

                        <a
                          href={file.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 w-full py-1.5 text-center text-[11px] font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                        >
                          View File in Storage ↗
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* -------------------------------------------------------- */}
              {/* SECTION: INSERTED DATA (WAIT SIGNALS & FLEET BUSES)      */}
              {/* -------------------------------------------------------- */}
              <div className="space-y-3">
                <div className="border-b border-slate-100 pb-2">
                  <h4 className="text-sm font-bold text-slate-900">
                    Inserted Transit Data & Activity Records
                  </h4>
                </div>

                {/* Wait Signals */}
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                    <span>Passenger Wait Signals</span>
                    <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.2 rounded">
                      {selectedUserWaitSignals.length} records
                    </span>
                  </div>
                  {selectedUserWaitSignals.length === 0 ? (
                    <div className="text-slate-400 italic text-[11px] bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      No passenger wait signals created by this user yet.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {selectedUserWaitSignals.map((sig) => (
                        <div
                          key={sig.id}
                          className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-bold text-slate-900">{sig.busNumber}</span>
                            <span className="text-slate-600 ml-2">@ {sig.stopName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold capitalize bg-emerald-100 text-emerald-800">
                              {sig.status}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {formatDate(sig.timestamp)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Buses Owned or Crewed */}
                {selectedUserBuses.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-700 mb-1.5">
                      Associated Bus Registrations ({selectedUserBuses.length})
                    </div>
                    <div className="space-y-1.5">
                      {selectedUserBuses.map((bus) => (
                        <div
                          key={bus.id}
                          className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-bold text-slate-900">{bus.busNumber}</span>
                            <span className="text-slate-600 ml-2">Route {bus.routeNumber}</span>
                          </div>
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold capitalize bg-blue-100 text-blue-800">
                            {bus.approvalStatus}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* -------------------------------------------------------- */}
              {/* SECTION: RAW FIRESTORE JSON DOCUMENT                     */}
              {/* -------------------------------------------------------- */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setJsonViewOpen(!jsonViewOpen)}
                  className="w-full px-4 py-2.5 bg-slate-100 hover:bg-slate-200 transition text-left flex items-center justify-between text-xs font-semibold text-slate-800"
                >
                  <span>Raw Firestore Document at <code>/profiles/{selectedUser.uid}</code></span>
                  <span>{jsonViewOpen ? '▲ Hide' : '▼ View JSON'}</span>
                </button>
                {jsonViewOpen && (
                  <pre className="p-3.5 bg-slate-950 text-slate-100 text-[10px] font-mono overflow-x-auto max-h-48 leading-relaxed">
                    {JSON.stringify(selectedUser, null, 2)}
                  </pre>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
              {selectedUser.uid !== DESIGNATED_ADMIN_UID ? (
                <button
                  type="button"
                  onClick={() => {
                    const u = selectedUser;
                    setSelectedUser(null);
                    setUserToDelete(u);
                  }}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-50 border border-rose-300 text-rose-700 hover:bg-rose-100 transition shadow-2xs flex items-center gap-1.5"
                >
                  <span>🗑️ Delete This User Profile</span>
                </button>
              ) : (
                <span className="text-[11px] text-slate-400 italic">SuperAdmin profile protected</span>
              )}

              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition shadow-2xs"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 5. MODAL: ADD NEW USER (PASSENGER / DRIVER / CONDUCTOR / ADMIN)*/}
      {/* ------------------------------------------------------------- */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden my-auto">
            <div className="px-6 py-4 bg-gradient-to-r from-amber-500/20 to-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-950">Add New User / নতুন ব্যবহারকারী</h3>
                <p className="text-xs text-slate-600">Register Passenger, Driver, Conductor, or Admin into Firestore</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddUserModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-4 text-xs">
              {/* Role Selection */}
              <div>
                <label className="block font-bold text-slate-800 mb-1.5">User Role (ভূমিকা):</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      { role: 'passenger', label: 'Passenger', bn: 'যাত্রী' },
                      { role: 'driver', label: 'Driver', bn: 'ড্রাইভার' },
                      { role: 'conductor', label: 'Conductor', bn: 'কন্ডাক্টর' },
                      { role: 'admin', label: 'Admin', bn: 'অ্যাডমিন' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.role}
                      type="button"
                      onClick={() => setNewUserRole(item.role)}
                      className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center justify-center ${
                        newUserRole === item.role
                          ? 'border-amber-500 bg-amber-50 text-slate-950 font-bold ring-2 ring-amber-400/50'
                          : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      <span className="text-sm font-semibold">{item.label}</span>
                      <span className="text-[10px] text-slate-500">{item.bn}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Display Name */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">Full Name (পুরো নাম): *</label>
                <input
                  type="text"
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="e.g. Subrata Mukherjee / অনিমেষ ঘোষ"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">Phone Number (মোবাইল নম্বর): *</label>
                <input
                  type="tel"
                  required
                  value={newUserPhone}
                  onChange={(e) => setNewUserPhone(e.target.value)}
                  placeholder="+919830123456"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white font-mono"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">Email Address (ইমেইল - ঐচ্ছিক):</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="user@kolkatatransit.org"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>

              {/* Driving License / Badge (for Driver/Conductor) */}
              {(newUserRole === 'driver' || newUserRole === 'conductor') && (
                <div>
                  <label className="block font-bold text-slate-800 mb-1">
                    {newUserRole === 'driver' ? 'Commercial Driving License No (ড্রাইভিং লাইসেন্স):' : 'Conductor Badge No (কন্ডাক্টর ব্যাজ নং):'}
                  </label>
                  <input
                    type="text"
                    value={newUserLicense}
                    onChange={(e) => setNewUserLicense(e.target.value)}
                    placeholder={newUserRole === 'driver' ? 'WB-01-2022-0045892' : 'WB-CND-99214'}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white font-mono"
                  />
                </div>
              )}

              {/* Subscription Status */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">Pass Subscription Status:</label>
                <select
                  value={newUserStatus}
                  onChange={(e) => setNewUserStatus(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="trial">3-Month Free Trial Pass (সক্রিয় ট্রায়াল)</option>
                  <option value="active">Active Verified Pass (পেইড ভেরিফাইড)</option>
                </select>
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingUser}
                  className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-xs transition disabled:opacity-50"
                >
                  {isSubmittingUser ? 'Saving...' : 'Create & Sync User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 6. MODAL: ADD NEW BUS TO TRANSIT FLEET                        */}
      {/* ------------------------------------------------------------- */}
      {isAddBusModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 bg-gradient-to-r from-amber-500/20 to-slate-50 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-black text-slate-950">Add New Bus / নতুন বাস যুক্ত করুন</h3>
                <p className="text-xs text-slate-600">Register vehicle, route assignment, and operational crew</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddBusModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateBus} className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
              {/* Bus Registration Number */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">Bus Registration Number (বাসের নম্বর): *</label>
                <input
                  type="text"
                  required
                  value={newBusNumber}
                  onChange={(e) => setNewBusNumber(e.target.value)}
                  placeholder="e.g. WB 04 G 4589 / WB 19 B 1204"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white font-mono uppercase"
                />
              </div>

              {/* Vehicle Model */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">Bus Model / Make (মডেল):</label>
                <input
                  type="text"
                  value={newBusModel}
                  onChange={(e) => setNewBusModel(e.target.value)}
                  placeholder="Tata Marcopolo BS-VI CNG / Volvo 8400 Low Floor"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>

              {/* Assigned Route */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">Assigned Route (নির্ধারিত রুট):</label>
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

              {/* Bus Owner / Transporter */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Owner Name (মালিকের নাম):</label>
                  <input
                    type="text"
                    value={newBusOwnerName}
                    onChange={(e) => setNewBusOwnerName(e.target.value)}
                    placeholder="e.g. CSTC / Private Fleet"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Owner Phone (ফোন):</label>
                  <input
                    type="tel"
                    value={newBusOwnerPhone}
                    onChange={(e) => setNewBusOwnerPhone(e.target.value)}
                    placeholder="+919830112233"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white font-mono"
                  />
                </div>
              </div>

              {/* Assigned Driver */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="font-bold text-slate-900">🚗 Assigned Driver (ড্রাইভার লিঙ্ক):</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newBusDriverName}
                    onChange={(e) => setNewBusDriverName(e.target.value)}
                    placeholder="Driver Name (e.g. Subhasish)"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white"
                  />
                  <input
                    type="tel"
                    value={newBusDriverPhone}
                    onChange={(e) => setNewBusDriverPhone(e.target.value)}
                    placeholder="Driver Phone (+91...)"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </div>
              </div>

              {/* Assigned Conductor */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="font-bold text-slate-900">🎫 Assigned Conductor (কন্ডাক্টর লিঙ্ক):</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newBusConductorName}
                    onChange={(e) => setNewBusConductorName(e.target.value)}
                    placeholder="Conductor Name (e.g. Tapan)"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white"
                  />
                  <input
                    type="tel"
                    value={newBusConductorPhone}
                    onChange={(e) => setNewBusConductorPhone(e.target.value)}
                    placeholder="Conductor Phone (+91...)"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAddBusModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingBus}
                  className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-xs transition disabled:opacity-50"
                >
                  {isSubmittingBus ? 'Adding Bus...' : 'Add Bus to Fleet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 7. MODAL: DELETE USER CONFIRMATION                            */}
      {/* ------------------------------------------------------------- */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-rose-200 overflow-hidden p-6 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center text-2xl mx-auto">
              🗑️
            </div>
            <div className="text-center">
              <h3 className="text-base font-bold text-slate-900">Delete User Account?</h3>
              <p className="text-xs text-slate-600 mt-1">
                Are you sure you want to permanently delete{' '}
                <strong className="text-slate-900 font-bold">{userToDelete.displayName}</strong> ({userToDelete.currentRole})?
              </p>
              <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-left font-mono text-slate-600 space-y-1">
                <div>UID: {userToDelete.uid}</div>
                <div>Phone: {userToDelete.phone}</div>
                {userToDelete.email && <div>Email: {userToDelete.email}</div>}
              </div>
              <p className="text-[11px] text-rose-600 mt-2 font-medium">
                This action will delete their profile from Cloud Firestore and unlink them from all bus crews.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="w-1/2 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteUser}
                className="w-1/2 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition shadow-xs"
              >
                Yes, Delete User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 8. MODAL: DELETE BUS CONFIRMATION                             */}
      {/* ------------------------------------------------------------- */}
      {busToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-rose-200 overflow-hidden p-6 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center text-2xl mx-auto">
              🚌
            </div>
            <div className="text-center">
              <h3 className="text-base font-bold text-slate-900">Delete Bus from Fleet?</h3>
              <p className="text-xs text-slate-600 mt-1">
                Are you sure you want to permanently delete vehicle{' '}
                <strong className="text-slate-900 font-bold font-mono">{busToDelete.busNumber}</strong> (Route {busToDelete.routeNumber})?
              </p>
              <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-left font-mono text-slate-600 space-y-1">
                <div>Model: {busToDelete.modelNumber}</div>
                <div>Owner: {busToDelete.ownerName} ({busToDelete.ownerPhone})</div>
                <div>Crew: {busToDelete.crew.length} registered</div>
              </div>
              <p className="text-[11px] text-rose-600 mt-2 font-medium">
                This will remove the bus from active transit monitoring, public schedules, and Cloud Firestore.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setBusToDelete(null)}
                className="w-1/2 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteBus}
                className="w-1/2 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition shadow-xs"
              >
                Yes, Delete Bus
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ------------------------------------------------------------- */}
      {/* 9. MODAL: CREATE / EDIT BUS ROUTE                             */}
      {/* ------------------------------------------------------------- */}
      {isAddRouteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-amber-500/20 to-slate-50 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-black text-slate-950 flex items-center gap-2">
                  <span>{editingRouteId ? 'Edit Bus Route (রুট পরিবর্তন)' : 'Add New Bus Route (নতুন বাস রুট)'}</span>
                  {newRouteNumber.trim() && (
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-bold">
                      {newRouteNumber.toUpperCase()}
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-600">
                  {editingRouteId
                    ? 'Update route number, terminals, fare, and sequential stoppages'
                    : 'Configure urban transit line, stops sequence, and operational frequency'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseRouteModal}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
              >
                ✕
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveRoute} className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
              {/* Route Number and Badge Color */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-800 mb-1">Route Number / Code (রুটের নম্বর): *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. S-12, AC-9, 24A, 1A"
                    value={newRouteNumber}
                    onChange={(e) => setNewRouteNumber(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white font-mono uppercase font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Badge Color:</label>
                  <div className="flex items-center gap-1.5 pt-1">
                    {['#0284c7', '#059669', '#7c3aed', '#d97706', '#dc2626'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewRouteColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full transition transform hover:scale-110 ${
                          newRouteColor === c ? 'ring-2 ring-offset-2 ring-slate-900 scale-105' : 'opacity-80'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Route Display Name */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">Route Full Name / Description (ঐচ্ছিক নাম):</label>
                <input
                  type="text"
                  placeholder="e.g. Howrah Station to New Town Eco Space"
                  value={newRouteName}
                  onChange={(e) => setNewRouteName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>

              {/* Terminals: Origin & Destination */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Origin Terminus (প্রারম্ভিক টার্মিনাস): *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Howrah Station"
                    value={newRouteOrigin}
                    onChange={(e) => setNewRouteOrigin(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Destination Terminus (গন্তব্য টার্মিনাস): *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Karunamoyee / New Town"
                    value={newRouteDestination}
                    onChange={(e) => setNewRouteDestination(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  />
                </div>
              </div>

              {/* Interactive Stoppage Sequence Builder */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span>Sequential Stoppages (স্টপেজ তালিকা)</span>
                    <span className="text-[10px] font-bold text-amber-950 bg-amber-200 px-2 py-0.5 rounded-full">
                      {intermediateStops.length + 2} total stops
                    </span>
                  </label>
                  <span className="text-[10px] text-slate-400">Origin → Via Stops → Destination</span>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
                  {/* Stop 1: Origin Stop Badge */}
                  <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-emerald-300 shadow-2xs">
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      1
                    </span>
                    <div className="flex-1 font-bold text-slate-800 truncate">
                      {newRouteOrigin.trim() ? newRouteOrigin : <span className="text-slate-400 italic font-normal">Enter Origin Terminus above</span>}
                    </div>
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                      Origin / শুরু
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
                          <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px] shrink-0 font-mono">
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
                    <p className="text-[11px] text-slate-500 italic py-2 text-center bg-white/70 rounded-lg border border-dashed border-slate-200">
                      মাঝের কোনো স্টপেজ এখনও যুক্ত করা নেই। নিচের বক্সে নাম লিখে &apos;+ Add Stop&apos; চাপুন।
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
                      placeholder="Type intermediate stop (e.g. Esplanade, Ultadanga, Ruby)..."
                      className="flex-1 px-3 py-1.5 text-xs bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button
                      type="button"
                      onClick={handleAddIntermediateStop}
                      className="px-3.5 py-1.5 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg shrink-0 flex items-center gap-1 shadow-xs transition"
                    >
                      <span>➕</span>
                      <span>Add Stop</span>
                    </button>
                  </div>

                  {/* Last Stop: Destination Stop Badge */}
                  <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-rose-300 shadow-2xs">
                    <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 font-mono">
                      {intermediateStops.length + 2}
                    </span>
                    <div className="flex-1 font-bold text-slate-800 truncate">
                      {newRouteDestination.trim() ? newRouteDestination : <span className="text-slate-400 italic font-normal">Enter Destination Terminus above</span>}
                    </div>
                    <span className="text-[10px] font-bold text-rose-800 bg-rose-100 px-2 py-0.5 rounded">
                      Destination / গন্তব্য
                    </span>
                  </div>
                </div>
              </div>

              {/* Operational Timing & Fare Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Category:</label>
                  <select
                    value={newRouteCategory}
                    onChange={(e) => setNewRouteCategory(e.target.value as any)}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="government">Govt / WBTC</option>
                    <option value="private">Private</option>
                    <option value="ac_express">AC Express</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Interval (Mins):</label>
                  <input
                    type="number"
                    min="5"
                    max="180"
                    value={newRouteFrequency}
                    onChange={(e) => setNewRouteFrequency(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-800 mb-1">First Bus:</label>
                  <input
                    type="text"
                    value={newRouteFirstBus}
                    onChange={(e) => setNewRouteFirstBus(e.target.value)}
                    placeholder="05:30 AM"
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white font-mono text-center"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Fare (₹):</label>
                  <input
                    type="number"
                    min="5"
                    max="150"
                    value={newRouteFare}
                    onChange={(e) => setNewRouteFare(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={handleCloseRouteModal}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRoute}
                  className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-xs transition disabled:opacity-50"
                >
                  {isSubmittingRoute ? 'Saving...' : editingRouteId ? 'Update Route' : 'Publish & Save Route'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 10. MODAL: DELETE ROUTE CONFIRMATION                          */}
      {/* ------------------------------------------------------------- */}
      {routeToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-rose-200 overflow-hidden p-6 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center text-2xl mx-auto">
              🗑️
            </div>
            <div className="text-center">
              <h3 className="text-base font-bold text-slate-900">Delete Route Permanently?</h3>
              <p className="text-xs text-slate-600 mt-1">
                Are you sure you want to delete Route{' '}
                <strong className="text-slate-900 font-bold font-mono">
                  {routeToDelete.routeNumber} ({routeToDelete.name})
                </strong>?
              </p>
              <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-left font-mono text-slate-600 space-y-1">
                <div>Origin: {routeToDelete.origin}</div>
                <div>Destination: {routeToDelete.destination}</div>
                <div>Stoppages: {routeToDelete.stops.length} stops</div>
              </div>
              <p className="text-[11px] text-rose-600 mt-2 font-medium">
                This will remove the route from public searches, commuter schedules, and Cloud Firestore.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setRouteToDelete(null)}
                className="w-1/2 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteRoute}
                className="w-1/2 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition shadow-xs"
              >
                Yes, Delete Route
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 11. CSV ROUTE IMPORTER MODAL                                  */}
      {/* ------------------------------------------------------------- */}
      <CsvRouteImporterModal
        isOpen={csvModalOpen}
        onClose={() => setCsvModalOpen(false)}
        onImportSuccess={(count) => {
          setActionNotice({
            type: 'success',
            text: `✓ Successfully imported ${count} bus routes from CSV into Linebazar and Cloud Firestore!`,
          });
          setTimeout(() => setActionNotice(null), 5000);
        }}
      />
    </div>
  );
};
