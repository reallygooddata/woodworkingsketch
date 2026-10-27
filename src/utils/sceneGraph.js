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
