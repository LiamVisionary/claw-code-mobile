import DirectoryBrowser from "@/components/DirectoryBrowser";
import FileBrowser from "@/components/FileBrowser";
import SlashCommandPicker from "@/components/SlashCommandPicker";
import { StreamingText } from "@/components/StreamingText";
import TerminalSheet from "@/components/terminal-sheet";
import { GlassButton } from "@/components/ui/GlassButton";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThinkingSprite } from "@/components/ui/ThinkingSprite";
import TouchableBounce from "@/components/ui/TouchableBounce";
import type { Palette } from "@/constants/palette";
import { BORDER_RADIUS, SHADOW, SPACING, TYPOGRAPHY } from "@/constants/theme";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { usePalette } from "@/hooks/usePalette";
import type { Attachment, Message, ModelEntry, PermissionRequest, ThreadStatus, ToolStep } from "@/store/gatewayStore";
import { useGatewayStore } from "@/store/gatewayStore";
import { nanoid } from "@/util/nanoid";
import { cleanModelMarkdown } from "@/utils/markdownCleanup";
import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { GlassView } from "expo-glass-effect";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  FlatList,
  Image,
  Keyboard,

  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Stable empty arrays — prevents Zustand `?? []` from returning a new reference
// on every store update and causing infinite re-renders.
const EMPTY_STEPS: ToolStep[] = [];
const EMPTY_REQS: PermissionRequest[] = [];
const EMPTY_MESSAGES: Message[] = [];

const TOP_BAR_HEIGHT = 52;

type QueuedItem = {
  id: string;
  text: string;
  attachments: Attachment[];
};

const EFFORT_LABEL: Record<"low" | "medium" | "high", string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

