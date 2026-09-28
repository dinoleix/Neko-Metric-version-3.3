import type { User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { LoginActivityRecord, UserProfile } from './types';

const SESSION_KEY = 'neko-login-activity-user';

const locationStatusFor = (error: GeolocationPositionError): LoginActivityRecord['locationStatus'] =>
  error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable';

/** Records at most once per browser tab session and never prevents sign-in. */
export const recordLoginActivity = async (user: User, profile: UserProfile): Promise<void> => {
  if (sessionStorage.getItem(SESSION_KEY) === user.uid) return;

  const ownerId = profile.ownerId || user.uid;
  const activityId = `${user.uid}_${Date.now()}_${crypto.randomUUID()}`;
  const base = {
    userId: user.uid,
    ownerId,
    email: user.email || profile.email || '',
    role: profile.role,
    ...(profile.assignedOutlet ? { assignedOutlet: profile.assignedOutlet } : {}),
    loggedInAt: serverTimestamp(),
  };

  const save = async (location: Pick<LoginActivityRecord, 'locationStatus' | 'latitude' | 'longitude' | 'accuracyMeters'>) => {
    await setDoc(doc(db, 'login_activity', activityId), { ...base, ...location });
    sessionStorage.setItem(SESSION_KEY, user.uid);
  };

  try {
    if (!navigator.geolocation) {
      await save({ locationStatus: 'unsupported' });
      return;
    }

    await new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        position => {
          void save({
            locationStatus: 'available',
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: Math.round(position.coords.accuracy),
          }).finally(resolve);
        },
        error => {
          void save({ locationStatus: locationStatusFor(error) }).finally(resolve);
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
      );
    });
  } catch (error) {
    console.warn('[login activity] could not save login:', error);
  }
};

export const clearLoginActivitySession = (): void => {
  sessionStorage.removeItem(SESSION_KEY);
};
