import React, { useEffect } from "react";
import "./index.css";
import "./App.css";
import Viewport3D from "./components/Viewport3D";
import DraggablePanel from "./components/layout/DraggablePanel";
import AppHeader from "./components/layout/AppHeader";
import OutlinerPanel from "./components/panels/OutlinerPanel";
import InspectorPanel from "./components/panels/InspectorPanel";
import SettingsPanel from "./components/panels/SettingsPanel";
import CutListPanel from "./components/panels/CutListPanel";
import AssemblyLibraryPanel from "./components/panels/AssemblyLibraryPanel";
import LightingPanel from "./components/panels/LightingPanel";
import MaterialsPanel from "./components/panels/MaterialsPanel";
import AddComponentPanel from "./components/panels/AddComponentPanel";
import ToolsPanel from "./components/panels/ToolsPanel";
import HardwarePanel from "./components/panels/HardwarePanel";
import AssembliesPanel from "./components/panels/AssembliesPanel";
import AnimationPanel from "./components/panels/AnimationPanel";
import TutorialRecorderPanel from "./components/panels/TutorialRecorderPanel";
import MeasurePanel from "./components/panels/MeasurePanel";
import NewBoardDialog from "./components/dialogs/NewBoardDialog";
import CabinetBuilderDialog from "./components/dialogs/CabinetBuilderDialog";
import BoxBuilderDialog from "./components/dialogs/BoxBuilderDialog";
import ShakerDoorBuilderDialog from "./components/dialogs/ShakerDoorBuilderDialog";
import DrawerBuilderDialog from "./components/dialogs/DrawerBuilderDialog";
import FaceFrameBuilderDialog from "./components/dialogs/FaceFrameBuilderDialog";
import ShelvingBuilderDialog from "./components/dialogs/ShelvingBuilderDialog";
import TableBaseBuilderDialog from "./components/dialogs/TableBaseBuilderDialog";
import TableTopBuilderDialog from "./components/dialogs/TableTopBuilderDialog";
import AiHelpDialog from "./components/dialogs/AiHelpDialog";
import UserManualDialog from "./components/dialogs/UserManualDialog";
import PrintDialog from "./components/dialogs/PrintDialog";
import SavePromptDialog from "./components/dialogs/SavePromptDialog";
import AttributionDialog from "./components/dialogs/AttributionDialog";
import WelcomeDialog from "./components/dialogs/WelcomeDialog";
import KeyboardShortcutsDialog from "./components/dialogs/KeyboardShortcutsDialog";
import ErrorBoundary from "./components/layout/ErrorBoundary";
import useStore from "./store/useStore";
import { useAutosave } from "./hooks/useAutosave";
import { useGlobalHotkeys } from "./hooks/useGlobalHotkeys";
import { useOverlapWarnings } from "./hooks/useOverlapWarnings";
import { getSmartPosition } from "./utils/panelLayout";
import { getDeviceInfo } from "./utils/deviceDetector";

function SmallScreenNotice({ os }) {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        background: "#121417",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "24px",
        boxSizing: "border-box",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: "#f0f0f0",
        textAlign: "center",
      }}
    >
      <div
        className="glass-panel"
        style={{
          maxWidth: "360px",
          width: "100%",
          padding: "32px 24px",
          borderRadius: "16px",
          border: "1px solid var(--border-color)",
          background: "var(--panel-bg)",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "20px",
        }}
      >
        <span style={{ fontSize: "3rem" }}>🖥️</span>
        <h2
          style={{
            margin: 0,
            fontSize: "1.3rem",
            fontWeight: 700,
            color: "var(--accent-color)",
            letterSpacing: "0.5px",
          }}
        >
          Screen Too Small
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: "0.9rem",
            lineHeight: "1.6",
            opacity: 0.95,
          }}
        >
          Luceysketch is a detailed 3D design tool that requires a larger
          screen. Please open it on a <strong>tablet</strong> or{" "}
          <strong>computer</strong> to design your woodworking projects.
        </p>
        <div
          style={{
            fontSize: "0.72rem",
            color: "var(--text-muted)",
            borderTop: "1px solid var(--border-color)",
            paddingTop: "12px",
            width: "100%",
          }}
        >
          Detected OS: <strong>{os}</strong>
        </div>
      </div>
    </div>
  );
}