// Module-level bridge so HeaderTitle (inside native header) can open
// ModelPickerBar without any React state flowing through Stack.Screen.
let _openModelPicker: (() => void) | null = null;

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const actions = useGatewayStore((s) => s.actions);
  const thread = useGatewayStore((s) =>
    s.threads.find((t) => t.id === id)
  );
  const messageMap = useGatewayStore((s) => s.messages);
  const toolSteps = useGatewayStore((s) => s.toolSteps[id ?? ""] ?? EMPTY_STEPS);
  const rawPermReqs = useGatewayStore((s) => s.permissionRequests[id ?? ""] ?? EMPTY_REQS);
  const isCompacting = useGatewayStore((s) => s.compacting[id ?? ""] ?? false);
  const runPhase = useGatewayStore((s) => s.runPhase[id ?? ""] ?? "idle");
  const permissionReqs = useMemo(
    () => rawPermReqs.filter((r) => r.pending),
    [rawPermReqs]
  );
  const messages = messageMap[id ?? ""] ?? EMPTY_MESSAGES;
  const listRef = useRef<FlatList<Message>>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [slashPickerVisible, setSlashPickerVisible] = useState(false);
  const [copiedConvo, setCopiedConvo] = useState(false);
  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [modePopover, setModePopover] = useState<null | "plan" | "effort">(null);
  /**
   * Horizontal offsets (relative to the composer row) of each mode pill.
   * Captured on layout so the popovers can anchor above the correct pill.
   */
  const [pillX, setPillX] = useState<{ plan?: number; effort?: number }>({});
  /**
   * In-flight uploads keyed by a client id. We track these separately
   * from `pendingAttachments` so the chat can show an instant thumbnail
   * + spinner while the file is being posted to the backend.
   */
  const [uploadingPreviews, setUploadingPreviews] = useState<
    { id: string; localUri: string; name: string; kind: "image" | "file" }[]
  >([]);
  /** URI of the attachment currently being shown in a full-screen overlay. */
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const settings = useGatewayStore((s) => s.settings);

  // Vision capability check for the currently-active model. Drives the
  // disabled state of the Photo library / Camera menu items so users
  // can't send images to a model that would reject them with a 404.
  const activeModel = useMemo(() => {
    const q = (settings.modelQueue ?? []).filter((m) => m.enabled);
    return q[0] ?? null;
  }, [settings.modelQueue]);
  const { supportsImage } = useModelCapabilities(activeModel);
  // Tracks the previous thread status so we can detect idle transitions
  const prevStatusRef = useRef<ThreadStatus>("idle");
  const { top, bottom } = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardUp = keyboardHeight > 0;
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
        // Keep the chat pinned to bottom when keyboard opens
        if (isAtBottomRef.current) {
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
        }
      }
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardHeight(0)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const palette = usePalette();

  useEffect(() => {
    if (!id) return;
    actions.setActiveThread(id);
    actions.loadMessages(id).catch(() => {});
    actions.openStream(id);
    return () => actions.closeStream(id);
  }, [id, actions]);

  // Auto-delete empty threads when the user navigates away without sending any messages.
  // Also refresh thread state on re-focus to catch missed SSE events.
  useFocusEffect(
    useCallback(() => {
      if (id) {
        actions.refreshThread(id).catch(() => {});
      }
      return () => {
        if (!id) return;
        const currentMessages = useGatewayStore.getState().messages[id] ?? [];
        if (currentMessages.length === 0) {
          actions.deleteThread(id).catch(() => {});
        }
      };
    }, [id, actions])
  );

  // Refresh thread state when app returns from background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && id) {
        actions.refreshThread(id).catch(() => {});
        // Terminal chunks are not in the SSE replay buffer — re-fetch
        // history from SQLite so any output that landed while we were
        // backgrounded shows up in the terminal sheet.
        actions.loadTerminal(id).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [id, actions]);

  useEffect(() => {
    if (id && !thread) {
      actions.loadThreads().catch(() => {});
    }
  }, [id, thread, actions]);

  // ── Auto-scroll + "scroll to bottom" FAB ─────────────────────────
  //
  // Design: follow iMessage/WhatsApp conventions.
  //  - By default, pinned to bottom. New content auto-scrolls.
  //  - When the user drags up, we un-pin and show a simple "↓" FAB.
  //  - When the user scrolls back to the bottom (or taps the FAB), re-pin.
  //  - When the user sends a message, force-pin so they see it land.
  //
  // Pin/unpin invariant: only USER-initiated scrolls (drag + momentum)
  // can unpin. Programmatic scrollToEnd and content-growth scroll events
  // can re-pin but never unpin. Without this, scrollToEnd's momentum-end
  // race against streaming content growth silently unpins the user.

  const isAtBottomRef = useRef(true);
  const isDraggingRef = useRef(false);
  // True only while a user-initiated fling is in progress (drag → momentum).
  // Programmatic scrollToEnd({animated:true}) also fires onMomentumScrollBegin
  // on iOS — we must NOT treat those as user scrolling, otherwise they unpin
  // the user mid-animation and block streaming follow-scrolls.
  const userMomentumRef = useRef(false);
  // Short-lived latch set on drag end. Promotes to userMomentumRef if a
  // momentum phase begins. Decays after 50ms if no momentum follows.
  const justDraggedRef = useRef(false);
  const justDraggedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showGoToLatest, setShowGoToLatest] = useState(false);
  // Suppress FAB + pin-updates while a programmatic scroll animation is in
  // flight. Without this, onMomentumScroll* events from the programmatic
  // animation race against streaming content growth and unpin the user.
  const suppressFabRef = useRef(false);
  const [headerVisible, setHeaderVisible] = useState(true);

  // Generous threshold — feels sticky and tolerates the small position
  // drift between a streaming chunk arriving and the follow-up scroll landing.
  const AT_BOTTOM_THRESHOLD = 140;

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      const distanceFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      const atBottom = distanceFromBottom < AT_BOTTOM_THRESHOLD;

      if (suppressFabRef.current) {
        if (showGoToLatest) setShowGoToLatest(false);
        return;
      }

      const userScrolling = isDraggingRef.current || userMomentumRef.current;

      if (!userScrolling) {
        // Programmatic scroll or content-growth event — only allow re-pin.
        if (atBottom && !isAtBottomRef.current) {
          isAtBottomRef.current = true;
          if (showGoToLatest) setShowGoToLatest(false);
        }
        return;
      }

      // User is scrolling — single source of truth for pin state.
      isAtBottomRef.current = atBottom;
      if (atBottom) {
        if (showGoToLatest) setShowGoToLatest(false);
      } else {
        if (!showGoToLatest) setShowGoToLatest(true);
      }
    },
    [showGoToLatest]
  );

  // Internal helper used by the follow-scroll effects. Always instant —
  // animated scrolls race with content growth and land at a stale offset.
  // Two rAFs: first lets React commit the render, second lets the native
  // FlatList finish its layout pass so contentSize is up-to-date.
  const followScrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
      });
    });
  }, []);

  // Length of the LAST message's content. Changes on every streaming chunk
  // (message count stays constant during a stream, only content grows).
  const lastMsgLen = messages[messages.length - 1]?.content?.length ?? 0;

  // Single follow-scroll effect: fires on new messages AND streaming chunks.
  // Both reduce to "content changed; if pinned, stay at bottom."
  useEffect(() => {
    if (!isAtBottomRef.current) return;
    if (isDraggingRef.current || userMomentumRef.current) return;
    followScrollToEnd();
  }, [messages.length, lastMsgLen, followScrollToEnd]);

  const jumpToLatest = useCallback(() => {
    suppressFabRef.current = true;
    isAtBottomRef.current = true;
    setShowGoToLatest(false);
    // Animated for the satisfying smooth jump from far up; followed by an
    // instant correction in case content grew during the animation.
    listRef.current?.scrollToEnd({ animated: true });
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: false });
      suppressFabRef.current = false;
    }, 450);
  }, []);

  // Force-pin on user send. The follow-scroll effect lands the actual scroll
  // once the new user message is committed and the bubble has laid out.
  const pinToBottom = useCallback(() => {
    suppressFabRef.current = true;
    isAtBottomRef.current = true;
    setShowGoToLatest(false);
    setTimeout(() => { suppressFabRef.current = false; }, 600);
  }, []);

  const handleInputChange = (text: string) => {
    setInput(text);
    setSlashPickerVisible(text.startsWith("/") && text.length > 0);
  };

  const threadStatus = thread?.status ?? "idle";

  const sendNow = useCallback(
    async (msg: string, attachments: Attachment[] = []) => {
      if (!id) return;
      if (!msg.trim() && attachments.length === 0) return;
      setSending(true);
      pinToBottom();
      try {
        await actions.sendMessage(id, msg.trim(), attachments);
      } catch {
        // errors handled in store
      } finally {
        setSending(false);
      }
    },
    [id, actions, pinToBottom]
  );

  const send = async () => {
    if (!id) return;
    const msg = input.trim();
    if (!msg && pendingAttachments.length === 0) return;
    const attachmentsSnapshot = pendingAttachments;
    setInput("");
    setSlashPickerVisible(false);
    setPendingAttachments([]);
    // If AI is busy, park the message (with attachments) on the queue
    // instead of sending. Attachments are already uploaded and referenced
    // by path, so they travel with the text to the next idle transition.
    if (threadStatus === "running" || threadStatus === "waiting") {
      setQueue((q) => [
        ...q,
        { id: nanoid(), text: msg, attachments: attachmentsSnapshot },
      ]);
      return;
    }
    await sendNow(msg, attachmentsSnapshot);
  };

  // Auto-drain queue when the AI becomes idle. Each drain kicks off a new
  // run (status → running), which flips us back to busy; the effect fires
  // again when that run finishes, sending the next queued item.
  const queueRef = useRef<QueuedItem[]>([]);
  queueRef.current = queue;
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = threadStatus;
    if (
      (prev === "running" || prev === "waiting") &&
      threadStatus === "idle" &&
      queueRef.current.length > 0
    ) {
      const [next, ...rest] = queueRef.current;
      setQueue(rest);
      sendNow(next.text, next.attachments);
    }
  }, [threadStatus, sendNow]);

  const onStop = useCallback(() => {
    if (id) {
      actions.stopRun(id);
    }
  }, [id, actions]);

  // Long-press on Stop: halt the current run *and* discard every queued turn.
  // A heavier haptic distinguishes the destructive action from the tap.
  const onStopAll = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setQueue([]);
    if (id) actions.stopRun(id);
  }, [id, actions]);

  const copyConversation = useCallback(async () => {
    if (!messages.length) return;
    const text = messages
      .map((m) => `${m.role === "user" ? "You" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    await Clipboard.setStringAsync(text);
    setCopiedConvo(true);
    setTimeout(() => setCopiedConvo(false), 2000);
  }, [messages]);

  // ── Attachment pickers ────────────────────────────────────────
  // All three paths funnel through the gateway store's
  // `uploadAttachment` action so the backend saves the file into
  // `<workDir>/.uploads/`, classifies it, and returns the metadata
  // we stash in `pendingAttachments` until the user taps Send.

  const uploadPicked = useCallback(
    async (file: {
      uri: string;
      name: string;
      mimeType: string;
      kind: "image" | "file";
    }) => {
      if (!id) return;
      const previewId = `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      // Push an instant preview so the user sees the image land in
      // the composer immediately. Removed once the upload resolves
      // (success → replaced by real attachment; failure → just gone).
      setUploadingPreviews((prev) => [
        ...prev,
        { id: previewId, localUri: file.uri, name: file.name, kind: file.kind },
      ]);
      try {
        const attachment = await actions.uploadAttachment(id, file);
        setPendingAttachments((prev) => [...prev, attachment]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Alert.alert("Upload failed", message);
      } finally {
        setUploadingPreviews((prev) => prev.filter((p) => p.id !== previewId));
      }
    },
    [id, actions]
  );

  const pickFromLibrary = useCallback(async () => {
    setAttachmentMenuOpen(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission required", "Enable photo library access in Settings.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const ext = (asset.uri.split(".").pop() ?? "jpg").toLowerCase();
      const name = asset.fileName ?? `photo-${Date.now()}.${ext}`;
      const mimeType = asset.mimeType ?? "image/jpeg";
      await uploadPicked({ uri: asset.uri, name, mimeType, kind: "image" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("Photo picker failed", message);
    }
  }, [uploadPicked]);

  const pickFromCamera = useCallback(async () => {
    setAttachmentMenuOpen(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission required", "Enable camera access in Settings.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const name = asset.fileName ?? `camera-${Date.now()}.jpg`;
      const mimeType = asset.mimeType ?? "image/jpeg";
      await uploadPicked({ uri: asset.uri, name, mimeType, kind: "image" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("Camera failed", message);
    }
  }, [uploadPicked]);

  const pickDocument = useCallback(async () => {
    setAttachmentMenuOpen(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const name = asset.name ?? `file-${Date.now()}`;
      const mimeType = asset.mimeType ?? "application/octet-stream";
      const isImage = (mimeType ?? "").startsWith("image/");
      await uploadPicked({
        uri: asset.uri,
        name,
        mimeType,
        kind: isImage ? "image" : "file",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("File picker failed", message);
    }
  }, [uploadPicked]);

  const pickServerFile = useCallback(
    async (serverPath: string) => {
      setShowFileBrowser(false);
      if (!id) return;
      const previewId = `srv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const fileName = serverPath.split("/").pop() || serverPath;
      const isImage = /\.(png|jpe?g|gif|webp|heic|heif|svg)$/i.test(fileName);
      setUploadingPreviews((prev) => [
        ...prev,
        {
          id: previewId,
          localUri: "",
          name: fileName,
          kind: isImage ? "image" : "file",
        },
      ]);
      try {
        const attachment = await actions.attachServerFile(id, serverPath);
        setPendingAttachments((prev) => [...prev, attachment]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Alert.alert("Attach failed", message);
      } finally {
        setUploadingPreviews((prev) => prev.filter((p) => p.id !== previewId));
      }
    },
    [id, actions]
  );

  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Animate the custom top bar visibility via a translateY transform
  // (native driver) AND the content wrapper's paddingTop in parallel
  // (JS driver — layout props can't use the native driver). Running
  // them together means the list reclaims the vacated space instead
  // of leaving a gap where the bar used to be.
  const headerAnim = useRef(new Animated.Value(0)).current;
  const padAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerAnim, {
        toValue: headerVisible ? 0 : 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(padAnim, {
        toValue: headerVisible ? 0 : 1,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start();
  }, [headerVisible, headerAnim, padAnim]);

  const contentPaddingTop = padAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [top + TOP_BAR_HEIGHT, top],
  });

  const liveThinking = useMemo(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "assistant" && lastMsg.thinking) return lastMsg.thinking;
    return "";
  }, [messages]);

  // Live-cycle badges: the trailing run of tool steps whose messageId
  // matches the most recent step's messageId. The backend rotates
  // `currentMessageId` on text-after-tool (each thought + its actions
  // get their own bubble), so the "latest step's messageId" is also the
  // current cycle's bubble id. When rotation fires, the new cycle starts
  // with a single tool and grows from there — the filter breaks at the
  // bubble boundary, so previous cycle's badges stay visible only on
  // their own MessageBubble (via the per-bubble messageId filter there),
  // not in the live indicator below the list.
  const runStartedAt = useGatewayStore((s) => s.runStartedAt[id ?? ""] ?? 0);
  const liveCycleSteps = useMemo(() => {
    if (toolSteps.length === 0) return EMPTY_STEPS;
    // Only show steps from the current run — prevents previous turn's
    // badges from lingering during the "thinking" phase of a new turn.
    const currentRunSteps = runStartedAt
      ? toolSteps.filter((s) => (s.startedAt ?? 0) >= runStartedAt)
      : toolSteps;
    if (currentRunSteps.length === 0) return EMPTY_STEPS;
    const latestMsgId = currentRunSteps[currentRunSteps.length - 1].messageId;
    const out: typeof currentRunSteps = [];
    for (let i = currentRunSteps.length - 1; i >= 0; i--) {
      if (currentRunSteps[i].messageId === latestMsgId) out.unshift(currentRunSteps[i]);
      else break;
    }
    return out;
  }, [toolSteps, runStartedAt]);

  const listFooterElem = useMemo(() => {
    const lastMsg = messages[messages.length - 1];
    const phaseActive = runPhase !== "idle";
    const needsIndicator =
      isCompacting ||
      phaseActive ||
      threadStatus === "waiting" ||
      (threadStatus === "running" && (!lastMsg || lastMsg.role === "user"));
    // Hide tool badges while the model is actively streaming response
    // text — no tool is currently running, and the badges for the tools
    // that produced this response are already attached to their own
    // bubble above. Showing them next to "responding…" is visually stale.
    const badgesForIndicator =
      runPhase === "responding" ? EMPTY_STEPS : liveCycleSteps;
    return needsIndicator ? (
      <ThinkingIndicator
        status={threadStatus}
        toolSteps={badgesForIndicator}
        permissionRequests={permissionReqs}
        onApprove={(permId) => actions.respondToPermission(id ?? "", permId, true)}
        onDeny={(permId) => actions.respondToPermission(id ?? "", permId, false)}
        isDark={isDark}
        isCompacting={isCompacting}
        runPhase={runPhase}
        thinkingContent={liveThinking}
      />
    ) : null;
  }, [threadStatus, messages, liveCycleSteps, permissionReqs, actions, id, isDark, isCompacting, runPhase, liveThinking]);

  // Pass the element directly — wrapping in `() => listFooterElem` would give
  // FlatList a new component *type* on every messages tick, causing React to
  // unmount/remount the whole footer subtree (sprite frame resets → flicker,
  // dot Animated.Values reset → animations restart from initial state).

  // While the thread is loading (e.g. after app resumes from background
  // and the Zustand store is briefly empty), show a loading screen with
  // the Claude sprite. Once refreshThread / loadThreads resolves, if the
  // thread truly doesn't exist, navigate to the chat list.
  const [threadCheckDone, setThreadCheckDone] = useState(false);
  useEffect(() => {
    if (thread) {
      setThreadCheckDone(false);
      return;
    }
    if (!id) return;
    let cancelled = false;
    actions
      .loadThreads()
      .then(() => {
        if (cancelled) return;
        const found = useGatewayStore
          .getState()
          .threads.some((t) => t.id === id);
        if (!found) {
          setThreadCheckDone(true);
          if (router.canGoBack()) router.back();
          else router.replace("/");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setThreadCheckDone(true);
          router.replace("/");
        }
      });
    return () => { cancelled = true; };
  }, [thread, id, actions, router]);

  if (!thread) {
    if (threadCheckDone) return null;
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.bg,
          gap: 16,
        }}
      >
        <ThinkingSprite size={48} intervalMs={200} />
        <Text style={{ color: palette.textMuted, fontSize: 13 }}>
          Loading...
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <HeaderTitle
              modelQueue={settings.modelQueue ?? []}
              onToggleModelPicker={() => _openModelPicker?.()}
              workDir={thread.workDir}
              threadTitle={thread.title ?? "Chat"}
              palette={palette}
            />
          ),
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <TouchableBounce sensory onPress={() => setShowTerminal(true)}>
                <View style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}>
                  <IconSymbol name="terminal" color={palette.textMuted} size={16} />
                </View>
              </TouchableBounce>
              <TouchableBounce sensory onPress={copyConversation} disabled={messages.length === 0}>
                <View style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center", opacity: messages.length > 0 ? 1 : 0.3 }}>
                  <IconSymbol
                    name={copiedConvo ? "checkmark" : "doc.on.doc"}
                    color={copiedConvo ? palette.success : palette.textMuted}
                    size={16}
                  />
                </View>
              </TouchableBounce>
            </View>
          ),
          headerBackVisible: true,
          headerTransparent: true,
          headerBlurEffect: undefined,
          headerShadowVisible: false,
          headerLargeTitleShadowVisible: false,
          headerStyle: { backgroundColor: "transparent" },
        }}
      />
      {/* Model picker — must be outside MaskedView so its Modal renders correctly */}
      <ModelPickerBar
        onChooseDirectory={() => {
          setShowDirBrowser(true);
        }}
        canChangeDirectory={messages.length === 0}
        currentWorkDir={thread.workDir}
        isDark={isDark}
      />

      <MaskedView
        style={{ flex: 1, backgroundColor: palette.bg }}
        maskElement={
          <LinearGradient
            colors={["#000", "#000", "rgba(0,0,0,0.25)"]}
            locations={[0, 0.85, 1]}
            style={{ flex: 1 }}
          />
        }
      >
        {/* Messages */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollIndicatorInsets={{ top: top + 44 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 20,
            // Manual top padding for the transparent header (safe area + nav bar).
            paddingTop: top + 52,
            // Extra bottom space for the floating input pill + safe area.
            // When the keyboard is open, add its height so content isn't
            // hidden behind it.
            paddingBottom: keyboardUp
              ? keyboardHeight + 80
              : 100 + bottom,
            gap: 18,
          }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onContentSizeChange={() => {
            // Layout-only growth (e.g. ListFooter expanding, attachments
            // measuring late). The content-length effect handles streaming.
            if (
              isAtBottomRef.current &&
              !isDraggingRef.current &&
              !userMomentumRef.current
            ) {
              listRef.current?.scrollToEnd({ animated: false });
            }
          }}
          onScrollBeginDrag={() => {
            suppressFabRef.current = false;
            isDraggingRef.current = true;
          }}
          onScrollEndDrag={() => {
            isDraggingRef.current = false;
            // Arm the "just-dragged" latch. If momentum follows, it will
            // promote to userMomentumRef. Otherwise it decays.
            justDraggedRef.current = true;
            if (justDraggedTimerRef.current) {
              clearTimeout(justDraggedTimerRef.current);
            }
            justDraggedTimerRef.current = setTimeout(() => {
              justDraggedRef.current = false;
            }, 50);
          }}
          onMomentumScrollBegin={() => {
            // Only treat momentum as user-driven if it directly followed
            // a drag. Programmatic scrollToEnd also fires this event but
            // with justDraggedRef=false.
            if (justDraggedRef.current) {
              userMomentumRef.current = true;
            }
          }}
          onMomentumScrollEnd={() => {
            userMomentumRef.current = false;
          }}
          renderItem={({ item, index }) => item.role === "system"
            ? <SystemLine message={item} isDark={isDark} />
            : <MessageBubble
                message={item}
                threadId={id ?? ""}
                isStreaming={
                  runPhase === "responding" &&
                  item.role === "assistant" &&
                  index === messages.length - 1
                }
                onOpenPreview={(uri) => setPreviewUri(uri)}
                onTurnConclusionExpand={() => {
                  // Suppress the FAB while the layout shift settles —
                  // the expand grows content which fires scroll events
                  // that would otherwise show "Go to latest".
                  suppressFabRef.current = true;
                  setShowGoToLatest(false);
                  requestAnimationFrame(() => {
                    try {
                      listRef.current?.scrollToIndex({
                        index,
                        animated: true,
                        viewPosition: 1,
                      });
                    } catch {
                      listRef.current?.scrollToEnd({ animated: true });
                    }
                    // Release suppression after the scroll animation
                    setTimeout(() => { suppressFabRef.current = false; }, 500);
                  });
                }}
              />
          }
          onScrollToIndexFailed={({ index: i }) => {
            // scrollToIndex can fail when the target row isn't in the
            // rendered window yet. Fall back to scrolling toward the
            // end which at least gets the user moving in the right
            // direction; FlatList will then resolve the target.
            setTimeout(() => {
              try {
                listRef.current?.scrollToIndex({
                  index: i,
                  animated: true,
                  viewPosition: 1,
                });
              } catch {
                listRef.current?.scrollToEnd({ animated: true });
              }
            }, 120);
          }}
          ListFooterComponent={listFooterElem}
          ListEmptyComponent={() => (
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
                gap: SPACING.sm,
                paddingVertical: 48,
              }}
            >
              <Image
                source={require("@/assets/icons/claude-sprite-icon.png")}
                style={{ width: 72, height: 72 }}
                resizeMode="contain"
              />
              <Text style={{ color: palette.textMuted, fontSize: 14 }}>
                Build something wild
              </Text>
            </View>
          )}
        />

        {/* Slash command picker — floats above the input bar */}
        <SlashCommandPicker
          inputValue={input}
          visible={slashPickerVisible}
          onSelect={(cmd) => {
            setInput(cmd);
            setSlashPickerVisible(false);
          }}
        />

        {/* Queue — one panel per queued turn, sent FIFO when idle */}
        {queue.map((item) => (
          <QueuedMessagePanel
            key={item.id}
            message={item.text}
            attachmentCount={item.attachments.length}
            isDark={isDark}
            onEdit={() => {
              setInput(item.text);
              setPendingAttachments((prev) => [...prev, ...item.attachments]);
              setQueue((q) => q.filter((x) => x.id !== item.id));
            }}
            onSendNow={() => {
              setQueue((q) => q.filter((x) => x.id !== item.id));
              sendNow(item.text, item.attachments);
            }}
            onDelete={() =>
              setQueue((q) => q.filter((x) => x.id !== item.id))
            }
          />
        ))}

      </MaskedView>

      {/* Attachment menu popup — rendered at the top level so no parent
          clips or constrains it. Liquid-glass styled to match the composer. */}
      {attachmentMenuOpen && (
        <>
          <Pressable
            onPress={() => setAttachmentMenuOpen(false)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 35,
            }}
          />
          <GlassView
            glassEffectStyle="regular"
            style={{
              position: "absolute",
              left: SPACING.lg + SPACING.md,
              bottom:
                (keyboardUp ? keyboardHeight + SPACING.sm : SPACING.sm + bottom) +
                56,
              borderRadius: 16,
              overflow: "hidden",
              paddingVertical: 6,
              minWidth: 220,
              zIndex: 40,
            }}
          >
            <AttachmentMenuItem
              icon="photo"
              label="Photo library"
              onPress={pickFromLibrary}
              palette={palette}
              disabled={!supportsImage}
              hint={
                !supportsImage && activeModel
                  ? `${activeModel.name} has no vision`
                  : undefined
              }
            />
            <View style={{ height: 1, backgroundColor: palette.divider, marginLeft: 44, opacity: 0.5 }} />
            <AttachmentMenuItem
              icon="camera"
              label="Camera"
              onPress={pickFromCamera}
              palette={palette}
              disabled={!supportsImage}
              hint={
                !supportsImage && activeModel
                  ? `${activeModel.name} has no vision`
                  : undefined
              }
            />
            <View style={{ height: 1, backgroundColor: palette.divider, marginLeft: 44, opacity: 0.5 }} />
            <AttachmentMenuItem
              icon="doc"
              label="File"
              onPress={pickDocument}
              palette={palette}
            />
            <View style={{ height: 1, backgroundColor: palette.divider, marginLeft: 44, opacity: 0.5 }} />
            <AttachmentMenuItem
              icon="server.rack"
              label="From server"
              onPress={() => {
                setAttachmentMenuOpen(false);
                setShowFileBrowser(true);
              }}
              palette={palette}
            />
          </GlassView>
        </>
      )}

      {/* Plan/Act mode popover */}
      {modePopover === "plan" && (
        <>
          <Pressable
            onPress={() => setModePopover(null)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 35,
            }}
          />
          <GlassView
            glassEffectStyle="regular"
            style={{
              position: "absolute",
              left: SPACING.lg + SPACING.md + (pillX.plan ?? 0),
              bottom:
                (keyboardUp ? keyboardHeight + SPACING.sm : SPACING.sm + bottom) +
                56,
              borderRadius: 16,
              overflow: "hidden",
              paddingVertical: 6,
              minWidth: 180,
              zIndex: 40,
            }}
          >
            <ModeOption
              label="Act"
              hint="Execute directly"
              selected={(settings.planMode ?? "act") === "act"}
              palette={palette}
              onPress={() => {
                actions.setSettings({ planMode: "act" });
                setModePopover(null);
              }}
            />
            <View style={{ height: 1, backgroundColor: palette.divider, marginLeft: 16, opacity: 0.5 }} />
            <ModeOption
              label="Plan"
              hint="Draft before acting"
              selected={settings.planMode === "plan"}
              palette={palette}
              onPress={() => {
                actions.setSettings({ planMode: "plan" });
                setModePopover(null);
              }}
            />
          </GlassView>
        </>
      )}

      {/* Reasoning effort popover */}
      {modePopover === "effort" && (
        <>
          <Pressable
            onPress={() => setModePopover(null)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 35,
            }}
          />
          <GlassView
            glassEffectStyle="regular"
            style={{
              position: "absolute",
              left: SPACING.lg + SPACING.md + (pillX.effort ?? 0),
              bottom:
                (keyboardUp ? keyboardHeight + SPACING.sm : SPACING.sm + bottom) +
                56,
              borderRadius: 16,
              overflow: "hidden",
              paddingVertical: 6,
              minWidth: 180,
              zIndex: 40,
            }}
          >
            {(["low", "medium", "high"] as const).map((level, i) => (
              <View key={level}>
                {i > 0 && (
                  <View style={{ height: 1, backgroundColor: palette.divider, marginLeft: 16, opacity: 0.5 }} />
                )}
                <ModeOption
                  label={EFFORT_LABEL[level]}
                  selected={(settings.reasoningEffort ?? "medium") === level}
                  palette={palette}
                  onPress={() => {
                    actions.setSettings({ reasoningEffort: level });
                    setModePopover(null);
                  }}
                />
              </View>
            ))}
          </GlassView>
        </>
      )}

      {/* ── Input — absolutely positioned, keyboard-aware ─── */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: keyboardUp ? keyboardHeight + SPACING.sm : SPACING.sm + bottom,
          paddingHorizontal: SPACING.lg,
          gap: SPACING.sm,
          zIndex: 30,
        }}
      >
        {/* Pending-attachment row */}
        {(pendingAttachments.length > 0 || uploadingPreviews.length > 0) && (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 10,
              paddingHorizontal: 4,
              paddingBottom: 4,
            }}
          >
            {uploadingPreviews.map((p) => (
              <AttachmentThumb
                key={p.id}
                kind={p.kind}
                localUri={p.kind === "image" ? p.localUri : undefined}
                name={p.name}
                palette={palette}
                loading
              />
            ))}
            {pendingAttachments.map((att, i) => (
              <AttachmentThumb
                key={`${att.path}-${i}`}
                kind={att.kind}
                localUri={att.localUri}
                name={att.fileName}
                palette={palette}
                onPress={
                  att.kind === "image" && att.localUri
                    ? () => setPreviewUri(att.localUri!)
                    : undefined
                }
                onRemove={() => removeAttachment(i)}
              />
            ))}
          </View>
        )}

        {/* Liquid glass pill — true iOS 26 glass with specular highlights */}
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          style={{
            flexDirection: "column",
            borderRadius: 22,
            overflow: "hidden",
            paddingHorizontal: SPACING.md,
            paddingTop: SPACING.xs,
            paddingBottom: SPACING.xs,
            gap: SPACING.xs,
          }}
        >
            <TextInput
              placeholder="Message…"
              placeholderTextColor={palette.textSoft}
              value={input}
              onChangeText={handleInputChange}
              multiline
              keyboardAppearance={isDark ? "dark" : "light"}
              style={{
                minHeight: 44,
                maxHeight: 140,
                color: palette.text,
                fontSize: TYPOGRAPHY.fontSizes.md,
                lineHeight: TYPOGRAPHY.lineHeights.md,
                paddingTop: SPACING.sm,
                paddingBottom: SPACING.xs,
              }}
            />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: SPACING.xs,
            }}
          >
            {/* Attachment + button */}
            <TouchableBounce
              sensory
              onPress={() => {
                setModePopover(null);
                setAttachmentMenuOpen((v) => !v);
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconSymbol
                  name={attachmentMenuOpen ? "xmark" : "plus"}
                  size={20}
                  color={palette.textMuted}
                />
              </View>
            </TouchableBounce>

            <ModePill
              label={settings.planMode === "plan" ? "Plan" : "Act"}
              active={modePopover === "plan"}
              palette={palette}
              onLayout={(x) => setPillX((p) => ({ ...p, plan: x }))}
              onPress={() => {
                setAttachmentMenuOpen(false);
                setModePopover((v) => (v === "plan" ? null : "plan"));
              }}
            />

            <ModePill
              label={EFFORT_LABEL[settings.reasoningEffort ?? "medium"]}
              active={modePopover === "effort"}
              palette={palette}
              onLayout={(x) => setPillX((p) => ({ ...p, effort: x }))}
              onPress={() => {
                setAttachmentMenuOpen(false);
                setModePopover((v) => (v === "effort" ? null : "effort"));
              }}
            />

            <View style={{ flex: 1 }} />

            {(() => {
              const hasContent =
                !!input.trim() || pendingAttachments.length > 0;
              const isBusy =
                threadStatus === "running" || threadStatus === "waiting";
              // Stop takes over only when the composer is empty *and* a run
              // is in flight. With text/attachments present, Send stays —
              // the user can queue another turn even mid-run. Separate
              // branches (with distinct keys) so RN's legacy TouchableBounce
              // remounts between modes rather than diffing props in place.
              if (!hasContent && isBusy) {
                return (
                  <TouchableBounce
                    key="composer-stop"
                    sensory
                    onPress={onStop}
                    onLongPress={queue.length > 0 ? onStopAll : undefined}
                  >
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        backgroundColor: palette.danger,
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <IconSymbol name="stop.fill" size={12} color="#fff" />
                    </View>
                  </TouchableBounce>
                );
              }
              return (
                <TouchableBounce
                  key="composer-send"
                  sensory
                  disabled={!hasContent}
                  onPress={send}
                  style={{ opacity: hasContent ? 1 : 0.3 }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: hasContent
                        ? palette.text
                        : isDark
                        ? "rgba(255,255,255,0.12)"
                        : "rgba(0,0,0,0.06)",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <IconSymbol
                      name="arrow.up"
                      size={14}
                      color={hasContent ? palette.bg : palette.textSoft}
                    />
                  </View>
                </TouchableBounce>
              );
            })()}
          </View>
          </GlassView>
      </View>

      {/* Directory browser — only available on turn 0 */}
      <DirectoryBrowser
        visible={showDirBrowser}
        initialPath={thread?.workDir || settings.lastWorkDir}
        onSelect={(path) => {
          setShowDirBrowser(false);
          if (id) actions.updateThreadWorkDir(id, path).catch(() => {});
        }}
        onCancel={() => setShowDirBrowser(false)}
      />

      {/* Server file browser — pick an existing file on the backend */}
      <FileBrowser
        visible={showFileBrowser}
        initialPath={thread?.workDir || settings.lastWorkDir}
        onSelect={pickServerFile}
        onCancel={() => setShowFileBrowser(false)}
      />

      {id && (
        <TerminalSheet
          threadId={id}
          visible={showTerminal}
          onClose={() => setShowTerminal(false)}
          onSendToClaw={(text) =>
            setInput((prev) => (prev ? `${prev}\n\n${text}` : text))
          }
        />
      )}

      {/* Scroll-to-bottom FAB — simple down arrow like iMessage. */}
      {showGoToLatest && (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: keyboardUp ? keyboardHeight + 64 : 64 + bottom,
            alignItems: "center",
            zIndex: 40,
          }}
        >
          <GlassButton
            onPress={jumpToLatest}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconSymbol name="chevron.down" color={palette.text} size={14} />
          </GlassButton>
        </View>
      )}

      {/* Full-screen image preview — opens when the user taps a
          pending-attachment thumbnail or an inline bubble image. */}
      <Modal
        visible={previewUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewUri(null)}
      >
        <Pressable
          onPress={() => setPreviewUri(null)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.9)",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          {previewUri && (
            <Image
              source={{ uri: previewUri }}
              style={{ width: "100%", height: "85%" }}
              resizeMode="contain"
            />
          )}
          <View
            style={{
              position: "absolute",
              top: top + 12,
              right: 20,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: "rgba(255,255,255,0.15)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconSymbol name="xmark" size={16} color="#fff" />
          </View>
        </Pressable>
      </Modal>

    </View>
  );
}

const EMPTY_BUBBLE_STEPS: ToolStep[] = [];
const EMPTY_TURN_LOG: string[] = [];

function formatTurnDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function isErrorLine(line: string): boolean {
  return (
    /\berror\b/i.test(line) ||
    /\bfailed\b/i.test(line) ||
    /\b50[0-9]\b/.test(line)
  );
}

function formatLogLine(line: string): string {
  if (!line.startsWith("{")) return line;
  try {
    const obj = JSON.parse(line);
    // API error payloads — extract the human message
    if (obj.error && typeof obj.error === "string") {
      // e.g. {"error":"api returned 502 ...","type":"error"}
      const inner = obj.error;
      // Try to pull the nested message out of the stringified JSON
      const msgMatch = inner.match(/"message"\s*:\s*"([^"]+)"/);
      if (msgMatch) return `Error: ${msgMatch[1]}`;
      return `Error: ${inner.slice(0, 300)}`;
    }
    return line;
  } catch {
    return line;
  }
}

function TurnConclusion({
  durationMs,
  log,
  palette,
  isDark,
  onExpand,
}: {
  durationMs: number;
  log: string[];
  palette: Palette;
  isDark: boolean;
  onExpand?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const logScrollRef = useRef<ScrollView>(null);
  const hasLog = log.length > 0;
  const label = `Worked for ${formatTurnDuration(durationMs)}`;
  const lineColor = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)";
  const textColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.42)";

  return (
    <View style={{ width: "100%", gap: 4, marginTop: 2 }}>
      <TouchableBounce
        sensory
        onPress={
          hasLog
            ? () => {
                setExpanded((v) => {
                  const next = !v;
                  onExpand?.(next);
                  return next;
                });
              }
            : undefined
        }
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: SPACING.sm,
          }}
        >
          <View style={{ flex: 1, height: 1, backgroundColor: lineColor }} />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Text
              style={{
                color: textColor,
                fontSize: 11,
                fontWeight: "500",
                letterSpacing: 0.2,
              }}
            >
              {label}
            </Text>
            {hasLog && (
              <IconSymbol
                name={expanded ? "chevron.up" : "chevron.down"}
                size={9}
                color={textColor}
              />
            )}
          </View>
          <View style={{ flex: 1, height: 1, backgroundColor: lineColor }} />
        </View>
      </TouchableBounce>
      {expanded && hasLog && (
        <View
          style={{
            marginHorizontal: SPACING.sm,
            backgroundColor: palette.surfaceAlt,
            borderRadius: BORDER_RADIUS.md,
            borderWidth: 1,
            borderColor: palette.divider,
            paddingHorizontal: 12,
            paddingVertical: 10,
            maxHeight: 260,
          }}
        >
          <ScrollView
            ref={logScrollRef}
            onContentSizeChange={() => {
              logScrollRef.current?.scrollToEnd({ animated: false });
            }}
          >
            {log.map((line, i) => (
              <Text
                key={i}
                selectable
                style={{
                  color: isErrorLine(line)
                    ? palette.danger
                    : palette.text,
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                  fontSize: 11,
                  lineHeight: 16,
                }}
              >
                {formatLogLine(line)}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

/** Theme-aware styles for react-native-markdown-display inside assistant bubbles */
function useMarkdownStyles(palette: Palette) {
  return useMemo(() => {
    const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
    const base = 15;
    const lh   = 24;
    return {
      body:      { color: palette.text, fontSize: base, lineHeight: lh },
      paragraph: {
        color: palette.text,
        fontSize: base,
        lineHeight: lh,
        marginTop: 0,
        // Comfortable paragraph rhythm per DESIGN_GUIDELINES.md ("let
        // text breathe; don't pack rows tightly to save pixels").
        marginBottom: 12,
      },
      heading1:  { color: palette.text, fontSize: 20, fontWeight: "700" as const, marginTop: 18, marginBottom: 8 },
      heading2:  { color: palette.text, fontSize: 17, fontWeight: "700" as const, marginTop: 16, marginBottom: 6 },
      heading3:  { color: palette.text, fontSize: 15, fontWeight: "600" as const, marginTop: 12, marginBottom: 4 },
      strong:    { fontWeight: "700" as const, color: palette.text },
      em:        { fontStyle: "italic" as const },
      s:         { textDecorationLine: "line-through" as const },
      link:      { color: palette.accent, textDecorationLine: "underline" as const },
      blockquote: {
        backgroundColor: palette.surfaceAlt,
        borderLeftWidth: 2,
        borderLeftColor: palette.textSoft,
        paddingLeft: 12,
        paddingVertical: 8,
        marginVertical: 10,
        borderRadius: 6,
      },
      code_inline: {
        backgroundColor: palette.surfaceAlt,
        fontFamily: mono,
        fontSize: 13,
        borderRadius: 4,
        paddingHorizontal: 5,
        paddingVertical: 1,
        // Stay in the warm palette — no saturated purple. The surface-
        // vs-bg tonal shift is enough to distinguish inline code.
        color: palette.text,
      },
      fence: {
        backgroundColor: palette.surfaceAlt,
        fontFamily: mono,
        fontSize: 12.5,
        lineHeight: 19,
        borderRadius: 10,
        padding: 14,
        marginVertical: 10,
        borderWidth: 1,
        borderColor: palette.divider,
        color: palette.text,
      },
      code_block: {
        backgroundColor: palette.surfaceAlt,
        fontFamily: mono,
        fontSize: 12.5,
        lineHeight: 19,
        borderRadius: 10,
        padding: 14,
        marginVertical: 10,
        borderWidth: 1,
        borderColor: palette.divider,
        color: palette.text,
      },
      hr:           { backgroundColor: palette.divider, height: 1, marginVertical: 16 },
      bullet_list:  { marginVertical: 6 },
      ordered_list: { marginVertical: 6 },
      list_item:    { marginBottom: 6 },
      bullet_list_icon: { color: palette.textMuted, fontSize: 14, marginRight: 8, marginTop: 2 },
      ordered_list_icon:{ color: palette.textMuted, fontSize: 14, marginRight: 8, marginTop: 2 },
    };
  }, [palette]);
}

// Markdown cleanup helpers live in a pure module so they can be
// unit-tested with `node --test` (no React Native deps).
// See utils/markdownCleanup.ts.

function SystemLine({ message, isDark }: { message: Message; isDark: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 4,
      }}
    >
      <View
        style={{
          flex: 1,
          height: 1,
          backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
        }}
      />
      <Text
        style={{
          color: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)",
          fontSize: 11,
          fontWeight: "500",
          fontStyle: "italic",
        }}
      >
        {message.content}
      </Text>
      <View
        style={{
          flex: 1,
          height: 1,
          backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
        }}
      />
    </View>
  );
}

function MessageBubble({
  message,
  threadId,
  isStreaming,
  onOpenPreview,
  onTurnConclusionExpand,
}: {
  message: Message;
  threadId: string;
  isStreaming?: boolean;
  onOpenPreview?: (uri: string) => void;
  onTurnConclusionExpand?: (messageId: string) => void;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [tappedBadgeId, setTappedBadgeId] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const palette = usePalette();
  const mdStyles = useMarkdownStyles(palette);

  // Tool steps for THIS message — only populated for assistant messages after a run.
  // Separate selector + useMemo avoids creating new arrays on every store update.
  const allThreadSteps = useGatewayStore((s) => s.toolSteps[threadId] ?? EMPTY_BUBBLE_STEPS);
  const msgSteps = useMemo(() => {
    if (isUser) return EMPTY_BUBBLE_STEPS;
    const filtered = allThreadSteps.filter((st) => st.messageId === message.id);
    return filtered.length > 0 ? filtered : EMPTY_BUBBLE_STEPS;
  }, [allThreadSteps, message.id, isUser]);

  const onCopy = useCallback(async () => {
    await Clipboard.setStringAsync(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [message.content]);

  // One badge per call (capped at 8 visible), for the collapsed icon strip
  const MAX_BADGE = 8;
  const visibleStepBadges = useMemo(() => msgSteps.slice(0, MAX_BADGE), [msgSteps]);
  const stepOverflow = Math.max(0, msgSteps.length - MAX_BADGE);

  return (
    <View
      style={{
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: 4,
      }}
    >
      {/* ── Thinking block (collapsible, assistant only) ─────────── */}
      {!isUser && message.thinking && (
        <View style={{ maxWidth: "88%", gap: 3 }}>
          <TouchableBounce sensory onPress={() => setThinkingExpanded((v) => !v)}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                alignSelf: "flex-start",
                paddingHorizontal: 9,
                paddingVertical: 4,
                backgroundColor: isDark ? "rgba(20,184,166,0.12)" : "rgba(20,184,166,0.08)",
                borderRadius: BORDER_RADIUS.full,
                borderWidth: 1,
                borderColor: isDark ? "rgba(20,184,166,0.25)" : "rgba(20,184,166,0.18)",
              }}
            >
              <IconSymbol name="brain.head.profile" size={10} color="#14B8A6" />
              <Text style={{ color: "#14B8A6", fontSize: 11, fontWeight: "600" }}>
                Thinking
              </Text>
              <IconSymbol
                name={thinkingExpanded ? "chevron.up" : "chevron.down"}
                size={9}
                color="#14B8A6"
              />
            </View>
          </TouchableBounce>
          {thinkingExpanded && (
            <View
              style={{
                backgroundColor: isDark ? "rgba(20,184,166,0.06)" : "rgba(20,184,166,0.04)",
                borderRadius: BORDER_RADIUS.lg,
                borderWidth: 1,
                borderColor: isDark ? "rgba(20,184,166,0.18)" : "rgba(20,184,166,0.12)",
                paddingHorizontal: 12,
                paddingVertical: 10,
                maxWidth: "100%",
              }}
            >
              <Text
                style={{
                  color: isDark ? "rgba(255,255,255,0.50)" : "rgba(0,0,0,0.45)",
                  fontSize: 12,
                  lineHeight: 18,
                  fontStyle: "italic",
                }}
              >
                {message.thinking}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── Tool steps strip (assistant only, when steps exist) ─── */}
      {!isUser && msgSteps.length > 0 && (
        <View style={{ maxWidth: "92%", gap: 4 }}>
          {/* Badge row — each badge tappable, expand button at end */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              flexWrap: "wrap",
            }}
          >
            {visibleStepBadges.map((step) => {
              const meta = resolveToolMeta(step);
              const isActive = tappedBadgeId === step.id;
              const isErr = step.status === "error";
              return (
                <TouchableBounce
                  key={step.id}
                  sensory
                  onPress={() => setTappedBadgeId((prev) => prev === step.id ? null : step.id)}
                >
                  <View
                    style={{
                      width: 26, height: 26, borderRadius: 7,
                      backgroundColor: isActive
                        ? `${meta.color}33`
                        : isErr
                          ? "rgba(239,68,68,0.1)"
                          : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                      borderWidth: isActive ? 1 : 0,
                      borderColor: `${meta.color}55`,
                      justifyContent: "center", alignItems: "center",
                    }}
                  >
                    {isErr
                      ? <IconSymbol name="xmark.circle.fill" size={12} color="#EF4444" />
                      : <ToolBadgeIcon meta={meta} size={12} color={isActive ? meta.color : (isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)")} />
                    }
                  </View>
                </TouchableBounce>
              );
            })}
            {stepOverflow > 0 && (
              <View style={{
                paddingHorizontal: 5, paddingVertical: 2,
                backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
                borderRadius: 6,
              }}>
                <Text style={{ color: isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.32)", fontSize: 10, fontWeight: "600" }}>
                  +{stepOverflow}
                </Text>
              </View>
            )}
            {/* Expand toggle */}
            <TouchableBounce sensory onPress={() => setStepsExpanded((v) => !v)}>
              <View style={{
                paddingHorizontal: 7, paddingVertical: 3,
                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                borderRadius: BORDER_RADIUS.full,
                flexDirection: "row",
                alignItems: "center",
                gap: 3,
              }}>
                <Text style={{ color: isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.35)", fontSize: 10.5, fontWeight: "500" }}>
                  {msgSteps.length} {msgSteps.length === 1 ? "step" : "steps"}
                </Text>
                <IconSymbol
                  name={stepsExpanded ? "chevron.up" : "chevron.down"}
                  size={9}
                  color={isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.28)"}
                />
              </View>
            </TouchableBounce>
          </View>

          {/* Tapped badge label */}
          {tappedBadgeId && (() => {
            const step = msgSteps.find((s) => s.id === tappedBadgeId);
            if (!step) return null;
            const meta = resolveToolMeta(step);
            return (
              <View style={{
                backgroundColor: isDark ? "#1c1c1e" : "#fff",
                borderRadius: BORDER_RADIUS.md,
                borderWidth: 1,
                borderColor: `${meta.color}33`,
                paddingHorizontal: 10,
                paddingVertical: 6,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
              }}>
                <View style={{
                  width: 18, height: 18, borderRadius: 4,
                  backgroundColor: `${meta.color}20`,
                  justifyContent: "center", alignItems: "center",
                }}>
                  <ToolBadgeIcon meta={meta} size={10} color={meta.color} />
                </View>
                <Text style={{
                  color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)",
                  fontSize: 12,
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                  flexShrink: 1,
                }} numberOfLines={2}>
                  {step.label || step.tool}
                </Text>
              </View>
            );
          })()}

          {/* Expanded step list */}
          {stepsExpanded && (
            <View
              style={{
                backgroundColor: isDark ? "#1c1c1e" : "#fff",
                borderRadius: BORDER_RADIUS.lg,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)",
                paddingHorizontal: 12,
                paddingVertical: 8,
                gap: 6,
                ...SHADOW.sm,
              }}
            >
              {msgSteps.map((step) => {
                const meta = resolveToolMeta(step);
                const isErr = step.status === "error";
                return (
                  <View key={step.id} style={{ gap: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                      {isErr
                        ? <IconSymbol name="xmark.circle.fill" size={12} color="#EF4444" />
                        : <IconSymbol name="checkmark.circle.fill" size={12} color="#22C55E" />
                      }
                      <View
                        style={{
                          width: 18, height: 18, borderRadius: 4,
                          backgroundColor: `${meta.color}20`,
                          justifyContent: "center", alignItems: "center",
                        }}
                      >
                        <ToolBadgeIcon meta={meta} size={10} color={meta.color} />
                      </View>
                      <Text
                        style={{
                          color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)",
                          fontSize: 11.5,
                          fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                          flexShrink: 1,
                        }}
                        numberOfLines={1}
                      >
                        {step.label}
                      </Text>
                    </View>
                    {step.detail != null && (
                      <Text
                        style={{
                          color: isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.28)",
                          fontSize: 10,
                          fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                          marginLeft: 37,
                        }}
                        numberOfLines={2}
                      >
                        {step.detail}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* ── Message bubble ─────────────────────────────────────── */}
      <TouchableBounce sensory onPress={onCopy}>
        {message.error ? (
          /* ── Error bubble — muted, low-contrast, no shadow ── */
          <View
            style={{
              width: "100%",
              backgroundColor: palette.surfaceAlt,
              borderRadius: 14,
              borderLeftWidth: 2,
              borderLeftColor: palette.danger,
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <Text
              selectable
              style={{
                color: palette.danger,
                fontSize: TYPOGRAPHY.fontSizes.sm,
                lineHeight: TYPOGRAPHY.lineHeights.md,
              }}
            >
              {(message.content || "An error occurred — please try again.").slice(0, 500)}
            </Text>
          </View>
        ) : (
          /* ── Normal bubble ──
             Per DESIGN_GUIDELINES.md: the assistant response reads as
             clean text on the background — no fill, no border, no
             shadow. The user message is subtle and unobtrusive: a soft
             surface-alt pill with palette.text, never painted in the
             accent colour. */
          <View
            style={{
              maxWidth: isUser ? "82%" : "100%",
              alignSelf: isUser ? "flex-end" : "stretch",
              gap: 6,
            }}
          >
            {/* Inline attachment thumbnails for user messages. Images
                use the stashed local URI we tucked onto the client
                message at send time. */}
            {isUser && message.attachments && message.attachments.length > 0 && (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 6,
                  alignSelf: "flex-end",
                  justifyContent: "flex-end",
                }}
              >
                {message.attachments.map((att, i) =>
                  att.kind === "image" && att.localUri ? (
                    <Pressable
                      key={`${att.path}-${i}`}
                      onPress={() => onOpenPreview?.(att.localUri!)}
                    >
                      <Image
                        source={{ uri: att.localUri }}
                        style={{
                          width: 72,
                          height: 72,
                          borderRadius: 10,
                          backgroundColor: palette.surfaceAlt,
                        }}
                        resizeMode="cover"
                      />
                    </Pressable>
                  ) : (
                    <View
                      key={`${att.path}-${i}`}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        backgroundColor: palette.surfaceAlt,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: palette.divider,
                        maxWidth: 240,
                      }}
                    >
                      <IconSymbol name="doc" size={16} color={palette.textMuted} />
                      <Text
                        style={{ color: palette.text, fontSize: 13 }}
                        numberOfLines={1}
                      >
                        {att.fileName}
                      </Text>
                    </View>
                  )
                )}
              </View>
            )}

            {/* Text body. Hidden for attachment-only messages so the
                bubble doesn't render an empty pill under the image. */}
            {message.content.trim().length > 0 && (
              <View
                style={{
                  backgroundColor: isUser ? palette.surfaceAlt : "transparent",
                  borderRadius: isUser ? 14 : 0,
                  paddingHorizontal: isUser ? 16 : 0,
                  paddingVertical: isUser ? 10 : 0,
                  alignSelf: isUser ? "flex-end" : "stretch",
                }}
              >
                {isUser ? (
                  <Text
                    selectable
                    style={{
                      color: palette.text,
                      fontSize: TYPOGRAPHY.fontSizes.md,
                      lineHeight: TYPOGRAPHY.lineHeights.md,
                    }}
                  >
                    {message.content}
                  </Text>
                ) : (
                  <StreamingText
                    content={cleanModelMarkdown(message.content)}
                    mdStyles={mdStyles}
                    streaming={isStreaming}
                    palette={palette}
                  />
                )}
              </View>
            )}
          </View>
        )}
      </TouchableBounce>

      {/* ── Turn conclusion: "Worked for X" (assistant only) ─────── */}
      {!isUser && message.turnDurationMs != null && (
        <TurnConclusion
          durationMs={message.turnDurationMs}
          log={message.turnLog ?? EMPTY_TURN_LOG}
          palette={palette}
          isDark={isDark}
          onExpand={(next) => {
            if (next) onTurnConclusionExpand?.(message.id);
          }}
        />
      )}

      {/* Timestamp */}
      <Text
        style={{
          color: isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.20)",
          fontSize: 10,
          paddingHorizontal: SPACING.sm,
          marginTop: -1,
          alignSelf: isUser ? "flex-end" : "flex-start",
        }}
      >
        {formatMsgTime(message.createdAt)}
      </Text>

      {/* Subtle copy indicator */}
      {copied && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 3,
            paddingHorizontal: SPACING.sm,
          }}
        >
          <IconSymbol name="checkmark" size={10} color={palette.success} />
          <Text style={{ fontSize: 11, color: palette.success }}>Copied</Text>
        </View>
      )}
    </View>
  );
}

// ─── Message timestamp helper ─────────────────────────────────────────────────

function formatMsgTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now   = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const msgDay     = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (msgDay === todayStart) return time;
  if (todayStart - msgDay <= 86_400_000) return `Yesterday ${time}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + time;
}

// ─── Queued message panel ─────────────────────────────────────────────────────

function QueuedMessagePanel({
  message,
  attachmentCount = 0,
  isDark,
  onEdit,
  onSendNow,
  onDelete,
}: {
  message: string;
  attachmentCount?: number;
  isDark: boolean;
  onEdit: () => void;
  onSendNow: () => void;
  onDelete: () => void;
}) {
  const bg     = isDark ? "#2c2415" : "#fffbeb";
  const border = isDark ? "rgba(245,158,11,0.30)" : "rgba(245,158,11,0.40)";
  const amber  = "#f59e0b";
  const subtle = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.40)";

  return (
    <View
      style={{
        marginHorizontal: SPACING.lg,
        marginBottom: SPACING.xs,
        backgroundColor: bg,
        borderRadius: BORDER_RADIUS.lg,
        borderWidth: 1,
        borderColor: border,
        overflow: "hidden",
        ...SHADOW.sm,
      }}
    >
      {/* Header row */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: 4,
          gap: 5,
        }}
      >
        <IconSymbol name="clock.arrow.2.circlepath" size={11} color={amber} />
        <Text style={{ color: amber, fontSize: 11, fontWeight: "600", flex: 1 }}>
          Queued — will send when ready
        </Text>
        {attachmentCount > 0 && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <IconSymbol name="paperclip" size={10} color={amber} />
            <Text style={{ color: amber, fontSize: 11, fontWeight: "600" }}>
              {attachmentCount}
            </Text>
          </View>
        )}
      </View>

      {/* Message preview */}
      <Text
        style={{
          color: isDark ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.75)",
          fontSize: 13.5,
          lineHeight: 19,
          paddingHorizontal: 12,
          paddingBottom: 10,
        }}
        numberOfLines={4}
      >
        {message}
      </Text>

      {/* Action row */}
      <View
        style={{
          flexDirection: "row",
          borderTopWidth: 1,
          borderTopColor: border,
        }}
      >
        {/* Edit */}
        <TouchableBounce sensory onPress={onEdit} style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              paddingVertical: 9,
              borderRightWidth: 1,
              borderRightColor: border,
            }}
          >
            <IconSymbol name="pencil" size={12} color={subtle} />
            <Text style={{ color: subtle, fontSize: 12, fontWeight: "500" }}>Edit</Text>
          </View>
        </TouchableBounce>

        {/* Send now */}
        <TouchableBounce sensory onPress={onSendNow} style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              paddingVertical: 9,
              borderRightWidth: 1,
              borderRightColor: border,
            }}
          >
            <IconSymbol name="arrow.up" size={12} color={amber} />
            <Text style={{ color: amber, fontSize: 12, fontWeight: "600" }}>Send now</Text>
          </View>
        </TouchableBounce>

        {/* Delete */}
        <TouchableBounce sensory onPress={onDelete} style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              paddingVertical: 9,
            }}
          >
            <IconSymbol name="xmark" size={12} color={subtle} />
            <Text style={{ color: subtle, fontSize: 12, fontWeight: "500" }}>Remove</Text>
          </View>
        </TouchableBounce>
      </View>
    </View>
  );
}

