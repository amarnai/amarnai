import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { formatQuotaResetDate } from '@amarnai/shared';
import { useSession } from '../../../src/auth/session';
import { useTriage } from '../../../src/triage/TriageProvider';
import { useThreadBodies, useThreadDetail, useGmailConnection } from '../../../src/data/queries';
import { useThreadDraft } from '../../../src/data/useThreadDraft';
import { RationaleCard } from '../../../src/components/RationaleCard';
import { MessageCard } from '../../../src/components/MessageCard';
import { RerouteSheet } from '../../../src/components/RerouteSheet';
import { AssigneeSheet } from '../../../src/components/AssigneeSheet';
import { DraftSheet } from '../../../src/components/DraftSheet';
import { Toast } from '../../../src/components/Toast';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { CenterView } from '../../../src/components/CenterView';
import { BackHeader } from '../../../src/components/BackHeader';

export default function ThreadDetailScreen() {
  const router = useRouter();
  const { i18n } = useLingui();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { workspaceId, workspaces } = useSession();
  const triage = useTriage();
  const { setSelectedId } = triage;
  const { bottom } = useSafeAreaInsets();

  const [rerouteOpen, setRerouteOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [draftSheetOpen, setDraftSheetOpen] = useState(false);

  // Members of the active workspace drive the assignee picker. Assignment is
  // offered only when there is more than one member.
  const members = useMemo(() => {
    const ws = workspaces.find((w) => w.id === workspaceId);
    return (ws?.members ?? []).map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
    }));
  }, [workspaces, workspaceId]);
  const canAssign = members.length >= 2;

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
  const gmailQuery = useGmailConnection(workspaceId ?? '');

  const explanation = detailQuery.data?.latestClassification?.explanation ?? null;
  const gmailAddress = gmailQuery.data?.gmailAddress ?? null;

  const { draftState, draft, quota, generate, regenerate, toggleSent } = useThreadDraft(thread);

  // Merge fetched bodies and attachment metadata into the view-model messages.
  const messages = useMemo(() => {
    if (!thread) return [];
    const bodies = bodiesQuery.data?.bodies;
    const attachmentMap = detailQuery.data
      ? new Map(detailQuery.data.messages.map((m) => [m.id, m.attachments]))
      : null;
    return thread.messages.map((m) => {
      const withBody = bodies && m.id in bodies ? { ...m, bodyText: bodies[m.id] ?? null } : m;
      const att = attachmentMap?.get(m.id);
      return att?.length ? { ...withBody, attachments: att } : withBody;
    });
  }, [thread, bodiesQuery.data, detailQuery.data]);

  if (!thread) {
    return (
      <ScreenContainer>
        <BackHeader onBack={() => router.back()} title={i18n._(msg`Thread`)} />
        <CenterView>
          <Text style={styles.empty}><Trans>Thread not found</Trans></Text>
        </CenterView>
      </ScreenContainer>
    );
  }

  const isDone = !!thread.doneMark;

  // Mirror the web canDraft logic: thread must be sorted and last message must
  // not be from the connected mailbox.
  const lastMessage = thread.messages[thread.messages.length - 1];
  const lastMsgIsOwn =
    !!gmailAddress &&
    !!lastMessage?.fromEmail &&
    lastMessage.fromEmail.toLowerCase() === gmailAddress.toLowerCase();
  // Gate on the Gmail query having settled: while it loads, gmailAddress is null
  // and lastMsgIsOwn is falsely false, which would briefly show (and allow a tap
  // on) the draft bar for threads whose last message the user sent.
  const canDraft = gmailQuery.isFetched && thread.status !== 'unsorted' && !lastMsgIsOwn;

  const quotaExhausted = quota != null && quota.used >= quota.limit;
  const draftResetDate = quota ? formatQuotaResetDate(quota.resetsAt) : '';
  const draftRemaining = quota ? quota.limit - quota.used : 0;
  const draftLimit = quota?.limit ?? 0;

  const handleMoveOpen = () => {
    triage.openRerouteFor(thread.id);
    setRerouteOpen(true);
  };
  const handleMoveSelect = (folderId: string) => {
    triage.commitReroute(folderId);
    setRerouteOpen(false);
  };
  const handleMoveClose = () => {
    triage.closeReroute();
    setRerouteOpen(false);
  };

  function handleDraftCopied() {
    triage.showToast({ message: i18n._(msg`Draft shared`) });
  }

  function renderDraftBar() {
    if (!canDraft) return null;

    if (draftState === 'idle') {
      return (
        <TouchableOpacity
          style={[styles.draftBar, quotaExhausted && styles.draftBarDisabled]}
          onPress={quotaExhausted ? undefined : () => generate()}
          disabled={quotaExhausted}
          activeOpacity={0.8}
        >
          <View style={styles.draftBarInner}>
            <Text style={[styles.draftBarText, quotaExhausted && styles.draftBarTextDisabled]}>
              {quotaExhausted ? (
                <Trans>No drafts remaining</Trans>
              ) : (
                <Trans>Generate draft reply</Trans>
              )}
            </Text>
            {quota != null && !quotaExhausted && (
              <Text style={styles.draftBarSub}>
                <Trans>{draftRemaining} of {draftLimit} left · resets {draftResetDate}</Trans>
              </Text>
            )}
            {quotaExhausted && quota != null && (
              <Text style={styles.draftBarSub}>
                <Trans>Resets {draftResetDate}</Trans>
              </Text>
            )}
          </View>
        </TouchableOpacity>
      );
    }

    if (draftState === 'loading') {
      return (
        <View style={[styles.draftBar, styles.draftBarLoading]}>
          <ActivityIndicator size="small" color={colors.accent} style={styles.draftBarSpinner} />
          <Text style={styles.draftBarTextMuted}><Trans>Writing draft reply…</Trans></Text>
        </View>
      );
    }

    if (draftState === 'error') {
      return (
        <TouchableOpacity
          style={[styles.draftBar, styles.draftBarError]}
          onPress={() => generate()}
          activeOpacity={0.8}
        >
          <Text style={styles.draftBarTextError}><Trans>Draft failed · tap to retry</Trans></Text>
        </TouchableOpacity>
      );
    }

    if (draftState === 'ready' && draft) {
      return (
        <TouchableOpacity
          style={[styles.draftBar, styles.draftBarReady]}
          onPress={() => setDraftSheetOpen(true)}
          activeOpacity={0.8}
        >
          <View style={styles.draftBarDot} />
          <Text style={styles.draftBarTextAccent}><Trans>View draft reply</Trans></Text>
        </TouchableOpacity>
      );
    }

    return null;
  }

  return (
    <ScreenContainer>
      <BackHeader onBack={() => router.back()} title={thread.subject} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.doneBar}>
          {isDone ? (
            <TouchableOpacity
              style={styles.doneBtnActive}
              onPress={() => triage.handleUnmarkDone(thread.id)}
            >
              <Text style={styles.doneBtnActiveText}><Trans>Done · undo</Trans></Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => triage.handleMarkDone(thread.id)}
            >
              <Text style={styles.doneBtnText}><Trans>Mark done</Trans></Text>
            </TouchableOpacity>
          )}
          {thread.assignment ? (
            <TouchableOpacity
              style={styles.assignBtnActive}
              onPress={() => canAssign && setAssigneeOpen(true)}
              disabled={!canAssign}
            >
              <Text style={styles.assignBtnActiveText} numberOfLines={1}>
                {thread.assignment.userName ?? thread.assignment.userEmail}
              </Text>
            </TouchableOpacity>
          ) : canAssign ? (
            <TouchableOpacity style={styles.assignBtn} onPress={() => setAssigneeOpen(true)}>
              <Text style={styles.assignBtnText}><Trans>Assign</Trans></Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.starBtn, thread.isImportant && styles.starBtnActive]}
            onPress={() => triage.handleToggleImportant(thread.id)}
            accessibilityRole="button"
            accessibilityLabel={
              thread.isImportant
                ? i18n._(msg`Remove from important`)
                : i18n._(msg`Mark as important`)
            }
            accessibilityState={{ selected: thread.isImportant }}
          >
            <Ionicons
              name={thread.isImportant ? 'star' : 'star-outline'}
              size={18}
              color={thread.isImportant ? colors.accent : colors.ink3}
            />
          </TouchableOpacity>
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

      {/* Sticky draft action bar — pinned above the safe-area bottom */}
      {canDraft && (
        <View style={[styles.draftBarWrap, { paddingBottom: bottom || space.md }]}>
          {renderDraftBar()}
        </View>
      )}

      <RerouteSheet
        visible={rerouteOpen}
        folders={triage.folders}
        currentFolderId={thread.folderId}
        onSelect={handleMoveSelect}
        onClose={handleMoveClose}
      />

      <AssigneeSheet
        visible={assigneeOpen}
        members={members}
        currentAssigneeId={thread.assignment?.userId ?? null}
        onSelect={(userId) => {
          const member = userId ? members.find((m) => m.userId === userId) ?? null : null;
          triage.handleAssign(thread.id, member);
          setAssigneeOpen(false);
        }}
        onClose={() => setAssigneeOpen(false)}
      />

      {draftState === 'ready' && draft && (
        <DraftSheet
          visible={draftSheetOpen}
          onClose={() => setDraftSheetOpen(false)}
          draft={draft}
          quota={quota}
          providerThreadId={thread.providerThreadId}
          onToggleSent={toggleSent}
          onRegenerate={() => {
            setDraftSheetOpen(false);
            regenerate();
          }}
          onCopied={handleDraftCopied}
        />
      )}

      <Toast
        toast={triage.toast}
        onUndo={() => {
          triage.toast?.onUndo?.();
          triage.dismissToast();
        }}
        onDismiss={triage.dismissToast}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: space.xxl * 3,
  },
  doneBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
  },
  starBtn: {
    marginLeft: 'auto',
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.full,
    padding: space.sm,
  },
  starBtnActive: {
    borderColor: colors.accentLine,
    backgroundColor: colors.accentSoft,
  },
  assignBtn: {
    borderWidth: 1,
    borderColor: colors.accentLine,
    borderRadius: radii.full,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  assignBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.accentInk,
  },
  assignBtnActive: {
    backgroundColor: colors.accentSoft,
    borderRadius: radii.full,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    flexShrink: 1,
  },
  assignBtnActiveText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.accentInk,
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
  empty: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },

  // ── Draft bar ────────────────────────────────────────────────────────────────
  draftBarWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.line2,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    backgroundColor: colors.bg,
  },
  draftBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    backgroundColor: colors.tealSoft,
  },
  draftBarInner: {
    alignItems: 'center',
    gap: space.xxs,
  },
  draftBarLoading: {
    backgroundColor: colors.bgSunk,
    flexDirection: 'row',
    gap: space.sm,
  },
  draftBarError: {
    backgroundColor: colors.dangerSoft,
  },
  draftBarReady: {
    backgroundColor: colors.okSoft,
    flexDirection: 'row',
    gap: space.sm,
  },
  draftBarDisabled: {
    backgroundColor: colors.bgSunk,
  },
  draftBarDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.ok,
  },
  draftBarSpinner: {
    marginRight: space.xs,
  },
  draftBarText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.tealInk,
  },
  draftBarTextMuted: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.ink3,
  },
  draftBarTextError: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.dangerInk,
  },
  draftBarTextAccent: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.okInk,
  },
  draftBarTextDisabled: {
    color: colors.ink4,
  },
  draftBarSub: {
    fontSize: fontSize.xs,
    color: colors.ink4,
  },
});
