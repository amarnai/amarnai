import { Tabs } from 'expo-router';
import { colors } from '@amarnai/tokens';
import { NavIcon } from '../../../src/components/NavIcon';

export default function TabsLayout() {
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
          title: 'Emails',
          tabBarIcon: ({ color, focused }) => <NavIcon name="emails" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="taxonomy/index"
        options={{
          title: 'Taxonomy',
          tabBarIcon: ({ color, focused }) => <NavIcon name="taxonomy" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings/index"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => <NavIcon name="settings" color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