// ─── Model picker ─────────────────────────────────────────────────────────────

function HeaderTitle({
  modelQueue,
  onToggleModelPicker,
  workDir,
  threadTitle,
  palette,
}: {
  modelQueue: ModelEntry[];
  onToggleModelPicker: () => void;
  workDir?: string | null;
  threadTitle: string;
  palette: Palette;
}) {
  const active = modelQueue.filter((m) => m.enabled)[0] ?? null;
  const dotColor = active ? PROVIDER_COLOR[active.provider] ?? "#6B7280" : null;
  const shortName = active
    ? active.name.includes("/")
      ? active.name.split("/").pop()!
      : active.name
    : null;
  const cwdName = workDir
    ? workDir.split("/").filter(Boolean).pop() ?? workDir
    : "";

  if (!active) {
    return (
      <Text style={{ color: palette.text, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
        {threadTitle}
      </Text>
    );
  }

  return (
    <TouchableBounce sensory onPress={onToggleModelPicker}>
      <View style={{ alignItems: "center", gap: 1 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 3.5,
              backgroundColor: dotColor ?? "#6B7280",
            }}
          />
          <Text
            style={{
              color: palette.text,
              fontSize: 15,
              fontWeight: "600",
              maxWidth: 180,
            }}
            numberOfLines={1}
          >
            {shortName}
          </Text>
          <IconSymbol
            name="chevron.down"
            size={10}
            color={palette.textMuted as any}
          />
        </View>
        {cwdName ? (
          <Text
            style={{
              color: palette.textMuted,
              fontSize: 10,
              maxWidth: 200,
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
            }}
            numberOfLines={1}
          >
            {cwdName}
          </Text>
        ) : null}
      </View>
    </TouchableBounce>
  );
}

const PROVIDER_COLOR: Record<string, string> = {
  claude:      "#0066FF",
  openrouter:  "#7B3FE4",
  local:       "#16A34A",
};

// ─── Attachment thumbnail ────────────────────────────────────────

function AttachmentThumb({
  kind,
  localUri,
  name,
  palette,
  loading,
  onPress,
  onRemove,
}: {
  kind: "image" | "file";
  localUri?: string;
  name: string;
  palette: Palette;
  loading?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const SIZE = 56;
  const content = (
    <View
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: 10,
        backgroundColor: palette.surfaceAlt,
        borderWidth: 1,
        borderColor: palette.divider,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {kind === "image" && localUri ? (
        <Image
          source={{ uri: localUri }}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            padding: 4,
          }}
        >
          <IconSymbol name="doc" size={18} color={palette.textMuted} />
        </View>
      )}
      {loading && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.45)",
          }}
        >
          <ActivityIndicator size="small" color="#fff" />
        </View>
      )}
    </View>
  );

  return (
    // Extra top/right padding leaves room for the remove-x to sit
    // outside the thumbnail without being clipped by sibling layout.
    <View style={{ position: "relative", paddingTop: 6, paddingRight: 6 }}>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityLabel={`Preview ${name}`}>
          {content}
        </Pressable>
      ) : (
        content
      )}
      {!loading && onRemove && (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: palette.text,
            borderWidth: 2,
            borderColor: palette.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <IconSymbol name="xmark" size={10} color={palette.bg} />
        </Pressable>
      )}
    </View>
  );
}

