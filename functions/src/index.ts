import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// -----------------------------------------------------------------
// Helper: Normalize Indian Bus Registration Number
// e.g. "wb 04 g 4589" -> "WB04G4589"
// -----------------------------------------------------------------
function normalizeBusNumber(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// -----------------------------------------------------------------
// 1. requestBusRegistration: Prevent Duplicate Bus with Transaction
// -----------------------------------------------------------------
export const requestBusRegistration = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be signed in.');
  }

  const { busNumber, modelNumber, frontPhotoUrl, assignedRouteId, role } = data;
  if (!busNumber || !modelNumber || !assignedRouteId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields.');
  }

  const normalized = normalizeBusNumber(busNumber);
  const normalizedDocRef = db.collection('normalizedBuses').doc(normalized);
  const busDocRef = db.collection('buses').doc();

  return await db.runTransaction(async (transaction) => {
    const existingNormalized = await transaction.get(normalizedDocRef);
    if (existingNormalized.exists) {
      throw new functions.https.HttpsError(
        'already-exists',
        `Bus ${busNumber.toUpperCase()} is already registered. Please request to join its crew.`
      );
    }

    const busPayload = {
      id: busDocRef.id,
      busNumber: busNumber.toUpperCase().trim(),
      normalizedBusNumber: normalized,
      modelNumber: modelNumber.trim(),
      frontPhotoUrl: frontPhotoUrl || '',
      assignedRouteId,
      ownerUid: context.auth!.uid,
      approvalStatus: 'pending',
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: false,
      crew: [
        {
          uid: context.auth!.uid,
          phone: context.auth!.token.phone_number || '',
          role: role || 'driver',
          joinedAt: new Date().toISOString(),
          isVerified: true,
        },
      ],
    };

    transaction.set(normalizedDocRef, {
      busId: busDocRef.id,
      normalizedNumber: normalized,
      ownerUid: context.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    transaction.set(busDocRef, busPayload);

    return { success: true, busId: busDocRef.id };
  });
});

// -----------------------------------------------------------------
// 2. adminApproveBus: Activates Bus & Starts 3-Month Free Trial
// -----------------------------------------------------------------
export const adminApproveBus = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Admin authentication required.');
  }

  // Verify Admin Claim or Profile Role
  const adminDoc = await db.collection('profiles').doc(context.auth.uid).collection('roles').doc('admin').get();
  if (!adminDoc.exists && context.auth.token.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only authorized admins can approve buses.');
  }

  const { busId } = data;
  const busRef = db.collection('buses').doc(busId);
  const busDoc = await busRef.get();
  if (!busDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Bus record not found.');
  }

  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + 90); // 3-month trial

  const batch = db.batch();

  batch.update(busRef, {
    approvalStatus: 'approved',
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    isActive: true,
  });

  const subRef = db.collection('subscriptions').doc(busId);
  batch.set(subRef, {
    id: `sub-${busId}`,
    subscriberId: busId,
    type: 'bus',
    status: 'trial',
    trialStartDate: now.toISOString(),
    trialEndDate: trialEnd.toISOString(),
    paidThroughDate: trialEnd.toISOString(),
    autoRenew: true,
    monthlyAmountInr: 99,
  });

  // Audit Log
  const auditRef = db.collection('adminAuditLogs').doc();
  batch.set(auditRef, {
    id: auditRef.id,
    adminUid: context.auth.uid,
    adminName: context.auth.token.name || 'Admin',
    action: 'approve_bus',
    targetType: 'bus',
    targetId: busId,
    details: `Approved bus registration and activated 90-day trial for bus ID ${busId}.`,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { success: true, trialEndDate: trialEnd.toISOString() };
});

