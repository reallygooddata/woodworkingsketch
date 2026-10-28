/**
 * Scene Graph Utilities — World-Space Only
 * 
 * All boards exist in a single flat world coordinate system.
 * No parent-chain matrix walking. No rotation composition.
 * Boards may carry a local `orientation` (Euler radians); computeWorldAABB
 * correctly transforms all 8 corners through the orientation matrix.
 * Groups are purely organizational containers.
 */

/**
 * Compute an axis-aligned bounding box (AABB) in world space for a list of boards.
 * For oriented boards, all 8 corners are rotated through the orientation matrix
 * to find the true world-space extents.
 * @param {Array} boardList - The boards to compute the AABB for
 * @returns {{ minX, maxX, minY, maxY, minZ, maxZ }}
 */
export const computeWorldAABB = (boardList) => {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    boardList.forEach(b => {
        if (b.shape === 'plane') return;
        const [px, py, pz] = b.position;
        const hx = b.size[0] / 2, hy = b.size[1] / 2, hz = b.size[2] / 2;
        const [rx, ry, rz] = b.orientation || [0, 0, 0];
        // Pivot offset: the mesh center is shifted by -pivot relative to b.position
        const piv = b.pivot || [0, 0, 0];

        if (rx === 0 && ry === 0 && rz === 0) {
            // Fast path — axis-aligned (pivot just shifts the center)
            const cx = px - piv[0], cy = py - piv[1], cz = pz - piv[2];
            if (cx - hx < minX) minX = cx - hx;
            if (cx + hx > maxX) maxX = cx + hx;
            if (cy - hy < minY) minY = cy - hy;
            if (cy + hy > maxY) maxY = cy + hy;
            if (cz - hz < minZ) minZ = cz - hz;
            if (cz + hz > maxZ) maxZ = cz + hz;
        } else {
            // Oriented — rotate all 8 corners and expand the AABB
            // Three.js YXZ Euler order: a=cos(x),b=sin(x),c=cos(y),d=sin(y),e=cos(z),f=sin(z)
            const a = Math.cos(rx), b = Math.sin(rx);
            const c = Math.cos(ry), d = Math.sin(ry);
            const e = Math.cos(rz), f = Math.sin(rz);
            const ce = c*e, cf = c*f, de = d*e, df = d*f;
            // Row-major rotation matrix (from Three.js makeRotationFromEuler YXZ)
            const R00 = ce+df*b,  R01 = de*b-cf,  R02 = a*d;
            const R10 = a*f,      R11 = a*e,      R12 = -b;
            const R20 = cf*b-de,  R21 = df+ce*b,  R22 = a*c;

            for (let ix = -1; ix <= 1; ix += 2) {
                for (let iy = -1; iy <= 1; iy += 2) {
                    for (let iz = -1; iz <= 1; iz += 2) {
                        // Local corner relative to board center, then offset by -pivot
                        const lx = hx * ix - piv[0], ly = hy * iy - piv[1], lz = hz * iz - piv[2];
                        const wx = px + R00*lx + R01*ly + R02*lz;
                        const wy = py + R10*lx + R11*ly + R12*lz;
                        const wz = pz + R20*lx + R21*ly + R22*lz;
                        if (wx < minX) minX = wx;
                        if (wx > maxX) maxX = wx;
                        if (wy < minY) minY = wy;
                        if (wy > maxY) maxY = wy;
                        if (wz < minZ) minZ = wz;
                        if (wz > maxZ) maxZ = wz;
                    }
                }
            }
        }
    });

    return { minX, maxX, minY, maxY, minZ, maxZ };
};

/**
 * Recursively collect all boards that are children (direct or nested) of a given parent.
 * @param {string} parentId - The parent group ID
 * @param {Array} boards - The boards array
 * @param {Object} groups - The groups object
 * @returns {Array} All descendant boards
 */
export const collectChildBoards = (parentId, boards, groups) => {
    const result = [];
    const traverse = (pId) => {
        boards.filter(b => b.parentId === pId).forEach(b => result.push(b));
        Object.keys(groups).filter(k => groups[k].parentId === pId).forEach(k => traverse(k));
    };
    traverse(parentId);
    return result;
};

