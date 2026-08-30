import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { colors, space, fontSize, fontWeight, radii } from '@aziru/tokens';
import type { ApiClient } from '@aziru/api-client';
import { SheetLayout } from './SheetLayout';
import { FormInput } from './FormInput';

type Props = {
  visible: boolean;
  onClose: () => void;
  workspaceId: string;
  client: ApiClient;
  emails: string[];
  onChange: (emails: string[]) => void;
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function BlacklistSheet({ visible, onClose, workspaceId, client, emails, onChange }: Props) {
  const { i18n } = useLingui();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const inputRef = useRef(null);

  // Reset transient input state each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setInput('');
    setError(null);
  }, [visible]);

  async function handleAdd() {
    const email = input.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setError(i18n._(msg`Enter a valid email address.`));
      return;
    }
    if (emails.includes(email)) {
      setError(i18n._(msg`Already in the list.`));
      return;
    }
    setError(null);
    setAdding(true);
    onChange([...emails, email]);
    setInput('');
    try {
      const updated = await client.addBlacklistedEmail(workspaceId, email);
      onChange(updated.blacklistedSenderEmails);
    } catch {
      onChange(emails.filter((e) => e !== email));
      setError(i18n._(msg`Could not add email. Please try again.`));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(email: string) {
    setRemovingEmail(email);
    const previous = emails;
    onChange(emails.filter((e) => e !== email));
    try {
      const updated = await client.removeBlacklistedEmail(workspaceId, email);
      onChange(updated.blacklistedSenderEmails);
    } catch {
      onChange(previous);
    } finally {
      setRemovingEmail(null);
    }
  }

  return (
    <SheetLayout visible={visible} onClose={onClose} title={i18n._(msg`Sender blacklist`)} keyboardAvoiding>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.hint}>
          <Trans>Threads from these senders will never be imported or sorted by Aziru.</Trans>
        </Text>

        <View style={styles.inputRow}>
          <FormInput
            ref={inputRef}
            style={styles.inputFlex}
            value={input}
            onChangeText={(v) => { setInput(v); setError(null); }}
            placeholder="sender@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="done"
            onSubmitEditing={() => void handleAdd()}
            editable={!adding}
          />
          <TouchableOpacity
            style={[styles.addBtn, (adding || input.trim() === '') && styles.btnDisabled]}
            onPress={() => void handleAdd()}
            disabled={adding || input.trim() === ''}
          >
            {adding ? (
              <ActivityIndicator size="small" color={colors.surface} />
            ) : (
              <Text style={styles.addBtnText}><Trans>Add</Trans></Text>
            )}
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {emails.length > 0 ? (
          <View style={styles.pillsWrap}>
            {emails.map((email) => (
              <View key={email} style={styles.pill}>
                <Text style={styles.pillEmail} numberOfLines={1}>{email}</Text>
                <TouchableOpacity
                  onPress={() => void handleRemove(email)}
                  disabled={removingEmail === email}
                  style={styles.pillRemove}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {removingEmail === email ? (
                    <ActivityIndicator size="small" color={colors.ink4} />
                  ) : (
                    <Ionicons name="close" size={14} color={colors.ink3} />
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}><Trans>No senders blocked yet.</Trans></Text>
        )}
      </ScrollView>
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.xl,
    flexShrink: 1,
  },
  bodyContent: {
    paddingVertical: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
  inputRow: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
  },
  inputFlex: {
    flex: 1,
    fontSize: fontSize.md,
  },
  addBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  addBtnText: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.danger,
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSunk,
    borderRadius: radii.full,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    gap: space.xs,
    maxWidth: '100%',
  },
  pillEmail: {
    fontSize: fontSize.sm,
    color: colors.ink2,
    flexShrink: 1,
  },
  pillRemove: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
});