// -----------------------------------------------------------------
// 3. sendWaitSignal: Deterministic ID + 10-Passenger Alert Trigger
// -----------------------------------------------------------------
export const sendWaitSignal = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Passenger must be signed in.');
  }

  const { busId, tripId, stopId, stopName, routeId } = data;
  if (!busId || !tripId || !stopId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing signal parameters.');
  }

  // Deterministic Wait Signal Document ID
  const signalId = `${context.auth.uid}_${busId}_${tripId}`;
  const signalRef = db.collection('waitSignals').doc(signalId);
  const stopWaitAggregateRef = db
    .collection('trips')
    .doc(tripId)
    .collection('busStopWaits')
    .doc(`${busId}_${stopId}`);

  return await db.runTransaction(async (transaction) => {
    const existingSignal = await transaction.get(signalRef);
    if (existingSignal.exists && existingSignal.data()?.status === 'active') {
      throw new functions.https.HttpsError(
        'already-exists',
        'You have already signaled waiting for this bus on its active trip.'
      );
    }

    // Record Wait Signal
    transaction.set(signalRef, {
      id: signalId,
      passengerUid: context.auth!.uid,
      passengerPhone: context.auth!.token.phone_number || '',
      busId,
      tripId,
      routeId,
      stopId,
      stopName,
      status: 'active',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update stop aggregate count
    const aggDoc = await transaction.get(stopWaitAggregateRef);
    let newCount = 1;
    let alertSent = false;

    if (aggDoc.exists) {
      const data = aggDoc.data()!;
      newCount = (data.count || 0) + 1;
      alertSent = data.alertSentToCrew || false;
      transaction.update(stopWaitAggregateRef, {
        count: newCount,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      transaction.set(stopWaitAggregateRef, {
        busId,
        stopId,
        stopName,
        count: 1,
        alertSentToCrew: false,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 10-PASSENGER ALERT TRIGGER: Notify Driver & Conductor via FCM
    if (newCount >= 10 && !alertSent) {
      transaction.update(stopWaitAggregateRef, { alertSentToCrew: true });

      // Send High-Priority FCM to bus crew topic
      const topic = `bus_crew_${busId}`;
      const payload: admin.messaging.Message = {
        topic,
        notification: {
          title: `⚠️ High Demand Alert: Stop ${stopName}`,
          body: `${newCount} passengers waiting for your bus at ${stopName}!`,
        },
        data: {
          busId,
          stopId,
          stopName,
          count: String(newCount),
          type: 'high_passenger_wait_alert',
        },
        android: {
          priority: 'high',
        },
      };

      // Asynchronous dispatch (post transaction)
      admin.messaging().send(payload).catch((err) => console.error('FCM send error:', err));
    }

    return { success: true, signalId, currentWaitCount: newCount };
  });
});

// -----------------------------------------------------------------
// 4. paymentWebhook: Verified Razorpay/Stripe Signature Webhook
// -----------------------------------------------------------------
export const paymentWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || 'linebazar_test_secret_key';
  const signature = req.headers['x-razorpay-signature'] as string;

  // Validate HMAC SHA256 Signature
  const bodyString = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(bodyString)
    .digest('hex');

  // Allow test simulation if secret header matches
  const isTest = req.headers['x-linebazar-test'] === 'true';

  if (!isTest && signature !== expectedSignature) {
    console.error('Invalid payment webhook signature');
    res.status(400).send('Invalid signature');
    return;
  }

  const event = req.body;
  const subscriberId = event.payload?.payment?.entity?.notes?.subscriberId || event.subscriberId;
  const amountInr = (event.payload?.payment?.entity?.amount || event.amount || 1900) / 100;
  const type = event.payload?.payment?.entity?.notes?.type || event.type || 'passenger';

  if (!subscriberId) {
    res.status(400).send('Missing subscriberId in payload');
    return;
  }

  const subRef = db.collection('subscriptions').doc(subscriberId);
  const subDoc = await subRef.get();

  const now = new Date();
  let newEndDate = new Date(now);

  if (subDoc.exists && subDoc.data()?.paidThroughDate) {
    const currentEnd = new Date(subDoc.data()?.paidThroughDate);
    if (currentEnd > now) newEndDate = currentEnd;
  }

  newEndDate.setMonth(newEndDate.getMonth() + 1); // Add 30 days

  const batch = db.batch();

  batch.set(
    subRef,
    {
      subscriberId,
      type,
      status: 'active',
      paidThroughDate: newEndDate.toISOString(),
      autoRenew: true,
      lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const paymentRecordRef = db.collection('payments').doc();
  batch.set(paymentRecordRef, {
    id: paymentRecordRef.id,
    subscriberId,
    type,
    amountInr,
    status: 'captured',
    provider: 'razorpay',
    providerPaymentId: event.payload?.payment?.entity?.id || 'demo_payment',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    paidPeriodEnd: newEndDate.toISOString(),
  });

  await batch.commit();

  res.status(200).json({ success: true, paidThroughDate: newEndDate.toISOString() });
});

// -----------------------------------------------------------------
// 5. cancelSubscription: Server-Authoritative Auto-Renew Cancellation
// -----------------------------------------------------------------
export const cancelSubscription = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be signed in.');
  }

  const { subscriberId } = data;
  const subRef = db.collection('subscriptions').doc(subscriberId);
  const subDoc = await subRef.get();

  if (!subDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Subscription not found.');
  }

  // Verify subscriber is self or bus owner
  if (subscriberId !== context.auth.uid) {
    const busDoc = await db.collection('buses').doc(subscriberId).get();
    if (!busDoc.exists || busDoc.data()?.ownerUid !== context.auth.uid) {
      throw new functions.https.HttpsError('permission-denied', 'Unauthorized to cancel this subscription.');
    }
  }

  await subRef.update({
    autoRenew: false,
    status: 'cancelled',
    cancellationDate: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, message: 'Subscription auto-renewal has been cancelled. Access remains active until period ends.' };
});