/**
 * Compute an AABB for an entire group by collecting all descendant boards.
 * Since groups have no transform, this is just the world AABB of all children.
 * @param {string} groupId - The group ID
 * @param {Array} boards - The boards array
 * @param {Object} groups - The groups object
 * @returns {{ width, height, depth, centerX, centerY, centerZ, minX, maxX, minY, maxY, minZ, maxZ } | null}
 */
export const calculateGroupAABB = (groupId, boards, groups) => {
    const childBoards = collectChildBoards(groupId, boards, groups);
    if (childBoards.length === 0) return null;

    const aabb = computeWorldAABB(childBoards);

    return {
        width: Math.abs(aabb.maxX - aabb.minX),
        height: Math.abs(aabb.maxY - aabb.minY),
        depth: Math.abs(aabb.maxZ - aabb.minZ),
        centerX: (aabb.maxX + aabb.minX) / 2,
        centerY: (aabb.maxY + aabb.minY) / 2,
        centerZ: (aabb.maxZ + aabb.minZ) / 2,
        ...aabb
    };
};

/**
 * Compute a single world-space anchor point [x, y, z] for a list of boards —
 * the center of their combined AABB. Falls back to averaging raw positions
 * when every board is a non-extent shape (e.g. reference planes), since
 * computeWorldAABB skips those and would otherwise yield an infinite box.
 * @param {Array} boardList - The boards to anchor
 * @returns {number[]} [x, y, z]
 */
export const computeSelectionAnchor = (boardList) => {
    const solids = boardList.filter(b => b.shape !== 'plane');
    if (solids.length > 0) {
        const aabb = computeWorldAABB(solids);
        if (Number.isFinite(aabb.minX)) {
            return [
                (aabb.minX + aabb.maxX) / 2,
                (aabb.minY + aabb.maxY) / 2,
                (aabb.minZ + aabb.maxZ) / 2,
            ];
        }
    }
    if (boardList.length === 0) return [0, 0, 0];
    const sum = boardList.reduce(
        (acc, b) => [acc[0] + b.position[0], acc[1] + b.position[1], acc[2] + b.position[2]],
        [0, 0, 0]
    );
    return [sum[0] / boardList.length, sum[1] / boardList.length, sum[2] / boardList.length];
};

import { getRotatedBoardAABB } from './constraintSolver';

/**
 * Rotation-aware world-space bounds of a single board — min/max per axis,
 * accounting for `orientation` (and `pivot`) the same way computeWorldAABB
 * does for a list of boards. Exact for boards rotated by multiples of 90°
 * (e.g. a "vertical" stud rotated onto the Y axis — the common case for
 * woodworking framing); for arbitrary tilts this is the bounding envelope,
 * same precision tradeoff the rest of the app already makes elsewhere.
 * @param {Object} board
 * @returns {{min: number[], max: number[]}}
 */
const worldBoundsOf = (board) => {
    const box = getRotatedBoardAABB(board);
    return {
        min: [box.min.x, box.min.y, box.min.z],
        max: [box.max.x, box.max.y, box.max.z],
    };
};

/**
 * Combined world-space bounds of a list of boards — the group counterpart
 * of worldBoundsOf(), used so a multi-board (group) drag can be treated as
 * one "dragged" extent for neighbor/alignment detection, the same way a
 * single board is. Returns null if the list has no solid (non-plane)
 * boards (nothing to compute a meaningful box from).
 * @param {Array} boardList
 * @returns {{min: number[], max: number[]} | null}
 */
const worldBoundsOfMany = (boardList) => {
    const solids = (boardList || []).filter(b => b && b.shape !== 'plane');
    if (solids.length === 0) return null;
    const aabb = computeWorldAABB(solids);
    if (!Number.isFinite(aabb.minX)) return null;
    return {
        min: [aabb.minX, aabb.minY, aabb.minZ],
        max: [aabb.maxX, aabb.maxY, aabb.maxZ],
    };
};

