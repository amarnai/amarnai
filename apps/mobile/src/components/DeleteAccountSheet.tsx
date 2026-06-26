import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, space, fontSize } from '@amarnai/tokens';
import type { ApiClient } from '@amarnai/api-client';
import { SheetLayout } from './SheetLayout';
import { FormInput } from './FormInput';
import { PrimaryButton } from './PrimaryButton';
import { toUserMessage } from '../errors';

type Props = {
  visible: boolean;
  onClose: () => void;
  client: ApiClient;
  // Called after the account is deleted server-side, to tear down the session.
  onDeleted: () => void | Promise<void>;
};

// Step-up confirmation for password-based accounts: the server requires the
// current password before deleting. (Federated accounts skip this sheet and use
// the plain confirm dialog instead.)
export function DeleteAccountSheet({ visible, onClose, client, onDeleted }: Props) {
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPassword('');
    setError(null);
  }, [visible]);

  async function handleDelete() {
    if (!password || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await client.deleteMe(password);
      await onDeleted();
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete account. Check your password and try again.'));
      setDeleting(false);
    }
  }

  return (
    <SheetLayout visible={visible} onClose={onClose} title="Delete account" keyboardAvoiding>
      <View style={styles.body}>
        <Text style={styles.warning}>
          This permanently deletes your account and all associated data. Enter your password to
          confirm.
        </Text>
        <FormInput
          value={password}
          onChangeText={(v) => { setPassword(v); setError(null); }}
          placeholder="Current password"
          secureTextEntry
          autoCapitalize="none"
          editable={!deleting}
          returnKeyType="done"
          onSubmitEditing={() => void handleDelete()}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <PrimaryButton
          label="Delete account"
          onPress={() => void handleDelete()}
          disabled={!password}
          loading={deleting}
          style={{ backgroundColor: colors.danger }}
        />
      </View>
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  warning: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.danger,
  },
});
