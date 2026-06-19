import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import { UserAvatar } from './UserAvatar';

type Member = {
  id: string;
  role: string;
  user: { id: string; email: string; name: string | null };
};

type Props = {
  visible: boolean;
  onClose: () => void;
  members: Member[];
  currentUserId: string | null;
};

// OWNER first, then the rest in their existing order.
function sortMembers(members: Member[]): Member[] {
  return [...members].sort((a, b) => {
    if (a.role === 'OWNER' && b.role !== 'OWNER') return -1;
    if (a.role !== 'OWNER' && b.role === 'OWNER') return 1;
    return 0;
  });
}

export function CollaboratorsSheet({ visible, onClose, members, currentUserId }: Props) {
  const sorted = sortMembers(members);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Collaborators</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {sorted.map((member) => {
              const isYou = member.user.id === currentUserId;
              const isOwner = member.role === 'OWNER';
              return (
                <View key={member.id} style={styles.memberRow}>
                  <UserAvatar name={member.user.name} email={member.user.email} />
                  <View style={styles.memberText}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {member.user.name ?? member.user.email}
                      {isYou ? ' (You)' : ''}
                    </Text>
                    {member.user.name ? (
                      <Text style={styles.memberEmail} numberOfLines={1}>
                        {member.user.email}
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.roleBadge, isOwner ? styles.roleBadgeOwner : styles.roleBadgeMember]}>
                    <Text style={[styles.roleText, isOwner ? styles.roleTextOwner : styles.roleTextMember]}>
                      {isOwner ? 'Admin' : 'Member'}
                    </Text>
                  </View>
                </View>
              );
            })}

            <Text style={styles.note}>
              Invite and remove collaborators on the web app.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  close: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
  body: {
    paddingHorizontal: space.xl,
  },
  bodyContent: {
    paddingVertical: space.lg,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  memberText: {
    flex: 1,
    minWidth: 0,
  },
  memberName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.ink,
  },
  memberEmail: {
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
  roleBadge: {
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xxs,
  },
  roleBadgeOwner: {
    backgroundColor: colors.accentSoft,
  },
  roleBadgeMember: {
    backgroundColor: colors.bgSunk,
  },
  roleText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  roleTextOwner: {
    color: colors.accentInk,
  },
  roleTextMember: {
    color: colors.ink3,
  },
  note: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
});