// ─── Composer mode controls ──────────────────────────────────────

/**
 * Pill button in the composer's bottom row — shows the current value of
 * a mode (Plan/Act, Reasoning effort) with a chevron that signals the
 * pill expands into a popover of options. Captures its own x-position
 * via onLayout so the popover can anchor directly above it.
 */
function ModePill({
  label,
  active,
  palette,
  onPress,
  onLayout,
}: {
  label: string;
  active: boolean;
  palette: Palette;
  onPress: () => void;
  onLayout: (x: number) => void;
}) {
  return (
    <TouchableBounce
      sensory
      onPress={onPress}
      onLayout={(e) => onLayout(e.nativeEvent.layout.x)}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 32,
          paddingHorizontal: 10,
          borderRadius: 16,
          backgroundColor: active ? palette.surfaceAlt : "transparent",
        }}
      >
        <Text
          style={{
            color: palette.textMuted,
            fontSize: 13,
            fontWeight: "500",
          }}
        >
          {label}
        </Text>
        <IconSymbol
          name="chevron.down"
          size={10}
          color={palette.textSoft}
        />
      </View>
    </TouchableBounce>
  );
}

function ModeOption({
  label,
  hint,
  selected,
  onPress,
  palette,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  palette: Palette;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: pressed ? palette.surfaceAlt : "transparent",
      })}
    >
      <View style={{ width: 14, alignItems: "center" }}>
        {selected && (
          <IconSymbol name="checkmark" size={12} color={palette.text} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: palette.text, fontSize: 14 }}>{label}</Text>
        {hint && (
          <Text style={{ color: palette.textSoft, fontSize: 11, marginTop: 2 }}>
            {hint}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// ─── Attachment menu item ────────────────────────────────────────

function AttachmentMenuItem({
  icon,
  label,
  onPress,
  palette,
  disabled,
  hint,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  palette: Palette;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: !disabled && pressed ? palette.surfaceAlt : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <IconSymbol name={icon as any} size={16} color={palette.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: palette.text, fontSize: 14 }}>{label}</Text>
        {hint && (
          <Text style={{ color: palette.textSoft, fontSize: 11, marginTop: 2 }}>
            {hint}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// ─── Custom animated top bar ────────────────────────────────────────────────

function ThreadTopBar({
  animValue,
  topInset,
  palette,
  isDark,
  threadTitle,
  workDir,
  modelQueue,
  modelPickerOpen,
  onToggleModelPicker,
  onBack,
  threadStatus,
  onStop,
  onCopyConversation,
  copiedConvo,
  canCopy,
}: {
  animValue: Animated.Value;
  topInset: number;
  palette: Palette;
  isDark: boolean;
  threadTitle: string;
  workDir?: string | null;
  modelQueue: ModelEntry[];
  modelPickerOpen: boolean;
  onToggleModelPicker: () => void;
  onBack: () => void;
  threadStatus: ThreadStatus;
  onStop: () => void;
  onCopyConversation: () => void;
  copiedConvo: boolean;
  canCopy: boolean;
}) {
  const active = modelQueue.filter((m) => m.enabled)[0] ?? null;
  const dotColor = active ? PROVIDER_COLOR[active.provider] ?? "#6B7280" : null;
  const shortName = active
    ? active.name.includes("/")
      ? active.name.split("/").pop()!
      : active.name
    : null;
  const cwdName = workDir
    ? workDir.split("/").filter(Boolean).pop() ?? workDir
    : "";

  const translateY = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -(topInset + TOP_BAR_HEIGHT)],
  });
  const opacity = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const blurTint = isDark ? "systemChromeMaterialDark" : "systemChromeMaterial";

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingTop: topInset,
        zIndex: 30,
        transform: [{ translateY }],
        opacity,
      }}
    >
      <View
        style={{
          height: TOP_BAR_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 8,
        }}
      >
        {/* Back — blur pill */}
        <TouchableBounce sensory onPress={onBack}>
          <BlurView
            tint={blurTint}
            intensity={80}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconSymbol name="chevron.left" color={palette.text} size={18} />
          </BlurView>
        </TouchableBounce>

        {/* Title area (centered) */}
        <View style={{ flex: 1, alignItems: "center" }}>
          {active ? (
            <TouchableBounce sensory onPress={onToggleModelPicker}>
              <View style={{ alignItems: "center", gap: 1 }}>
                <BlurView
                  tint={blurTint}
                  intensity={80}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    borderRadius: 999,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 3.5,
                      backgroundColor: dotColor ?? "#6B7280",
                    }}
                  />
                  <Text
                    style={{
                      color: palette.text,
                      fontSize: 13,
                      fontWeight: "600",
                      maxWidth: 160,
                    }}
                    numberOfLines={1}
                  >
                    {shortName}
                  </Text>
                  <IconSymbol
                    name={modelPickerOpen ? "chevron.up" : "chevron.down"}
                    size={9}
                    color={palette.textMuted as any}
                  />
                </BlurView>
                {cwdName ? (
                  <Text
                    style={{
                      color: palette.textMuted,
                      fontSize: 10,
                      marginTop: 1,
                      maxWidth: 200,
                      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    }}
                    numberOfLines={1}
                  >
                    {cwdName}
                  </Text>
                ) : null}
              </View>
            </TouchableBounce>
          ) : (
            <Text
              style={{ color: palette.text, fontSize: 16, fontWeight: "600" }}
              numberOfLines={1}
            >
              {threadTitle}
            </Text>
          )}
        </View>

        {/* Right action cluster — blur pills */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {threadStatus === "running" && (
            <TouchableBounce sensory onPress={onStop}>
              <BlurView
                tint={blurTint}
                intensity={80}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  overflow: "hidden",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconSymbol name="stop.fill" color={palette.danger} size={16} />
              </BlurView>
            </TouchableBounce>
          )}
          <TouchableBounce
            sensory
            disabled={!canCopy}
            onPress={onCopyConversation}
          >
            <BlurView
              tint={blurTint}
              intensity={80}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
                opacity: canCopy ? 1 : 0.3,
              }}
            >
              <IconSymbol
                name={copiedConvo ? "checkmark" : "doc.on.doc"}
                color={copiedConvo ? palette.success : palette.textMuted}
                size={16}
              />
            </BlurView>
          </TouchableBounce>
        </View>
      </View>
    </Animated.View>
  );
}

