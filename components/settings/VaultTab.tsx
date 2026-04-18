import { Text, View } from "react-native";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { GlassButton } from "@/components/ui/GlassButton";
import { usePalette } from "@/hooks/usePalette";
import {
  Card,
  Caption,
  Field,
  Hairline,
  Segmented,
  ToggleRow,
} from "./_shared";
import { useSettingsForm } from "./SettingsFormContext";

export function VaultTab() {
  const palette = usePalette();
  const form = useSettingsForm();
  const {
    obsidianEnabled,
    setObsidianEnabled,
    obsidianProvider,
    setObsidianProvider,
    obsidianPath,
    setObsidianPath,
    obsidianLocalUri,
    obsidianLocalDisplay,
    obsidianUseForMemory,
    setObsidianUseForMemory,
    obsidianUseForReference,
    setObsidianUseForReference,
    obsidianUseMcpVault,
    setObsidianUseMcpVault,
    obsidianStatus,
    setObsidianStatus,
    obsidianMessage,
    setObsidianMessage,
    obsidianChecking,
    detectedVaults,
    setDetectedVaults,
    validateObsidianBackend,
    detectVaultsOnBackend,
    createVaultOnBackend,
    pickLocalVault,
    setObsidianLocalUri,
    setObsidianLocalDisplay,
    checkHeadlessStatus,
    installHeadless,
    headlessLogin,
    headlessSetupAndSync,
    headlessStep,
    headlessEmail,
    setHeadlessEmail,
    headlessPassword,
    setHeadlessPassword,
    headlessMfa,
    setHeadlessMfa,
    headlessRemoteVaults,
    headlessMessage,
    headlessBusy,
    setHeadlessMessage,
    setHeadlessStep,
  } = form;

  const showIntro = obsidianStatus !== "ok";

  return (
    <>
      {showIntro && (
        <View style={{ marginBottom: 18, marginHorizontal: 4, gap: 10 }}>
          <Text
            style={{
              color: palette.text,
              fontSize: 17,
              fontWeight: "600",
              letterSpacing: 0.1,
            }}
          >
            Give Claw a notebook
          </Text>
          <Text
            style={{
              color: palette.textMuted,
              fontSize: 14,
              lineHeight: 21,
            }}
          >
            Point Claw at a folder of markdown notes — an{" "}
            <Text style={{ color: palette.text, fontWeight: "600" }}>Obsidian</Text>{" "}
            vault works great, but any plain-text folder will do. Claw reads the
            notes as background context and writes new memory notes back into
            the folder as it learns about you and your projects.
          </Text>
          <Text
            style={{
              color: palette.textSoft,
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            Why bother: instead of starting cold every conversation, Claw
            carries facts, preferences, and project context forward — and
            everything lives in your notes, readable and editable in any tool.
            Pick how it reaches your vault below.
          </Text>
        </View>
      )}
      <Card>
        <View style={{ padding: 18, gap: 14 }}>
          <Segmented
            options={[
              { key: "sync", label: "Obsidian Sync" },
              { key: "backend", label: "Manual path" },
              { key: "local", label: "This device" },
            ]}
            value={obsidianProvider}
            onChange={(k) => {
              setObsidianProvider(k as "sync" | "backend" | "local");
              setObsidianStatus("idle");
              setObsidianMessage(null);
              setDetectedVaults([]);
              setHeadlessMessage(null);
              if (k === "sync") checkHeadlessStatus();
            }}
          />
          {obsidianProvider === "sync" ? (
            <View style={{ gap: 12 }}>
              {headlessStep === "checking" && (
                <Text
                  style={{
                    color: palette.textMuted,
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  Checking server…
                </Text>
              )}

              {headlessStep === "not_installed" && (
                <>
                  <Text
                    style={{
                      color: palette.textSoft,
                      fontSize: 13,
                      lineHeight: 18,
                    }}
                  >
                    Obsidian Headless syncs your vault via Obsidian Sync —
                    same encryption, no desktop app needed. Requires an
                    Obsidian Sync subscription.
                  </Text>
                  <TouchableBounce sensory onPress={installHeadless}>
                    <View
                      style={{
                        borderRadius: 12,
                        paddingVertical: 13,
                        alignItems: "center",
                        backgroundColor: palette.accent,
                        opacity: headlessBusy ? 0.6 : 1,
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontWeight: "600",
                          fontSize: 14,
                        }}
                      >
                        {headlessBusy
                          ? "Installing…"
                          : "Install Obsidian Headless"}
                      </Text>
                    </View>
                  </TouchableBounce>
                </>
              )}

              {headlessStep === "not_logged_in" && (
                <>
                  <Field
                    placeholder="Obsidian account email"
                    value={headlessEmail}
                    onChangeText={setHeadlessEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  <Field
                    placeholder="Password"
                    value={headlessPassword}
                    onChangeText={setHeadlessPassword}
                    secureTextEntry
                  />
                  <Field
                    placeholder="2FA code (if enabled)"
                    value={headlessMfa}
                    onChangeText={setHeadlessMfa}
                    keyboardType="number-pad"
                  />
                  <TouchableBounce sensory onPress={headlessLogin}>
                    <View
                      style={{
                        borderRadius: 12,
                        paddingVertical: 13,
                        alignItems: "center",
                        backgroundColor: palette.accent,
                        opacity: headlessBusy ? 0.6 : 1,
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontWeight: "600",
                          fontSize: 14,
                        }}
                      >
                        {headlessBusy ? "Logging in…" : "Sign in"}
                      </Text>
                    </View>
                  </TouchableBounce>
                </>
              )}

              {headlessStep === "pick_vault" && (
                <>
                  {headlessRemoteVaults.length > 0 ? (
                    <View style={{ gap: 6 }}>
                      <Text
                        style={{
                          color: palette.textMuted,
                          fontSize: 12,
                          fontWeight: "600",
                          letterSpacing: 0.8,
                          textTransform: "uppercase",
                        }}
                      >
                        Your remote vaults
                      </Text>
                      {headlessRemoteVaults.map((v) => (
                        <TouchableBounce
                          key={v.id}
                          sensory
                          onPress={() =>
                            headlessSetupAndSync(v.name || v.id)
                          }
                        >
                          <View
                            style={{
                              backgroundColor: palette.surfaceAlt,
                              borderRadius: 10,
                              paddingHorizontal: 14,
                              paddingVertical: 10,
                              flexDirection: "row",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <Text
                              style={{
                                color: palette.text,
                                fontSize: 14,
                                fontWeight: "600",
                                flex: 1,
                              }}
                            >
                              {v.name}
                            </Text>
                            <Text
                              style={{
                                color: palette.textSoft,
                                fontSize: 11,
                              }}
                            >
                              {v.encryption === "e2ee"
                                ? "E2E encrypted"
                                : "Standard"}
                            </Text>
                          </View>
                        </TouchableBounce>
                      ))}
                    </View>
                  ) : (
                    <Text
                      style={{
                        color: palette.textSoft,
                        fontSize: 13,
                        textAlign: "center",
                      }}
                    >
                      {headlessBusy
                        ? "Loading vaults…"
                        : "No remote vaults found. Create one in Obsidian first."}
                    </Text>
                  )}
                </>
              )}

              {headlessStep === "syncing" && (
                <View
                  style={{
                    backgroundColor: palette.surfaceAlt,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    gap: 4,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: palette.success,
                      }}
                    />
                    <Text
                      style={{
                        color: palette.text,
                        fontSize: 14,
                        fontWeight: "600",
                      }}
                    >
                      Obsidian Sync active
                    </Text>
                  </View>
                  <Text
                    style={{ color: palette.textMuted, fontSize: 12 }}
                    numberOfLines={1}
                  >
                    {obsidianPath}
                  </Text>
                </View>
              )}

              {headlessMessage && (
                <Text
                  style={{
                    color:
                      headlessStep === "syncing"
                        ? palette.success
                        : palette.textSoft,
                    fontSize: 13,
                  }}
                >
                  {headlessMessage}
                </Text>
              )}
            </View>
          ) : obsidianProvider === "backend" ? (
            <>
              {/* Show detected vaults as tappable pills */}
              {detectedVaults.length > 0 && !obsidianPath.trim() && (
                <View style={{ gap: 6 }}>
                  <Text
                    style={{
                      color: palette.textMuted,
                      fontSize: 12,
                      fontWeight: "600",
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Found on server
                  </Text>
                  {detectedVaults.map((v) => (
                    <TouchableBounce
                      key={v.path}
                      sensory
                      onPress={() => {
                        setObsidianPath(v.path);
                        setDetectedVaults([]);
                        setTimeout(
                          () => validateObsidianBackend(v.path),
                          100
                        );
                      }}
                    >
                      <View
                        style={{
                          backgroundColor: palette.surfaceAlt,
                          borderRadius: 10,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              color: palette.text,
                              fontSize: 14,
                              fontWeight: "600",
                            }}
                          >
                            {v.name}
                          </Text>
                          <Text
                            style={{
                              color: palette.textMuted,
                              fontSize: 11,
                              marginTop: 2,
                            }}
                            numberOfLines={1}
                          >
                            {v.path}
                          </Text>
                        </View>
                        <Text
                          style={{
                            color: palette.textSoft,
                            fontSize: 12,
                          }}
                        >
                          {v.noteCount} note{v.noteCount === 1 ? "" : "s"}
                        </Text>
                      </View>
                    </TouchableBounce>
                  ))}
                </View>
              )}
              {obsidianStatus !== "ok" && (
                <Field
                  placeholder="Vault path on server (or tap Detect below)"
                  value={obsidianPath}
                  onChangeText={setObsidianPath}
                />
              )}
              {obsidianStatus === "ok" && obsidianPath.trim() && (
                <View
                  style={{
                    backgroundColor: palette.surfaceAlt,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                  }}
                >
                  <Text
                    style={{
                      color: palette.textMuted,
                      fontSize: 11,
                      fontWeight: "600",
                      letterSpacing: 1.2,
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    Connected vault
                  </Text>
                  <Text
                    style={{
                      color: palette.text,
                      fontSize: 14,
                      fontWeight: "500",
                    }}
                    numberOfLines={2}
                  >
                    {obsidianPath}
                  </Text>
                </View>
              )}
              {obsidianStatus !== "ok" && (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <GlassButton
                      onPress={detectVaultsOnBackend}
                      disabled={obsidianChecking}
                      tintColor={palette.accent}
                      style={{
                        borderRadius: 12,
                        paddingVertical: 14,
                        width: "100%",
                        opacity: obsidianChecking ? 0.6 : 1,
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontWeight: "600",
                          fontSize: 14,
                          letterSpacing: 0.2,
                        }}
                      >
                        {obsidianChecking ? "Scanning…" : "Detect"}
                      </Text>
                    </GlassButton>
                  </View>
                  <View style={{ flex: 1 }}>
                    <GlassButton
                      onPress={createVaultOnBackend}
                      disabled={obsidianChecking}
                      tintColor={palette.text}
                      style={{
                        borderRadius: 12,
                        paddingVertical: 14,
                        width: "100%",
                        opacity: obsidianChecking ? 0.6 : 1,
                      }}
                    >
                      <Text
                        style={{
                          color: palette.bg,
                          fontWeight: "600",
                          fontSize: 14,
                          letterSpacing: 0.2,
                        }}
                      >
                        {obsidianChecking ? "Creating…" : "Create vault"}
                      </Text>
                    </GlassButton>
                  </View>
                </View>
              )}
              {obsidianStatus !== "ok" && obsidianPath.trim() && (
                <TouchableBounce
                  sensory
                  onPress={() => validateObsidianBackend()}
                >
                  <View
                    style={{
                      borderRadius: 12,
                      paddingVertical: 13,
                      alignItems: "center",
                      backgroundColor: palette.accent,
                      opacity: obsidianChecking ? 0.4 : 1,
                    }}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontWeight: "600",
                        fontSize: 14,
                        letterSpacing: 0.2,
                      }}
                    >
                      Connect
                    </Text>
                  </View>
                </TouchableBounce>
              )}
            </>
          ) : (
            <>
              {obsidianLocalDisplay ? (
                <View
                  style={{
                    backgroundColor: palette.surfaceAlt,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                  }}
                >
                  <Text
                    style={{
                      color: palette.textMuted,
                      fontSize: 11,
                      fontWeight: "600",
                      letterSpacing: 1.2,
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    Connected vault
                  </Text>
                  <Text
                    style={{
                      color: palette.text,
                      fontSize: 14,
                      fontWeight: "500",
                    }}
                    numberOfLines={2}
                  >
                    {obsidianLocalDisplay}
                  </Text>
                </View>
              ) : null}
              <TouchableBounce sensory onPress={pickLocalVault}>
                <View
                  style={{
                    borderRadius: 12,
                    paddingVertical: 13,
                    alignItems: "center",
                    backgroundColor: obsidianLocalUri
                      ? palette.surfaceAlt
                      : palette.accent,
                    opacity: obsidianChecking ? 0.6 : 1,
                  }}
                >
                  <Text
                    style={{
                      color: obsidianLocalUri ? palette.text : "#fff",
                      fontWeight: "600",
                      fontSize: 14,
                      letterSpacing: 0.2,
                    }}
                  >
                    {obsidianChecking
                      ? "Checking…"
                      : obsidianLocalUri
                      ? "Pick different folder"
                      : "Pick vault folder"}
                  </Text>
                </View>
              </TouchableBounce>
              {!obsidianLocalUri && (
                <Text
                  style={{
                    color: palette.textSoft,
                    fontSize: 12,
                    lineHeight: 17,
                  }}
                >
                  Read-only: the agent sees your vault as context but can't
                  write back to this device. For memory write-back, use the
                  backend provider.
                </Text>
              )}
            </>
          )}
          {obsidianMessage && (
            <Text
              style={{
                color:
                  obsidianStatus === "ok" ? palette.success : palette.danger,
                fontSize: 13,
                marginTop: 2,
              }}
            >
              {obsidianMessage}
            </Text>
          )}
        </View>
        {/* Only show configuration options once a vault is connected */}
        {obsidianStatus === "ok" && (
          <>
            <Hairline inset={20} />
            <ToggleRow
              title="Enable Obsidian integration"
              description="Pause vault integration without disconnecting."
              value={obsidianEnabled}
              onValueChange={setObsidianEnabled}
            />
            {obsidianEnabled && (
              <>
                <Hairline inset={20} />
                <ToggleRow
                  title="Use for memory"
                  description={
                    obsidianProvider === "backend"
                      ? "Inject notes from claw-code/memory/ as persistent context, and let the AI add or update memory notes there."
                      : "Inject notes from claw-code/memory/ as read-only persistent context."
                  }
                  value={obsidianUseForMemory}
                  onValueChange={setObsidianUseForMemory}
                />
                <Hairline inset={20} />
                <ToggleRow
                  title="Use for reference"
                  description="Let the AI read and search any note in your vault when answering."
                  value={obsidianUseForReference}
                  onValueChange={setObsidianUseForReference}
                />
                {obsidianProvider !== "local" && (
                  <>
                    <Hairline inset={20} />
                    <ToggleRow
                      title="Vault tools (MCP)"
                      description="Rich vault tools (search, frontmatter, tags). Adds ~60s startup time per message — enable only when needed."
                      value={obsidianUseMcpVault}
                      onValueChange={setObsidianUseMcpVault}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
        {/* Disconnect button when vault is connected */}
        {obsidianStatus === "ok" && (
          <>
            <Hairline inset={20} />
            <TouchableBounce
              sensory
              onPress={() => {
                setObsidianPath("");
                setObsidianLocalUri("");
                setObsidianLocalDisplay("");
                setObsidianStatus("idle");
                setObsidianMessage(null);
                setObsidianEnabled(false);
              }}
            >
              <View style={{ paddingVertical: 14, alignItems: "center" }}>
                <Text
                  style={{
                    color: palette.danger,
                    fontSize: 14,
                    fontWeight: "500",
                  }}
                >
                  Disconnect vault
                </Text>
              </View>
            </TouchableBounce>
          </>
        )}
      </Card>
      <Caption>
        {obsidianProvider === "sync"
          ? "Uses Obsidian Sync to keep your vault in sync across all devices. Requires an Obsidian Sync subscription."
          : obsidianProvider === "backend"
          ? "Point to an existing vault folder on your server. Use git or Syncthing to sync with other devices."
          : "Vault lives on this device — read-only. Pick the folder Obsidian stores its vault in."}
      </Caption>
    </>
  );
}
