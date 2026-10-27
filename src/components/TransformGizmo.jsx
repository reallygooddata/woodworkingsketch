import React, { useCallback, useMemo, useRef } from 'react';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import useStore from '../store/useStore';
import { collectChildBoards, computeSelectionAnchor } from '../utils/sceneGraph';
import { propagateMove } from '../utils/constraintSolver';
import { getGridStep } from '../utils/units';

// World-space position is clamped to the same safe bounds used elsewhere
// in the app (see boardSlice.updateVector) so a wild drag can't send a
// board flying off into unusable coordinates.
const POSITION_LIMIT = 5000;
const clampPos = (v) => Math.min(POSITION_LIMIT, Math.max(-POSITION_LIMIT, v));
const ROTATE_SNAP_DEGREES = 5;

/**
 * On-screen move/rotate gizmo for the current selection.
 *
 * Mirrors the math already used by the keyboard/inspector actions:
 *  - translate: same constraint (Glue) propagation as updateVector/moveGroup.
 *  - rotate (single board): same local-axis quaternion approach as incrementRotation.
 *  - rotate (multi/group): same AABB-centroid pivot approach as incrementAssemblyRotation.
 */
export default function TransformGizmo() {
  const selectedItemIds = useStore(s => s.selectedItemIds);
  const gizmoMode = useStore(s => s.gizmoMode);
  const gizmoEnabled = useStore(s => s.gizmoEnabled);
  const gridSnap = useStore(s => s.gridSnap);
  const units = useStore(s => s.units);
  const setIsGizmoDragging = useStore(s => s.setIsGizmoDragging);

  // Suppress the gizmo while another exclusive viewport tool is active so it
  // doesn't steal clicks meant for face-picking (measure, pivot, constraints...).
  const measureActive = useStore(s => !!s.measureMode?.active);
  const pivotPickActive = useStore(s => !!s.pivotMode?.active);
  const dKeyPressed = useStore(s => s.dKeyPressed);
  const constraintTargetActive = useStore(s => !!s.constraintTargetMode?.active);
  const definePlaneActive = useStore(s => s.definePlaneActive);
  const measureFaceAnglesActive = useStore(s => s.measureFaceAnglesActive);
  const measureEdgesActive = useStore(s => s.measureEdgesActive);
  const miterSawBoardId = useStore(s => s.miterSawBoardId);

  const suppressed = measureActive || pivotPickActive || dKeyPressed ||
    constraintTargetActive || definePlaneActive || measureFaceAnglesActive ||
    measureEdgesActive || !!miterSawBoardId;

  const proxyRef = useRef(null);
  // Snapshot of board transforms + pivot, captured once per drag gesture.
  const dragRef = useRef(null);

  const selectionSignature = useMemo(() => selectedItemIds.slice().sort().join('|'), [selectedItemIds]);

  // Recomputed only when the selection or mode actually changes (NOT on every
  // board mutation) — this is what positions/orients the gizmo the moment it
  // appears. Live drag state after that point comes from the proxy object
  // itself, which TransformControls drives directly every frame.
  const placement = useMemo(() => {
    if (!gizmoEnabled || suppressed || selectedItemIds.length === 0) return null;

    const { boards, groups } = useStore.getState();
    const boardSet = new Set();
    selectedItemIds.forEach(id => {
      const b = boards.find(bd => bd.id.toString() === id);
      if (b) boardSet.add(b);
      else if (groups[id]) collectChildBoards(id, boards, groups).forEach(cb => boardSet.add(cb));
    });
    const activeBoards = Array.from(boardSet);
    if (activeBoards.length === 0) return null;

    const isSingleBoardMode = selectedItemIds.length === 1 &&
      boards.some(b => b.id.toString() === selectedItemIds[0]);

    let anchor;
    const quat = new THREE.Quaternion();
    if (isSingleBoardMode) {
      anchor = [...activeBoards[0].position];
      const euler = new THREE.Euler(...(activeBoards[0].orientation || [0, 0, 0]), 'YXZ');
      quat.setFromEuler(euler);
    } else {
      anchor = computeSelectionAnchor(activeBoards);
    }

    return {
      activeBoardIds: activeBoards.map(b => b.id.toString()),
      isSingleBoardMode,
      anchor,
      quat: [quat.x, quat.y, quat.z, quat.w],
    };
  }, [gizmoEnabled, suppressed, selectionSignature, gizmoMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const snapStep = getGridStep(gridSnap, units); // inches; 0 means "off"
  const translationSnap = snapStep > 0 ? snapStep : null;
  const rotationSnap = snapStep > 0 ? THREE.MathUtils.degToRad(ROTATE_SNAP_DEGREES) : null;

  const handleMouseDown = useCallback(() => {
    const proxy = proxyRef.current;
    if (!proxy || !placement) return;
    setIsGizmoDragging(true);
    const state = useStore.getState();
    state.pushHistory();

    const boardsNow = state.boards;
    const snapshots = new Map();
    const snapshotIds = (gizmoMode === 'translate')
      ? Array.from(propagateMove(placement.activeBoardIds, [1, 1, 1], state.constraints).keys())
      : placement.activeBoardIds;

    snapshotIds.forEach(id => {
      const b = boardsNow.find(bd => bd.id.toString() === id);
      if (!b) return;
      const euler = new THREE.Euler(...(b.orientation || [0, 0, 0]), 'YXZ');
      snapshots.set(id, {
        pos: new THREE.Vector3(...b.position),
        quat: new THREE.Quaternion().setFromEuler(euler),
      });
    });

    dragRef.current = {
      anchor: proxy.position.clone(),
      snapshots,
      mode: gizmoMode,
      isSingleBoardMode: placement.isSingleBoardMode,
    };
  }, [placement, gizmoMode, setIsGizmoDragging]);

  const handleObjectChange = useCallback(() => {
    const drag = dragRef.current;
    const proxy = proxyRef.current;
    if (!drag || !proxy) return;
    const state = useStore.getState();

    if (drag.mode === 'translate') {
      const delta = proxy.position.clone().sub(drag.anchor);
      state.setBoards(state.boards.map(b => {
        const snap = drag.snapshots.get(b.id.toString());
        if (!snap) return b;
        return {
          ...b,
          position: [
            clampPos(snap.pos.x + delta.x),
            clampPos(snap.pos.y + delta.y),
            clampPos(snap.pos.z + delta.z),
          ],
        };
      }));
    } else {
      const qCurrent = proxy.quaternion;
      state.setBoards(state.boards.map(b => {
        const snap = drag.snapshots.get(b.id.toString());
        if (!snap) return b;

        if (drag.isSingleBoardMode) {
          const newEuler = new THREE.Euler().setFromQuaternion(qCurrent, 'YXZ');
          return { ...b, orientation: [newEuler.x, newEuler.y, newEuler.z] };
        }

        // Multi/group rotate: swing each board's position around the shared
        // pivot, and compose the same world-space delta into its own
        // orientation — identical math to incrementAssemblyRotation.
        const rel = snap.pos.clone().sub(drag.anchor).applyQuaternion(qCurrent);
        const newPos = drag.anchor.clone().add(rel);
        const newQuat = qCurrent.clone().multiply(snap.quat);
        const newEuler = new THREE.Euler().setFromQuaternion(newQuat, 'YXZ');
        return {
          ...b,
          position: [clampPos(newPos.x), clampPos(newPos.y), clampPos(newPos.z)],
          orientation: [newEuler.x, newEuler.y, newEuler.z],
        };
      }));
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsGizmoDragging(false);
    dragRef.current = null;
  }, [setIsGizmoDragging]);

  if (!placement) return null;

  const space = (gizmoMode === 'rotate' && placement.isSingleBoardMode) ? 'local' : 'world';

  return (
    <group key={`${selectionSignature}_${gizmoMode}`}>
      <group ref={proxyRef} position={placement.anchor} quaternion={placement.quat} />
      <TransformControls
        object={proxyRef}
        mode={gizmoMode}
        space={space}
        size={0.85}
        translationSnap={gizmoMode === 'translate' ? translationSnap : null}
        rotationSnap={gizmoMode === 'rotate' ? rotationSnap : null}
        onMouseDown={handleMouseDown}
        onObjectChange={handleObjectChange}
        onMouseUp={handleMouseUp}
      />
    </group>
  );
}