function ModelPickerBar({
  onChooseDirectory,
  canChangeDirectory,
  currentWorkDir,
  isDark,
}: {
  onChooseDirectory?: () => void;
  canChangeDirectory?: boolean;
  currentWorkDir?: string;
  isDark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const settings = useGatewayStore((s) => s.settings);
  const actions  = useGatewayStore((s) => s.actions);
  const queue    = (settings.modelQueue ?? []).filter((m) => m.enabled);

  // Register the module-level opener so HeaderTitle (inside the native
  // header, outside this component tree) can trigger it without any
  // React state flowing through Stack.Screen options.
  useEffect(() => {
    _openModelPicker = () => setOpen(true);
    return () => { _openModelPicker = null; };
  }, []);

  const close = () => setOpen(false);

  // Allow opening even with zero models so users can still reach
  // "Change working directory" via this picker on a fresh thread.
  if (queue.length === 0 && !onChooseDirectory) return null;

  const selectModel = (entry: ModelEntry) => {
    const newQueue = [entry, ...settings.modelQueue.filter((m) => m.id !== entry.id)];
    actions.setSettings({
      serverUrl:       settings.serverUrl,
      bearerToken:     settings.bearerToken,
      model:           settings.model,
      modelQueue:      newQueue,
      autoCompact:     settings.autoCompact,
      streamingEnabled: settings.streamingEnabled,
    });
    close();
  };

  const dropBg     = isDark ? "#1c1c1e" : "#fff";
  const dropBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

  return (
    <>
      {/* Dropdown — rendered in a Modal so it's never clipped by parent overflow */}
      <Modal
        transparent
        visible={open}
        animationType="none"
        onRequestClose={close}
      >
        <Pressable
          style={{ flex: 1 }}
          onPress={close}
        >
          {/* Position the card near the top-center of the screen */}
          <View
            style={{
              paddingTop: 110,
              alignItems: "center",
            }}
          >
            <Pressable>
              <View
                style={{
                  backgroundColor: dropBg,
                  borderRadius: BORDER_RADIUS.lg,
                  borderWidth: 1,
                  borderColor: dropBorder,
                  minWidth: 220,
                  overflow: "hidden",
                  ...SHADOW.md,
                }}
              >
                {queue.map((entry, i) => {
                  const isActive = i === 0;
                  const color    = PROVIDER_COLOR[entry.provider] ?? "#6B7280";
                  const name     = entry.name.includes("/") ? entry.name.split("/").pop()! : entry.name;
                  return (
                    <TouchableBounce key={entry.id} sensory onPress={() => selectModel(entry)}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 9,
                          paddingHorizontal: 14,
                          paddingVertical: 11,
                          borderBottomWidth: 1,
                          borderBottomColor: dropBorder,
                          backgroundColor: isActive
                            ? isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"
                            : "transparent",
                        }}
                      >
                        <View
                          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }}
                        />
                        <Text
                          style={{
                            flex: 1,
                            color: isDark ? "#fff" : "#000",
                            fontSize: 13.5,
                            fontWeight: isActive ? "600" : "400",
                          }}
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                        {isActive && (
                          <IconSymbol name="checkmark" size={12} color={color} />
                        )}
                      </View>
                    </TouchableBounce>
                  );
                })}
                {/* Change working directory row. Disabled once the thread
                    has messages (claw sessions are pinned to the cwd
                    they started with). */}
                {onChooseDirectory && (
                  <TouchableBounce
                    sensory
                    disabled={!canChangeDirectory}
                    onPress={() => { close(); onChooseDirectory(); }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 9,
                        paddingHorizontal: 14,
                        paddingVertical: 11,
                        opacity: canChangeDirectory ? 1 : 0.4,
                      }}
                    >
                      <IconSymbol
                        name="folder"
                        size={13}
                        color={isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)"}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={{
                            color: isDark ? "#fff" : "#000",
                            fontSize: 13.5,
                            fontWeight: "500",
                          }}
                          numberOfLines={1}
                        >
                          Working directory
                        </Text>
                        {currentWorkDir ? (
                          <Text
                            style={{
                              color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)",
                              fontSize: 11,
                              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                              marginTop: 2,
                            }}
                            numberOfLines={1}
                          >
                            {currentWorkDir}
                          </Text>
                        ) : null}
                      </View>
                      <IconSymbol
                        name="chevron.right"
                        size={11}
                        color={isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)"}
                      />
                    </View>
                  </TouchableBounce>
                )}
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** SF Symbol name + accent color for each tool type */
const TOOL_META: Record<string, { icon: string; color: string }> = {
  // ── Shell execution ──────────────────────────────────────────────────
  bash:               { icon: "terminal",                      color: "#A855F7" },
  Bash:               { icon: "terminal",                      color: "#A855F7" },
  // ── File reading ─────────────────────────────────────────────────────
  read:               { icon: "doc.text",                      color: "#6B7280" },
  Read:               { icon: "doc.text",                      color: "#6B7280" },
  read_file:          { icon: "doc.text",                      color: "#6B7280" },
  cat:                { icon: "doc.text",                      color: "#6B7280" },
  view:               { icon: "doc.text",                      color: "#6B7280" },
  // ── File writing / editing ───────────────────────────────────────────
  edit:               { icon: "pencil",                        color: "#3B82F6" },
  Edit:               { icon: "pencil",                        color: "#3B82F6" },
  edit_file:          { icon: "pencil",                        color: "#3B82F6" },
  str_replace_editor: { icon: "pencil",                        color: "#3B82F6" },
  write:              { icon: "square.and.pencil",             color: "#3B82F6" },
  Write:              { icon: "square.and.pencil",             color: "#3B82F6" },
  write_file:         { icon: "square.and.pencil",             color: "#3B82F6" },
  create:             { icon: "doc.badge.plus",                color: "#22C55E" },
  create_file:        { icon: "doc.badge.plus",                color: "#22C55E" },
  // ── Search ───────────────────────────────────────────────────────────
  search:             { icon: "magnifyingglass",               color: "#F97316" },
  Search:             { icon: "magnifyingglass",               color: "#F97316" },
  grep:               { icon: "magnifyingglass",               color: "#F97316" },
  Grep:               { icon: "magnifyingglass",               color: "#F97316" },
  grep_search:        { icon: "magnifyingglass",               color: "#F97316" },
  search_files:       { icon: "magnifyingglass",               color: "#F97316" },
  web_search:         { icon: "magnifyingglass.circle",        color: "#0EA5E9" },
  WebSearch:          { icon: "magnifyingglass.circle",        color: "#0EA5E9" },
  // ── Directory / file navigation ──────────────────────────────────────
  glob:               { icon: "folder",                        color: "#F97316" },
  Glob:               { icon: "folder",                        color: "#F97316" },
  glob_search:        { icon: "folder",                        color: "#F97316" },
  ls:                 { icon: "folder",                        color: "#6B7280" },
  list_directory:     { icon: "folder",                        color: "#6B7280" },
  // ── Git ──────────────────────────────────────────────────────────────
  git:                { icon: "arrow.triangle.branch",         color: "#F59E0B" },
  // ── File operations ──────────────────────────────────────────────────
  diff:               { icon: "arrow.left.arrow.right",        color: "#8B5CF6" },
  mv:                 { icon: "arrow.right.doc.on.clipboard",  color: "#6B7280" },
  move_file:          { icon: "arrow.right.doc.on.clipboard",  color: "#6B7280" },
  cp:                 { icon: "doc.on.doc",                    color: "#6B7280" },
  rm:                 { icon: "trash",                         color: "#EF4444" },
  delete_file:        { icon: "trash",                         color: "#EF4444" },
  mkdir:              { icon: "folder.badge.plus",             color: "#22C55E" },
  // ── Obsidian vault ────────────────────────────────────────────────────
  vault_read:         { icon: "__obsidian__",                   color: "#7C3AED" },
  vault_write:        { icon: "__obsidian__",                   color: "#7C3AED" },
  // ── Thinking ─────────────────────────────────────────────────────────
  think:              { icon: "brain.head.profile",            color: "#14B8A6" },
  // ── Fallback ─────────────────────────────────────────────────────────
  unknown:            { icon: "hammer",                        color: "#6B7280" },
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const OBSIDIAN_ICON = require("@/assets/icons/obsidian-icon.png");

/** Render a tool badge icon — SF Symbol for most tools, Obsidian logo for vault ops. */
function ToolBadgeIcon({ meta, size, color }: { meta: { icon: string; color: string }; size: number; color: string }) {
  if (meta.icon === "__obsidian__") {
    return <Image source={OBSIDIAN_ICON} style={{ width: size, height: size, opacity: 0.9 }} />;
  }
  return <IconSymbol name={meta.icon as any} size={size} color={color} />;
}

/** Resolve tool meta, detecting Obsidian vault file operations. */
function resolveToolMeta(step: { tool: string; label?: string; detail?: string }) {
  // Check if this tool targets a vault path (label or detail contains vault indicators)
  const target = (step.label ?? "") + " " + (step.detail ?? "");
  const isVault = /obsidian|\.obsidian|claw-code\/memory/i.test(target)
    || /\/Obsidian\//i.test(target);
  if (isVault) {
    const isWrite = /edit|write|create|append|mkdir/i.test(step.tool);
    return isWrite ? TOOL_META.vault_write : TOOL_META.vault_read;
  }
  return TOOL_META[step.tool] ?? TOOL_META.unknown;
}

const THINKING_PHRASES = [
  "thinking",
  "cooking",
  "whipping that cream",
  "making magic",
  "scouring the ocean floor",
  "big braining",
  "connecting the pieces",
];

/** Per-letter staggered Y bounce. Each character is its own Animated.Text so we can
 *  apply transform (nested-inside-Text transforms are ignored on RN). */
function BouncingPhrase({ text, color }: { text: string; color: string }) {
  const letters = useMemo(() => Array.from(text), [text]);
  const animsRef = useRef<Animated.Value[]>([]);
  while (animsRef.current.length < letters.length) {
    animsRef.current.push(new Animated.Value(0));
  }

  useEffect(() => {
    const STAGGER = 55;
    const UP = 220;
    const DOWN = 260;
    const TAIL = 700;
    const cycleMs = letters.length * STAGGER + UP + DOWN + TAIL;

    const anims = letters.map((_, i) => {
      const v = animsRef.current[i];
      v.setValue(0);
      const restAfter = Math.max(0, cycleMs - (i * STAGGER + UP + DOWN));
      return Animated.loop(
        Animated.sequence([
          Animated.delay(i * STAGGER),
          Animated.timing(v, { toValue: -2.5, duration: UP, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
          Animated.timing(v, { toValue: 0,    duration: DOWN, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
          Animated.delay(restAfter),
        ])
      );
    });
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [letters]);

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      {letters.map((ch, i) => (
        <Animated.Text
          key={`${text}-${i}`}
          style={{
            color,
            fontSize: 13,
            fontWeight: "500",
            transform: [{ translateY: animsRef.current[i] }],
          }}
        >
          {ch === " " ? "\u00A0" : ch}
        </Animated.Text>
      ))}
    </View>
  );
}

/** Three pulsing period dots — must be top-level Animated.Text (not nested
 *  inside another <Text>), otherwise native-driver opacity updates have no
 *  native view to land on and the dots appear frozen. */
function PulsingDots({ color }: { color: string }) {
  const op1 = useRef(new Animated.Value(0.2)).current;
  const op2 = useRef(new Animated.Value(0.2)).current;
  const op3 = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const makePulse = (val: Animated.Value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1,   duration: 320, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0.2, duration: 320, useNativeDriver: true }),
        ])
      );

    const a1 = makePulse(op1);
    a1.start();
    const animRefs: Animated.CompositeAnimation[] = [a1];
    const t1 = setTimeout(() => { const a = makePulse(op2); a.start(); animRefs.push(a); }, 213);
    const t2 = setTimeout(() => { const a = makePulse(op3); a.start(); animRefs.push(a); }, 426);

    return () => {
      animRefs.forEach((a) => a.stop());
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [op1, op2, op3]);

  const dotStyle = { color, fontSize: 13, fontWeight: "500" as const };
  return (
    <>
      <Animated.Text style={[dotStyle, { opacity: op1 }]}>.</Animated.Text>
      <Animated.Text style={[dotStyle, { opacity: op2 }]}>.</Animated.Text>
      <Animated.Text style={[dotStyle, { opacity: op3 }]}>.</Animated.Text>
    </>
  );
}

/** Cycling text label with three pulsing period dots at text baseline. */
function CyclingLabel({ color }: { color: string }) {
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    const phraseTimer = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % THINKING_PHRASES.length);
    }, 2800);
    return () => clearInterval(phraseTimer);
  }, []);

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      <BouncingPhrase text={THINKING_PHRASES[phraseIdx]} color={color} />
      <PulsingDots color={color} />
    </View>
  );
}

