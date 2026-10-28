import * as THREE from 'three';
import { computeWorldAABB, collectChildBoards, worldBoundsOfSelection } from '../../utils/sceneGraph';
import { propagateMove, checkConstraintConflict, solveFlushSnap, faceToAxis } from '../../utils/constraintSolver';
import { WOOD_CATALOGUE, PAINT_PALETTE } from '../../utils/materialCatalogue';
import { calculateBoardCuts } from '../../utils/miterSawCalculator';

// Returns an auto-incremented clone name ("Leg" -> "Leg 2" -> "Leg 3", ...)
// matching the convention the Inspector's "Clone Component" button has always
// used, so a duplicate created any way (button or keyboard shortcut) reads
// the same. `existingBoards` should include any clones already assigned a
// name earlier in the same batch, so a multi-board duplicate doesn't hand out
// the same name twice.
const nextCloneName = (existingBoards, originalName) => {
  const match = originalName.match(/^(.*?)(?:\s\d+)?$/);
  const baseName = match ? match[1].trim() : originalName.trim();
  let maxIdx = 0;
  existingBoards.forEach(b => {
    if (b.name === baseName) {
      maxIdx = Math.max(maxIdx, 1);
    } else {
      const m = b.name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s(\\d+)$`));
      if (m) maxIdx = Math.max(maxIdx, parseInt(m[1]));
    }
  });
  return `${baseName} ${maxIdx > 0 ? maxIdx + 1 : 2}`;
};

export const createBoardSlice = (set, get) => ({
  miterSawCuts: null,
  miterSawBoardId: null,
  miterSawOriginalBoardId: null,
  selectedMiterCutIndex: null,

  setSelectedMiterCutIndex: (index) => {
    set({ selectedMiterCutIndex: index });
  },

  calculateMiterSawCuts: (boardId) => {
    const { boards } = get();
    const targetBoard = boards.find(b => b.id.toString() === boardId.toString());
    if (!targetBoard) return;
    const cuts = calculateBoardCuts(targetBoard);
    set({
      miterSawCuts: cuts,
      miterSawBoardId: boardId.toString(),
      selectedMiterCutIndex: null
    });
  },

  setCustomPivot: (boardId, localOffset) => {
    const {
      boards,
      setBoards,
      pushHistory
    } = get();
    const b = boards.find(b => b.id.toString() === boardId.toString());
    if (!b) return;
    pushHistory();
    const oldPiv = b.pivot || [0, 0, 0];
    const dx = localOffset[0] - oldPiv[0];
    const dy = localOffset[1] - oldPiv[1];
    const dz = localOffset[2] - oldPiv[2];

    // Apply orientation to find world-space delta
    let wx = dx,
      wy = dy,
      wz = dz;
    const [rx, ry, rz] = b.orientation || [0, 0, 0];
    if (rx !== 0 || ry !== 0 || rz !== 0) {
      const ca = Math.cos(rx),
        sb = Math.sin(rx);
      const cc = Math.cos(ry),
        sd = Math.sin(ry);
      const ce = Math.cos(rz),
        sf = Math.sin(rz);
      wx = (cc * ce + sd * sf * sb) * dx + (sd * sb * ce - cc * sf) * dy + ca * sd * dz;
      wy = ca * sf * dx + ca * ce * dy + -sb * dz;
      wz = (cc * sf * sb - sd * ce) * dx + (sd * sf + cc * ce * sb) * dy + ca * cc * dz;
    }
    setBoards(prev => prev.map(board => {
      if (board.id.toString() === boardId.toString()) {
        return {
          ...board,
          pivot: [...localOffset],
          position: [board.position[0] + wx, board.position[1] + wy, board.position[2] + wz]
        };
      }
      return board;
    }));
  },
  // ── end library actions ──────────────────────────────────────────────────

  /**
   * Apply a material descriptor to all selected boards (or set defaultMaterial
   * if nothing is selected). Tracks recent custom paint colours.
   *
   * @param {{ type: 'wood'|'color', id?: string, hex?: string }} matDesc
   */
  applyMaterial: matDesc => {
    const {
      selectedItemIds,
      boards,
      groups,
      setBoards,
      setDefaultMaterial,
      setRecentColors,
      recentColors,
      pushHistory,
      showToast,
      addRecordedStep
    } = get();
    if (selectedItemIds.length === 0) {
      // No selection — update the global default for future new boards
      setDefaultMaterial(matDesc);
      const label = matDesc.type === 'color' ? matDesc.hex : matDesc.id;
      showToast(`Default material → ${label}`);

      if (addRecordedStep) {
        const matLabel = matDesc.type === 'color' ? `color \`${matDesc.hex}\`` : `wood type \`${matDesc.id}\``;
        addRecordedStep(`In the **Materials** panel, set the default material for new boards to ${matLabel}.`);
      }
    } else {
      pushHistory();

      // Collect all board IDs to update (direct + inside selected groups)
      const boardIds = new Set();
      const collectBoards = gid => {
        boards.filter(b => b.parentId === gid).forEach(b => boardIds.add(b.id.toString()));
        Object.keys(groups).filter(k => groups[k].parentId === gid).forEach(collectBoards);
      };
      selectedItemIds.forEach(id => {
        if (groups[id]) collectBoards(id);else boardIds.add(id);
      });
      setBoards(prev => prev.map(b => boardIds.has(b.id.toString()) ? {
        ...b,
        material: matDesc
      } : b));
      const label = matDesc.type === 'color' ? matDesc.hex : matDesc.id;
      showToast(`Material → ${label} ✓`);

      if (addRecordedStep) {
        const matLabel = matDesc.type === 'color' ? `color \`${matDesc.hex}\`` : `wood type \`${matDesc.id}\``;
        const selectedNames = boards.filter(b => boardIds.has(b.id.toString())).map(b => `\`${b.name}\``).join(', ');
        if (selectedNames) {
          addRecordedStep(`In the **Materials** panel, apply the ${matLabel} to the selected board(s): ${selectedNames}.`);
        }
      }
    }

    // Track recent custom colours (max 8, newest first)
    if (matDesc.type === 'color') {
      const updated = [matDesc.hex, ...recentColors.filter(c => c !== matDesc.hex)].slice(0, 8);
      setRecentColors(updated);
    }
  },
  toggleSelection: (id, isMulti, faceStr = null, source = null) => {
    const {
      constraintTargetMode,
      setConstraintTargetMode,
      pushHistory,
      boards,
      groups,
      constraints,
      setConstraints,
      setBoards,
      selectedItemIds,
      setSelectedItemIds,
      showToast,
      addRecordedStep
    } = get();
    const strId = id.toString();
    if (constraintTargetMode && constraintTargetMode.active) {
      // ── Glue: step 1 only — just pick the target board (no face needed) ─
      if (constraintTargetMode.type === 'Glue') {
        if (strId === constraintTargetMode.sourceId) return; // can't glue to self
        const boardA = boards.find(b => b.id.toString() === constraintTargetMode.sourceId);
        const boardB = boards.find(b => b.id.toString() === strId);
        if (!boardA || !boardB) return;
        const proposed = {
          type: 'Glue',
          boardAId: constraintTargetMode.sourceId,
          boardBId: strId
        };
        const conflict = checkConstraintConflict(proposed, constraints, boards);
        if (conflict) {
          showToast('⚠️ ' + conflict);
          setConstraintTargetMode(null);
          return;
        }
        pushHistory();
        const offset = [boardB.position[0] - boardA.position[0], boardB.position[1] - boardA.position[1], boardB.position[2] - boardA.position[2]];
        const id = Date.now().toString();
        setConstraints(prev => ({
          ...prev,
          [id]: {
            type: 'Glue',
            boardAId: boardA.id.toString(),
            boardBId: boardB.id.toString(),
            offset,
            enabled: true
          }
        }));
        setConstraintTargetMode(null);
        showToast(`Glued "${boardA.name}" to "${boardB.name}"`);

        if (addRecordedStep) {
          addRecordedStep(`Select \`${boardA.name}\`. In the Inspector Panel, click **+ Add Glue**, and then click on \`${boardB.name}\` to rigidly join them together.`);
        }
        return;
      }

      // ── Flush: 2-step face picker ─────────────────────────────────────
      if (!faceStr) return;
      if (constraintTargetMode.step === 1) {
        if (strId !== constraintTargetMode.sourceId) return;
        setConstraintTargetMode({
          ...constraintTargetMode,
          step: 2,
          sourceFace: faceStr
        });
      } else if (constraintTargetMode.step === 2) {
        if (strId === constraintTargetMode.sourceId) return;
        const boardA = boards.find(b => b.id.toString() === constraintTargetMode.sourceId);
        const boardB = boards.find(b => b.id.toString() === strId);
        if (!boardA || !boardB) return;
        const axis = faceToAxis(constraintTargetMode.sourceFace);
        const proposed = {
          type: 'Flush',
          boardAId: boardA.id.toString(),
          boardBId: strId,
          faceA: constraintTargetMode.sourceFace,
          faceB: faceStr
        };
        const conflict = checkConstraintConflict(proposed, constraints, boards);
        if (conflict) {
          showToast('⚠️ ' + conflict);
          setConstraintTargetMode(null);
          return;
        }
        pushHistory();
        // Snap boardA to satisfy the constraint immediately
        const snappedPos = solveFlushSnap(boardA, constraintTargetMode.sourceFace, boardB, faceStr);
        if (snappedPos) {
          const deltaVec = [snappedPos[0] - boardA.position[0], snappedPos[1] - boardA.position[1], snappedPos[2] - boardA.position[2]];
          const moveMap = propagateMove([boardA.id.toString()], deltaVec, constraints);
          setBoards(prev => prev.map(b => {
            const d = moveMap.get(b.id.toString());
            if (d) {
              return {
                ...b,
                position: [b.position[0] + d[0], b.position[1] + d[1], b.position[2] + d[2]]
              };
            }
            return b;
          }));
        }
        const cId = Date.now().toString();
        setConstraints(prev => ({
          ...prev,
          [cId]: {
            type: 'Flush',
            boardAId: boardA.id.toString(),
            boardBId: strId,
            faceA: constraintTargetMode.sourceFace,
            faceB: faceStr,
            axis,
            enabled: true
          }
        }));
        setConstraintTargetMode(null);
        showToast(`Flush constraint added on ${['X', 'Y', 'Z'][axis]} axis.`);

        if (addRecordedStep) {
          addRecordedStep(
            `Select \`${boardA.name}\`. In the Inspector Panel, click **+ Add Flush Alignment**.\n` +
            `*   Click the **${constraintTargetMode.sourceFace}** face on \`${boardA.name}\`.\n` +
            `*   Click the **${faceStr}** face on \`${boardB.name}\` to align them.`
          );
        }
      }
      return;
    }

    if (addRecordedStep) {
      const board = boards.find(b => b.id.toString() === strId);
      const group = groups[strId];
      const name = board ? board.name : (group ? group.name || strId : strId);
      if (source === 'outliner') {
        const isDeselecting = selectedItemIds.includes(strId);
        if (isDeselecting) {
          addRecordedStep(`In the **Outliner** panel, click on \`${name}\` to deselect it.`);
        } else if (isMulti) {
          addRecordedStep(`In the **Outliner** panel, click on \`${name}\` to add it to the selection.`);
        } else {
          addRecordedStep(`In the **Outliner** panel, click on \`${name}\` to select it.`);
        }
      } else {
        addRecordedStep(`Select \`${name}\`.`);
      }
    }

    if (isMulti) {
      setSelectedItemIds(prev => prev.includes(strId) ? prev.filter(x => x !== strId) : [...prev, strId]);
    } else {
      setSelectedItemIds([strId]);
    }
  },
  updateSelectedBoards: (key, value) => {
    const {
      pushHistory,
      setBoards,
      boards,
      selectedItemIds
    } = get();
    pushHistory();
    setBoards(boards.map(b => selectedItemIds.includes(b.id.toString()) ? {
      ...b,
      [key]: value
    } : b));
  },
  // ─── CSG Operation CRUD ──────────────────────────────────────────────────
  addOperation: (boardId, opType) => {
    const {
      pushHistory,
      setBoards
    } = get();
    pushHistory();
    const defaults = {
      hole: {
        type: 'hole',
        radius: 1,
        offsetX: 0,
        offsetY: 0,
        axis: 'y'
      },
      cove: {
        type: 'cove',
        edge: 'top',
        depth: 1,
        axis: 'y'
      },
      arc: {
        type: 'arc',
        startAngle: 0,
        endAngle: 90,
        innerRadius: 0,
        axis: 'y'
      }
    };
    const op = {
      id: Date.now(),
      ...(defaults[opType] ?? {
        type: opType
      })
    };
    setBoards(prev => prev.map(b => b.id.toString() === boardId.toString() ? {
      ...b,
      operations: [...(b.operations || []), op]
    } : b));
  },
  updateOperation: (boardId, opId, patch) => {
    const {
      pushHistory,
      setBoards
    } = get();
    pushHistory();
    setBoards(prev => prev.map(b => b.id.toString() === boardId.toString() ? {
      ...b,
      operations: (b.operations || []).map(o => o.id === opId ? {
        ...o,
        ...patch
      } : o)
    } : b));
  },
  removeOperation: (boardId, opId) => {
    const {
      pushHistory,
      setBoards
    } = get();
    pushHistory();
    setBoards(prev => prev.map(b => b.id.toString() === boardId.toString() ? {
      ...b,
      operations: (b.operations || []).filter(o => o.id !== opId)
    } : b));
  },
  // ─── Hardware Attachment CRUD ────────────────────────────────────────────
  addHardware: (boardId, catalogueItem, face) => {
    const {
      pushHistory,
      setBoards
    } = get();
    pushHistory();
    const hw = {
      id: 'hw_' + Date.now(),
      name: catalogueItem.label,
      modelUrl: catalogueItem.modelUrl,
      catalogueId: catalogueItem.id,
      face: face || catalogueItem.defaultFace || 'front',
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1
    };
    setBoards(prev => prev.map(b => b.id.toString() === boardId.toString() ? {
      ...b,
      hardware: [...(b.hardware || []), hw]
    } : b));
  },
  updateHardware: (boardId, hwId, patch) => {
    const {
      pushHistory,
      setBoards
    } = get();
    pushHistory();
    setBoards(prev => prev.map(b => b.id.toString() === boardId.toString() ? {
      ...b,
      hardware: (b.hardware || []).map(h => h.id === hwId ? {
        ...h,
        ...patch
      } : h)
    } : b));
  },
  removeHardware: (boardId, hwId) => {
    const {
      pushHistory,
      setBoards
    } = get();
    pushHistory();
    setBoards(prev => prev.map(b => b.id.toString() === boardId.toString() ? {
      ...b,
      hardware: (b.hardware || []).filter(h => h.id !== hwId)
    } : b));
  },
  toggleBoardVisibility: id => {
    const {
      setBoards,
      boards,
      addRecordedStep
    } = get();
    const board = boards.find(b => b.id.toString() === id.toString());
    if (board && addRecordedStep) {
      const nextVisible = board.visible === false ? 'show' : 'hide';
      addRecordedStep(`In the **Outliner** panel, click the visibility icon for \`${board.name}\` to ${nextVisible} it.`);
    }
    setBoards(bds => bds.map(b => b.id.toString() === id.toString() ? {
      ...b,
      visible: b.visible === false ? true : false
    } : b));
  },
  toggleGroupVisibility: groupId => {
    const {
      setGroups,
      groups,
      addRecordedStep
    } = get();
    const cur = groups[groupId] || {};
    if (addRecordedStep) {
      const nextVisible = cur.visible === false ? 'show' : 'hide';
      const name = cur.name || groupId;
      addRecordedStep(`In the **Outliner** panel, click the visibility icon for the \`${name}\` assembly to ${nextVisible} it.`);
    }
    setGroups(prev => {
      const cur = prev[groupId] || {};
      return {
        ...prev,
        [groupId]: {
          ...cur,
          visible: cur.visible === false ? true : false
        }
      };
    });
  },
  // ─── Update a vector field (size or position) on selected boards ─────────
  updateVector: (key, index, value) => {
    const {
      selectedItemIds,
      pushHistory,
      boards,
      constraints,
      setBoards,
      units,
      showToast,
      addRecordedStep
    } = get();
    if (selectedItemIds.length === 0) return;
    pushHistory();
    const floatVal = parseFloat(value) || 0;

    const formatVal = (val) => {
      if (units === 'metric') {
        return `${(val * 25.4).toFixed(0)} mm`;
      }
      const standardFraction = val === 0.75 ? ' (3/4")' : val === 0.5 ? ' (1/2")' : val === 0.25 ? ' (1/4")' : val === 0.375 ? ' (3/8")' : '';
      return `${parseFloat(val.toFixed(4))}"${standardFraction}`;
    };

    if (key === 'position') {
      // Find the primary board to compute delta
      const primaryBoard = boards.find(bd => selectedItemIds.includes(bd.id.toString()));
      if (!primaryBoard) return;

      let clampedVal = floatVal;
      let wasClamped = false;
      if (floatVal < -5000) {
        clampedVal = -5000;
        wasClamped = true;
      } else if (floatVal > 5000) {
        clampedVal = 5000;
        wasClamped = true;
      }

      if (addRecordedStep) {
        const axisLabel = index === 0 ? 'X/Red' : index === 1 ? 'Y/Green' : 'Z/Blue';
        const boardName = primaryBoard.name || 'Component';
        addRecordedStep(`In the Inspector Panel for \`${boardName}\`, set **Position/${axisLabel} dimension** to ${formatVal(clampedVal)}.`);
      }

      if (wasClamped) {
        const axisLetter = ['X', 'Y', 'Z'][index];
        const unitLabel = units === 'metric' ? 'mm' : 'in';
        const displayVal = units === 'metric' ? (clampedVal * 25.4).toFixed(0) : clampedVal.toFixed(2);
        showToast(`⚠️ Position ${axisLetter} clamped to safe limit of ${displayVal} ${unitLabel}`);
      }

      const delta = clampedVal - primaryBoard.position[index];
      if (delta === 0) return;
      const deltaVec = [0, 0, 0];
      deltaVec[index] = delta;

      // Propagate through constraints
      const moveMap = propagateMove(selectedItemIds, deltaVec, constraints);
      setBoards(boards.map(b => {
        const d = moveMap.get(b.id.toString());
        if (d) {
          let nx = b.position[0] + d[0];
          let ny = b.position[1] + d[1];
          let nz = b.position[2] + d[2];

          let propClamped = false;
          if (nx < -5000) { nx = -5000; propClamped = true; }
          else if (nx > 5000) { nx = 5000; propClamped = true; }

          if (ny < -5000) { ny = -5000; propClamped = true; }
          else if (ny > 5000) { ny = 5000; propClamped = true; }

          if (nz < -5000) { nz = -5000; propClamped = true; }
          else if (nz > 5000) { nz = 5000; propClamped = true; }

          if (propClamped && b.id.toString() === primaryBoard.id.toString() && !wasClamped) {
            showToast(`⚠️ Position clamped to safe bounds`);
          }

          return {
            ...b,
            position: [nx, ny, nz]
          };
        }
        return b;
      }));
    } else {
      let clampedVal = floatVal;
      let wasClamped = false;
      if (key === 'size') {
        if (floatVal < 0.0625) {
          clampedVal = 0.0625;
          wasClamped = true;
        } else if (floatVal > 1000) {
          clampedVal = 1000;
          wasClamped = true;
        }

        if (wasClamped) {
          // Determine friendly label if standard Length/Width/Thickness
          const dimLabel = ['Length', 'Width', 'Thickness'][index] || `Size axis ${index}`;
          const unitLabel = units === 'metric' ? 'mm' : 'in';
          const displayVal = units === 'metric' ? (clampedVal * 25.4).toFixed(1) : clampedVal.toFixed(3);
          showToast(`⚠️ ${dimLabel} clamped to safe limit of ${displayVal} ${unitLabel}`);
        }

        if (addRecordedStep) {
          const primaryBoard = boards.find(bd => selectedItemIds.includes(bd.id.toString()));
          const boardName = primaryBoard ? primaryBoard.name : 'Component';
          const sizeLabel = index === 0 ? 'Length/X/Red dimension' : index === 1 ? 'Thickness/Y/Green dimension' : 'Width/Z/Blue dimension';
          addRecordedStep(`In the Inspector Panel for \`${boardName}\`, set **${sizeLabel}** to ${formatVal(clampedVal)}.`);
        }
      }

      // Size / other scalar field — only apply to directly selected boards
      setBoards(boards.map(b => {
        if (selectedItemIds.includes(b.id.toString())) {
          let newVec = [...b[key]];
          newVec[index] = clampedVal;
          return {
            ...b,
            [key]: newVec
          };
        }
        return b;
      }));
    }
  },
  // ─── Apply incremental rotation to a board (quaternion math) ──────────────
  // Applies rotation exactly along the board's LOCAL axis, avoiding gimbal lock.
  incrementRotation: (axis, degrees) => {
    const {
      selectedItemIds,
      pushHistory,
      boards,
      setBoards
    } = get();
    if (selectedItemIds.length === 0) return;
    pushHistory();
    const radians = degrees * Math.PI / 180;
    const axisVec = new THREE.Vector3();
    if (axis === 0) axisVec.set(1, 0, 0);
    if (axis === 1) axisVec.set(0, 1, 0);
    if (axis === 2) axisVec.set(0, 0, 1);
    const qInc = new THREE.Quaternion().setFromAxisAngle(axisVec, radians);
    setBoards(boards.map(b => {
      if (selectedItemIds.includes(b.id.toString())) {
        const currentEuler = new THREE.Euler(...(b.orientation || [0, 0, 0]), 'YXZ');
        const qCurrent = new THREE.Quaternion().setFromEuler(currentEuler);

        // Multiply applies the rotation LOCALLY
        qCurrent.multiply(qInc);
        const newEuler = new THREE.Euler().setFromQuaternion(qCurrent, 'YXZ');

        // Keep values wrapped inside reasonable bounds slightly (to avoid drifting)
        let x = newEuler.x;
        let y = newEuler.y;
        let z = newEuler.z;
        return {
          ...b,
          orientation: [x, y, z]
        };
      }
      return b;
    }));
  },
  // ─── Reset orientation on selected boards to [0,0,0] ─────────────────────
  resetRotation: () => {
    const {
      selectedItemIds,
      pushHistory,
      boards,
      setBoards
    } = get();
    if (selectedItemIds.length === 0) return;
    pushHistory();
    setBoards(boards.map(b => selectedItemIds.includes(b.id.toString()) ? {
      ...b,
      orientation: [0, 0, 0]
    } : b));
  },
  // ─── applyRotation removed — local orientation model ──────────────────────
  // Operations (miter, dado, hole, etc.) are defined in LOCAL board space.
  // Rotating a board only changes its `orientation` Euler — no baking, no
  // axis/face remapping.  The old applyRotation bake-rotation logic has been
  // intentionally deleted as part of the local-orientation migration.

  // ─── Move all boards in a group by a delta ───────────────────────────────
  moveGroup: (groupId, axis, delta) => {
    const {
      pushHistory,
      boards,
      groups,
      constraints,
      setBoards
    } = get();
    if (delta === 0) return;
    pushHistory();
    const childBoards = collectChildBoards(groupId, boards, groups);
    const childIds = childBoards.map(b => b.id.toString());
    const deltaVec = [0, 0, 0];
    deltaVec[axis] = delta;
    const moveMap = propagateMove(childIds, deltaVec, constraints);
    setBoards(boards.map(b => {
      const d = moveMap.get(b.id.toString());
      if (d) {
        return {
          ...b,
          position: [b.position[0] + d[0], b.position[1] + d[1], b.position[2] + d[2]]
        };
      }
      return b;
    }));
  },
  // ─── Set the gap (or overlap, if negative) between two boards along one   ───
  // axis by moving ONLY `movingBoardId`, keeping `referenceBoardId` fixed.
  // Mirrors updateVector's propagateMove-based delta application, but the
  // delta is derived from a target *distance between boards* rather than an
  // absolute coordinate.
  setBoardGapOnAxis: (movingBoardId, referenceBoardId, axis, desiredGap) => {
    const {
      boards,
      constraints,
      pushHistory,
      setBoards
    } = get();
    const movingIdStr = movingBoardId.toString();
    const moving = boards.find(b => b.id.toString() === movingIdStr);
    const reference = boards.find(b => b.id.toString() === referenceBoardId.toString());
    if (!moving || !reference) return;

    const movingHalf = moving.size[axis] / 2;
    const refHalf = reference.size[axis] / 2;
    const refMin = reference.position[axis] - refHalf;
    const refMax = reference.position[axis] + refHalf;

    // Keep the board on whichever side of the reference it's currently on.
    const movingIsBelow = moving.position[axis] <= reference.position[axis];
    const newCenter = movingIsBelow
      ? (refMin - desiredGap - movingHalf)
      : (refMax + desiredGap + movingHalf);

    const delta = newCenter - moving.position[axis];
    if (Math.abs(delta) < 1e-9) return;
    pushHistory();

    const deltaVec = [0, 0, 0];
    deltaVec[axis] = delta;
    const moveMap = propagateMove([movingIdStr], deltaVec, constraints);
    setBoards(boards.map(b => {
      const d = moveMap.get(b.id.toString());
      if (d) {
        return {
          ...b,
          position: [b.position[0] + d[0], b.position[1] + d[1], b.position[2] + d[2]]
        };
      }
      return b;
    }));
  },
  // ─── Set the gap between a dragged board/group and a specific neighbor ────
  // board along one axis, keeping the neighbor fixed — the click-to-edit
  // counterpart to LiveDistanceOverlay's gap readouts (findNearestNeighbors
  // in sceneGraph.js). Unlike setBoardGapOnAxis, `movingIds` may be a whole
  // group/assembly (moved as a rigid unit via their combined bounds), and
  // `direction` (1 or -1, from findNearestNeighbors) says which side of the
  // neighbor the moving side is currently facing, so the sign of the gap is
  // unambiguous even when the moving side's bounds already sit exactly at
  // the neighbor's face (gap 0).
  setGapToNeighbor: (movingIds, axis, direction, neighborId, desiredGap) => {
    const {
      boards,
      constraints,
      pushHistory,
      setBoards
    } = get();
    const movingIdList = (Array.isArray(movingIds) ? movingIds : [movingIds]).map(id => id.toString());
    const movingBoards = boards.filter(b => movingIdList.includes(b.id.toString()));
    const neighbor = boards.find(b => b.id.toString() === neighborId.toString());
    if (movingBoards.length === 0 || !neighbor) return;

    const movingBounds = worldBoundsOfSelection(movingBoards);
    const neighborBounds = worldBoundsOfSelection(neighbor);
    if (!movingBounds || !neighborBounds) return;

    const gap = Math.max(0, desiredGap);
    const delta = direction === 1
      ? (neighborBounds.min[axis] - gap) - movingBounds.max[axis]
      : (neighborBounds.max[axis] + gap) - movingBounds.min[axis];
    if (Math.abs(delta) < 1e-9) return;
    pushHistory();

    const deltaVec = [0, 0, 0];
    deltaVec[axis] = delta;
    const moveMap = propagateMove(movingIdList, deltaVec, constraints);
    setBoards(boards.map(b => {
      const d = moveMap.get(b.id.toString());
      if (d) {
        return {
          ...b,
          position: [b.position[0] + d[0], b.position[1] + d[1], b.position[2] + d[2]]
        };
      }
      return b;
    }));
  },
  handleDragStart: (e, id, type) => {
    const {
      selectedItemIds
    } = get();
    // If the dragged item is part of the current selection, move all selected items.
    // Otherwise, just move the single dragged item.
    const idsToMove = selectedItemIds.includes(id.toString()) ? selectedItemIds : [id.toString()];
    e.dataTransfer.setData('drag_ids', JSON.stringify(idsToMove));
    e.dataTransfer.setData('drag_id', id); // keep for backwards compat
    e.dataTransfer.setData('drag_type', type);
    e.stopPropagation();
  },
  handleDrop: (e, newParentId) => {
    const {
      pushHistory,
      setBoards,
      setGroups,
      groups,
      boards,
      addRecordedStep
    } = get();
    e.preventDefault();
    e.stopPropagation();

    // Try multi-select payload first, fall back to single
    let ids;
    try {
      ids = JSON.parse(e.dataTransfer.getData('drag_ids') || '[]');
    } catch {
      ids = [];
    }
    if (!ids.length) ids = [e.dataTransfer.getData('drag_id')].filter(Boolean);

    // Remove the target itself to prevent circular reparenting
    ids = ids.filter(id => id !== newParentId);
    if (!ids.length) return;
    pushHistory();
    const boardIds = new Set(ids.filter(id => boards.some(b => b.id.toString() === id)));
    const groupIds = ids.filter(id => groups[id] !== undefined);

    if (addRecordedStep) {
      const draggedNames = ids.map(id => {
        const b = boards.find(x => x.id.toString() === id);
        return b ? b.name : (groups[id] ? groups[id].name || id : id);
      });
      const namesList = draggedNames.map(name => `\`${name}\``).join(', ');
      const parentName = newParentId === 'Workspace' ? 'Workspace' : (groups[newParentId] ? groups[newParentId].name || newParentId : newParentId);
      const destLabel = newParentId === 'Workspace' ? 'Workspace root' : `\`${parentName}\` assembly`;
      addRecordedStep(`In the **Outliner** panel, drag the component(s): ${namesList} and drop under the ${destLabel} to group them.`);
    }

    setBoards(prev => prev.map(b => boardIds.has(b.id.toString()) ? {
      ...b,
      parentId: newParentId
    } : b));
    setGroups(prev => {
      let next = {
        ...prev
      };
      groupIds.forEach(id => {
        if (next[id]) next[id] = {
          ...next[id],
          parentId: newParentId
        };
      });
      return next;
    });
  },
  // ─── Drop to floor: set the board so its bottom face sits at Y=0 ─────────
  dropBoardToFloor: () => {
    const {
      selectedItemIds,
      boards,
      pushHistory,
      setBoards,
      addRecordedStep
    } = get();
    const selectedBoard = selectedItemIds.length === 1 && boards.find(b => b.id.toString() === selectedItemIds[0]);
    if (!selectedBoard) return;
    pushHistory();

    // Use orientation-aware AABB to find the true bottom Y
    const aabb = computeWorldAABB([selectedBoard]);
    const bottomY = aabb.minY;
    const delta = -bottomY; // shift so bottom sits at Y=0

    if (addRecordedStep) {
      addRecordedStep(`Look at the Inspector Panel for \`${selectedBoard.name}\` and click on the button that says, "Set on Floor", and it will move the board to the working surface 'floor'.`);
    }

    setBoards(boards.map(b => {
      if (selectedItemIds.includes(b.id.toString())) {
        return {
          ...b,
          position: [b.position[0], b.position[1] + delta, b.position[2]]
        };
      }
      return b;
    }));
  },
  dropGroupToFloor: () => {
    const {
      selectedItemIds,
      groups,
      pushHistory,
      boards,
      setBoards
    } = get();
    const selectedGroup = selectedItemIds.length === 1 && Object.keys(groups).find(k => k === selectedItemIds[0]);
    if (!selectedGroup) return;
    pushHistory();

    // Find the lowest Y extent of all child boards (orientation-aware)
    const childBoards = collectChildBoards(selectedGroup, boards, groups);
    if (childBoards.length === 0) return;
    const aabb = computeWorldAABB(childBoards);
    const lowestY = aabb.minY;
    if (lowestY === Infinity) return;
    // Shift all child boards so the lowest is sitting on Y=0
    const delta = -lowestY;
    const childIds = new Set(childBoards.map(b => b.id.toString()));
    setBoards(boards.map(b => {
      if (childIds.has(b.id.toString())) {
        return {
          ...b,
          position: [b.position[0], b.position[1] + delta, b.position[2]]
        };
      }
      return b;
    }));
  },
  // Drop the entire current multi-selection to the floor (works for any mix of boards and groups)
  dropSelectionToFloor: () => {
    const {
      selectedItemIds,
      boards,
      groups,
      pushHistory,
      setBoards,
      addRecordedStep
    } = get();
    if (selectedItemIds.length === 0) return;

    // Collect all boards in the selection (direct boards + children of selected groups)
    const boardSet = new Set();
    selectedItemIds.forEach(id => {
      const board = boards.find(b => b.id.toString() === id);
      if (board) {
        boardSet.add(board);
      } else if (groups[id]) {
        collectChildBoards(id, boards, groups).forEach(b => boardSet.add(b));
      }
    });
    const selBoards = Array.from(boardSet);
    if (selBoards.length === 0) return;

    // Find the lowest Y extent across all selected boards (orientation-aware)
    const aabb = computeWorldAABB(selBoards);
    const lowestY = aabb.minY;
    if (lowestY === Infinity) return;
    const delta = -lowestY; // shift so lowest point lands on Y=0
    if (delta === 0) return;
    pushHistory();

    if (addRecordedStep) {
      addRecordedStep(`In the Multi-Select Inspector Panel, click **Set on Floor** to move the selected boards to the floor.`);
    }

    const selIds = new Set(selBoards.map(b => b.id.toString()));
    setBoards(boards.map(b => selIds.has(b.id.toString()) ? {
      ...b,
      position: [b.position[0], b.position[1] + delta, b.position[2]]
    } : b));
  },
  manualAddBoard: () => {
    const {
      selectedItemIds,
      boards,
      groups,
      setNewBoardDialog
    } = get();
    const selectedBoard = selectedItemIds.length === 1 && boards.find(b => b.id.toString() === selectedItemIds[0]);
    const selectedGroup = selectedItemIds.length === 1 && Object.keys(groups).find(k => k === selectedItemIds[0]);
    const targetParent = selectedGroup || (selectedBoard ? selectedBoard.parentId : 'Workspace');
    setNewBoardDialog({
      name: 'New Component',
      parentId: targetParent,
      sizeX: 12,
      sizeY: 0.75,
      sizeZ: 12,
      position: [0, 0, 0]
    });
  },
  manualAddCylinder: () => {
    const {
      selectedItemIds,
      boards,
      groups,
      setNewBoardDialog
    } = get();
    const selectedBoard = selectedItemIds.length === 1 && boards.find(b => b.id.toString() === selectedItemIds[0]);
    const selectedGroup = selectedItemIds.length === 1 && Object.keys(groups).find(k => k === selectedItemIds[0]);
    const targetParent = selectedGroup || (selectedBoard ? selectedBoard.parentId : 'Workspace');
    const radius = 0.875; // 1.75" diameter — typical round furniture leg
    const height = 12;
    const diameter = radius * 2;
    setNewBoardDialog({
      name: 'Cylinder',
      parentId: targetParent,
      shape: 'cylinder',
      cylinder: {
        radius,
        axis: 'y'
      },
      sizeX: diameter,
      sizeY: height,
      sizeZ: diameter,
      position: [0, height / 2, 0]
    });
  },
  manualAddTaper: () => {
    const {
      selectedItemIds,
      boards,
      groups,
      setNewBoardDialog
    } = get();
    const selectedBoard = selectedItemIds.length === 1 && boards.find(b => b.id.toString() === selectedItemIds[0]);
    const selectedGroup = selectedItemIds.length === 1 && Object.keys(groups).find(k => k === selectedItemIds[0]);
    const targetParent = selectedGroup || (selectedBoard ? selectedBoard.parentId : 'Workspace');
    const w = 1.75,
      h = 12,
      d = 1.75;
    setNewBoardDialog({
      name: 'Tapered Leg',
      parentId: targetParent,
      shape: 'taper',
      taper: {
        angleLeft: 2,
        angleRight: 2,
        angleFront: 2,
        angleBack: 2
      },
      sizeX: w,
      sizeY: h,
      sizeZ: d,
      position: [0, h / 2, 0]
    });
  },
  manualAddArc: () => {
    const {
      selectedItemIds,
      boards,
      groups,
      setNewBoardDialog
    } = get();
    const selectedBoard = selectedItemIds.length === 1 && boards.find(b => b.id.toString() === selectedItemIds[0]);
    const selectedGroup = selectedItemIds.length === 1 && Object.keys(groups).find(k => k === selectedItemIds[0]);
    const targetParent = selectedGroup || (selectedBoard ? selectedBoard.parentId : 'Workspace');
    const radius = 12; // 12" radius corner piece
    const thickness = 0.75; // 3/4" material
    setNewBoardDialog({
      name: 'Arc / Curve',
      parentId: targetParent,
      shape: 'arc',
      arc: {
        startAngle: 0,
        endAngle: 90,
        innerRadius: 0,
        axis: 'y'
      },
      sizeX: radius,
      sizeY: thickness,
      sizeZ: radius,
      position: [0, thickness / 2, 0]
    });
  },
  manualAddCove: () => {
    const {
      selectedItemIds,
      boards,
      groups,
      setNewBoardDialog
    } = get();
    const selectedBoard = selectedItemIds.length === 1 && boards.find(b => b.id.toString() === selectedItemIds[0]);
    const selectedGroup = selectedItemIds.length === 1 && Object.keys(groups).find(k => k === selectedItemIds[0]);
    const targetParent = selectedGroup || (selectedBoard ? selectedBoard.parentId : 'Workspace');
    const width = 12;
    const height = 4;
    const thickness = 0.75;
    setNewBoardDialog({
      name: 'Cove / Arch',
      parentId: targetParent,
      shape: 'cove',
      cove: {
        edge: 'top',
        depth: 2,
        axis: 'z'
      },
      sizeX: width,
      sizeY: height,
      sizeZ: thickness,
      position: [0, height / 2, 0]
    });
  },
  manualAddHole: () => {
    const {
      selectedItemIds,
      boards,
      groups,
      setNewBoardDialog
    } = get();
    const selectedBoard = selectedItemIds.length === 1 && boards.find(b => b.id.toString() === selectedItemIds[0]);
    const selectedGroup = selectedItemIds.length === 1 && Object.keys(groups).find(k => k === selectedItemIds[0]);
    const targetParent = selectedGroup || (selectedBoard ? selectedBoard.parentId : 'Workspace');
    const sizeX = 12,
      sizeY = 12,
      sizeZ = 0.75;
    setNewBoardDialog({
      name: 'Panel with Hole',
      parentId: targetParent,
      shape: 'hole',
      hole: {
        radius: 2,
        offsetX: 0,
        offsetY: 0,
        axis: 'z'
      },
      sizeX,
      sizeY,
      sizeZ,
      position: [0, sizeY / 2, 0]
    });
  },
  handleComponentDelete: () => {
    const {
      setConfirmDialog,
      selectedItemIds,
      boards,
      pushHistory,
      setBoards,
      setSelectedItemIds
    } = get();
    const selectedBoard = selectedItemIds.length === 1 && boards.find(b => b.id.toString() === selectedItemIds[0]);
    const boardToDelete = selectedBoard;
    setConfirmDialog({
      message: `Are you sure you want to delete component "${boardToDelete.name}"? This action will permanently remove it from the project.`,
      onConfirm: () => {
        pushHistory();
        setBoards(prev => prev.filter(bd => bd.id !== boardToDelete.id));
        setSelectedItemIds(prev => prev.filter(id => id !== boardToDelete.id.toString()));
        setConfirmDialog(null);
      }
    });
  },
  handleMultiDelete: () => {
    const {
      setConfirmDialog,
      selectedItemIds,
      groups,
      boards,
      pushHistory,
      setBoards,
      setGroups,
      setSelectedItemIds,
      setConstraints
    } = get();
    const count = selectedItemIds.length;
    setConfirmDialog({
      message: `Delete ${count} selected item${count !== 1 ? 's' : ''}? This will remove all selected boards and assemblies (including their children) permanently.`,
      onConfirm: () => {
        pushHistory();
        const allGroupIdsToDel = new Set();
        const allBoardIdsToDel = new Set();
        const traverseGroup = gId => {
          allGroupIdsToDel.add(gId);
          Object.keys(groups).forEach(k => {
            if (groups[k].parentId === gId) traverseGroup(k);
          });
          boards.forEach(bd => {
            if (bd.parentId === gId) allBoardIdsToDel.add(bd.id.toString());
          });
        };
        selectedItemIds.forEach(id => {
          if (groups[id]) {
            traverseGroup(id);
          } else {
            allBoardIdsToDel.add(id);
          }
        });
        setBoards(prev => prev.filter(bd => !allBoardIdsToDel.has(bd.id.toString())));
        setGroups(prev => {
          const next = {
            ...prev
          };
          allGroupIdsToDel.forEach(id => delete next[id]);
          return next;
        });
        // Remove constraints that reference any deleted board
        setConstraints(prev => {
          const next = {};
          Object.entries(prev).forEach(([cId, c]) => {
            if (!allBoardIdsToDel.has(c.boardAId) && !allBoardIdsToDel.has(c.boardBId)) {
              next[cId] = c;
            }
          });
          return next;
        });
        setSelectedItemIds([]);
        setConfirmDialog(null);
      }
    });
  },
  // Clones a single board: offsets the copy along its own thin/local axis
  // (default) or a chosen world axis, auto-increments its name ("Leg" ->
  // "Leg 2"), and clears its constraints. This is the Inspector's "Clone
  // Component" button logic, lifted into the store so the Ctrl/Cmd+D
  // keyboard shortcut can reuse the exact same behavior for a single-board
  // selection instead of a separate, cruder duplicate path.
  cloneBoard: (boardId, { cloneMode = 'local', cloneOffset = 0.75, recordStep = true } = {}) => {
    const {
      boards,
      units,
      pushHistory,
      setBoards,
      setSelectedItemIds,
      addRecordedStep
    } = get();
    const selectedBoard = boards.find(b => b.id.toString() === boardId.toString());
    if (!selectedBoard) return null;

    const newPos = [...selectedBoard.position];

    if (cloneMode === 'local') {
      const minSize = Math.min(...selectedBoard.size);
      const thickAxis = selectedBoard.size.indexOf(minSize);

      const dx = thickAxis === 0 ? cloneOffset : 0;
      const dy = thickAxis === 1 ? cloneOffset : 0;
      const dz = thickAxis === 2 ? cloneOffset : 0;

      const [rx, ry, rz] = selectedBoard.orientation || [0, 0, 0];
      let wx = dx, wy = dy, wz = dz;
      if (rx !== 0 || ry !== 0 || rz !== 0) {
        const a = Math.cos(rx), sb = Math.sin(rx);
        const c = Math.cos(ry), d = Math.sin(ry);
        const ce = Math.cos(rz), f = Math.sin(rz);
        const cce = c * ce, ccf = c * f, de = d * ce, df = d * f;
        wx = (cce + df * sb) * dx + (de * sb - ccf) * dy + (a * d) * dz;
        wy = (a * f) * dx + (a * ce) * dy + (-sb) * dz;
        wz = (ccf * sb - de) * dx + (df + cce * sb) * dy + (a * c) * dz;
      }

      newPos[0] += wx;
      newPos[1] += wy;
      newPos[2] += wz;
    } else {
      const axisIndex = cloneMode === 'worldX' ? 0 : cloneMode === 'worldY' ? 1 : 2;
      newPos[axisIndex] += cloneOffset;
    }

    const maxId = Math.max(...boards.map(b => parseInt(b.id) || 0), 0);
    const newId = maxId + 1;

    const newBoard = {
      ...selectedBoard,
      id: newId,
      position: newPos,
      constraints: [],
      name: nextCloneName(boards, selectedBoard.name)
    };

    if (recordStep && addRecordedStep) {
      const formatVal = (val) => {
        if (units === 'metric') {
          return `${(val * 25.4).toFixed(0)} mm`;
        }
        const standardFraction = val === 0.75 ? ' (3/4")' : val === 0.5 ? ' (1/2")' : val === 0.25 ? ' (1/4")' : val === 0.375 ? ' (3/8")' : '';
        return `${parseFloat(val.toFixed(4))}"${standardFraction}`;
      };

      const offsetStr = formatVal(cloneOffset);
      let modeBtn = 'Local (Auto)';
      if (cloneMode === 'worldX') modeBtn = 'World X';
      else if (cloneMode === 'worldY') modeBtn = 'World Y';
      else if (cloneMode === 'worldZ') modeBtn = 'World Z';

      const btnName = cloneMode === 'local' ? 'Clone (Thin Axis)' : `Clone along ${cloneMode.replace('world', '')}`;

      const stepText = `In the Inspector Panel for \`${selectedBoard.name}\`, under **Clone Component**:\n` +
        `*   Click the **${modeBtn}** button.\n` +
        `*   Set the **Offset** to \`${offsetStr}\`.\n` +
        `Click **${btnName}** to create a clone named \`${newBoard.name}\`.`;

      addRecordedStep(stepText);
    }

    pushHistory();
    setBoards([...boards, newBoard]);
    setSelectedItemIds([newId.toString()]);
    return newBoard;
  },
  // Clones the currently selected boards (and, for a selected assembly, all
  // of its descendant boards) with fresh ids, offsetting the copies slightly
  // so they're visibly distinct from the originals. Used by the Ctrl/Cmd+D
  // keyboard shortcut. A single selected board delegates to `cloneBoard` so
  // the shortcut behaves identically to the Inspector's "Clone Component"
  // button; this generic diagonal-offset path only runs for multi-select or
  // an assembly, where the single-board axis-aware offset doesn't apply.
  duplicateSelected: () => {
    const {
      selectedItemIds,
      boards,
      groups,
      cloneBoard,
      pushHistory,
      setBoards,
      setSelectedItemIds
    } = get();
    if (selectedItemIds.length === 0) return;

    if (selectedItemIds.length === 1 && !groups[selectedItemIds[0]]) {
      cloneBoard(selectedItemIds[0], { recordStep: false });
      return;
    }

    const boardIdsToDuplicate = new Set();
    const collectGroupBoards = (groupId) => {
      boards.forEach(b => {
        if (b.parentId === groupId) boardIdsToDuplicate.add(b.id.toString());
      });
      Object.keys(groups).forEach(k => {
        if (groups[k].parentId === groupId) collectGroupBoards(k);
      });
    };
    selectedItemIds.forEach(id => {
      if (groups[id]) {
        collectGroupBoards(id);
      } else {
        boardIdsToDuplicate.add(id);
      }
    });
    if (boardIdsToDuplicate.size === 0) return;

    pushHistory();
    const OFFSET = 2; // inches — nudges the copy so it doesn't sit exactly on the original
    let idSeed = Date.now();
    const newIds = [];
    let namingPool = boards; // grows as names are assigned, so a batch never collides with itself
    const newBoards = boards
      .filter(b => boardIdsToDuplicate.has(b.id.toString()))
      .map(b => {
        const newId = idSeed++;
        newIds.push(newId.toString());
        const newBoard = {
          ...b,
          id: newId,
          name: nextCloneName(namingPool, b.name),
          position: [b.position[0] + OFFSET, b.position[1], b.position[2] + OFFSET],
          // Per-board constraints are cleared on every other clone path in the
          // codebase (handleClone, prepareBoardForMiterSaw) since they'd
          // otherwise point at relationships that only made sense for the
          // original board.
          constraints: []
        };
        namingPool = [...namingPool, newBoard];
        return newBoard;
      });
    setBoards(prev => [...prev, ...newBoards]);
    setSelectedItemIds(newIds);
  },
  // Offsets the currently selected boards' positions by the given world-space
  // delta. Used by arrow-key nudging; `recordHistory` is set to false for
  // auto-repeated key events so holding an arrow key produces a single undo
  // step instead of flooding the (capped) history stack.
  nudgeSelected: (dx, dy, dz, { recordHistory = true } = {}) => {
    const { selectedItemIds, pushHistory, setBoards } = get();
    if (selectedItemIds.length === 0) return;
    if (recordHistory) pushHistory();
    setBoards(prev => prev.map(b => selectedItemIds.includes(b.id.toString()) ? {
      ...b,
      position: [b.position[0] + dx, b.position[1] + dy, b.position[2] + dz]
    } : b));
  },
  handleNewBoardConfirm: () => {
    const {
      pushHistory,
      newBoardDialog,
      setBoards,
      defaultMaterial,
      setSelectedItemIds,
      setNewBoardDialog,
      units,
      addRecordedStep
    } = get();
    pushHistory();
    const newId = Date.now();

    // Carry through base shapes (box, taper, cylinder)
    const boardShape = newBoardDialog.shape;
    const boardTaper = newBoardDialog.taper;
    const boardCylinder = newBoardDialog.cylinder;

    // Translate cutting shapes into operations
    const boardArc = newBoardDialog.arc;
    const boardCove = newBoardDialog.cove;
    const boardHole = newBoardDialog.hole;
    const operations = [];
    if (boardArc) operations.push({
      id: Date.now() + 1,
      type: 'arc',
      ...boardArc
    });
    if (boardCove) operations.push({
      id: Date.now() + 2,
      type: 'cove',
      ...boardCove
    });
    if (boardHole) operations.push({
      id: Date.now() + 3,
      type: 'hole',
      ...boardHole
    });
    let finalShape = boardShape || 'box';
    if (['arc', 'cove', 'hole'].includes(finalShape)) {
      finalShape = 'box';
    }
    const sizes = [newBoardDialog.sizeX, newBoardDialog.sizeY, newBoardDialog.sizeZ];
    const sortedSizes = [...sizes].sort((a, b) => b - a);
    const width = sortedSizes[1] ?? 0;
    const defaultLumberType = width > 12 ? 'plywood' : 'solid';

    if (addRecordedStep) {
      const formatVal = (val) => {
        if (units === 'metric') {
          return `${(val * 25.4).toFixed(0)} mm`;
        }
        const standardFraction = val === 0.75 ? ' (3/4")' : val === 0.5 ? ' (1/2")' : val === 0.25 ? ' (1/4")' : val === 0.375 ? ' (3/8")' : '';
        return `${parseFloat(val.toFixed(4))}"${standardFraction}`;
      };

      const name = newBoardDialog.name || 'New Component';
      const posX = formatVal(newBoardDialog.position[0]);
      const posY = formatVal(newBoardDialog.position[1]);
      const posZ = formatVal(newBoardDialog.position[2]);
      const sizeX = formatVal(newBoardDialog.sizeX);
      const sizeY = formatVal(newBoardDialog.sizeY);
      const sizeZ = formatVal(newBoardDialog.sizeZ);

      const stepText = `Click the **Components** button in the header bar.\n` +
        `Click **Custom Board** and set its properties:\n` +
        `*   **Name:** \`${name}\`\n` +
        `*   **Length/X/Red dimension:** ${sizeX}\n` +
        `*   **Width/Z/Blue dimension:** ${sizeZ}\n` +
        `*   **Thickness/Y/Green dimension:** ${sizeY}\n` +
        `*   **Position:** [X: ${posX}, Y: ${posY}, Z: ${posZ}]\n` +
        `Click **Add Component**.`;

      addRecordedStep(stepText);
    }

    setBoards(prev => [...prev, {
      id: newId,
      name: newBoardDialog.name || 'New Component',
      parentId: newBoardDialog.parentId,
      size: sizes,
      position: newBoardDialog.position,
      material: defaultMaterial,
      joint: 'None',
      shape: finalShape,
      operations,
      lumberType: defaultLumberType,
      grainDirection: 'length',
      ...(boardTaper ? {
        taper: boardTaper
      } : {}),
      ...(boardCylinder ? {
        cylinder: boardCylinder
      } : {})
    }]);
    setSelectedItemIds([newId.toString()]);
    setNewBoardDialog(null);
  },
  prepareBoardForMiterSaw: (boardId) => {
    const {
      boards,
      setBoards,
      setSelectedItemIds,
      pushHistory,
      showToast,
      addRecordedStep,
      setConstraints
    } = get();
    const targetBoard = boards.find(b => b.id.toString() === boardId.toString());
    if (!targetBoard) return;

    pushHistory();

    // 1. Release alignments & constraints for the original board
    setConstraints(prev => {
      const next = {};
      Object.entries(prev).forEach(([cId, c]) => {
        if (c.boardAId !== boardId.toString() && c.boardBId !== boardId.toString()) {
          next[cId] = c;
        }
      });
      return next;
    });

    const aabb = computeWorldAABB(boards);
    const maxX = boards.length > 0 ? aabb.maxX : 0;

    const cloneId = Date.now();

    // Map size indices: longest is Length (X), shortest is Thickness (Y), middle is Width (Z)
    const sizeWithIndices = targetBoard.size.map((val, idx) => ({ val, idx }));
    sizeWithIndices.sort((a, b) => b.val - a.val);
    const mapX = sizeWithIndices[0].idx; // longest (Length)
    const mapZ = sizeWithIndices[1].idx; // middle (Width)
    const mapY = sizeWithIndices[2].idx; // shortest (Thickness)

    const isEven = 
      (mapX === 0 && mapY === 1 && mapZ === 2) ||
      (mapX === 1 && mapY === 2 && mapZ === 0) ||
      (mapX === 2 && mapY === 0 && mapZ === 1);
    const permDet = isEven ? 1 : -1;

    const s_X = 1;
    const s_Y = 1;
    const s_Z = permDet;

    const newSize = [targetBoard.size[mapX], targetBoard.size[mapY], targetBoard.size[mapZ]];

    const oldPivot = targetBoard.pivot || [0, 0, 0];
    const newPivot = oldPivot[0] === 0 && oldPivot[1] === 0 && oldPivot[2] === 0 
      ? undefined 
      : [s_X * oldPivot[mapX], s_Y * oldPivot[mapY], s_Z * oldPivot[mapZ]];

    let newGrain = 'length';
    const oldGrainAxis = targetBoard.grainDirection === 'width' ? 2 : 0;
    if (mapX === oldGrainAxis) {
      newGrain = 'length';
    } else if (mapZ === oldGrainAxis) {
      newGrain = 'width';
    }

    const FRIENDLY_FACES = {
      top: { axis: 1, sign: 1, faceAxes: [0, 2] },
      bottom: { axis: 1, sign: -1, faceAxes: [0, 2] },
      front: { axis: 2, sign: 1, faceAxes: [0, 1] },
      back: { axis: 2, sign: -1, faceAxes: [0, 1] },
      right: { axis: 0, sign: 1, faceAxes: [1, 2] },
      left: { axis: 0, sign: -1, faceAxes: [1, 2] }
    };

    const FRIENDLY_AXIS_SIGN_TO_FACE = {
      '1_1': 'top',
      '1_-1': 'bottom',
      '2_1': 'front',
      '2_-1': 'back',
      '0_1': 'right',
      '0_-1': 'left'
    };

    const getCoveEdgeVector = (axis, edge) => {
      if (axis === 'y') {
        if (edge === 'left') return [ -1, 0, 0 ];
        if (edge === 'right') return [ 1, 0, 0 ];
        if (edge === 'bottom') return [ 0, 0, -1 ];
        if (edge === 'top') return [ 0, 0, 1 ];
      } else if (axis === 'x') {
        if (edge === 'left') return [ 0, 0, -1 ];
        if (edge === 'right') return [ 0, 0, 1 ];
        if (edge === 'bottom') return [ 0, -1, 0 ];
        if (edge === 'top') return [ 0, 1, 0 ];
      } else if (axis === 'z') {
        if (edge === 'left') return [ -1, 0, 0 ];
        if (edge === 'right') return [ 1, 0, 0 ];
        if (edge === 'bottom') return [ 0, -1, 0 ];
        if (edge === 'top') return [ 0, 1, 0 ];
      }
      return [0, 0, 0];
    };

    const getCoveEdgeFromVector = (newAxis, vec) => {
      const nonZeroIdx = vec.findIndex(x => Math.abs(x) > 0.5);
      if (nonZeroIdx === -1) return 'top';
      const sign = vec[nonZeroIdx] > 0 ? 1 : -1;
      if (newAxis === 'y') {
        if (nonZeroIdx === 0) return sign > 0 ? 'right' : 'left';
        if (nonZeroIdx === 2) return sign > 0 ? 'top' : 'bottom';
      } else if (newAxis === 'x') {
        if (nonZeroIdx === 2) return sign > 0 ? 'right' : 'left';
        if (nonZeroIdx === 1) return sign > 0 ? 'top' : 'bottom';
      } else if (newAxis === 'z') {
        if (nonZeroIdx === 0) return sign > 0 ? 'right' : 'left';
        if (nonZeroIdx === 1) return sign > 0 ? 'top' : 'bottom';
      }
      return 'top';
    };

    const liftAngleTo3D = (axis, deg) => {
      const rad = (deg * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      if (axis === 'y') return [c, 0, s];
      if (axis === 'x') return [0, s, c];
      return [c, s, 0];
    };

    const project3DToAngle = (newAxis, vec) => {
      let x, y;
      if (newAxis === 'y') {
        x = vec[0];
        y = vec[2];
      } else if (newAxis === 'x') {
        x = vec[2];
        y = vec[1];
      } else {
        x = vec[0];
        y = vec[1];
      }
      let rad = Math.atan2(y, x);
      if (rad < 0) rad += 2 * Math.PI;
      return (rad * 180) / Math.PI;
    };

    const parseEdgeProfileStr = (edgeStr) => {
      const match = edgeStr.match(/^([xyz])([+-])([xyz])([+-])$/);
      if (!match) return [0, 0, 0];
      const a1 = match[1];
      const s1 = match[2] === '+' ? 1 : -1;
      const a2 = match[3];
      const s2 = match[4] === '+' ? 1 : -1;
      const vec = [0, 0, 0];
      vec[a1 === 'x' ? 0 : (a1 === 'y' ? 1 : 2)] = s1;
      vec[a2 === 'x' ? 0 : (a2 === 'y' ? 1 : 2)] = s2;
      return vec;
    };

    const getEdgeProfileStrFromVector = (vec) => {
      const nonZeroIndices = [];
      vec.forEach((val, idx) => {
        if (Math.abs(val) > 0.5) nonZeroIndices.push(idx);
      });
      if (nonZeroIndices.length < 2) return 'y+z+';
      const idx1 = nonZeroIndices[0];
      const idx2 = nonZeroIndices[1];
      const a1 = ['x', 'y', 'z'][idx1];
      const s1 = vec[idx1] > 0 ? '+' : '-';
      const a2 = ['x', 'y', 'z'][idx2];
      const s2 = vec[idx2] > 0 ? '+' : '-';
      return `${a1}${s1}${a2}${s2}`;
    };

    const newOperations = (targetBoard.operations || []).map(op => {
      const newOp = { ...op };

      const transformFaceStr = (faceStr) => {
        if (!faceStr) return faceStr;
        const match = faceStr.match(/^([xyz])([+-])$/);
        if (!match) return faceStr;
        const oldAxis = match[1] === 'x' ? 0 : match[1] === 'y' ? 1 : 2;
        const oldSign = match[2] === '+' ? 1 : -1;
        let newAxis = 0;
        let signVal = s_X;
        if (mapX === oldAxis) {
          newAxis = 0;
          signVal = s_X;
        } else if (mapY === oldAxis) {
          newAxis = 1;
          signVal = s_Y;
        } else if (mapZ === oldAxis) {
          newAxis = 2;
          signVal = s_Z;
        }
        const newSign = oldSign * signVal;
        const axisChar = ['x', 'y', 'z'][newAxis];
        const signChar = newSign > 0 ? '+' : '-';
        return `${axisChar}${signChar}`;
      };

      const transformFriendlyFaceStr = (faceStr) => {
        if (!faceStr) return faceStr;
        const faceInfo = FRIENDLY_FACES[faceStr];
        if (!faceInfo) return faceStr;
        const oldAxis = faceInfo.axis;
        const oldSign = faceInfo.sign;
        let newAxis = 0;
        let signVal = s_X;
        if (mapX === oldAxis) {
          newAxis = 0;
          signVal = s_X;
        } else if (mapY === oldAxis) {
          newAxis = 1;
          signVal = s_Y;
        } else if (mapZ === oldAxis) {
          newAxis = 2;
          signVal = s_Z;
        }
        const newSign = oldSign * signVal;
        return FRIENDLY_AXIS_SIGN_TO_FACE[`${newAxis}_${newSign}`] || faceStr;
      };

      const transformAxisChar = (axisChar) => {
        if (!axisChar) return axisChar;
        const oldAxis = axisChar === 'x' ? 0 : axisChar === 'y' ? 1 : 2;
        let newAxis = 0;
        if (mapX === oldAxis) newAxis = 0;
        else if (mapY === oldAxis) newAxis = 1;
        else if (mapZ === oldAxis) newAxis = 2;
        return ['x', 'y', 'z'][newAxis];
      };

      const transformOffset = (oldAxis, oldOffset) => {
        if (oldOffset === undefined || oldOffset === null) return oldOffset;
        let signVal = s_X;
        if (mapX === oldAxis) {
          signVal = s_X;
        } else if (mapY === oldAxis) {
          signVal = s_Y;
        } else if (mapZ === oldAxis) {
          signVal = s_Z;
        }
        return signVal * oldOffset;
      };

      if (op.type === 'miter') {
        newOp.face = transformFaceStr(op.face);
        newOp.fenceEdge = transformFaceStr(op.fenceEdge);
      } else if (op.type === 'dado') {
        newOp.face = transformFriendlyFaceStr(op.face);
        newOp.direction = transformAxisChar(op.direction);
        const face = FRIENDLY_FACES[op.face || 'top'];
        if (face) {
          const { faceAxes } = face;
          const dirAxis = op.direction === ['x', 'y', 'z'][faceAxes[1]] ? faceAxes[1] : faceAxes[0];
          const widthAxis = dirAxis === faceAxes[0] ? faceAxes[1] : faceAxes[0];
          newOp.offset = transformOffset(widthAxis, op.offset);
          newOp.lengthOffset = transformOffset(dirAxis, op.lengthOffset);
        }
      } else if (op.type === 'hole') {
        if (op.depth !== undefined && op.face !== undefined) {
          newOp.face = transformFriendlyFaceStr(op.face);
          const face = FRIENDLY_FACES[op.face || 'top'];
          if (face) {
            const { faceAxes } = face;
            const fa0 = faceAxes[0];
            const fa1 = faceAxes[1];
            const spanFaceAxis = targetBoard.size[fa0] >= targetBoard.size[fa1] ? fa0 : fa1;
            const thicknessFaceAxis = spanFaceAxis === fa0 ? fa1 : fa0;
            newOp.offset = transformOffset(spanFaceAxis, op.offset);
            newOp.offsetY = transformOffset(thicknessFaceAxis, op.offsetY);
          }
        } else {
          let oldAxisX, oldAxisY;
          if (op.axis === 'x') {
            oldAxisX = 2;
            oldAxisY = 1;
          } else if (op.axis === 'z') {
            oldAxisX = 0;
            oldAxisY = 1;
          } else {
            oldAxisX = 0;
            oldAxisY = 2;
          }
          newOp.offsetX = transformOffset(oldAxisX, op.offsetX);
          newOp.offsetY = transformOffset(oldAxisY, op.offsetY);
          newOp.axis = transformAxisChar(op.axis);
        }
      } else if (op.type === 'cove') {
        const oldAxis = op.axis || 'y';
        const oldEdge = op.edge || 'top';
        const vOld = getCoveEdgeVector(oldAxis, oldEdge);
        const vNew = [transformOffset(0, vOld[0]), transformOffset(1, vOld[1]), transformOffset(2, vOld[2])];
        const newAxis = transformAxisChar(oldAxis);
        newOp.edge = getCoveEdgeFromVector(newAxis, vNew);
        newOp.axis = newAxis;
      } else if (op.type === 'arc') {
        const oldAxis = op.axis || 'y';
        const newAxis = transformAxisChar(oldAxis);
        const vStartOld = liftAngleTo3D(oldAxis, op.startAngle ?? 0);
        const vEndOld = liftAngleTo3D(oldAxis, op.endAngle ?? 90);
        const vStartNew = [transformOffset(0, vStartOld[0]), transformOffset(1, vStartOld[1]), transformOffset(2, vStartOld[2])];
        const vEndNew = [transformOffset(0, vEndOld[0]), transformOffset(1, vEndOld[1]), transformOffset(2, vEndOld[2])];
        let newStart = project3DToAngle(newAxis, vStartNew);
        let newEnd = project3DToAngle(newAxis, vEndNew);
        while (newEnd < newStart) {
          newEnd += 360;
        }
        newOp.startAngle = newStart;
        newOp.endAngle = newEnd;
        newOp.axis = newAxis;
      } else if (op.type === 'edge-profile') {
        const vOld = parseEdgeProfileStr(op.edge);
        const vNew = [transformOffset(0, vOld[0]), transformOffset(1, vOld[1]), transformOffset(2, vOld[2])];
        newOp.edge = getEdgeProfileStrFromVector(vNew);
      } else if (op.type === 'pocket-holes') {
        newOp.face = transformFriendlyFaceStr(op.face);
        newOp.edge = transformFriendlyFaceStr(op.edge);
      } else if (op.type === 'dowel-holes') {
        newOp.face = transformFriendlyFaceStr(op.face);
      } else if (op.type === 'subtract') {
        if (op.relativeMatrix) {
          const matOld = new THREE.Matrix4().fromArray(op.relativeMatrix);
          const rpe = new Array(16).fill(0);
          rpe[15] = 1;
          rpe[mapX] = s_X;
          rpe[4 + mapY] = s_Y;
          rpe[8 + mapZ] = s_Z;
          const matPerm = new THREE.Matrix4().fromArray(rpe);
          const matPermT = matPerm.clone().transpose();
          const matNew = matPermT.multiply(matOld);
          newOp.relativeMatrix = matNew.toArray();
        }
      }
      return newOp;
    });

    const clone = {
      ...targetBoard,
      id: cloneId,
      name: `${targetBoard.name} (Miter/Bevel Angles)`,
      parentId: 'Workspace',
      size: newSize,
      pivot: newPivot,
      orientation: [0, 0, 0],
      position: [
        maxX + 10,
        0,
        0
      ],
      constraints: [],
      disableAutoAlign: true,
      hardware: [],
      grainDirection: newGrain,
      operations: newOperations
    };

    const cloneAabb = computeWorldAABB([clone]);
    clone.position[0] += (maxX + 10) - cloneAabb.minX;
    clone.position[1] = -cloneAabb.minY;

    if (addRecordedStep) {
      addRecordedStep(`Clone board \`${targetBoard.name}\` for miter/bevel angles calculation, keeping its original orientation and positioning it at [X: ${clone.position[0].toFixed(2)}, Y: ${clone.position[1].toFixed(2)}, Z: ${clone.position[2].toFixed(2)}] and releasing its alignments and constraints.`);
    }

    // 2. Pre-calculate the cuts on the clone
    const cuts = calculateBoardCuts(clone);

    const updatedBoards = boards.map(b => {
      if (b.id.toString() === boardId.toString()) {
        return {
          ...b,
          disableAutoAlign: true,
          constraints: []
        };
      }
      return b;
    });

    setBoards([...updatedBoards, clone]);
    setSelectedItemIds([cloneId.toString()]);
    set({
      miterSawCuts: cuts,
      miterSawBoardId: cloneId.toString(),
      miterSawOriginalBoardId: boardId.toString(),
      selectedMiterCutIndex: null
    });

    showToast(`Prepared clone "${clone.name}" and calculated its miter/bevel angles.`);
  },
  closeMiterSawMode: () => {
    const {
      boards,
      setBoards,
      miterSawBoardId,
      miterSawOriginalBoardId,
      setSelectedItemIds,
      pushHistory
    } = get();

    if (!miterSawBoardId) return;

    pushHistory();

    // Remove the clone board
    const nextBoards = boards.filter(b => b.id.toString() !== miterSawBoardId.toString());

    // Restore disableAutoAlign on original board
    const updatedBoards = nextBoards.map(b => {
      if (miterSawOriginalBoardId && b.id.toString() === miterSawOriginalBoardId.toString()) {
        return {
          ...b,
          disableAutoAlign: false
        };
      }
      return b;
    });

    setBoards(updatedBoards);

    if (miterSawOriginalBoardId) {
      setSelectedItemIds([miterSawOriginalBoardId.toString()]);
    } else {
      setSelectedItemIds([]);
    }

    set({
      miterSawCuts: null,
      miterSawBoardId: null,
      miterSawOriginalBoardId: null,
      selectedMiterCutIndex: null
    });
  }
});