function WorkspaceApp() {
  const {
    showCutlistPanel,
    setShowCutlistPanel,
    showSettingsPanel,
    setShowSettingsPanel,
    showAssemblyLibrary,
    setShowAssemblyLibrary,
    showRecorderPanel,
    setShowRecorderPanel,
    showLightingPanel,
    setShowLightingPanel,
    showMaterialsPanel,
    setShowMaterialsPanel,
    showAddComponentPanel,
    setShowAddComponentPanel,
    showAssembliesPanel,
    setShowAssembliesPanel,
    showToolsPanel,
    setShowToolsPanel,
    showHardwarePanel,
    setShowHardwarePanel,
    showAnimationPanel,
    setShowAnimationPanel,
    showOutlinerPanel,
    setShowOutlinerPanel,
    showMeasurePanel,
    setShowMeasurePanel,
    selectedItemIds,
    boards,
    groups,
    toast,
    computingMessage,
    confirmDialog,
    setConfirmDialog,
    showNewWorkspaceDialog,
    setShowNewWorkspaceDialog,
    newWorkspace,
    theme,
    pushHistory,
    autosaveInterval,
    saveWorkspace,
    currentFileName,
    setShowSavePromptDialog,
    setSavePromptCallback,
    headerBottom,
    setOverlappingBoardIds,
    overlappingBoardIds,
    enableCollisions,
    panelLayoutMode,
    workspaceLayout,
    addRecordedStep,
  } = useStore();

  const isDocked = workspaceLayout === "docked";
  const isAdvanced = panelLayoutMode !== "standard";

  const inspectorTitle = (() => {
    if (selectedItemIds.length === 0) return "";
    if (selectedItemIds.length > 1) return `${selectedItemIds.length} Selected`;
    const id = selectedItemIds[0];
    const board = boards.find((b) => b.id.toString() === id);
    if (board) return board.name;
    const group = Object.entries(groups || {}).find(([gid]) => gid === id);
    if (group) return group[1].name || group[0];
    return "Selection";
  })();

  const hasDockedPanels =
    showOutlinerPanel ||
    selectedItemIds.length > 0 ||
    showAddComponentPanel ||
    showAssembliesPanel ||
    showToolsPanel ||
    showHardwarePanel ||
    (isAdvanced && showAssemblyLibrary) ||
    (isAdvanced && showMaterialsPanel) ||
    (isAdvanced && showLightingPanel) ||
    (isAdvanced && showAnimationPanel);

  const showSidebar = isDocked && hasDockedPanels;

  useEffect(() => {
    if (theme === "light") document.documentElement.classList.add("light-mode");
    else document.documentElement.classList.remove("light-mode");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useAutosave(autosaveInterval);

  useOverlapWarnings({
    boards,
    enableCollisions,
    overlappingBoardIds,
    setOverlappingBoardIds,
  });

  useGlobalHotkeys({ setShowRecorderPanel });

  return (
    <ErrorBoundary>
      <div className={`app-container ${showSidebar ? "layout-docked" : ""}`}>
        {toast && (
          <div
            style={{
              position: "fixed",
              bottom: "24px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "var(--accent-color)",
              color: "#fff",
              padding: "12px 24px",
              borderRadius: "24px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              zIndex: 10000,
              fontWeight: "bold",
            }}
          >
            {toast}
          </div>
        )}

        <div className="canvas-area">
          <Viewport3D />
        </div>

        <div className="app-overlay">
          <AppHeader />

          {overlappingBoardIds && overlappingBoardIds.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100px",
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(255, 59, 48, 0.9)",
                color: "#fff",
                padding: "8px 16px",
                borderRadius: "24px",
                fontWeight: "bold",
                fontSize: "0.85rem",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                zIndex: 9000,
                backdropFilter: "blur(4px)",
                border: "1px solid rgba(255,255,255,0.2)",
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              {overlappingBoardIds.length} boards physically overlapping
            </div>
          )}

          <main className="main-workspace">
            {showSettingsPanel && (
              <DraggablePanel
                title="Settings"
                defaultPosition={getSmartPosition(
                  780,
                  500,
                  "center",
                  headerBottom,
                )}
                defaultSize={{ width: 780 }}
                topMargin={headerBottom}
                onClose={() => setShowSettingsPanel(false)}
                zIndex={1000}
              >
                <SettingsPanel />
              </DraggablePanel>
            )}

            {showCutlistPanel && (
              <DraggablePanel
                title="Project Cut List"
                defaultPosition={getSmartPosition(
                  720,
                  500,
                  "force-center",
                  headerBottom,
                )}
                defaultSize={{ width: 720 }}
                topMargin={headerBottom}
                onClose={() => setShowCutlistPanel(false)}
                zIndex={500}
              >
                <CutListPanel />
              </DraggablePanel>
            )}

            {showRecorderPanel && (
              <DraggablePanel
                title="🔴 Step-by-Step Recorder"
                defaultPosition={getSmartPosition(
                  340,
                  480,
                  "center",
                  headerBottom,
                )}
                defaultSize={{ width: 340 }}
                topMargin={headerBottom}
                onClose={() => setShowRecorderPanel(false)}
                zIndex={600}
              >
                <TutorialRecorderPanel />
              </DraggablePanel>
            )}

            {showMeasurePanel && (
              <DraggablePanel
                title="Measure"
                defaultPosition={getSmartPosition(
                  200,
                  200,
                  "right",
                  headerBottom,
                )}
                defaultSize={{ width: 200 }}
                topMargin={headerBottom}
                onClose={() => setShowMeasurePanel(false)}
                zIndex={800}
              >
                <MeasurePanel />
              </DraggablePanel>
            )}

            {!isDocked && showOutlinerPanel && (
              <DraggablePanel
                title="Outliner"
                defaultPosition={getSmartPosition(
                  200,
                  400,
                  "right",
                  headerBottom,
                )}
                defaultSize={{ width: 200 }}
                topMargin={headerBottom}
                onClose={() => setShowOutlinerPanel(false)}
              >
                <OutlinerPanel />
              </DraggablePanel>
            )}

            {!isDocked && selectedItemIds.length > 0 && (
              <DraggablePanel
                title={`Inspector — ${inspectorTitle}`}
                defaultPosition={getSmartPosition(
                  300,
                  600,
                  "inspector",
                  headerBottom,
                )}
                defaultSize={{ width: 300 }}
                topMargin={headerBottom}
                onFocusCapture={(e) => {
                  if (e.target.tagName === "INPUT") pushHistory();
                }}
              >
                <InspectorPanel />
              </DraggablePanel>
            )}

            {!isDocked && showAddComponentPanel && (
              <DraggablePanel
                title="＋ Add Component"
                defaultPosition={getSmartPosition(
                  260,
                  300,
                  "left",
                  headerBottom,
                )}
                defaultSize={{ width: 260 }}
                topMargin={headerBottom}
                onClose={() => setShowAddComponentPanel(false)}
              >
                <AddComponentPanel />
              </DraggablePanel>
            )}

            {!isDocked && showAssembliesPanel && (
              <DraggablePanel
                title="🧱 Builders"
                defaultPosition={getSmartPosition(
                  260,
                  300,
                  "left",
                  headerBottom,
                )}
                defaultSize={{ width: 260 }}
                topMargin={headerBottom}
                onClose={() => setShowAssembliesPanel(false)}
              >
                <AssembliesPanel />
              </DraggablePanel>
            )}

            {!isDocked && showToolsPanel && (
              <DraggablePanel
                title="🧰 Tools"
                defaultPosition={getSmartPosition(
                  340,
                  250,
                  "left",
                  headerBottom,
                )}
                defaultSize={{ width: 340 }}
                topMargin={headerBottom}
                onClose={() => setShowToolsPanel(false)}
                onFocusCapture={(e) => {
                  if (e.target.tagName === "INPUT") pushHistory();
                }}
              >
                <ToolsPanel />
              </DraggablePanel>
            )}

            {!isDocked && showHardwarePanel && (
              <DraggablePanel
                title="🔩 Hardware"
                defaultPosition={getSmartPosition(
                  280,
                  450,
                  "left",
                  headerBottom,
                )}
                defaultSize={{ width: 280 }}
                topMargin={headerBottom}
                onClose={() => setShowHardwarePanel(false)}
              >
                <HardwarePanel />
              </DraggablePanel>
            )}

            {!isDocked && isAdvanced && showAssemblyLibrary && (
              <DraggablePanel
                title="📦 Assembly Library"
                defaultPosition={getSmartPosition(
                  330,
                  400,
                  "left",
                  headerBottom,
                )}
                defaultSize={{ width: 330 }}
                topMargin={headerBottom}
                onClose={() => setShowAssemblyLibrary(false)}
              >
                <AssemblyLibraryPanel />
              </DraggablePanel>
            )}

            {!isDocked && isAdvanced && showLightingPanel && (
              <DraggablePanel
                title="💡 Lighting"
                defaultPosition={getSmartPosition(
                  310,
                  400,
                  "left",
                  headerBottom,
                )}
                defaultSize={{ width: 310 }}
                topMargin={headerBottom}
                onClose={() => setShowLightingPanel(false)}
              >
                <LightingPanel />
              </DraggablePanel>
            )}

            {!isDocked && isAdvanced && showMaterialsPanel && (
              <DraggablePanel
                title="🎨 Materials"
                defaultPosition={getSmartPosition(
                  290,
                  400,
                  "left",
                  headerBottom,
                )}
                defaultSize={{ width: 290 }}
                topMargin={headerBottom}
                onClose={() => setShowMaterialsPanel(false)}
              >
                <MaterialsPanel />
              </DraggablePanel>
            )}

            {!isDocked && isAdvanced && showAnimationPanel && (
              <DraggablePanel
                title="🎬 Animation"
                defaultPosition={getSmartPosition(
                  320,
                  500,
                  "left",
                  headerBottom,
                )}
                defaultSize={{ width: 320 }}
                topMargin={headerBottom}
                onClose={() => setShowAnimationPanel(false)}
              >
                <AnimationPanel />
              </DraggablePanel>
            )}
          </main>

          {computingMessage && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 10000,
                background: "rgba(0,0,0,0.4)",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                backdropFilter: "blur(2px)",
              }}
            >
              <div
                style={{
                  background: "var(--panel-bg, #1e1e1e)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "12px",
                  padding: "28px 40px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "14px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                }}
              >
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    border: "3px solid rgba(188,138,95,0.3)",
                    borderTop: "3px solid var(--accent-color)",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                <span
                  style={{
                    color: "var(--text-main)",
                    fontSize: "0.95rem",
                    fontWeight: 600,
                  }}
                >
                  {computingMessage}
                </span>
              </div>
            </div>
          )}

          {confirmDialog && (
            <div
              className="app-overlay"
              style={{
                background: "rgba(0,0,0,0.6)",
                zIndex: 10001,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                position: "fixed",
                inset: 0,
              }}
              onClick={() => setConfirmDialog(null)}
            >
              <div
                className="glass-panel"
                style={{
                  padding: "24px",
                  width: "380px",
                  borderRadius: "12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3
                  style={{
                    margin: 0,
                    color: confirmDialog.titleColor || "#ff3b30",
                  }}
                >
                  {confirmDialog.title || "⚠ Confirm Deletion"}
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.9rem",
                    color: "var(--text-main)",
                    lineHeight: 1.5,
                  }}
                >
                  {confirmDialog.message}
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    justifyContent: "flex-end",
                    marginTop: "8px",
                  }}
                >
                  <button
                    className="nav-btn"
                    style={{
                      padding: "8px 20px",
                      border: "1px solid var(--border-color)",
                    }}
                    onClick={() => {
                      if (confirmDialog.onCancel) confirmDialog.onCancel();
                      else setConfirmDialog(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="nav-btn"
                    style={{
                      padding: "8px 20px",
                      background:
                        confirmDialog.confirmBg || "rgba(255, 59, 48, 0.15)",
                      color: confirmDialog.confirmColor || "#ff3b30",
                      border: `1px solid ${confirmDialog.confirmBorder || "rgba(255, 59, 48, 0.3)"}`,
                      fontWeight: "bold",
                    }}
                    onClick={confirmDialog.onConfirm}
                  >
                    {confirmDialog.confirmText || "Delete"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showNewWorkspaceDialog && (
            <div
              className="app-overlay"
              style={{
                background: "rgba(0,0,0,0.6)",
                zIndex: 10001,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                position: "fixed",
                inset: 0,
              }}
              onClick={() => setShowNewWorkspaceDialog(false)}
            >
              <div
                className="glass-panel"
                style={{
                  padding: "28px",
                  width: "500px",
                  borderRadius: "12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3 style={{ margin: 0, color: "var(--text-main)" }}>
                  ✨ New Project
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.95rem",
                    color: "var(--text-main)",
                    lineHeight: 1.5,
                  }}
                >
                  Do you want to save the current project before starting a new
                  one?
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    justifyContent: "flex-end",
                    marginTop: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    className="nav-btn"
                    style={{
                      padding: "8px 16px",
                      border: "1px solid var(--border-color)",
                    }}
                    onClick={() => setShowNewWorkspaceDialog(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="nav-btn"
                    style={{
                      padding: "8px 16px",
                      background: "rgba(255, 59, 48, 0.15)",
                      color: "#ff3b30",
                      border: "1px solid rgba(255, 59, 48, 0.3)",
                      fontWeight: "bold",
                    }}
                    onClick={() => {
                      if (addRecordedStep) {
                        addRecordedStep(
                          "Click the **File** menu in the header. Click **New Project** and then click **Discard (Clear Workspace)**.",
                        );
                      }
                      newWorkspace();
                      setShowNewWorkspaceDialog(false);
                    }}
                  >
                    Discard (Clear Workspace)
                  </button>
                  <button
                    className="nav-btn primary"
                    style={{
                      padding: "8px 16px",
                      background: "var(--accent-color)",
                      color: "#fff",
                      border: "none",
                      fontWeight: "bold",
                    }}
                    onClick={() => {
                      if (addRecordedStep) {
                        addRecordedStep(
                          "Click the **File** menu in the header. Click **New Project** and then click **Save Local & Clear**.",
                        );
                      }
                      if (currentFileName) {
                        saveWorkspace(currentFileName);
                        newWorkspace();
                        setShowNewWorkspaceDialog(false);
                      } else {
                        setSavePromptCallback(() => {
                          newWorkspace();
                        });
                        setShowSavePromptDialog(true);
                        setShowNewWorkspaceDialog(false);
                      }
                    }}
                  >
                    Save Local & Clear
                  </button>
                  <button
                    className="nav-btn primary"
                    style={{
                      padding: "8px 16px",
                      background: "var(--accent-color)",
                      color: "#fff",
                      border: "none",
                      fontWeight: "bold",
                    }}
                    onClick={async () => {
                      if (addRecordedStep) {
                        addRecordedStep(
                          "Click the **File** menu in the header. Click **New Project** and then click **Save to Disk & Clear**.",
                        );
                      }
                      const success = await useStore
                        .getState()
                        .exportWorkspace();
                      if (success) {
                        newWorkspace();
                        setShowNewWorkspaceDialog(false);
                      }
                    }}
                  >
                    Save to Disk & Clear
                  </button>
                </div>
              </div>
            </div>
          )}

          <NewBoardDialog />
          <CabinetBuilderDialog />
          <BoxBuilderDialog />
          <ShakerDoorBuilderDialog />
          <DrawerBuilderDialog />
          <FaceFrameBuilderDialog />
          <ShelvingBuilderDialog />
          <TableBaseBuilderDialog />
          <TableTopBuilderDialog />
          <AiHelpDialog />
          <UserManualDialog />
          <PrintDialog />
          <SavePromptDialog />
          <AttributionDialog />
          <WelcomeDialog />
          <KeyboardShortcutsDialog />
        </div>

        {showSidebar && (
          <div className="docked-sidebar">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px",
                borderBottom: "1px solid var(--border-color)",
                background: "rgba(0,0,0,0.1)",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "0.8rem",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  letterSpacing: "1px",
                }}
              >
                Workspace Panels
              </h3>
            </div>
            <div className="docked-sidebar-content">
              {showOutlinerPanel && (
                <div className="sidebar-panel-card">
                  <div className="sidebar-panel-header">
                    <span>🗂️ Outliner</span>
                    <button
                      className="sidebar-close-btn"
                      onClick={() => setShowOutlinerPanel(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sidebar-panel-body">
                    <OutlinerPanel />
                  </div>
                </div>
              )}

              {selectedItemIds.length > 0 && (
                <div className="sidebar-panel-card">
                  <div className="sidebar-panel-header">
                    <span>Inspector — {inspectorTitle}</span>
                    <button
                      className="sidebar-close-btn"
                      onClick={() => useStore.getState().setSelectedItemIds([])}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sidebar-panel-body">
                    <InspectorPanel />
                  </div>
                </div>
              )}

              {showAddComponentPanel && (
                <div className="sidebar-panel-card">
                  <div className="sidebar-panel-header">
                    <span>＋ Add Component</span>
                    <button
                      className="sidebar-close-btn"
                      onClick={() => setShowAddComponentPanel(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sidebar-panel-body">
                    <AddComponentPanel />
                  </div>
                </div>
              )}

              {showAssembliesPanel && (
                <div className="sidebar-panel-card">
                  <div className="sidebar-panel-header">
                    <span>🧱 Builders</span>
                    <button
                      className="sidebar-close-btn"
                      onClick={() => setShowAssembliesPanel(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sidebar-panel-body">
                    <AssembliesPanel />
                  </div>
                </div>
              )}

              {showToolsPanel && (
                <div className="sidebar-panel-card">
                  <div className="sidebar-panel-header">
                    <span>🧰 Tools</span>
                    <button
                      className="sidebar-close-btn"
                      onClick={() => setShowToolsPanel(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sidebar-panel-body">
                    <ToolsPanel />
                  </div>
                </div>
              )}

              {showHardwarePanel && (
                <div className="sidebar-panel-card">
                  <div className="sidebar-panel-header">
                    <span>🔩 Hardware</span>
                    <button
                      className="sidebar-close-btn"
                      onClick={() => setShowHardwarePanel(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sidebar-panel-body">
                    <HardwarePanel />
                  </div>
                </div>
              )}

              {isAdvanced && showAssemblyLibrary && (
                <div className="sidebar-panel-card">
                  <div className="sidebar-panel-header">
                    <span>📦 Assembly Library</span>
                    <button
                      className="sidebar-close-btn"
                      onClick={() => setShowAssemblyLibrary(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sidebar-panel-body">
                    <AssemblyLibraryPanel />
                  </div>
                </div>
              )}

              {isAdvanced && showMaterialsPanel && (
                <div className="sidebar-panel-card">
                  <div className="sidebar-panel-header">
                    <span>🎨 Materials</span>
                    <button
                      className="sidebar-close-btn"
                      onClick={() => setShowMaterialsPanel(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sidebar-panel-body">
                    <MaterialsPanel />
                  </div>
                </div>
              )}

              {isAdvanced && showLightingPanel && (
                <div className="sidebar-panel-card">
                  <div className="sidebar-panel-header">
                    <span>💡 Lighting</span>
                    <button
                      className="sidebar-close-btn"
                      onClick={() => setShowLightingPanel(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sidebar-panel-body">
                    <LightingPanel />
                  </div>
                </div>
              )}

              {isAdvanced && showAnimationPanel && (
                <div className="sidebar-panel-card">
                  <div className="sidebar-panel-header">
                    <span>🎬 Animation</span>
                    <button
                      className="sidebar-close-btn"
                      onClick={() => setShowAnimationPanel(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sidebar-panel-body">
                    <AnimationPanel />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

export default function App() {
  const info = getDeviceInfo();

  if (info.isPhone) {
    return <SmallScreenNotice os={info.os} />;
  }

  return <WorkspaceApp />;
}
