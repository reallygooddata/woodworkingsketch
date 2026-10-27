import { create } from "zustand";
import * as THREE from "three";
import { createActions } from "./actions";
import {
  loadLibrarySync,
  loadLibraryFromDiskIfNeeded,
  loadStoredHandle,
} from "../utils/libraryPersistence";
import {
  loadHardwareLibrarySync,
  loadHardwareLibraryFromDiskIfNeeded,
  loadStoredHardwareHandle,
  persistHardwareLibrary,
} from "../utils/hardwareLibraryPersistence";
import { DEFAULT_LIGHTING } from "../utils/lightingPresets";
import {
  ACTIVE_WORKSPACE_KEY,
  loadRecentFiles,
  loadWorkspaceStorage,
  updateActiveWorkspaceStorage,
} from "../utils/workspaceSerialization";

import {
  checkConstraintConflict,
  getFaceWorldPos,
} from "../utils/constraintSolver";

const _initialHardwareLibrary = loadHardwareLibrarySync();

// ─── Fresh-start flag: append ?fresh to the URL to skip localStorage ─────────
const FRESH_START =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("fresh");
if (FRESH_START)
  console.info(
    "%c[FRESH START] Skipping localStorage — using hardcoded defaults.",
    "color: #bc8a5f; font-weight: bold;",
  );

// ─── Helper: load persisted state from localStorage ──────────────────────────
const loadState = (key, def) => {
  if (FRESH_START) return def;
  const workspace = loadWorkspaceStorage(ACTIVE_WORKSPACE_KEY);
  return workspace?.[key] !== undefined ? workspace[key] : def;
};

// Assembly library hydrated synchronously; disk recovery runs async after mount
const _initialLibrary = loadLibrarySync();