/**
 * Normalizes the "dragged" argument accepted by findNearestNeighbors /
 * findAlignments — either a single board (back-compat) or an array of
 * boards (group drag) — into a combined bounds box plus the set of ids to
 * exclude from the comparison (the dragged board itself, or every board in
 * the dragged group).
 * @param {Object|Array} dragged
 * @returns {{bounds: {min: number[], max: number[]}, excludeIds: Set} | null}
 */
const resolveDraggedBounds = (dragged) => {
    const list = Array.isArray(dragged) ? dragged : [dragged];
    const solids = list.filter(b => b && b.shape !== 'plane');
    if (solids.length === 0) return null;
    const bounds = solids.length === 1 ? worldBoundsOf(solids[0]) : worldBoundsOfMany(solids);
    if (!bounds) return null;
    return { bounds, excludeIds: new Set(solids.map(b => b.id)) };
};

/**
 * Find, for a board (or a group of boards) being dragged, the nearest board
 * directly facing it in each of the 6 axis-directions (+X/-X/+Y/-Y/+Z/-Z) —
 * i.e. the board whose cross-section overlaps the dragged extent's on the
 * other two axes, with the smallest gap along the axis in question. Used to
 * show live "how far apart" readouts while dragging, without requiring a
 * selection.
 *
 * Rotation-aware for a single dragged board (uses its true rotated
 * world-space extents); for a group, the combined axis-aligned bounding box
 * of the whole selection is used as the dragged extent — the same
 * approximation already used to place/size the group transform gizmo.
 *
 * @param {Object|Array} dragged - The board (or array of boards) currently being moved
 * @param {Array} others - All other boards to check against
 * @returns {Array<{axis: number, direction: 1|-1, gap: number, neighbor: Object, start: number[], end: number[]}>}
 */
export const findNearestNeighbors = (dragged, others) => {
    const resolved = resolveDraggedBounds(dragged);
    if (!resolved) return [];
    const { bounds: { min: dMin, max: dMax }, excludeIds } = resolved;

    // key: `${axis}_${direction}` -> best match so far
    const best = {};

    others.forEach(o => {
        if (!o || o.shape === 'plane' || excludeIds.has(o.id)) return;
        const { min: oMin, max: oMax } = worldBoundsOf(o);

        for (let axis = 0; axis < 3; axis++) {
            const [oa1, oa2] = [0, 1, 2].filter(a => a !== axis);
            const crossOverlaps =
                dMax[oa1] >= oMin[oa1] - 1e-6 && dMin[oa1] <= oMax[oa1] + 1e-6 &&
                dMax[oa2] >= oMin[oa2] - 1e-6 && dMin[oa2] <= oMax[oa2] + 1e-6;
            if (!crossOverlaps) continue;

            let direction = null, gap = null;
            if (oMin[axis] >= dMax[axis] - 1e-6) {
                direction = 1;
                gap = Math.max(0, oMin[axis] - dMax[axis]);
            } else if (oMax[axis] <= dMin[axis] + 1e-6) {
                direction = -1;
                gap = Math.max(0, dMin[axis] - oMax[axis]);
            } else {
                continue; // overlapping on this axis — not a clean facing neighbor
            }

            const key = `${axis}_${direction}`;
            if (!best[key] || gap < best[key].gap) {
                const overlapMin = [Math.max(dMin[oa1], oMin[oa1]), Math.max(dMin[oa2], oMin[oa2])];
                const overlapMax = [Math.min(dMax[oa1], oMax[oa1]), Math.min(dMax[oa2], oMax[oa2])];
                const mid = [(overlapMin[0] + overlapMax[0]) / 2, (overlapMin[1] + overlapMax[1]) / 2];

                const start = [0, 0, 0];
                const end = [0, 0, 0];
                start[oa1] = end[oa1] = mid[0];
                start[oa2] = end[oa2] = mid[1];
                start[axis] = direction === 1 ? dMax[axis] : dMin[axis];
                end[axis] = direction === 1 ? oMin[axis] : oMax[axis];

                best[key] = { axis, direction, gap, neighbor: o, start, end };
            }
        }
    });

    return Object.values(best);
};

