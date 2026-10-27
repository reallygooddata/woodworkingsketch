import versionInfo from "../version.json";

export const ACTIVE_WORKSPACE_KEY = "lucey_save";
export const RECENT_FILES_KEY = "lucey_recent_files";
export const WORKSPACE_SCHEMA_VERSION = 1;

export function sanitizeBoard(board) {
  const { constraints: _constraints, rotation, ...rest } = board || {};
  const size =
    Array.isArray(board?.size) && board.size.length === 3
      ? board.size
      : [1, 1, 1];
  const sorted = [...size].sort((a, b) => b - a);
  const width = sorted[1] ?? 0;
  const defaultLumberType = width > 12 ? "plywood" : "solid";

  return {
    ...rest,
    size,
    position:
      Array.isArray(board?.position) && board.position.length === 3
        ? board.position
        : [0, 0.5, 0],
    operations: Array.isArray(board?.operations) ? board.operations : [],
    shape: board?.shape || "box",
    parentId: board?.parentId || "Workspace",
    lumberType: board?.lumberType || defaultLumberType,
    grainDirection: board?.grainDirection || "length",
    ...(rotation && !board?.orientation ? { orientation: rotation } : {}),
  };
}

export function sanitizeGroups(groups) {
  if (!groups || typeof groups !== "object") {
    return {
      Workspace: {
        parentId: null,
        visible: true,
        isExpanded: true,
        name: "Workspace",
      },
    };
  }

  const nextGroups = { ...groups };

  if (!nextGroups.Workspace) {
    nextGroups.Workspace = {
      parentId: null,
      visible: true,
      isExpanded: true,
      name: "Workspace",
    };
  }

  Object.keys(nextGroups).forEach((key) => {
    if (key !== "Workspace" && !nextGroups[key].parentId) {
      nextGroups[key] = { ...nextGroups[key], parentId: "Workspace" };
    }
  });

  return nextGroups;
}

export function sanitizeWorkspacePayload(payload) {
  if (!payload || typeof payload !== "object") return null;

  return {
    ...payload,
    boards: Array.isArray(payload.boards)
      ? payload.boards.map(sanitizeBoard)
      : payload.boards,
    groups: sanitizeGroups(payload.groups),
  };
}

export function validateWorkspacePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { valid: false, reason: "Workspace payload must be an object." };
  }

  if (!Array.isArray(payload.boards)) {
    return {
      valid: false,
      reason: "Workspace payload must include a boards array.",
    };
  }

  if (
    !payload.groups ||
    typeof payload.groups !== "object" ||
    Array.isArray(payload.groups)
  ) {
    return {
      valid: false,
      reason: "Workspace payload must include a groups object.",
    };
  }

  for (const board of payload.boards) {
    if (!board || typeof board !== "object") {
      return { valid: false, reason: "Each board must be an object." };
    }

    if (!("id" in board)) {
      return { valid: false, reason: "Each board must include an id." };
    }

    if (!Array.isArray(board.size) || board.size.length !== 3) {
      return {
        valid: false,
        reason: `Board ${board.id} must include a size array with 3 entries.`,
      };
    }

    if (!Array.isArray(board.position) || board.position.length !== 3) {
      return {
        valid: false,
        reason: `Board ${board.id} must include a position array with 3 entries.`,
      };
    }
  }

  return { valid: true };
}

export function buildWorkspacePayload(state) {
  const {
    boards,
    groups,
    constraints,
    theme,
    units,
    gridSnap,
    defaultMaterial,
    showEdges,
    showDimensions,
    showBoundingBox,
    globalBounds,
    lighting,
    recentColors,
    autosaveInterval,
    cameraState,
    measurements,
    showMeasurements,
    panelLayoutMode,
    workspaceLayout,
    lumberyardSnapEnabled,
    measurementStyle,
    imperialFormat,
  } = state;

  return {
    boards,
    groups,
    constraints,
    theme,
    units,
    gridSnap,
    defaultMaterial,
    showEdges,
    showDimensions,
    showBoundingBox,
    globalBounds,
    lighting,
    recentColors,
    autosaveInterval,
    cameraState,
    measurements,
    showMeasurements,
    panelLayoutMode,
    workspaceLayout,
    lumberyardSnapEnabled,
    measurementStyle,
    imperialFormat,
  };
}