// ─── Store Definition ────────────────────────────────────────────────────────
const useStore = create((set, get) => ({
  // ── 2A: UI Toggle State ──────────────────────────────────────────────────
  headerBottom: 140,
  setHeaderBottom: (val) => set({ headerBottom: val }),

  showCutlistPanel: false,
  setShowCutlistPanel: (v) => {
    const next = typeof v === "function" ? v(get().showCutlistPanel) : v;
    if (next !== get().showCutlistPanel && get().addRecordedStep) {
      get().addRecordedStep(
        next
          ? "Click the **Cut List** panel button to open the cut list sheet."
          : "Close the **Cut List** panel.",
      );
    }
    set({ showCutlistPanel: next });
  },

  // ── Computing overlay ────────────────────────────────────────────────────
  computingMessage: null,
  setComputingMessage: (msg) => set({ computingMessage: msg }),

  // ── Three.js Model Group for Export ──────────────────────────────────────
  threeModelGroup: null,
  setThreeModelGroup: (group) => set({ threeModelGroup: group }),

  // ── Overlap Warnings ─────────────────────────────────────────────────────
  overlappingBoardIds: [],
  setOverlappingBoardIds: (ids) => set({ overlappingBoardIds: ids }),

  isOrtho: false,
  setIsOrtho: (v) =>
    set({ isOrtho: typeof v === "function" ? v(get().isOrtho) : v }),

  // Whether scroll-wheel zoom pivots around the point under the cursor
  // (modern CAD-style) vs. always zooming toward the fixed orbit target.
  // Helpful for tall/large models where the target tends to sit near the
  // floor, which otherwise drags the view back down on every zoom.
  zoomToCursor: loadState("zoomToCursor", true),
  setZoomToCursor: (v) => {
    const next = typeof v === "function" ? v(get().zoomToCursor) : v;
    set({ zoomToCursor: next });
    updateActiveWorkspaceStorage((current) => ({
      ...current,
      zoomToCursor: next,
    }));
  },

  // Whether the very first camera view (when no camera position has been
  // saved yet — a fresh session or a freshly-opened project) centers on the
  // workspace's actual content instead of the world origin/floor. Without
  // this, the orbit pivot starts at floor level, so the floor sits at the
  // vertical middle of the screen for anything tall until you manually pan.
  // Only affects that initial framing — once you've navigated at all, your
  // own camera position is saved and respected from then on.
  autoCenterCamera: loadState("autoCenterCamera", true),
  setAutoCenterCamera: (v) => {
    const next = typeof v === "function" ? v(get().autoCenterCamera) : v;
    set({ autoCenterCamera: next });
    updateActiveWorkspaceStorage((current) => ({
      ...current,
      autoCenterCamera: next,
    }));
  },

  cameraState: loadState("cameraState", null),
  setCameraState: (v) => {
    const next = typeof v === "function" ? v(get().cameraState) : v;
    set({ cameraState: next });
    updateActiveWorkspaceStorage((current) => ({
      ...current,
      cameraState: next,
    }));
  },

  showGrid: true,
  setShowGrid: (v) =>
    set({ showGrid: typeof v === "function" ? v(get().showGrid) : v }),

  enableCollisions: loadState("enableCollisions", true),
  setEnableCollisions: (v) =>
    set({
      enableCollisions: typeof v === "function" ? v(get().enableCollisions) : v,
    }),

  autosaveInterval: loadState("autosaveInterval", "10"),
  setAutosaveInterval: (v) =>
    set({
      autosaveInterval: typeof v === "function" ? v(get().autosaveInterval) : v,
    }),

  panelLayoutMode: loadState("panelLayoutMode", "advanced"),
  setPanelLayoutMode: (v) => {
    const next = typeof v === "function" ? v(get().panelLayoutMode) : v;
    set({ panelLayoutMode: next });
    updateActiveWorkspaceStorage((current) => ({
      ...current,
      panelLayoutMode: next,
    }));
  },

  workspaceLayout: loadState("workspaceLayout", "floating"),
  setWorkspaceLayout: (v) => {
    const next = typeof v === "function" ? v(get().workspaceLayout) : v;
    set({ workspaceLayout: next });
    updateActiveWorkspaceStorage((current) => ({
      ...current,
      workspaceLayout: next,
    }));
  },

  lumberyardSnapEnabled: loadState("lumberyardSnapEnabled", true),
  setLumberyardSnapEnabled: (v) => {
    const next = typeof v === "function" ? v(get().lumberyardSnapEnabled) : v;
    set({ lumberyardSnapEnabled: next });
    updateActiveWorkspaceStorage((current) => ({
      ...current,
      lumberyardSnapEnabled: next,
    }));
  },

  dKeyPressed: false,
  setDKeyPressed: (v) =>
    set({ dKeyPressed: typeof v === "function" ? v(get().dKeyPressed) : v }),

  showSettingsPanel: false,
  setShowSettingsPanel: (v) => {
    const next = typeof v === "function" ? v(get().showSettingsPanel) : v;
    if (next !== get().showSettingsPanel && get().addRecordedStep) {
      get().addRecordedStep(
        next
          ? "Click the **Settings** panel button to open settings."
          : "Close the **Settings** panel.",
      );
    }
    set({ showSettingsPanel: next });
  },

  showLightingPanel: false,
  setShowLightingPanel: (v) => {
    const next = typeof v === "function" ? v(get().showLightingPanel) : v;
    if (next !== get().showLightingPanel && get().addRecordedStep) {
      get().addRecordedStep(
        next
          ? "Click the **Lighting** panel button."
          : "Close the **Lighting** panel.",
      );
    }
    set({ showLightingPanel: next });
  },

  showMaterialsPanel: false,
  setShowMaterialsPanel: (v) => {
    const next = typeof v === "function" ? v(get().showMaterialsPanel) : v;
    if (next !== get().showMaterialsPanel && get().addRecordedStep) {
      get().addRecordedStep(
        next
          ? "Click the **Materials** panel button to open the Paint & Materials tray."
          : "Close the **Materials** panel.",
      );
    }
    set({ showMaterialsPanel: next });
  },

  showAddComponentPanel: false,
  setShowAddComponentPanel: (v) => {
    const next = typeof v === "function" ? v(get().showAddComponentPanel) : v;
    if (next !== get().showAddComponentPanel && get().addRecordedStep) {
      get().addRecordedStep(
        next
          ? "Click the **Components** panel button."
          : "Close the **Components** panel.",
      );
    }
    set({ showAddComponentPanel: next });
  },

  showToolsPanel: false,
  setShowToolsPanel: (v) => {
    const next = typeof v === "function" ? v(get().showToolsPanel) : v;
    if (next !== get().showToolsPanel && get().addRecordedStep) {
      get().addRecordedStep(
        next
          ? "Click the **Tools** panel button."
          : "Close the **Tools** panel.",
      );
    }
    set({ showToolsPanel: next });
  },

  showHardwarePanel: false,
  setShowHardwarePanel: (v) => {
    const next = typeof v === "function" ? v(get().showHardwarePanel) : v;
    if (next !== get().showHardwarePanel && get().addRecordedStep) {
      get().addRecordedStep(
        next
          ? "Click the **Hardware** panel button."
          : "Close the **Hardware** panel.",
      );
    }
    set({ showHardwarePanel: next });
  },

  showAnimationPanel: false,
  setShowAnimationPanel: (v) => {
    const next = typeof v === "function" ? v(get().showAnimationPanel) : v;
    if (next !== get().showAnimationPanel && get().addRecordedStep) {
      get().addRecordedStep(
        next
          ? "Click the **Animate** panel button."
          : "Close the **Animate** panel.",
      );
    }
    set({ showAnimationPanel: next });
  },

  showMeasurePanel: false,
  setShowMeasurePanel: (v) => {
    const next = typeof v === "function" ? v(get().showMeasurePanel) : v;
    if (next !== get().showMeasurePanel && get().addRecordedStep) {
      get().addRecordedStep(
        next ? "Open measurement panel." : "Close measurement panel.",
      );
    }
    set({ showMeasurePanel: next });
  },

  imperialFormat: loadState("imperialFormat", "fraction"),
  setImperialFormat: (v) => {
    const next = typeof v === "function" ? v(get().imperialFormat) : v;
    set({ imperialFormat: next });
    updateActiveWorkspaceStorage((current) => ({
      ...current,
      imperialFormat: next,
    }));
  },

  // ─── Animation state ──────────────────────────────────────────────────────
  animation: {
    boardAnim: {
      boardId: null,
      start: null, // { orientation: [x,y,z], pivot: [x,y,z]|undefined }
      end: null,
      playing: false,
      progress: 0,
      speed: 1.0,
      duration: 2.0,
      loop: false,
      bounce: false,
      easing: "ease-in-out",
    },
    turntable: {
      playing: false,
      speed: 6,
      height: 20,
    },
  },
  setAnimation: (updater) =>
    set((state) => ({
      animation:
        typeof updater === "function"
          ? updater(state.animation)
          : { ...state.animation, ...updater },
    })),

  // Which hardware piece is currently selected (null = none)
  selectedHardwareId: null,
  setSelectedHardwareId: (v) => set({ selectedHardwareId: v }),

  // Custom imported hardware catalogue entries — persisted to localStorage + disk
  customHardware: _initialHardwareLibrary,
  addCustomHardware: (item) => {
    const next = [...get().customHardware, item];
    set({ customHardware: next });
    persistHardwareLibrary(next, get().hardwareLibraryDiskHandle);
  },
  removeCustomHardware: (id) => {
    const next = get().customHardware.filter((h) => h.id !== id);
    set({ customHardware: next });
    persistHardwareLibrary(next, get().hardwareLibraryDiskHandle);
  },

  // Disk file handle for hardware library auto-save
  hardwareLibraryDiskHandle: null,
  setHardwareLibraryDiskHandle: (v) => set({ hardwareLibraryDiskHandle: v }),

  // Hidden built-in hardware IDs (so user can remove defaults they don't want)
  hiddenBuiltinHardware: loadState("lucey_hidden_builtin_hw", []),
  hideBuiltinHardware: (id) => {
    const next = [...get().hiddenBuiltinHardware, id];
    set({ hiddenBuiltinHardware: next });
    try {
      localStorage.setItem("lucey_hidden_builtin_hw", JSON.stringify(next));
    } catch {}
  },
  restoreBuiltinHardware: () => {
    set({ hiddenBuiltinHardware: [] });
    try {
      localStorage.removeItem("lucey_hidden_builtin_hw");
    } catch {}
  },

  // Which operation ID the Tools panel should focus on for editing (null = none)
  editingToolOpId: null,
  setEditingToolOpId: (v) =>
    set({
      editingToolOpId: typeof v === "function" ? v(get().editingToolOpId) : v,
    }),

  showOutlinerPanel: true,
  setShowOutlinerPanel: (v) => {
    const next = typeof v === "function" ? v(get().showOutlinerPanel) : v;
    if (next !== get().showOutlinerPanel && get().addRecordedStep) {
      get().addRecordedStep(
        next
          ? "Click the **Outliner** panel button."
          : "Close the **Outliner** panel.",
      );
    }
    set({ showOutlinerPanel: next });
  },

  isRightPanelOpen: true,
  setIsRightPanelOpen: (v) =>
    set({
      isRightPanelOpen: typeof v === "function" ? v(get().isRightPanelOpen) : v,
    }),

  fileMenuOpen: false,
  setFileMenuOpen: (v) =>
    set({ fileMenuOpen: typeof v === "function" ? v(get().fileMenuOpen) : v }),
  showAssembliesPanel: false,
  setShowAssembliesPanel: (v) => {
    const next = typeof v === "function" ? v(get().showAssembliesPanel) : v;
    if (next !== get().showAssembliesPanel && get().addRecordedStep) {
      get().addRecordedStep(
        next
          ? "Click the **Builders** panel button."
          : "Close the **Builders** panel.",
      );
    }
    set({ showAssembliesPanel: next });
  },

  toast: null,
  setToast: (v) => set({ toast: v }),
  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => set({ toast: null }), 3000);
  },

  newBoardDialog: null,
  setNewBoardDialog: (v) =>
    set({
      newBoardDialog: typeof v === "function" ? v(get().newBoardDialog) : v,
    }),

  confirmDialog: null,
  setConfirmDialog: (v) =>
    set({
      confirmDialog: typeof v === "function" ? v(get().confirmDialog) : v,
    }),

  showNewWorkspaceDialog: false,
  setShowNewWorkspaceDialog: (v) =>
    set({
      showNewWorkspaceDialog:
        typeof v === "function" ? v(get().showNewWorkspaceDialog) : v,
    }),

  showSavePromptDialog: false,
  setShowSavePromptDialog: (v) =>
    set({
      showSavePromptDialog:
        typeof v === "function" ? v(get().showSavePromptDialog) : v,
    }),

  savePromptCallback: null,
  setSavePromptCallback: (v) =>
    set({
      savePromptCallback:
        typeof v === "function" ? v(get().savePromptCallback) : v,
    }),

  cabinetDialog: null,
  setCabinetDialog: (v) =>
    set({
      cabinetDialog: typeof v === "function" ? v(get().cabinetDialog) : v,
    }),
  boxDialog: null,
  setBoxDialog: (v) =>
    set({ boxDialog: typeof v === "function" ? v(get().boxDialog) : v }),
  shakerDoorDialog: null,
  setShakerDoorDialog: (v) =>
    set({
      shakerDoorDialog: typeof v === "function" ? v(get().shakerDoorDialog) : v,
    }),
  drawerDialog: null,
  setDrawerDialog: (v) =>
    set({ drawerDialog: typeof v === "function" ? v(get().drawerDialog) : v }),
  faceFrameDialog: null,
  setFaceFrameDialog: (v) =>
    set({
      faceFrameDialog: typeof v === "function" ? v(get().faceFrameDialog) : v,
    }),
  shelvingDialog: null,
  setShelvingDialog: (v) =>
    set({
      shelvingDialog: typeof v === "function" ? v(get().shelvingDialog) : v,
    }),
  tableBaseDialog: null,
  setTableBaseDialog: (v) =>
    set({
      tableBaseDialog: typeof v === "function" ? v(get().tableBaseDialog) : v,
    }),
  tableTopDialog: null,
  setTableTopDialog: (v) =>
    set({
      tableTopDialog: typeof v === "function" ? v(get().tableTopDialog) : v,
    }),

  recentFiles: loadRecentFiles(),
  setRecentFiles: (v) =>
    set({ recentFiles: typeof v === "function" ? v(get().recentFiles) : v }),

  showAiHelpDialog: false,
  setShowAiHelpDialog: (v) =>
    set({
      showAiHelpDialog: typeof v === "function" ? v(get().showAiHelpDialog) : v,
    }),

  showUserManualDialog: false,
  setShowUserManualDialog: (v) =>
    set({
      showUserManualDialog:
        typeof v === "function" ? v(get().showUserManualDialog) : v,
    }),

  showKeyboardShortcutsDialog: false,
  setShowKeyboardShortcutsDialog: (v) =>
    set({
      showKeyboardShortcutsDialog:
        typeof v === "function" ? v(get().showKeyboardShortcutsDialog) : v,
    }),

  showAttributionDialog: false,
  setShowAttributionDialog: (v) =>
    set({
      showAttributionDialog:
        typeof v === "function" ? v(get().showAttributionDialog) : v,
    }),

  currentFileName: (() => {
    const rf = loadRecentFiles();
    return rf.length > 0 ? rf[0].name : "Untitled";
  })(),
  setCurrentFileName: (v) => set({ currentFileName: v }),

  // ── 2A-lib: Assembly Library State ──────────────────────────────────────
  // Each entry: { id, name, category, tags[], thumbnail, boards[], groups{}, constraints{} }
  assemblyLibrary: _initialLibrary,
  setAssemblyLibrary: (v) =>
    set({
      assemblyLibrary: typeof v === "function" ? v(get().assemblyLibrary) : v,
    }),

  showAssemblyLibrary: false,
  setShowAssemblyLibrary: (v) => {
    const next = typeof v === "function" ? v(get().showAssemblyLibrary) : v;
    if (next !== get().showAssemblyLibrary && get().addRecordedStep) {
      get().addRecordedStep(
        next
          ? "Click the **Library** panel button."
          : "Close the **Library** panel.",
      );
    }
    set({ showAssemblyLibrary: next });
  },

  // User-defined category list — persisted in localStorage
  assemblyCategories: loadState("assemblyCategories", [
    "Uncategorized",
    "Cabinet",
    "Box",
    "Chair",
    "Table",
    "Leg Set",
    "Shelf",
    "Drawer",
    "Frame",
    "Other",
  ]),
  addAssemblyCategory: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const { assemblyCategories } = get();
    if (assemblyCategories.includes(trimmed)) return false;
    const next = [...assemblyCategories, trimmed];
    set({ assemblyCategories: next });
    try {
      const s = localStorage.getItem("lucey_save");
      const p = s ? JSON.parse(s) : {};
      localStorage.setItem(
        "lucey_save",
        JSON.stringify({ ...p, assemblyCategories: next }),
      );
    } catch {
      /* non-fatal */
    }
    return true;
  },

  // FileSystemFileHandle stored in IndexedDB; loaded async on mount
  libraryDiskHandle: null,
  setLibraryDiskHandle: (v) => set({ libraryDiskHandle: v }),

  aiEngine: "si", // 'si' or 'ai'
  setAiEngine: (v) =>
    set({ aiEngine: typeof v === "function" ? v(get().aiEngine) : v }),

  chatInput: "",
  setChatInput: (v) =>
    set({ chatInput: typeof v === "function" ? v(get().chatInput) : v }),

  chatMessages: [
    {
      role: "ai",
      text: 'Ready! Try "move this 3 along red" or "make this 1 inch wider". Select a board first!',
    },
  ],
  setChatMessages: (v) =>
    set({ chatMessages: typeof v === "function" ? v(get().chatMessages) : v }),

  // ── 2B: Settings / Preferences State ─────────────────────────────────────
  theme: loadState("theme", "dark"),
  setTheme: (v) => {
    const newTheme = typeof v === "function" ? v(get().theme) : v;
    set({ theme: newTheme });
    if (newTheme === "light")
      document.documentElement.classList.add("light-mode");
    else document.documentElement.classList.remove("light-mode");
  },

  units: loadState("units", "imperial"),
  setUnits: (v) => {
    const nextUnits = typeof v === "function" ? v(get().units) : v;
    let nextSnap = get().gridSnap;
    if (nextUnits === "metric") {
      if (nextSnap === "1/16 in") nextSnap = "1 mm";
      else if (nextSnap === "1/8 in") nextSnap = "2 mm";
      else if (nextSnap === "1/4 in") nextSnap = "5 mm";
      else if (nextSnap === "1/2 in" || nextSnap === "1 in") nextSnap = "10 mm";
      else if (nextSnap !== "off") nextSnap = "5 mm";
    } else {
      if (nextSnap === "1 mm") nextSnap = "1/16 in";
      else if (nextSnap === "2 mm") nextSnap = "1/8 in";
      else if (nextSnap === "5 mm") nextSnap = "1/4 in";
      else if (nextSnap === "10 mm") nextSnap = "1/2 in";
      else if (nextSnap !== "off") nextSnap = "1/4 in";
    }
    set({ units: nextUnits, gridSnap: nextSnap });
    try {
      const s = localStorage.getItem("lucey_save");
      const p = s ? JSON.parse(s) : {};
      p.units = nextUnits;
      p.gridSnap = nextSnap;
      localStorage.setItem("lucey_save", JSON.stringify(p));
    } catch (e) {}
  },

  gridSnap: loadState("gridSnap", "1/8 in"),
  setGridSnap: (v) => {
    const nextSnap = typeof v === "function" ? v(get().gridSnap) : v;
    set({ gridSnap: nextSnap });
    try {
      const s = localStorage.getItem("lucey_save");
      const p = s ? JSON.parse(s) : {};
      p.gridSnap = nextSnap;
      localStorage.setItem("lucey_save", JSON.stringify(p));
    } catch (e) {}
  },

  plywoodInventory: loadState("plywoodInventory", []),
  setPlywoodInventory: (v) => {
    const next = typeof v === "function" ? v(get().plywoodInventory) : v;
    set({ plywoodInventory: next });
    updateActiveWorkspaceStorage((current) => ({
      ...current,
      plywoodInventory: next,
    }));
  },

  workspaceSize: loadState("workspaceSize", 120),
  setWorkspaceSize: (v) => {
    const next = typeof v === "function" ? v(get().workspaceSize) : v;

    let newSnap = get().gridSnap;
    if (next <= 120) newSnap = "1/8 in";
    else if (next <= 240) newSnap = "1/4 in";
    else if (next <= 360) newSnap = "1/2 in";
    else newSnap = "1 in";

    set({ workspaceSize: next, gridSnap: newSnap });
    try {
      const s = localStorage.getItem("lucey_save");
      const p = s ? JSON.parse(s) : {};
      p.workspaceSize = next;
      p.gridSnap = newSnap;
      localStorage.setItem("lucey_save", JSON.stringify(p));
    } catch (e) {}
  },

  defaultMaterial: loadState("defaultMaterial", "pine"),
  setDefaultMaterial: (v) =>
    set({
      defaultMaterial: typeof v === "function" ? v(get().defaultMaterial) : v,
    }),

  showEdges: loadState("showEdges", true),
  setShowEdges: (v) =>
    set({ showEdges: typeof v === "function" ? v(get().showEdges) : v }),

  showDimensions: loadState("showDimensions", true),
  setShowDimensions: (v) =>
    set({
      showDimensions: typeof v === "function" ? v(get().showDimensions) : v,
    }),

  showBoundingBox: loadState("showBoundingBox", true),
  setShowBoundingBox: (v) =>
    set({
      showBoundingBox: typeof v === "function" ? v(get().showBoundingBox) : v,
    }),

  // ── Measurement layer ─────────────────────────────────────────────────
  // Measure mode interaction state (like constraintTargetMode)
  // null = inactive
  // { active: true, firstPoint: null } = waiting for first click
  // { active: true, firstPoint: { localOffset, boardId, snapType } } = waiting for second
  measureMode: null,
  setMeasureMode: (v) =>
    set({ measureMode: typeof v === "function" ? v(get().measureMode) : v }),

  // Custom Pivot mode interaction state
  // { active: true, boardId: '123' }
  pivotMode: null,
  setPivotMode: (v) =>
    set({ pivotMode: typeof v === "function" ? v(get().pivotMode) : v }),

  pivotHoverSnap: null,
  setPivotHoverSnap: (v) => set({ pivotHoverSnap: v }),

  // ── Mouse Transform Gizmo (drag-to-move / drag-to-rotate) ─────────────────
  // 'translate' | 'rotate' — which gizmo is shown for the current selection.
  // Not persisted — always starts in 'translate' mode each session.
  gizmoMode: "translate",
  setGizmoMode: (v) =>
    set({ gizmoMode: typeof v === "function" ? v(get().gizmoMode) : v }),
  // Whether the gizmo is shown at all for the current selection.
  gizmoEnabled: loadState("gizmoEnabled", true),
  setGizmoEnabled: (v) => {
    const next = typeof v === "function" ? v(get().gizmoEnabled) : v;
    set({ gizmoEnabled: next });
    updateActiveWorkspaceStorage((current) => ({
      ...current,
      gizmoEnabled: next,
    }));
  },
  // Whether dragging the single-board Transform gizmo magnetically snaps
  // onto other boards' aligned faces (same highlight shown by
  // LiveDistanceOverlay). Can be turned off for free-floating movement.
  gizmoMagneticSnap: loadState("gizmoMagneticSnap", true),
  setGizmoMagneticSnap: (v) => {
    const next = typeof v === "function" ? v(get().gizmoMagneticSnap) : v;
    set({ gizmoMagneticSnap: next });
    updateActiveWorkspaceStorage((current) => ({
      ...current,
      gizmoMagneticSnap: next,
    }));
  },
  // True only while the user is actively dragging the gizmo handle — used to
  // suspend OrbitControls so orbiting doesn't fight the drag.
  isGizmoDragging: false,
  setIsGizmoDragging: (v) =>
    set({ isGizmoDragging: typeof v === "function" ? v(get().isGizmoDragging) : v }),

  // IDs of boards currently being repositioned by ANY drag mechanism (the
  // Transform gizmo, or the hold-D smart-snap drag). Read by
  // LiveDistanceOverlay to show live gaps to the nearest neighboring boards
  // without requiring a multi-selection.
  liveDragBoardIds: [],
  setLiveDragBoardIds: (v) =>
    set({ liveDragBoardIds: typeof v === "function" ? v(get().liveDragBoardIds) : v }),

  // Persisted custom measurements
  measurements: loadState("measurements", []),
  setMeasurements: (v) =>
    set({ measurements: typeof v === "function" ? v(get().measurements) : v }),

  // Face Angle Measurement Mode state
  measureFaceAnglesActive: false,
  setMeasureFaceAnglesActive: (active) =>
    set({ measureFaceAnglesActive: active }),
  selectedFaces: [],
  toggleFaceSelection: (boardId, normal, localPt, label) => {
    const { selectedFaces } = get();
    const newFace = { boardId, normal, localPt, label };

    // Reset selection if clicking a different board
    if (selectedFaces.length > 0 && selectedFaces[0].boardId !== boardId) {
      set({ selectedFaces: [newFace] });
      return;
    }

    const index = selectedFaces.findIndex(
      (f) =>
        f.boardId === boardId &&
        Math.abs(f.normal[0] - normal[0]) < 0.01 &&
        Math.abs(f.normal[1] - normal[1]) < 0.01 &&
        Math.abs(f.normal[2] - normal[2]) < 0.01 &&
        Math.abs(f.localPt[0] - localPt[0]) < 0.05 &&
        Math.abs(f.localPt[1] - localPt[1]) < 0.05 &&
        Math.abs(f.localPt[2] - localPt[2]) < 0.05,
    );

    if (index > -1) {
      set({ selectedFaces: selectedFaces.filter((_, i) => i !== index) });
    } else {
      if (selectedFaces.length >= 2) {
        set({ selectedFaces: [newFace] });
      } else {
        set({ selectedFaces: [...selectedFaces, newFace] });
      }
    }
  },
  clearFaceSelection: () => set({ selectedFaces: [] }),

  // Edge Relationship Measurement Mode state
  measureEdgesActive: false,
  setMeasureEdgesActive: (active) => set({ measureEdgesActive: active }),
  selectedEdges: [],
  toggleEdgeSelection: (boardId, edgeStart, edgeEnd) => {
    const { selectedEdges } = get();
    const newEdge = { boardId, edgeStart, edgeEnd };

    const index = selectedEdges.findIndex(
      (e) =>
        e.boardId === boardId &&
        ((Math.abs(e.edgeStart[0] - edgeStart[0]) < 0.01 &&
          Math.abs(e.edgeStart[1] - edgeStart[1]) < 0.01 &&
          Math.abs(e.edgeStart[2] - edgeStart[2]) < 0.01 &&
          Math.abs(e.edgeEnd[0] - edgeEnd[0]) < 0.01 &&
          Math.abs(e.edgeEnd[1] - edgeEnd[1]) < 0.01 &&
          Math.abs(e.edgeEnd[2] - edgeEnd[2]) < 0.01) ||
          (Math.abs(e.edgeStart[0] - edgeEnd[0]) < 0.01 &&
            Math.abs(e.edgeStart[1] - edgeEnd[1]) < 0.01 &&
            Math.abs(e.edgeStart[2] - edgeEnd[2]) < 0.01 &&
            Math.abs(e.edgeEnd[0] - edgeStart[0]) < 0.01 &&
            Math.abs(e.edgeEnd[1] - edgeStart[1]) < 0.01 &&
            Math.abs(e.edgeEnd[2] - edgeStart[2]) < 0.01)),
    );

    if (index > -1) {
      set({ selectedEdges: selectedEdges.filter((_, i) => i !== index) });
    } else {
      if (selectedEdges.length >= 2) {
        set({ selectedEdges: [newEdge] });
      } else {
        set({ selectedEdges: [...selectedEdges, newEdge] });
      }
    }
  },
  clearEdgeSelection: () => set({ selectedEdges: [] }),

  // Visibility toggle (controls both auto-dims AND custom measurements)
  showMeasurements: loadState("showMeasurements", true),
  setShowMeasurements: (v) =>
    set({
      showMeasurements: typeof v === "function" ? v(get().showMeasurements) : v,
    }),

  // Measurement line end style ('arrows', 'slashes', or 'spheres')
  measurementStyle: loadState("measurementStyle", "arrows"),
  setMeasurementStyle: (v) => {
    const next = typeof v === "function" ? v(get().measurementStyle) : v;
    set({ measurementStyle: next });
    try {
      const s = localStorage.getItem("lucey_save");
      const p = s ? JSON.parse(s) : {};
      p.measurementStyle = next;
      localStorage.setItem("lucey_save", JSON.stringify(p));
    } catch (e) {}
  },

  // Which measurement is selected (for deletion)
  selectedMeasurementId: null,
  setSelectedMeasurementId: (v) => set({ selectedMeasurementId: v }),

  // Hovered snap point during measure mode (for preview markers)
  measureHoverSnap: null, // { worldPos: [x,y,z], type: 'corner'|'edge'|'face' }
  setMeasureHoverSnap: (v) => set({ measureHoverSnap: v }),

  // ── Print ────────────────────────────────────────────────────────────────
  showPrintDialog: false,
  setShowPrintDialog: (v) => set({ showPrintDialog: v }),
  // Set to an options object to trigger capture, null when idle
  printCapture: null,
  setPrintCapture: (v) => set({ printCapture: v }),

  globalBounds: loadState("globalBounds", {
    enabled: false,
    x: 18,
    y: 25,
    z: 18,
  }),
  setGlobalBounds: (v) =>
    set({ globalBounds: typeof v === "function" ? v(get().globalBounds) : v }),

  // ── 2B-light: Lighting State ──────────────────────────────────────────────
  // { presetKey, shadows, lights[] } — persisted in lucey_save under 'lighting'
  lighting: loadState("lighting", DEFAULT_LIGHTING),
  setLighting: (v) =>
    set({ lighting: typeof v === "function" ? v(get().lighting) : v }),

  // ── 2B-mat: Recent custom paint colours (last 8) ─────────────────────────
  recentColors: loadState("recentColors", []),
  setRecentColors: (v) => {
    const next = typeof v === "function" ? v(get().recentColors) : v;
    set({ recentColors: next });
    // Auto-persist so they survive without an explicit save
    try {
      const s = localStorage.getItem("lucey_save");
      const p = s ? JSON.parse(s) : {};
      localStorage.setItem(
        "lucey_save",
        JSON.stringify({ ...p, recentColors: next }),
      );
    } catch {
      /* non-fatal */
    }
  },

  // Boards: orientation is local (Euler radians). Operations are in LOCAL board space.
  // Size: [x, y, z] where x=length, y=height, z=depth — always LOCAL dimensions
  // Position: [x, y, z] = center of the board in world space
  // Note: boards no longer carry a constraints[] array — see root `constraints` map.
  boards: loadState("boards", []),
  setBoards: (v) => {
    const nextBoards = typeof v === "function" ? v(get().boards) : v;
    const constraints = get().constraints || {};
    let newConstraints = { ...constraints };
    let changed = false;

    const axisFaces = [
      { min: "x-", center: "center", max: "x+" },
      { min: "y-", center: "center", max: "y+" },
      { min: "z-", center: "center", max: "z+" },
    ];

    // 1. Audit existing Flush constraints: remove if misaligned > 0.01"
    Object.entries(constraints).forEach(([cId, c]) => {
      if (c.type === "Flush" && c.enabled !== false) {
        const boardA = nextBoards.find((bd) => bd.id.toString() === c.boardAId);
        const boardB = nextBoards.find((bd) => bd.id.toString() === c.boardBId);
        if (boardA && boardB && c.faceA && c.faceB) {
          const posA = getFaceWorldPos(boardA, c.faceA);
          const posB = getFaceWorldPos(boardB, c.faceB);
          if (posA && posB && typeof c.axis === "number") {
            const dev = Math.abs(posA[c.axis] - posB[c.axis]);
            if (dev > 0.01) {
              delete newConstraints[cId];
              changed = true;
            }
          }
        }
      }
    });

    // 2. Auto-detect new Flush alignments: add if aligned < 0.005"
    for (let axis = 0; axis < 3; axis++) {
      for (let i = 0; i < nextBoards.length; i++) {
        const b = nextBoards[i];
        if (b.visible === false || b.disableAutoAlign || b.shape === "plane")
          continue;
        const b_size = b.size[axis];
        const b_pos = b.position[axis];

        for (let j = i + 1; j < nextBoards.length; j++) {
          const other = nextBoards[j];
          if (
            other.visible === false ||
            other.disableAutoAlign ||
            other.shape === "plane"
          )
            continue;
          const o_size = other.size[axis];
          const o_pos = other.position[axis];

          const b_min = b_pos - b_size / 2;
          const b_max = b_pos + b_size / 2;
          const o_min = o_pos - o_size / 2;
          const o_max = o_pos + o_size / 2;

          let faceA = null;
          let faceB = null;

          if (Math.abs(b_min - o_max) < 0.005) {
            faceA = axisFaces[axis].min;
            faceB = axisFaces[axis].max;
          } else if (Math.abs(b_max - o_min) < 0.005) {
            faceA = axisFaces[axis].max;
            faceB = axisFaces[axis].min;
          } else if (Math.abs(b_min - o_min) < 0.005) {
            faceA = axisFaces[axis].min;
            faceB = axisFaces[axis].min;
          } else if (Math.abs(b_max - o_max) < 0.005) {
            faceA = axisFaces[axis].max;
            faceB = axisFaces[axis].max;
          }

          if (faceA && faceB) {
            const proposed = {
              type: "Flush",
              boardAId: b.id.toString(),
              boardBId: other.id.toString(),
              faceA,
              faceB,
              axis,
              enabled: true,
            };

            const exists = Object.values(newConstraints).some(
              (c) =>
                c.type === "Flush" &&
                ((c.boardAId === proposed.boardAId &&
                  c.boardBId === proposed.boardBId) ||
                  (c.boardAId === proposed.boardBId &&
                    c.boardBId === proposed.boardAId)) &&
                c.axis === proposed.axis,
            );

            if (!exists) {
              const conflict = checkConstraintConflict(
                proposed,
                newConstraints,
                nextBoards,
              );
              if (!conflict) {
                const cId =
                  "flush_" +
                  Date.now() +
                  "_" +
                  Math.floor(Math.random() * 1000);
                newConstraints[cId] = proposed;
                changed = true;
              }
            }
          }
        }
      }
    }

    // 3. Keep selected miter cut synchronized: if rotated such that selected cut is no longer visible, deselect/unhighlight
    const miterSawBoardId = get().miterSawBoardId;
    let selectedMiterCutIndex = get().selectedMiterCutIndex;
    const miterSawCuts = get().miterSawCuts;

    if (miterSawBoardId && selectedMiterCutIndex !== null && miterSawCuts) {
      const newBoard = nextBoards.find(
        (b) => b.id.toString() === miterSawBoardId,
      );
      if (!newBoard) {
        selectedMiterCutIndex = null;
      } else {
        const newOri = newBoard.orientation || [0, 0, 0];
        const [rx, ry, rz] = newOri;
        const euler = new THREE.Euler(rx, ry, rz, "YXZ");
        const upVectors = {
          top: new THREE.Vector3(0, 1, 0).applyEuler(euler).y,
          bottom: new THREE.Vector3(0, -1, 0).applyEuler(euler).y,
          front: new THREE.Vector3(0, 0, 1).applyEuler(euler).y,
          back: new THREE.Vector3(0, 0, -1).applyEuler(euler).y,
        };
        let maxVal = upVectors.top;
        let upFace = "top";
        for (const [face, val] of Object.entries(upVectors)) {
          if (val > maxVal) {
            maxVal = val;
            upFace = face;
          }
        }

        const filteredCuts = miterSawCuts.filter((cut) => {
          if (cut.isEndCut) return true;
          const cy = cut.centerY !== undefined ? cut.centerY : cut.positionY;
          const cz = cut.centerZ !== undefined ? cut.centerZ : cut.positionZ;
          if (upFace === "top") return cy > 0.05;
          if (upFace === "bottom") return cy < -0.05;
          if (upFace === "front") return cz > 0.05;
          if (upFace === "back") return cz < -0.05;
          return false;
        });

        const selectedCut = miterSawCuts[selectedMiterCutIndex];
        const isVisible = filteredCuts.some((c) => c === selectedCut);
        if (!isVisible) {
          selectedMiterCutIndex = null;
        }
      }
    }

    const currentSelectedMiterCutIndex = get().selectedMiterCutIndex;
    const selectedMiterCutIndexChanged =
      selectedMiterCutIndex !== currentSelectedMiterCutIndex;

    if (changed || selectedMiterCutIndexChanged) {
      set({
        boards: nextBoards,
        constraints: newConstraints,
        selectedMiterCutIndex,
      });
    } else {
      set({ boards: nextBoards });
    }
  },

  // Groups: Purely organizational. No position or rotation.
  groups: loadState("groups", {
    Workspace: { parentId: null, visible: true, isExpanded: true },
  }),
  setGroups: (v) =>
    set({ groups: typeof v === "function" ? v(get().groups) : v }),

  // Central constraint index. Key = UUID string.
  // Flush: { type, boardAId, boardBId, faceA, faceB, axis, enabled }
  // Glue:  { type, boardAId, boardBId, offset: [dx,dy,dz], enabled }
  constraints: loadState("constraints", {}),
  setConstraints: (v) =>
    set({ constraints: typeof v === "function" ? v(get().constraints) : v }),

  selectedItemIds: [],
  setSelectedItemIds: (v) =>
    set({
      selectedItemIds: typeof v === "function" ? v(get().selectedItemIds) : v,
    }),

  constraintTargetMode: null,
  setConstraintTargetMode: (v) =>
    set({
      constraintTargetMode:
        typeof v === "function" ? v(get().constraintTargetMode) : v,
    }),

  // ── 2D: History (Undo/Redo) ───────────────────────────────────────────────
  history: [],
  redoHistory: [],

  pushHistory: () => {
    const { boards, groups, constraints, history } = get();
    set({
      redoHistory: [],
      history: [...history, { boards, groups, constraints }].slice(-25),
    });
  },

  handleUndo: () => {
    const { history, boards, groups, constraints, selectedItemIds } = get();
    if (history.length === 0) return;
    const last = history[history.length - 1];
    // Drop any selected ids that won't exist once boards/groups are restored
    // (e.g. undoing a duplicate or new-board creation) — otherwise the
    // Inspector keeps trying to read boards that no longer exist, which can
    // produce NaN values and crash numeric inputs.
    const validIds = new Set([
      ...last.boards.map((b) => b.id.toString()),
      ...Object.keys(last.groups || {}),
    ]);
    set({
      redoHistory: [...get().redoHistory, { boards, groups, constraints }],
      history: history.slice(0, -1),
      boards: last.boards,
      groups: last.groups,
      constraints: last.constraints ?? {},
      selectedItemIds: selectedItemIds.filter((id) => validIds.has(id)),
    });
  },

  handleRedo: () => {
    const { redoHistory, boards, groups, constraints, selectedItemIds } = get();
    if (redoHistory.length === 0) return;
    const next = redoHistory[redoHistory.length - 1];
    const validIds = new Set([
      ...next.boards.map((b) => b.id.toString()),
      ...Object.keys(next.groups || {}),
    ]);
    set({
      history: [...get().history, { boards, groups, constraints }],
      redoHistory: redoHistory.slice(0, -1),
      boards: next.boards,
      groups: next.groups,
      constraints: next.constraints ?? {},
      selectedItemIds: selectedItemIds.filter((id) => validIds.has(id)),
    });
  },

  resetHistory: () => set({ history: [], redoHistory: [] }),

  // ── 2E: Actions ──────────────────────────────────────────────────────────
  ...createActions(set, get),
}));

