import { doc, setDoc, getDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { ref as sRef, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { ref as dbRef, set, remove } from 'firebase/database';
import { db, auth, storage, rtdb } from '../lib/firebase';
import { handleFirestoreError, OperationType } from './firebase';
import { BusRegistration, BusRoute, BusStand, UserProfile, WaitSignal, OnboardPassenger, UserFileRecord } from '../types';
import { KOLKATA_BUS_STANDS, KOLKATA_ROUTES, INITIAL_BUSES } from '../data/kolkataRoutes';

export class FirestoreSyncService {
  private static instance: FirestoreSyncService;

  private constructor() {}

  public static getInstance(): FirestoreSyncService {
    if (!FirestoreSyncService.instance) {
      FirestoreSyncService.instance = new FirestoreSyncService();
    }
    return FirestoreSyncService.instance;
  }

  // Listen to Firebase Auth state
  public listenToAuth(onUserChange: (user: User | null) => void): () => void {
    return onAuthStateChanged(auth, (firebaseUser) => {
      onUserChange(firebaseUser);
    });
  }

  // Seed verified Kolkata routes, stands, and fleet buses into Firestore
  public async seedKolkataDataset(): Promise<{ routes: number; stands: number; buses: number }> {
    let routesCount = 0;
    let standsCount = 0;
    let busesCount = 0;

    try {
      // 1. Seed Routes
      for (const route of KOLKATA_ROUTES) {
        const routeRef = doc(db, 'routes', route.id);
        await setDoc(routeRef, {
          id: route.id,
          routeNumber: route.routeNumber,
          name: route.name,
          origin: route.origin,
          destination: route.destination,
          category: route.category,
          color: route.color,
          firstBus: route.firstBus,
          lastBus: route.lastBus,
          frequencyMins: route.frequencyMins,
          fareStartingInr: route.fareStartingInr,
          stops: route.stops,
          isActive: route.isActive,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        routesCount++;
      }

      // 2. Seed Stands / Terminals
      for (const stand of KOLKATA_BUS_STANDS) {
        const standRef = doc(db, 'stands', stand.id);
        await setDoc(standRef, {
          id: stand.id,
          name: stand.name,
          location: stand.location,
          lat: stand.lat,
          lng: stand.lng,
          capacityBuses: stand.capacityBuses,
          amenities: stand.amenities,
          routesOriginating: stand.routesOriginating,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        standsCount++;
      }

      // 3. Seed Initial Bus Registrations
      for (const bus of INITIAL_BUSES) {
        const busRef = doc(db, 'buses', bus.id);
        await setDoc(busRef, {
          id: bus.id,
          busNumber: bus.busNumber,
          normalizedBusNumber: bus.normalizedBusNumber,
          modelNumber: bus.modelNumber,
          frontPhotoUrl: bus.frontPhotoUrl,
          assignedRouteId: bus.assignedRouteId,
          routeNumber: bus.routeNumber,
          ownerUid: bus.ownerUid,
          ownerName: bus.ownerName,
          ownerPhone: bus.ownerPhone,
          approvalStatus: bus.approvalStatus,
          appliedAt: bus.appliedAt,
          approvedAt: bus.approvedAt || null,
          isActive: bus.isActive,
          subscription: bus.subscription,
        }, { merge: true });
        busesCount++;
      }

      return { routes: routesCount, stands: standsCount, buses: busesCount };
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'routes');
      throw error;
    }
  }

  // Save or update User Profile in Firestore
  public async syncUserProfile(profile: UserProfile): Promise<void> {
    try {
      const profileRef = doc(db, 'profiles', profile.uid);
      await setDoc(profileRef, {
        uid: profile.uid,
        phone: profile.phone,
        email: profile.email || '',
        displayName: profile.displayName,
        photoURL: profile.photoURL || '',
        currentRole: profile.currentRole,
        roles: profile.roles,
        createdAt: profile.createdAt,
        subscription: profile.subscription,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (error) {
      console.warn('Could not sync user profile to Firestore (using offline cache):', error);
    }
  }

  // Retrieve User Profile from Firestore by UID
  public async getUserProfile(uid: string): Promise<UserProfile | null> {
    try {
      const profileRef = doc(db, 'profiles', uid);
      const snap = await getDoc(profileRef);
      if (snap.exists()) {
        return snap.data() as UserProfile;
      }
      return null;
    } catch (error) {
      console.warn('Could not fetch user profile from Firestore:', error);
      return null;
    }
  }

  // Save Wait Signal to Firestore with deterministic ID
  public async syncWaitSignal(signal: WaitSignal): Promise<void> {
    try {
      const signalRef = doc(db, 'waitSignals', signal.id);
      await setDoc(signalRef, {
        id: signal.id,
        passengerUid: signal.passengerUid,
        passengerPhone: signal.passengerPhone,
        busId: signal.busId,
        busNumber: signal.busNumber,
        tripId: signal.tripId,
        routeId: signal.routeId,
        stopId: signal.stopId,
        stopName: signal.stopName,
        status: signal.status,
        timestamp: signal.timestamp,
      }, { merge: true });
    } catch (error) {
      console.warn('Could not sync wait signal to Firestore (using offline cache):', error);
    }
  }

  // Sync Onboard Passenger ("I am in the Bus") to Firestore
  public async syncOnboardPassenger(onboard: OnboardPassenger): Promise<void> {
    try {
      const docRef = doc(db, 'onboardPassengers', onboard.id);
      await setDoc(docRef, {
        id: onboard.id,
        passengerUid: onboard.passengerUid,
        passengerName: onboard.passengerName,
        passengerPhone: onboard.passengerPhone,
        busId: onboard.busId,
        busNumber: onboard.busNumber,
        routeId: onboard.routeId,
        routeNumber: onboard.routeNumber,
        tripId: onboard.tripId,
        originStopId: onboard.originStopId,
        originStopName: onboard.originStopName,
        destinationStopId: onboard.destinationStopId,
        destinationStopName: onboard.destinationStopName,
        boardedAt: onboard.boardedAt,
        status: onboard.status,
        alightedAt: onboard.alightedAt || null,
        notifyBeforeStops: onboard.notifyBeforeStops ?? 1,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (error) {
      console.warn('Could not sync onboard passenger to Firestore (using offline cache):', error);
    }
  }

  // Save new Bus registration to Firestore
  public async syncBusRegistration(bus: BusRegistration): Promise<void> {
    try {
      const busRef = doc(db, 'buses', bus.id);
      await setDoc(busRef, {
        id: bus.id,
        busNumber: bus.busNumber,
        normalizedBusNumber: bus.normalizedBusNumber,
        modelNumber: bus.modelNumber,
        frontPhotoUrl: bus.frontPhotoUrl,
        assignedRouteId: bus.assignedRouteId,
        routeNumber: bus.routeNumber,
        ownerUid: bus.ownerUid,
        ownerName: bus.ownerName,
        ownerPhone: bus.ownerPhone,
        approvalStatus: bus.approvalStatus,
        appliedAt: bus.appliedAt,
        crew: bus.crew,
        subscription: bus.subscription,
        isActive: bus.isActive,
      }, { merge: true });
    } catch (error) {
      console.warn('Could not sync bus to Firestore (using offline cache):', error);
    }
  }

  // Save or update Route in Firestore
  public async syncRoute(route: BusRoute): Promise<void> {
    try {
      const routeRef = doc(db, 'routes', route.id);
      await setDoc(routeRef, {
        id: route.id,
        routeNumber: route.routeNumber,
        name: route.name,
        origin: route.origin,
        destination: route.destination,
        category: route.category,
        color: route.color,
        firstBus: route.firstBus,
        lastBus: route.lastBus,
        frequencyMins: route.frequencyMins,
        fareStartingInr: route.fareStartingInr,
        stops: route.stops,
        isActive: route.isActive,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (error) {
      console.warn('Could not sync route to Firestore (using offline cache):', error);
    }
  }

  // Delete Route in Firestore
  public async deleteRoute(routeId: string): Promise<void> {
    try {
      const routeRef = doc(db, 'routes', routeId);
      await deleteDoc(routeRef);
    } catch (error) {
      console.warn('Could not delete route from Firestore:', error);
    }
  }

  // Delete User Profile in Firestore
  public async deleteUserProfile(uid: string): Promise<void> {
    try {
      const profileRef = doc(db, 'profiles', uid);
      await deleteDoc(profileRef);
    } catch (error) {
      console.warn('Could not delete user profile from Firestore:', error);
    }
  }

  // Delete Bus in Firestore
  public async deleteBusRegistration(busId: string): Promise<void> {
    try {
      const busRef = doc(db, 'buses', busId);
      await deleteDoc(busRef);
    } catch (error) {
      console.warn('Could not delete bus registration from Firestore:', error);
    }
  }

  // Update Bus Photo in Firestore (invoked when driver or conductor uploads/deletes their bus photo)
  public async updateBusPhoto(busId: string, photoUrl: string): Promise<void> {
    try {
      const busRef = doc(db, 'buses', busId);
      await setDoc(
        busRef,
        {
          frontPhotoUrl: photoUrl,
          photoUpdatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (error) {
      console.warn('Could not update bus photo in Firestore:', error);
    }
  }
}

export const firestoreSync = FirestoreSyncService.getInstance();

export interface StorageUploadProgress {
  progressPercent: number;
  bytesTransferred: number;
  totalBytes: number;
  state: 'running' | 'paused' | 'success' | 'error';
}

/**
 * Universal file uploader to Firebase Storage with live progress callback
 */
export async function uploadFileToStorage(
  file: File,
  storagePath: string,
  onProgress?: (p: StorageUploadProgress) => void
): Promise<string> {
  const sanitizedPath = storagePath.replace(/^\/+/, '');
  const fileRef = sRef(storage, sanitizedPath);
  const metadata = {
    contentType: file.type || 'image/jpeg',
    customMetadata: {
      originalName: file.name,
      uploadedAt: new Date().toISOString(),
      app: 'Linebazar Kolkata Transit',
    },
  };

  try {
    if (onProgress) {
      const uploadTask = uploadBytesResumable(fileRef, file, metadata);
      return await new Promise<string>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const pct = snapshot.totalBytes > 0
              ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
              : 0;
            onProgress({
              progressPercent: pct,
              bytesTransferred: snapshot.bytesTransferred,
              totalBytes: snapshot.totalBytes,
              state: snapshot.state as any,
            });
          },
          (error) => {
            console.error('Firebase Storage upload error:', error);
            onProgress({
              progressPercent: 0,
              bytesTransferred: 0,
              totalBytes: file.size,
              state: 'error',
            });
            reject(error);
          },
          async () => {
            const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
            onProgress({
              progressPercent: 100,
              bytesTransferred: file.size,
              totalBytes: file.size,
              state: 'success',
            });
            // Automatically log file in userFiles collection for Admin visibility
            await recordUserFile({
              fileName: file.name,
              downloadUrl,
              storagePath,
              contentType: file.type || 'application/octet-stream',
              sizeBytes: file.size,
              fileCategory: storagePath.includes('avatar') ? 'avatar' : storagePath.includes('bus') ? 'vehicle_photo' : 'document',
            }).catch(() => {});
            resolve(downloadUrl);
          }
        );
      });
    } else {
      const snapshot = await uploadBytes(fileRef, file, metadata);
      const downloadUrl = await getDownloadURL(snapshot.ref);
      await recordUserFile({
        fileName: file.name,
        downloadUrl,
        storagePath,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        fileCategory: storagePath.includes('avatar') ? 'avatar' : storagePath.includes('bus') ? 'vehicle_photo' : 'document',
      }).catch(() => {});
      return downloadUrl;
    }
  } catch (err) {
    console.warn('Firebase Storage upload failed, utilizing temporary object URL:', err);
    // Return object URL as transparent client fallback if offline or storage blocked
    return URL.createObjectURL(file);
  }
}

export async function recordUserFile(fileData: Partial<UserFileRecord>): Promise<void> {
  try {
    const fileId = fileData.id || `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const userDocRef = doc(db, 'userFiles', fileId);
    const currentUser = auth.currentUser;
    const newRecord: UserFileRecord = {
      id: fileId,
      userId: fileData.userId || currentUser?.uid || 'anonymous',
      userEmail: fileData.userEmail || currentUser?.email || '',
      userPhone: fileData.userPhone || currentUser?.phoneNumber || '',
      fileName: fileData.fileName || 'file',
      downloadUrl: fileData.downloadUrl || '',
      storagePath: fileData.storagePath || '',
      contentType: fileData.contentType || 'application/octet-stream',
      sizeBytes: fileData.sizeBytes || 0,
      fileCategory: fileData.fileCategory || 'document',
      uploadedAt: fileData.uploadedAt || new Date().toISOString(),
    };
    await setDoc(userDocRef, newRecord, { merge: true });
  } catch (e) {
    console.warn('Could not register file in userFiles collection:', e);
  }
}

export async function uploadBusPhotoToStorage(file: File, busId: string): Promise<string> {
  const safeBusId = busId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `bus_photos/${safeBusId}/${Date.now()}_${cleanFileName}`;
  return uploadFileToStorage(file, path);
}

export async function broadcastLiveGpsToRTDB(busId: string, locationData: any): Promise<void> {
  try {
    const busLocRef = dbRef(rtdb, `liveLocations/${busId}`);
    await set(busLocRef, {
      ...locationData,
      updatedAt: Date.now(),
    });
  } catch (e) {
    // RTDB fallback
  }
}

export async function removeLiveGpsFromRTDB(busId: string): Promise<void> {
  try {
    const busLocRef = dbRef(rtdb, `liveLocations/${busId}`);
    await remove(busLocRef);
  } catch (e) {
    // RTDB fallback
  }
}