// Tolerance (inches) used to decide two face values are "the same" — matches
// the existing flush-detection tolerance used by analyzeTouchConnection.
export const ALIGNMENT_EPSILON = 0.05;

/**
 * The 4 world-space corners of one axis-aligned face of a `{min, max}` box
 * (e.g. its top face, or its +X face), as a closed rectangle loop suitable
 * for a line or filled plane. `value` is the world coordinate of the face
 * along `axis`; the box's extents on the other two axes determine the
 * rectangle. Shared by boardFaceRect (single, rotation-aware board) and
 * group alignment highlights (combined AABB of a multi-board drag).
 * @param {{min: number[], max: number[]}} bounds
 * @param {number} axis - 0=X, 1=Y, 2=Z
 * @param {number} value - world coordinate of the face along `axis`
 * @returns {number[][]} 4 corner points, in winding order
 */
export const rectFromBounds = ({ min, max }, axis, value) => {
    const [oa1, oa2] = [0, 1, 2].filter(a => a !== axis);
    const h1 = (max[oa1] - min[oa1]) / 2;
    const h2 = (max[oa2] - min[oa2]) / 2;
    const c1 = (max[oa1] + min[oa1]) / 2;
    const c2 = (max[oa2] + min[oa2]) / 2;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s1, s2]) => {
        const p = [0, 0, 0];
        p[axis] = value;
        p[oa1] = c1 + s1 * h1;
        p[oa2] = c2 + s2 * h2;
        return p;
    });
};

/**
 * The 4 world-space corners of one axis-aligned face of a board (e.g. its
 * top face, or its +X face), as a closed rectangle loop suitable for a line
 * or filled plane. `value` is the world coordinate of the face along `axis`;
 * the board's true (rotation-aware) extents on the other two axes determine
 * the rectangle, so a rotated/vertical board highlights correctly too.
 * @param {Object} board
 * @param {number} axis - 0=X, 1=Y, 2=Z
 * @param {number} value - world coordinate of the face along `axis`
 * @returns {number[][]} 4 corner points, in winding order
 */
export const boardFaceRect = (board, axis, value) => rectFromBounds(worldBoundsOf(board), axis, value);

/**
 * Combined world-space bounds of a group of boards, suitable for passing to
 * rectFromBounds() to highlight the "dragged" side of an alignment when a
 * multi-board selection (not a single board) is being moved. Exported for
 * LiveDistanceOverlay.
 * @param {Array} boardList
 * @returns {{min: number[], max: number[]} | null}
 */
export const groupWorldBounds = (boardList) => worldBoundsOfMany(boardList);

/**
 * Public, board-or-group-agnostic bounds lookup — the same normalization
 * findNearestNeighbors/findAlignments use internally (rotation-aware single
 * board, combined AABB for a list), exposed for callers that need to turn a
 * target gap into a concrete position delta (e.g. click-to-edit on a live
 * distance label).
 * @param {Object|Array} boardOrBoards
 * @returns {{min: number[], max: number[]} | null}
 */
export const worldBoundsOfSelection = (boardOrBoards) => {
    const resolved = resolveDraggedBounds(boardOrBoards);
    return resolved ? resolved.bounds : null;
};

/**
 * Find every (axis, face-of-dragged, face-of-other) pair whose world
 * coordinate matches within ALIGNMENT_EPSILON — i.e. a min/center/max face
 * of the dragged board lines up with a min/center/max face of another board,
 * whether or not the two boards are actually touching or facing each other.
 * This is the "smart guide" check (like Figma/PowerPoint alignment guides)
 * used to highlight edges the moment two boards line up while dragging.
 * Rotation-aware for a single dragged board; for a group, the combined
 * axis-aligned bounding box of the whole selection is used (same tradeoff
 * as findNearestNeighbors).
 *
 * @param {Object|Array} dragged - A board, or an array of boards (group drag)
 * @param {Array} others
 * @param {number} epsilon
 * @returns {Array<{axis: number, value: number, neighbor: Object}>}
 */
