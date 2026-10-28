import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { getRotatedBoardAABB } from './constraintSolver';

// Auto-spacing rule for Smart Joint Fasteners: keep each fastener this far
// from the outer edge of the joint face, to avoid splitting the wood. A 2"
// margin is ideal, but narrow dimensional lumber (e.g. a 2x4's 3.5" face)
// can't fit two fasteners with 2" clear on *both* sides — that scenario
// used to silently collapse to a single centered fastener regardless of
// how many were requested. Scale the margin down smoothly for faces at or
// under 4" wide instead; wider faces are unaffected (still get the full
// 2" margin, same as before).
const PREFERRED_FASTENER_MARGIN = 2.0;
const MIN_FASTENER_MARGIN = 0.5;
// Even with a scaled-down margin, don't allow multiple fasteners if the
// usable gap between them would be under 1" — e.g. a 2x2's 1.5" face
// should still get a single centered fastener rather than two crammed
// right next to each other.
const MIN_ACTIVE_LENGTH_FOR_MULTIPLE = 1.0;
function fastenerMarginFor(totalLength) {
  if (totalLength > PREFERRED_FASTENER_MARGIN * 2) return PREFERRED_FASTENER_MARGIN;
  return Math.max(MIN_FASTENER_MARGIN, totalLength / 4);
}

/**
 * Given the width of a joint face, returns the fastener edge margin and
 * whether that face can usefully fit more than one fastener at all (see
 * MIN_ACTIVE_LENGTH_FOR_MULTIPLE above). Shared by the count calculation
 * (MultiSelectInspector) and the actual placement (getPositions below) so
 * the two always agree.
 */
export function fastenerLayoutFor(totalLength) {
  const margin = fastenerMarginFor(totalLength);
  const activeLength = totalLength - 2 * margin;
  return { margin, activeLength, allowsMultiple: activeLength >= MIN_ACTIVE_LENGTH_FOR_MULTIPLE };
}

/**
 * Analyzes the touch connection between two boards.
 * Returns null if they are not touching, or an object describing the connection.
 */
