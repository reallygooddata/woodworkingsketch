import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Line, Billboard, Text, Html } from '@react-three/drei';
import useStore from '../store/useStore';
import { findNearestNeighbors, findAlignments, boardFaceRect, rectFromBounds, groupWorldBounds, collectChildBoards, ALIGNMENT_EPSILON } from '../utils/sceneGraph';
import { formatUnit, parseFraction } from '../utils/units';

const AXIS_COLOR = ['#ff3c3c', '#3cc85a', '#3c96ff'];
const ALIGN_COLOR = '#22c55e'; // matches the existing "snapped" highlight color used elsewhere

// Round to ≤4 decimal places, stripping trailing zeros — matches the
// MultiSelectInspector "Distance Between Boards" card's own fmt4.
const fmt4 = (v) => parseFloat(v.toFixed(4));

// A translucent + outlined rectangle on one axis-aligned face of a board —
// used to highlight the exact edge/face that just lined up with another board.
// Built directly from boardFaceRect's rotation-aware corners (not the board's
// raw unrotated size), so a vertical/rotated board highlights correctly too.
function FaceHighlight({ board, axis, value }) {
  return <BoundsFaceHighlight corners={boardFaceRect(board, axis, value)} />;
}

// Same highlight, but for the combined bounding box of a multi-board (group)
// drag rather than a single board's true rotated extents — there's no one
// orientation to speak of for a mixed-orientation selection, so the group's
// AABB face is used instead (matching the box already used to place/size the
// group transform gizmo).
function GroupFaceHighlight({ bounds, axis, value }) {
  return <BoundsFaceHighlight corners={rectFromBounds(bounds, axis, value)} />;
}

function BoundsFaceHighlight({ corners }) {
  const loop = [...corners, corners[0]];
  const positions = new Float32Array([
    ...corners[0], ...corners[1], ...corners[2],
    ...corners[0], ...corners[2], ...corners[3],
  ]);

  return (
    <group>
      <mesh raycast={() => null} renderOrder={5}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={6} array={positions} itemSize={3} />
        </bufferGeometry>
        <meshBasicMaterial color={ALIGN_COLOR} transparent opacity={0.3} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
      <Line points={loop} color={ALIGN_COLOR} lineWidth={3} depthTest={false} renderOrder={6} />
    </group>
  );
}

// The small floating input a gap label turns into when clicked — plain text
// (not NumericInput) since it lives in a drei <Html> overlay rather than a
// panel, but parses the same way (fractions like "1 1/2" allowed) and commits
// on Enter/blur, discarding on Escape. Autofocused + preselected so typing
// immediately replaces the current value.
function GapEditInput({ initialValue, onCommit, onCancel }) {
  const [text, setText] = useState(String(initialValue));
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const parsed = parseFraction(text);
    if (!isNaN(parsed) && parsed >= 0) onCommit(parsed);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={text}
      onChange={e => setText(e.target.value)}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      onBlur={commit}
      style={{
        width: '72px',
        textAlign: 'center',
        fontSize: '13px',
        fontWeight: 600,
        fontFamily: 'inherit',
        background: '#111',
        color: ALIGN_COLOR,
        border: `1px solid ${ALIGN_COLOR}`,
        borderRadius: '4px',
        padding: '3px 4px',
        outline: 'none',
      }}
    />
  );
}

/**
 * Live feedback for the current translate selection — single board,
 * multi-select, or a whole assembly/group — whether actively being dragged
 * (Transform gizmo or hold-D smart-snap drag) or simply selected right
 * afterward, so there's time to click a label before it's "mid-drag":
 *  - Dashed distance lines + clickable labels to the nearest board in each
 *    direction the dragged board/group is actually facing
 *    (findNearestNeighbors). Clicking a label turns it into a text input —
 *    typing an exact value and pressing Enter (or clicking away) moves the
 *    dragged side to hit that exact gap, keeping the neighbor fixed
 *    (setGapToNeighbor).
 *  - Bright highlighted faces/edges on BOTH sides the instant any of their
 *    faces (min/center/max, on any axis) line up — including boards that
 *    aren't touching, e.g. two legs reaching the same height (findAlignments).
 * For a single board, both checks use its true rotation-aware extents; for
 * a group/assembly, the combined bounding box of the whole selection is used.
 */