function CompactingLabel({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      <Text style={{ color, fontSize: 13, fontWeight: "500" }}>compacting</Text>
      <PulsingDots color={color} />
    </View>
  );
}

function RespondingLabel({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      <Text style={{ color, fontSize: 13, fontWeight: "500" }}>responding</Text>
      <PulsingDots color={color} />
    </View>
  );
}

function ThinkingIndicator({
  status,
  toolSteps,
  permissionRequests,
  onApprove,
  onDeny,
  isDark,
  isCompacting = false,
  runPhase = "idle",
  thinkingContent = "",
}: {
  status: ThreadStatus;
  toolSteps: ToolStep[];
  permissionRequests: PermissionRequest[];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  isDark: boolean;
  isCompacting?: boolean;
  runPhase?: string;
  thinkingContent?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [tappedBadgeId, setTappedBadgeId] = useState<string | null>(null);
  const palette = usePalette();

  const MAX_VISIBLE  = 8;
  const visibleBadges = toolSteps.slice(-MAX_VISIBLE);
  const hiddenCount   = Math.max(0, toolSteps.length - MAX_VISIBLE);
  const hasBadges    = toolSteps.length > 0;
  const hasThinking  = thinkingContent.length > 0;
  const dotColor     = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.35)";
  const bubbleBg     = isDark ? "#1c1c1e" : "#fff";
  const bubbleBorder = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  const tappedStep = tappedBadgeId ? toolSteps.find((s) => s.id === tappedBadgeId) : null;

  return (
    <View style={{ gap: 6, paddingTop: SPACING.xs }}>

      {/* ── Compact inline label + individual tappable badges ────── */}
      <View
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          paddingVertical: 4,
        }}
      >
        {/* Phase label — tappable to toggle thinking */}
        <TouchableBounce sensory onPress={hasThinking ? () => setThinkingExpanded((v) => !v) : undefined}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <ThinkingSprite size={21} />
            {isCompacting || runPhase === "compacting"
              ? <CompactingLabel color="#F59E0B" />
              : runPhase === "responding"
                ? <RespondingLabel color={dotColor} />
                : <CyclingLabel color={dotColor} />
            }
            {hasThinking && (
              <IconSymbol
                name={thinkingExpanded ? "chevron.up" : "chevron.down"}
                size={9}
                color={dotColor}
              />
            )}
          </View>
        </TouchableBounce>

        {hasBadges && (
          <View style={{ width: 1, height: 14, backgroundColor: dotColor, opacity: 0.25, marginHorizontal: 1 }} />
        )}

        {/* Individual tappable badges — each toggles its label.
            Note: claw's stream API doesn't emit tool_end in real-time, so
            we intentionally don't show a running-spinner state. Each badge
            appearing at all means the tool invocation was started; its
            mere presence is the live-progress indicator. */}
        {visibleBadges.map((step) => {
          const meta     = resolveToolMeta(step);
          const isError  = step.status === "error";
          const isActive = tappedBadgeId === step.id;
          return (
            <TouchableBounce
              key={step.id}
              sensory
              onPress={() => setTappedBadgeId((prev) => prev === step.id ? null : step.id)}
            >
              <View
                style={{
                  width: 26, height: 26, borderRadius: 7,
                  backgroundColor: isActive
                    ? `${meta.color}33`
                    : isError
                      ? "rgba(239,68,68,0.12)"
                      : isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)",
                  borderWidth: isActive ? 1 : 0,
                  borderColor: `${meta.color}55`,
                  justifyContent: "center", alignItems: "center",
                }}
              >
                {isError
                  ? <IconSymbol name="xmark.circle.fill" size={12} color="#EF4444" />
                  : <ToolBadgeIcon meta={meta} size={12} color={meta.color} />
                }
              </View>
            </TouchableBounce>
          );
        })}

        {hiddenCount > 0 && (
          <View
            style={{
              paddingHorizontal: 5, paddingVertical: 2,
              backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
              borderRadius: 6,
            }}
          >
            <Text style={{ color: dotColor, fontSize: 10, fontWeight: "600" }}>
              +{hiddenCount}
            </Text>
          </View>
        )}

        {/* Expand toggle for full step list */}
        {hasBadges && (
          <TouchableBounce sensory onPress={() => setExpanded((v) => !v)}>
            <IconSymbol
              name={expanded ? "chevron.up" : "chevron.down"}
              size={9}
              color={dotColor}
            />
          </TouchableBounce>
        )}
      </View>

      {/* ── Tapped badge label tooltip ────────────────────────── */}
      {tappedStep && (
        <View
          style={{
            backgroundColor: bubbleBg,
            borderRadius: BORDER_RADIUS.md,
            borderWidth: 1,
            borderColor: `${(resolveToolMeta(tappedStep)).color}33`,
            paddingHorizontal: 10,
            paddingVertical: 6,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            alignSelf: "flex-start",
          }}
        >
          {(() => {
            const meta = resolveToolMeta(tappedStep);
            return (
              <>
                <View style={{
                  width: 18, height: 18, borderRadius: 4,
                  backgroundColor: `${meta.color}20`,
                  justifyContent: "center", alignItems: "center",
                }}>
                  <ToolBadgeIcon meta={meta} size={10} color={meta.color} />
                </View>
                <Text
                  style={{
                    color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)",
                    fontSize: 12,
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    flexShrink: 1,
                  }}
                  numberOfLines={2}
                >
                  {tappedStep.label || tappedStep.tool}
                </Text>
              </>
            );
          })()}
        </View>
      )}

      {/* ── Expanded step list ────────────────────────────── */}
      {expanded && hasBadges && (
        <View
          style={{
            backgroundColor: bubbleBg,
            borderRadius: BORDER_RADIUS.lg,
            borderWidth: 1,
            borderColor: bubbleBorder,
            paddingHorizontal: 12,
            paddingVertical: 8,
            gap: 6,
            ...SHADOW.sm,
          }}
        >
          {toolSteps.map((step) => {
            const meta    = resolveToolMeta(step);
            const isError = step.status === "error";
            return (
              <View key={step.id} style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                {isError
                  ? <IconSymbol name="xmark.circle.fill" size={12} color="#EF4444" />
                  : <IconSymbol name="checkmark.circle.fill" size={12} color="#22C55E" />
                }
                <View style={{
                  width: 20, height: 20, borderRadius: 5,
                  backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                  justifyContent: "center", alignItems: "center",
                }}>
                  <ToolBadgeIcon meta={meta} size={11} color={meta.color} />
                </View>
                <Text
                  style={{
                    color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)",
                    fontSize: 12.5,
                    fontWeight: "500",
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    flexShrink: 1,
                  }}
                  numberOfLines={1}
                >
                  {step.label}
                </Text>
              </View>
            );
          })}
        </View>
      )}


      {/* ── Live thinking content (expandable) ─────────────── */}
      {thinkingExpanded && hasThinking && (
        <View
          style={{
            backgroundColor: isDark ? "rgba(20,184,166,0.06)" : "rgba(20,184,166,0.04)",
            borderRadius: BORDER_RADIUS.lg,
            borderWidth: 1,
            borderColor: isDark ? "rgba(20,184,166,0.18)" : "rgba(20,184,166,0.12)",
            paddingHorizontal: 12,
            paddingVertical: 10,
            maxHeight: 200,
          }}
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text
              style={{
                color: isDark ? "rgba(255,255,255,0.50)" : "rgba(0,0,0,0.45)",
                fontSize: 12,
                lineHeight: 18,
                fontStyle: "italic",
              }}
            >
              {thinkingContent}
            </Text>
          </ScrollView>
        </View>
      )}

      {/* ── Permission request cards ───────────────────────── */}
      {permissionRequests.map((req) => {
        const meta = resolveToolMeta(req);
        return (
          <View
            key={req.id}
            style={{
              backgroundColor: bubbleBg,
              borderRadius: BORDER_RADIUS.lg,
              borderWidth: 1.5,
              borderColor: "#FF9500",
              overflow: "hidden",
              ...SHADOW.sm,
            }}
          >
            {/* Orange header strip */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
                backgroundColor: isDark ? "rgba(255,149,0,0.15)" : "rgba(255,149,0,0.10)",
                paddingHorizontal: 14,
                paddingVertical: 9,
              }}
            >
              <View
                style={{
                  width: 24, height: 24, borderRadius: 7,
                  backgroundColor: "rgba(255,149,0,0.20)",
                  justifyContent: "center", alignItems: "center",
                }}
              >
                <ToolBadgeIcon meta={meta} size={13} color={"#FF9500"} />
              </View>
              <Text style={{ color: "#FF9500", fontSize: 13, fontWeight: "700", flex: 1 }}>
                Permission Required
              </Text>
              <IconSymbol name="exclamationmark.triangle.fill" size={13} color={"#FF9500"} />
            </View>

            {/* Description + buttons */}
            <View style={{ padding: 14, gap: 12 }}>
              <Text
                style={{
                  color: palette.text,
                  fontSize: 13,
                  lineHeight: 18,
                  fontFamily: req.tool === "bash" ? (Platform.OS === "ios" ? "Menlo" : "monospace") : undefined,
                }}
              >
                {req.description}
              </Text>
              <View style={{ flexDirection: "row", gap: SPACING.sm }}>
                <TouchableBounce sensory onPress={() => onApprove(req.id)} style={{ flex: 1 }}>
                  <View
                    style={{
                      backgroundColor: palette.accent,
                      borderRadius: BORDER_RADIUS.md,
                      paddingVertical: 9,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>Allow</Text>
                  </View>
                </TouchableBounce>
                <TouchableBounce sensory onPress={() => onDeny(req.id)} style={{ flex: 1 }}>
                  <View
                    style={{
                      backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                      borderRadius: BORDER_RADIUS.md,
                      paddingVertical: 9,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: palette.text, fontSize: 14, fontWeight: "600" }}>Deny</Text>
                  </View>
                </TouchableBounce>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