export function analyzeTouchConnection(boardA, boardB) {
  if (!boardA || !boardB) return null;
  if (boardA.shape === 'plane' || boardB.shape === 'plane') return null;

  // 1. Create OBBs to verify physical touch / intersection (slightly expanded)
  const createOBB = (b, expandAmount = 0.02) => {
    const rot = b.orientation || b.rotation || [0, 0, 0];
    const euler = new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ');
    const quaternion = new THREE.Quaternion().setFromEuler(euler);
    const position = new THREE.Vector3(...b.position);

    let matrix = new THREE.Matrix4();
    if (b.pivot) {
      const pivotPos = new THREE.Vector3(...b.pivot);
      const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
      const invPivotMatrix = new THREE.Matrix4().makeTranslation(-pivotPos.x, -pivotPos.y, -pivotPos.z);
      const translationMatrix = new THREE.Matrix4().makeTranslation(position.x, position.y, position.z);
      matrix.multiply(translationMatrix).multiply(rotationMatrix).multiply(invPivotMatrix);
    } else {
      matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));
    }

    const obb = new OBB();
    // Expand the OBB by tolerance to capture perfectly flush boards
    obb.halfSize.set(
      b.size[0] / 2 + expandAmount,
      b.size[1] / 2 + expandAmount,
      b.size[2] / 2 + expandAmount
    );
    obb.applyMatrix4(matrix);
    return obb;
  };

  const obbA = createOBB(boardA);
  const obbB = createOBB(boardB);

  // If expanded OBBs do not intersect, they are not touching
  if (!obbA.intersectsOBB(obbB)) {
    return null;
  }

  // 2. Determine the true world-space touch/overlap using each board's
  // actual rotated AABB (not raw position ± size/2, which is only correct
  // for an unrotated board). A board that's been physically rotated — e.g.
  // a stud tipped up to stand vertically — has `size` values that no
  // longer line up with world X/Y/Z at all, so reading them directly here
  // used to silently fail to detect genuine touching joints.
  const boxA = getRotatedBoardAABB(boardA);
  const boxB = getRotatedBoardAABB(boardB);
  const aMinX = boxA.min.x, aMaxX = boxA.max.x;
  const aMinY = boxA.min.y, aMaxY = boxA.max.y;
  const aMinZ = boxA.min.z, aMaxZ = boxA.max.z;
  const bMinX = boxB.min.x, bMaxX = boxB.max.x;
  const bMinY = boxB.min.y, bMaxY = boxB.max.y;
  const bMinZ = boxB.min.z, bMaxZ = boxB.max.z;

  const TOLERANCE = 0.05; // 1/20 inch tolerance for flush detection

  let touchAxis = null; // 'x', 'y', 'z'
  let contactFaceA = null;
  let contactFaceB = null;

  // Check X touch: Face A touches Face B
  if (Math.abs(aMaxX - bMinX) < TOLERANCE) {
    touchAxis = 'x';
    contactFaceA = 'right';
    contactFaceB = 'left';
  } else if (Math.abs(aMinX - bMaxX) < TOLERANCE) {
    touchAxis = 'x';
    contactFaceA = 'left';
    contactFaceB = 'right';
  }
  // Check Y touch
  else if (Math.abs(aMaxY - bMinY) < TOLERANCE) {
    touchAxis = 'y';
    contactFaceA = 'top';
    contactFaceB = 'bottom';
  } else if (Math.abs(aMinY - bMaxY) < TOLERANCE) {
    touchAxis = 'y';
    contactFaceA = 'bottom';
    contactFaceB = 'top';
  }
  // Check Z touch
  else if (Math.abs(aMaxZ - bMinZ) < TOLERANCE) {
    touchAxis = 'z';
    contactFaceA = 'front';
    contactFaceB = 'back';
  } else if (Math.abs(aMinZ - bMaxZ) < TOLERANCE) {
    touchAxis = 'z';
    contactFaceA = 'back';
    contactFaceB = 'front';
  }

  if (!touchAxis) {
    // If no flush face touch is found directly, they might intersect or be slightly nested (e.g. dado/rabbet)
    // We fall back to standard center proximity
    return null;
  }

  // Calculate overlap range in the other two axes
  const overlapX = [Math.max(aMinX, bMinX), Math.min(aMaxX, bMaxX)];
  const overlapY = [Math.max(aMinY, bMinY), Math.min(aMaxY, bMaxY)];
  const overlapZ = [Math.max(aMinZ, bMinZ), Math.min(aMaxZ, bMaxZ)];

  const spanX = overlapX[1] - overlapX[0];
  const spanY = overlapY[1] - overlapY[0];
  const spanZ = overlapZ[1] - overlapZ[0];

  // Verify that the other two axes actually overlap (positive span)
  if (touchAxis === 'x' && (spanY <= 0 || spanZ <= 0)) return null;
  if (touchAxis === 'y' && (spanX <= 0 || spanZ <= 0)) return null;
  if (touchAxis === 'z' && (spanX <= 0 || spanY <= 0)) return null;

  // 3. Classify relative orientation
  // A connection is parallel ONLY if the boards' long axes point the same
  // (or opposite) way *in world space*. Comparing raw local `size` index
  // identity (the old approach) breaks the moment either board is rotated
  // — e.g. a vertical stud's local "long axis" is index 0 (X, its stored
  // length), but in world space it actually points along Y, so it must be
  // rotated into world space before comparing against the other board.
  const getLongestAxis = (size) => {
    let maxVal = -1;
    let maxIdx = 0;
    for (let i = 0; i < 3; i++) {
      if (size[i] > maxVal) {
        maxVal = size[i];
        maxIdx = i;
      }
    }
    return maxIdx; // 0=X, 1=Y, 2=Z
  };
  const LOCAL_AXIS_VECTORS = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  const worldLongAxisDir = (board) => {
    const [rx, ry, rz] = board.orientation || [0, 0, 0];
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    return LOCAL_AXIS_VECTORS[getLongestAxis(board.size)].clone().applyQuaternion(quaternion);
  };

  const isParallel = Math.abs(worldLongAxisDir(boardA).dot(worldLongAxisDir(boardB))) > 0.99;
  const jointType = isParallel ? 'parallel' : 'right-angle';

  // 4. Compute distribution list of fasteners using the Auto Spacing Rule
  // Determine which axis of the contact plane is longer to distribute fasteners along
  let distAxis = null;
  let range = [];
  if (touchAxis === 'x') {
    distAxis = spanZ > spanY ? 'z' : 'y';
    range = distAxis === 'z' ? overlapZ : overlapY;
  } else if (touchAxis === 'y') {
    distAxis = spanZ > spanX ? 'z' : 'x';
    range = distAxis === 'z' ? overlapZ : overlapX;
  } else {
    distAxis = spanY > spanX ? 'y' : 'x';
    range = distAxis === 'y' ? overlapY : overlapX;
  }

  const getPositions = (count = 2) => {
    const minVal = range[0];
    const maxVal = range[1];
    const totalLength = maxVal - minVal;

    const { margin, activeLength, allowsMultiple } = fastenerLayoutFor(totalLength);

    const coords = [];
    if (!allowsMultiple || count === 1) {
      // Too short for margin, place in center of contact area
      coords.push((minVal + maxVal) / 2);
    } else {
      const step = activeLength / (count - 1);
      for (let k = 0; k < count; k++) {
        coords.push(minVal + margin + k * step);
      }
    }
    return { axis: distAxis, coords, range };
  };

  // Center of contact in the touch axis — must use whichever pair of faces
  // actually matched (contactFaceA tells us the direction), not always
  // "A's max meets B's min": the two boards could just as easily touch the
  // other way around (A's min meeting B's max), and using the wrong pairing
  // here put the touch point — and therefore the fastener/hole position —
  // many inches away from the real joint whenever that happened.
  const touchCenter = contactFaceA === 'right' ? (aMaxX + bMinX) / 2
                     : contactFaceA === 'left' ? (aMinX + bMaxX) / 2
                     : contactFaceA === 'top' ? (aMaxY + bMinY) / 2
                     : contactFaceA === 'bottom' ? (aMinY + bMaxY) / 2
                     : contactFaceA === 'front' ? (aMaxZ + bMinZ) / 2
                     : (aMinZ + bMaxZ) / 2; // 'back'

  // Center of the intersection plane in all 3 dimensions
  const centerPos = [
    touchAxis === 'x' ? touchCenter : (overlapX[0] + overlapX[1]) / 2,
    touchAxis === 'y' ? touchCenter : (overlapY[0] + overlapY[1]) / 2,
    touchAxis === 'z' ? touchCenter : (overlapZ[0] + overlapZ[1]) / 2
  ];

  return {
    touchAxis,
    contactFaceA,
    contactFaceB,
    jointType,
    centerPos,
    overlapSpans: [spanX, spanY, spanZ],
    getPositions
  };
}