export function LiveDistanceOverlay() {
  const liveDragBoardIds = useStore(s => s.liveDragBoardIds);
  const selectedItemIds = useStore(s => s.selectedItemIds);
  const gizmoMode = useStore(s => s.gizmoMode);
  const boards = useStore(s => s.boards);
  const groups = useStore(s => s.groups);
  const units = useStore(s => s.units);
  const imperialFormat = useStore(s => s.imperialFormat || 'fraction');
  const setGapToNeighbor = useStore(s => s.setGapToNeighbor);

  // Which gap label (if any) is currently showing an edit input, keyed the
  // same way as its React key (`${axis}_${direction}_${neighborId}`).
  const [editingKey, setEditingKey] = useState(null);
  // Dismiss any open edit box the moment the selection/drag target changes
  // (so a stale input from a previous board doesn't linger) — done during
  // render, mirroring NumericInput's own prop-change reset, rather than in
  // a useEffect, which would cause an extra cascading render for this.
  const [prevSignature, setPrevSignature] = useState(null);

  // While actively dragging, liveDragBoardIds is authoritative; once you let
  // go, fall back to the plain selection so the labels (and the ability to
  // click them) stick around instead of vanishing the instant the mouse is
  // released. Only applies in translate mode — rotating doesn't need gap
  // readouts.
  const activeIds = liveDragBoardIds.length > 0
    ? liveDragBoardIds
    : (gizmoMode === 'translate' ? selectedItemIds : []);
  const activeSignature = activeIds.slice().sort().join('|');

  if (activeSignature !== prevSignature) {
    setPrevSignature(activeSignature);
    if (editingKey !== null) setEditingKey(null);
  }

  if (activeIds.length === 0) return null;

  const boardSet = new Set();
  activeIds.forEach(id => {
    const b = boards.find(bd => bd.id.toString() === id);
    if (b) boardSet.add(b);
    else if (groups[id]) collectChildBoards(id, boards, groups).forEach(cb => boardSet.add(cb));
  });
  const draggedBoards = Array.from(boardSet);
  if (draggedBoards.length === 0) return null;
  const isGroup = draggedBoards.length > 1;
  const draggedIds = draggedBoards.map(b => b.id);

  const neighbors = findNearestNeighbors(draggedBoards, boards).filter(n => n.gap > ALIGNMENT_EPSILON);
  const alignments = findAlignments(draggedBoards, boards);
  if (neighbors.length === 0 && alignments.length === 0) return null;

  const groupBounds = isGroup ? groupWorldBounds(draggedBoards) : null;

  return (
    <group userData={{ printProtected: true }}>
      {neighbors.map(({ axis, direction, gap, neighbor, start, end }) => {
        const color = AXIS_COLOR[axis];
        const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2];
        const key = `${axis}_${direction}_${neighbor.id}`;
        const isEditing = editingKey === key;
        return (
          <group key={`gap_${key}`}>
            <Line points={[start, end]} color={color} lineWidth={2} dashed dashSize={0.25} gapSize={0.15} depthTest={false} renderOrder={6} />
            <mesh position={start} renderOrder={7} raycast={() => null}>
              <sphereGeometry args={[0.12, 8, 8]} />
              <meshBasicMaterial color={color} depthTest={false} />
            </mesh>
            <mesh position={end} renderOrder={7} raycast={() => null}>
              <sphereGeometry args={[0.12, 8, 8]} />
              <meshBasicMaterial color={color} depthTest={false} />
            </mesh>
            {isEditing ? (
              <Html position={mid} center style={{ pointerEvents: 'auto' }} occlude={false}>
                <GapEditInput
                  initialValue={units === 'metric' ? fmt4(gap * 25.4) : fmt4(gap)}
                  onCommit={(val) => {
                    const desiredGap = units === 'metric' ? val / 25.4 : val;
                    setGapToNeighbor(draggedIds, axis, direction, neighbor.id, desiredGap);
                    setEditingKey(null);
                  }}
                  onCancel={() => setEditingKey(null)}
                />
              </Html>
            ) : (
              <Billboard position={mid}>
                <Text
                  fontSize={1}
                  color={color}
                  anchorX="center"
                  anchorY="bottom"
                  renderOrder={8}
                  material-depthTest={false}
                  outlineWidth={0.04}
                  outlineColor="#000000"
                  onClick={(e) => { e.stopPropagation(); setEditingKey(key); }}
                  onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
                  onPointerOut={() => { document.body.style.cursor = 'auto'; }}
                >
                  {formatUnit(gap, units, imperialFormat)}
                </Text>
              </Billboard>
            )}
          </group>
        );
      })}

      {alignments.map(({ axis, value, neighbor }) => (
        <group key={`align_${axis}_${neighbor.id}`}>
          {isGroup
            ? (groupBounds && <GroupFaceHighlight bounds={groupBounds} axis={axis} value={value} />)
            : <FaceHighlight board={draggedBoards[0]} axis={axis} value={value} />}
          <FaceHighlight board={neighbor} axis={axis} value={value} />
        </group>
      ))}
    </group>
  );
}