// ── Async disk recovery: runs once after the store is created ────────────────
// If localStorage was empty (cache cleared), tries to reload from the stored
// disk file handle and also re-hydrates libraryDiskHandle.
(async () => {
  try {
    // Restore handle regardless (needed for auto-save even if LS is populated)
    const handle = await loadStoredHandle();
    if (handle) useStore.setState({ libraryDiskHandle: handle });

    // Only attempt disk recovery when localStorage was empty
    if (_initialLibrary.length === 0) {
      const recovered = await loadLibraryFromDiskIfNeeded();
      if (recovered.length > 0) {
        useStore.setState({ assemblyLibrary: recovered });
      }
    }
  } catch {
    /* non-fatal */
  }

  // ── Hardware library disk recovery ──
  try {
    const hwHandle = await loadStoredHardwareHandle();
    if (hwHandle) useStore.setState({ hardwareLibraryDiskHandle: hwHandle });

    if (_initialHardwareLibrary.length === 0) {
      const { entries, handle } = await loadHardwareLibraryFromDiskIfNeeded();
      if (entries.length > 0) {
        useStore.setState({ customHardware: entries });
      }
      if (handle) useStore.setState({ hardwareLibraryDiskHandle: handle });
    }
  } catch {
    /* non-fatal */
  }
})();

export default useStore;
