import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ApiClient } from '@aziru/api-client';
import { registerNotificationCategories } from './categories';

// Show triage pushes while the app is foregrounded (otherwise Expo silently
// drops them). Set once at module load. shouldShowBanner/shouldShowList replace
// the deprecated shouldShowAlert in expo-notifications (SDK 53+).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function resolveProjectId(): string | undefined {
  // EAS injects the project id here; getExpoPushTokenAsync requires it.
  const eas = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas;
  return eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Registers this device for push and sends the Expo token to the API via
 * POST /devices (through the injected, authenticated client). Returns the token
 * on success, or null when push is unavailable (simulator, denied permission,
 * missing project id) — callers treat null as "push not set up" and move on.
 *
 * Call this after sign-in, when the client carries a valid bearer token.
 */
export async function registerForPushNotifications(client: ApiClient): Promise<string | null> {
  // Push tokens are only issued on physical devices; emulators have no FCM token.
  if (!Device.isDevice) return null;

  await registerNotificationCategories();

  let status = (await Notifications.getPermissionsAsync()).status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  const projectId = resolveProjectId();
  if (!projectId) {
    console.warn('[push] No EAS projectId — cannot obtain an Expo push token');
    return null;
  }

  const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId });

  await client.registerPushDevice({
    expoPushToken,
    platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
  });

  return expoPushToken;
}