export const findAlignments = (dragged, others, epsilon = ALIGNMENT_EPSILON) => {
    const resolved = resolveDraggedBounds(dragged);
    if (!resolved) return [];
    const { bounds: dBounds, excludeIds } = resolved;

    const facesOf = (board, axis) => {
        const { min, max } = worldBoundsOf(board);
        return [min[axis], (min[axis] + max[axis]) / 2, max[axis]];
    };
    const facesOfBounds = ({ min, max }, axis) => [min[axis], (min[axis] + max[axis]) / 2, max[axis]];

    const results = [];
    const seen = new Set();
    for (let axis = 0; axis < 3; axis++) {
        const dFaces = facesOfBounds(dBounds, axis);
        others.forEach(o => {
            if (!o || o.shape === 'plane' || excludeIds.has(o.id)) return;
            const oFaces = facesOf(o, axis);
            dFaces.forEach(dVal => {
                oFaces.forEach(oVal => {
                    if (Math.abs(dVal - oVal) <= epsilon) {
                        const key = `${axis}_${o.id}`;
                        if (seen.has(key)) return; // one highlight per axis/neighbor is enough
                        seen.add(key);
                        results.push({ axis, value: (dVal + oVal) / 2, neighbor: o });
                    }
                });
            });
        });
    }
    return results;
};

// Magnetic pull radius (inches) for snap-to-alignment while dragging the
// Transform gizmo — intentionally larger than ALIGNMENT_EPSILON so the drag
// actually "catches" instead of requiring pixel-perfect precision.
export const ALIGNMENT_SNAP_RADIUS = 0.6;

/**
 * Given a board (for its size/orientation/pivot) and a candidate (not-yet-
 * committed) world position, find the nearest aligned position within
 * ALIGNMENT_SNAP_RADIUS on each axis independently — i.e. magnetic snap-to-
 * alignment, the drag-time counterpart to findAlignments(). Each axis may
 * snap to a different neighboring board, or not snap at all if nothing is
 * within range. Rotation-aware, so a vertical board snaps by its true edges.
 *
 * @param {Object} board - the board being moved (used for its size/orientation/pivot)
 * @param {number[]} candidatePosition - [x, y, z] position to snap from
 * @param {Array} others - boards to snap against (should exclude the board
 *   being moved and any of its glue-connected companions)
 * @param {number} radius
 * @returns {number[]} the (possibly) snapped [x, y, z] position
 */
export const computeAlignmentSnap = (board, candidatePosition, others, radius = ALIGNMENT_SNAP_RADIUS) => {
    // Bounds of the dragged board's own shape, centered at its CURRENT
    // position, so we can re-derive its half-extents at the candidate
    // position without re-rotating anything (orientation doesn't change
    // during a translate drag).
    const ownBounds = worldBoundsOf(board);
    const halfExtent = [0, 1, 2].map(i => (ownBounds.max[i] - ownBounds.min[i]) / 2);
    const ownCenterOffset = [0, 1, 2].map(i => (ownBounds.max[i] + ownBounds.min[i]) / 2 - board.position[i]);

    const snapped = [...candidatePosition];
    for (let axis = 0; axis < 3; axis++) {
        const myCenter = candidatePosition[axis] + ownCenterOffset[axis];
        const myFaces = [myCenter - halfExtent[axis], myCenter, myCenter + halfExtent[axis]];
        let bestAdjustment = null;
        others.forEach(o => {
            if (!o || o.shape === 'plane') return;
            const { min: oMin, max: oMax } = worldBoundsOf(o);
            const oFaces = [oMin[axis], (oMin[axis] + oMax[axis]) / 2, oMax[axis]];
            myFaces.forEach(myVal => {
                oFaces.forEach(oVal => {
                    const adjustment = oVal - myVal;
                    if (Math.abs(adjustment) <= radius &&
                        (bestAdjustment === null || Math.abs(adjustment) < Math.abs(bestAdjustment))) {
                        bestAdjustment = adjustment;
                    }
                });
            });
        });
        if (bestAdjustment !== null) snapped[axis] = candidatePosition[axis] + bestAdjustment;
    }
    return snapped;
};

