import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { useSession } from '../../../src/auth/session';
import { useTriage } from '../../../src/triage/TriageProvider';
import { useThreadBodies, useThreadDetail } from '../../../src/data/queries';
import { RationaleCard } from '../../../src/components/RationaleCard';
import { MessageCard } from '../../../src/components/MessageCard';
import { RerouteSheet } from '../../../src/components/RerouteSheet';
import { Toast } from '../../../src/components/Toast';

export default function ThreadDetailScreen() {
  const router = useRouter();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { workspaceId } = useSession();
  const triage = useTriage();
  const { setSelectedId } = triage;

  const [sheetOpen, setSheetOpen] = useState(false);

  // Drive the shared selection from the route param so the screen is self-contained
  // (works via deep link or back navigation, not only a list tap).
  useEffect(() => {
    setSelectedId(threadId);
  }, [threadId, setSelectedId]);

  // Read the thread directly from the view-model by id so it renders before the
  // selectedId state settles, and stays live through optimistic mutations.
  const thread = triage.threads.find((t) => t.id === threadId) ?? null;

  const bodiesQuery = useThreadBodies(workspaceId ?? '', threadId);
  const detailQuery = useThreadDetail(workspaceId ?? '', threadId);

  const explanation = detailQuery.data?.latestClassification?.explanation ?? null;

  // Merge fetched bodies into the view-model's message metadata.
  const messages = useMemo(() => {
    if (!thread) return [];
    const bodies = bodiesQuery.data?.bodies;
    if (!bodies) return thread.messages;
    return thread.messages.map((m) =>
      m.id in bodies ? { ...m, bodyText: bodies[m.id] ?? null } : m,
    );
  }, [thread, bodiesQuery.data]);

  if (!thread) {
    return (
      <View style={styles.container}>
        <Header onBack={() => router.back()} title="Thread" />
        <View style={styles.center}>
          <Text style={styles.empty}>Thread not found</Text>
        </View>
      </View>
    );
  }

  const isDone = !!thread.doneMark;

  const handleMoveOpen = () => {
    triage.openRerouteFor(thread.id);
    setSheetOpen(true);
  };
  const handleMoveSelect = (folderId: string) => {
    triage.commitReroute(folderId);
    setSheetOpen(false);
  };
  const handleMoveClose = () => {
    triage.closeReroute();
    setSheetOpen(false);
  };

  return (
    <View style={styles.container}>
      <Header onBack={() => router.back()} title={thread.subject} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.doneBar}>
          {isDone ? (
            <TouchableOpacity
              style={styles.doneBtnActive}
              onPress={() => triage.handleUnmarkDone(thread.id)}
            >
              <Text style={styles.doneBtnActiveText}>Done · undo</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => triage.handleMarkDone(thread.id)}
            >
              <Text style={styles.doneBtnText}>Mark done</Text>
            </TouchableOpacity>
          )}
        </View>

        <RationaleCard
          thread={thread}
          folders={triage.folders}
          explanation={explanation}
          onApprove={() => triage.handleApprove(thread.id)}
          onReroute={handleMoveOpen}
        />

        {messages.map((msg, idx) => (
          <MessageCard
            key={msg.id}
            message={msg}
            defaultExpanded={idx === messages.length - 1}
            loading={bodiesQuery.isLoading}
          />
        ))}
      </ScrollView>

      <RerouteSheet
        visible={sheetOpen}
        folders={triage.folders}
        currentFolderId={thread.folderId}
        onSelect={handleMoveSelect}
        onClose={handleMoveClose}
      />

      <Toast
        toast={triage.toast}
        onUndo={() => {
          triage.toast?.onUndo?.();
          triage.dismissToast();
        }}
        onDismiss={triage.dismissToast}
      />
    </View>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.back} onPress={onBack} hitSlop={8}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
    gap: space.lg,
  },
  back: {
    paddingVertical: space.xxs,
  },
  backText: {
    fontSize: fontSize.lg,
    color: colors.accent,
    fontWeight: fontWeight.medium,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
    flex: 1,
  },
  scrollContent: {
    paddingBottom: space.xxl * 3,
  },
  doneBar: {
    flexDirection: 'row',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
  },
  doneBtn: {
    borderWidth: 1,
    borderColor: colors.okLine,
    borderRadius: radii.full,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  doneBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.okInk,
  },
  doneBtnActive: {
    backgroundColor: colors.okSoft,
    borderRadius: radii.full,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  doneBtnActiveText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.okInk,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
});