export function buildWorkspaceDocument(payload) {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    appVersion: versionInfo.version,
    exportedAt: new Date().toISOString(),
    workspace: payload,
  };
}

function migrateLegacyWorkspacePayload(payload) {
  if (!payload || typeof payload !== "object") return null;

  const validation = validateWorkspacePayload(payload);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  return sanitizeWorkspacePayload(payload);
}

function migrateV1WorkspaceDocument(document) {
  if (!document?.workspace || typeof document.workspace !== "object") {
    throw new Error(
      "Versioned workspace document must include a workspace object.",
    );
  }

  const validation = validateWorkspacePayload(document.workspace);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  return sanitizeWorkspacePayload(document.workspace);
}

export function migrateWorkspaceDocument(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  if (!("workspace" in parsed)) {
    return migrateLegacyWorkspacePayload(parsed);
  }

  const schemaVersion = parsed.schemaVersion ?? 1;

  switch (schemaVersion) {
    case 1:
      return migrateV1WorkspaceDocument(parsed);
    default:
      return sanitizeWorkspacePayload(parsed.workspace);
  }
}

export function parseWorkspaceString(serialized) {
  if (!serialized) return null;

  const parsed = JSON.parse(serialized);
  return migrateWorkspaceDocument(parsed);
}

export function stringifyWorkspacePayload(payload, spacing = 0, options = {}) {
  const { versioned = false } = options;
  const data = versioned ? buildWorkspaceDocument(payload) : payload;
  return JSON.stringify(data, null, spacing);
}

export function loadWorkspaceStorage(key = ACTIVE_WORKSPACE_KEY) {
  try {
    const serialized = localStorage.getItem(key);
    if (!serialized) return null;
    return parseWorkspaceString(serialized);
  } catch (error) {
    console.error(
      "[workspaceSerialization] Failed to load workspace storage:",
      key,
      error,
    );
    return null;
  }
}

export function saveWorkspaceStorage(key, payload, spacing = 0) {
  const serialized = stringifyWorkspacePayload(payload, spacing);
  localStorage.setItem(key, serialized);
  return serialized;
}

// Reads whatever is currently stored under `key` without enforcing the
// strict `boards`/`groups` schema that `loadWorkspaceStorage` requires.
// `updateActiveWorkspaceStorage` performs incremental merges (camera state,
// toggles, etc.) that happen long before a full workspace (with boards) is
// ever saved — requiring a fully valid document here would reject that
// legitimate partial state and silently drop it on every subsequent merge.
function readRawWorkspaceStorage(key) {
  try {
    const serialized = localStorage.getItem(key);
    if (!serialized) return null;
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object") return null;
    const payload = "workspace" in parsed ? parsed.workspace : parsed;
    return payload && typeof payload === "object" ? payload : null;
  } catch (error) {
    console.error(
      "[workspaceSerialization] Failed to read raw workspace storage:",
      key,
      error,
    );
    return null;
  }
}

export function updateActiveWorkspaceStorage(updater) {
  try {
    const current = readRawWorkspaceStorage(ACTIVE_WORKSPACE_KEY) || {};
    const next = updater(current);
    return saveWorkspaceStorage(ACTIVE_WORKSPACE_KEY, next);
  } catch (error) {
    console.error(
      "[workspaceSerialization] Failed to update active workspace storage:",
      error,
    );
    return null;
  }
}

export function loadRecentFiles() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_FILES_KEY)) || [];
  } catch {
    return [];
  }
}

export function saveRecentFiles(recentFiles) {
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recentFiles));
}
