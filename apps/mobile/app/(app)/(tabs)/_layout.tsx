import { Tabs } from 'expo-router';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { colors } from '@aziru/tokens';
import { NavIcon } from '../../../src/components/NavIcon';

export default function TabsLayout() {
  const { i18n } = useLingui();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.ink4,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.line,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="emails/index"
        options={{
          title: i18n._(msg`Emails`),
          tabBarIcon: ({ color, focused }) => <NavIcon name="emails" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="plan/index"
        options={{
          title: i18n._(msg`Plan`),
          tabBarIcon: ({ color, focused }) => <NavIcon name="taxonomy" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings/index"
        options={{
          title: i18n._(msg`Settings`),
          tabBarIcon: ({ color, focused }) => <NavIcon name="settings" color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
