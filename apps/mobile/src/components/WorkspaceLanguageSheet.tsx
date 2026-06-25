import { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, fontSize } from '@amarnai/tokens';
import type { ApiClient } from '@amarnai/api-client';
import { SUPPORTED_LOCALES, LOCALE_DISPLAY_NAMES, type SupportedLocale } from '@amarnai/i18n';
import { SheetLayout } from './SheetLayout';
import { toUserMessage } from '../errors';

type Props = {
  visible: boolean;
  onClose: () => void;
  workspaceId: string;
  client: ApiClient;
  currentLocale: string;
  // Re-fetch workspaces so the new language takes effect (drives UI + taxonomy).
  onChanged: () => void | Promise<void>;
};

// Owner-only picker for the workspace language. Changing it updates the UI for
// everyone in the workspace and the language of the next AI taxonomy generation.
export function WorkspaceLanguageSheet({
  visible,
  onClose,
  workspaceId,
  client,
  currentLocale,
  onChanged,
}: Props) {
  const [saving, setSaving] = useState<SupportedLocale | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function select(locale: SupportedLocale) {
    if (saving || locale === currentLocale) return;
    setSaving(locale);
    setError(null);
    try {
      await client.updateWorkspace(workspaceId, { locale });
      await onChanged();
      onClose();
    } catch (err) {
      setError(toUserMessage(err, 'Could not change the language. Please try again.'));
    } finally {
      setSaving(null);
    }
  }

  return (
    <SheetLayout visible={visible} onClose={onClose} title="Language" handle>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <FlatList
        style={styles.list}
        data={SUPPORTED_LOCALES}
        keyExtractor={(l) => l}
        renderItem={({ item }) => {
          const isCurrent = item === currentLocale;
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => void select(item)}
              disabled={!!saving}
            >
              <Text style={styles.rowText} numberOfLines={1}>
                {LOCALE_DISPLAY_NAMES[item]}
              </Text>
              {isCurrent ? <Ionicons name="checkmark" size={20} color={colors.accent} /> : null}
            </TouchableOpacity>
          );
        }}
      />
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  list: {
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  rowText: {
    flex: 1,
    fontSize: fontSize.lg,
    color: colors.ink,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.danger,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
});
