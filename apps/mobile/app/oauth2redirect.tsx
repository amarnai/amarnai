import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

// Close the Chrome Custom Tab as early as possible so promptAsync() resolves.
WebBrowser.maybeCompleteAuthSession();

export default function OAuthRedirectScreen() {
  useEffect(() => {
    // Navigate back to sign-in so it can show the loading/error state.
    if (router.canGoBack()) router.back();
  }, []);
  return <View />;
}
