import React from 'react';
import * as THREE from 'three';
import { Line, Billboard, Text } from '@react-three/drei';
import useStore from '../store/useStore';
import { findNearestNeighbors, findAlignments, boardFaceRect, ALIGNMENT_EPSILON } from '../utils/sceneGraph';
import { formatUnit } from '../utils/units';

const AXIS_COLOR = ['#ff3c3c', '#3cc85a', '#3c96ff'];
const ALIGN_COLOR = '#22c55e'; // matches the existing "snapped" highlight color used elsewhere

// A translucent + outlined rectangle on one axis-aligned face of a board —
// used to highlight the exact edge/face that just lined up with another board.
// Built directly from boardFaceRect's rotation-aware corners (not the board's
// raw unrotated size), so a vertical/rotated board highlights correctly too.
function FaceHighlight({ board, axis, value }) {
  const corners = boardFaceRect(board, axis, value);
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

/**
 * Live feedback while a single board is being dragged (Transform gizmo, or
 * hold-D smart-snap drag) — no multi-selection required:
 *  - Dashed distance lines + labels to the nearest board in each direction
 *    it's actually facing (findNearestNeighbors).
 *  - Bright highlighted faces/edges on BOTH boards the instant any of their
 *    faces (min/center/max, on any axis) line up — including boards that
 *    aren't touching, e.g. two legs reaching the same height (findAlignments).
 */
export function LiveDistanceOverlay() {
  const liveDragBoardIds = useStore(s => s.liveDragBoardIds);
  const boards = useStore(s => s.boards);
  const units = useStore(s => s.units);
  const imperialFormat = useStore(s => s.imperialFormat || 'fraction');

  // Only show for a single dragged board — this is the no-selection-needed
  // case. Multi/group transforms already have the "Distance Between Boards"
  // inspector card for explicit comparisons.
  if (liveDragBoardIds.length !== 1) return null;

  const dragged = boards.find(b => b.id.toString() === liveDragBoardIds[0]);
  if (!dragged) return null;

  const neighbors = findNearestNeighbors(dragged, boards).filter(n => n.gap > ALIGNMENT_EPSILON);
  const alignments = findAlignments(dragged, boards);
  if (neighbors.length === 0 && alignments.length === 0) return null;

  return (
    <group userData={{ printProtected: true }}>
      {neighbors.map(({ axis, direction, gap, neighbor, start, end }) => {
        const color = AXIS_COLOR[axis];
        const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2];
        return (
          <group key={`gap_${axis}_${direction}_${neighbor.id}`}>
            <Line points={[start, end]} color={color} lineWidth={2} dashed dashSize={0.25} gapSize={0.15} depthTest={false} renderOrder={6} />
            <mesh position={start} renderOrder={7} raycast={() => null}>
              <sphereGeometry args={[0.12, 8, 8]} />
              <meshBasicMaterial color={color} depthTest={false} />
            </mesh>
            <mesh position={end} renderOrder={7} raycast={() => null}>
              <sphereGeometry args={[0.12, 8, 8]} />
              <meshBasicMaterial color={color} depthTest={false} />
            </mesh>
            <Billboard position={mid}>
              <Text fontSize={1} color={color} anchorX="center" anchorY="bottom" renderOrder={8} material-depthTest={false} outlineWidth={0.04} outlineColor="#000000">
                {formatUnit(gap, units, imperialFormat)}
              </Text>
            </Billboard>
          </group>
        );
      })}

      {alignments.map(({ axis, value, neighbor }) => (
        <group key={`align_${axis}_${neighbor.id}`}>
          <FaceHighlight board={dragged} axis={axis} value={value} />
          <FaceHighlight board={neighbor} axis={axis} value={value} />
        </group>
      ))}
    </group>
  );
}
