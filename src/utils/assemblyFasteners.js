/**
 * assemblyFasteners.js
 *
 * Pure utility function to apply smart joint fasteners (pocket holes, dowels, loose tenons, screws)
 * between two boards.
 * Performs touch analysis, layout calculations, dynamic offset shifts, and generates all 3D
 * entities and glue constraints, returned to the Zustand store context.
 */

import { analyzeTouchConnection } from './fastenerAnalyzer';
import { FACE_MAP } from './geometryBuilders';

// The actual hole-carving geometry (buildBlindHoleTool in geometryBuilders.js)
// independently decides which of a face's two in-plane axes is the "span"
// (gets `offset`) vs. "thickness" (gets `offsetY`) by comparing that board's
// own `size` on those two axes — NOT by reusing whatever axis this file
// picked as the shared fastener-distribution axis. Those two choices only
// agree by coincidence for "normal"-proportioned boards; they can disagree
// whenever a board's dimensions are stored in an unexpected order — e.g. a
// "Vertical"-oriented board keeps its 24" length in the size[1] slot instead
// of size[0]. When they disagree, the hole gets carved on the wrong local
// axis, leaving the fastener fully embedded in solid, uncut wood. This
// mirrors buildBlindHoleTool's own rule per-board so the two always agree.
function faceOffsetsFor(board, faceName, distAxisIdx, distVal, otherVal) {
  const { faceAxes } = FACE_MAP[faceName];
  const spanAxis = board.size[faceAxes[0]] >= board.size[faceAxes[1]] ? faceAxes[0] : faceAxes[1];
  return spanAxis === distAxisIdx
    ? { offset: distVal, offsetY: otherVal }
    : { offset: otherVal, offsetY: distVal };
}

export const applySmartFastenersHelper = (boardA, boardB, config, boards, groups, constraints) => {
  // 1. Pre-clean any existing smart smart-fasteners or constraints between these two
  let cleanBoards = boards.map(b => {
    if (b.id === boardA.id || b.id === boardB.id) {
      return {
        ...b,
        operations: (b.operations || []).filter(op => op.source !== 'smart-fastener'),
        edgeJoints: (b.edgeJoints || []).filter(ej => ej.partnerId?.toString() !== (b.id === boardA.id ? boardB.id : boardA.id).toString())
      };
    }
    return b;
  });

  // Remove any visual fastener boards belonging to these two boards
  const fastenerGroupPrefix = `fasteners_${boardA.id}_${boardB.id}`;
  const fastenerGroupPrefixRev = `fasteners_${boardB.id}_${boardA.id}`;
  cleanBoards = cleanBoards.filter(b => {
    const pid = b.parentId;
    return pid !== fastenerGroupPrefix && pid !== fastenerGroupPrefixRev;
  });

  // Clean up constraints
  const nextConstraints = { ...constraints };
  Object.keys(nextConstraints).forEach(cid => {
    const c = nextConstraints[cid];
    if (
      c.type === 'Glue' &&
      ((c.boardAId?.toString() === boardA.id.toString() && c.boardBId?.toString() === boardB.id.toString()) ||
       (c.boardAId?.toString() === boardB.id.toString() && c.boardBId?.toString() === boardA.id.toString()))
    ) {
      delete nextConstraints[cid];
    }
  });

  // Clean up groups
  const nextGroups = { ...groups };
  delete nextGroups[fastenerGroupPrefix];
  delete nextGroups[fastenerGroupPrefixRev];

  // 2. Perform touch analysis
  const analysis = analyzeTouchConnection(boardA, boardB);
  if (!analysis) {
    return {
      success: false,
      newBoards: cleanBoards,
      nextGroups,
      nextConstraints
    };
  }

  const { touchAxis, contactFaceA, contactFaceB, centerPos, getPositions } = analysis;
  const { axis: distAxis, coords } = getPositions(config.count || 2);

  // 3. Register a nice Joint Fasteners sub-group in outliner
  const jointGroupId = fastenerGroupPrefix;
  const fastenerLabel = config.type === 'pocket-hole' ? 'Pocket Holes'
                      : config.type === 'dowels' ? 'Dowel Pins'
                      : config.type === 'loose-tenon' ? 'Loose Tenons (Dominoes)'
                      : 'Wood Screws';

  nextGroups[jointGroupId] = {
    parentId: boardA.parentId || 'Workspace',
    isExpanded: false,
    visible: true,
    name: `${fastenerLabel} (${boardA.name} ↔ ${boardB.name})`
  };

  // Make fresh copies of boardA and boardB for modification
  const newBoardA = { ...cleanBoards.find(b => b.id === boardA.id) };
  const newBoardB = { ...cleanBoards.find(b => b.id === boardB.id) };
  newBoardA.operations = [...(newBoardA.operations || [])];
  newBoardB.operations = [...(newBoardB.operations || [])];
  newBoardA.edgeJoints = [...(newBoardA.edgeJoints || [])];
  newBoardB.edgeJoints = [...(newBoardB.edgeJoints || [])];

  const newFastenerBoards = [];
  const baseId = Date.now() + Math.floor(Math.random() * 10000);

  // 4. Generate operations & visual 3D fasteners
  if (config.type === 'pocket-hole') {
    let face = 'back';
    if (boardA.name.includes('Back')) face = 'front';
    else if (boardA.name.includes('Left')) face = 'right';
    else if (boardA.name.includes('Right')) face = 'left';

    newBoardA.operations.push({
      id: `op_ph_bulk_${Date.now()}`,
      type: 'pocket-holes',
      face: face,
      edge: contactFaceA,
      count: config.count || 2,
      spacing: 'auto',
      source: 'smart-fastener'
    });
  }

  coords.forEach((coord, idx) => {
    const fId = baseId + idx;

    // Determine coordinate relative to board centers
    const offsetValA = coord - (distAxis === 'z' ? boardA.position[2] : distAxis === 'y' ? boardA.position[1] : boardA.position[0]);
    const offsetValB = coord - (distAxis === 'z' ? boardB.position[2] : distAxis === 'y' ? boardB.position[1] : boardB.position[0]);

    // Determine the face axes and identify the other non-distribution face axis
    const distAxisIdx = distAxis === 'z' ? 2 : distAxis === 'y' ? 1 : 0;
    const touchAxisIdx = touchAxis === 'x' ? 0 : touchAxis === 'y' ? 1 : 2;
    const otherFaceAxis = [0, 1, 2].find(i => i !== distAxisIdx && i !== touchAxisIdx);

    const localOffsetY_A = centerPos[otherFaceAxis] - boardA.position[otherFaceAxis];
    const localOffsetY_B = centerPos[otherFaceAxis] - boardB.position[otherFaceAxis];

    // Spawning positions for visual 3D fastener cylinders/boxes
    const fastenerPos = [
      distAxis === 'x' ? coord : centerPos[0],
      distAxis === 'y' ? coord : centerPos[1],
      distAxis === 'z' ? coord : centerPos[2]
    ];

    if (config.type === 'pocket-hole') {
      // Spawn a visual 3D plug in a contrasting wood color (e.g. cherry or walnut)
      let plugSize;
      if (touchAxis === 'x') plugSize = [1.25, 0.375, 0.375];
      else if (touchAxis === 'y') plugSize = [0.375, 1.25, 0.375];
      else plugSize = [0.375, 0.375, 1.25];

      newFastenerBoards.push({
        id: fId,
        name: `Pocket Plug ${idx + 1}`,
        parentId: jointGroupId,
        size: plugSize,
        position: fastenerPos,
        material: 'cherry', // Contrasting wood plug color
        joint: 'None',
        shape: 'cylinder',
        cylinder: {
          radius: 0.1875,
          axis: touchAxis
        },
        operations: [],
        edgeJoints: [],
        meta: { isFastenerElement: true }
      });
    } else if (config.type === 'dowels') {
      // Dowels are circular holes in BOTH boards
      const dowelFacesA = faceOffsetsFor(boardA, contactFaceA, distAxisIdx, offsetValA, localOffsetY_A);
      const dowelFacesB = faceOffsetsFor(boardB, contactFaceB, distAxisIdx, offsetValB, localOffsetY_B);
      newBoardA.operations.push({
        id: `op_dowel_A_${fId}`,
        type: 'hole',
        face: contactFaceA,
        axis: touchAxis,
        radius: 0.1875,
        depth: 0.75,
        offset: dowelFacesA.offset,
        offsetY: dowelFacesA.offsetY,
        source: 'smart-fastener'
      });

      newBoardB.operations.push({
        id: `op_dowel_B_${fId}`,
        type: 'hole',
        face: contactFaceB,
        axis: touchAxis,
        radius: 0.1875,
        depth: 0.75,
        offset: dowelFacesB.offset,
        offsetY: dowelFacesB.offsetY,
        source: 'smart-fastener'
      });

      // Spawn visual Dowel (Birch material)
      let dowelSize;
      if (touchAxis === 'x') dowelSize = [1.5, 0.375, 0.375];
      else if (touchAxis === 'y') dowelSize = [0.375, 1.5, 0.375];
      else dowelSize = [0.375, 0.375, 1.5];

      newFastenerBoards.push({
        id: fId,
        name: `Dowel Pin ${idx + 1}`,
        parentId: jointGroupId,
        size: dowelSize,
        position: fastenerPos,
        material: 'birch', // Birch wood material
        joint: 'None',
        shape: 'cylinder',
        cylinder: {
          radius: 0.1875,
          axis: touchAxis
        },
        operations: [],
        edgeJoints: [],
        meta: { isFastenerElement: true }
      });
    } else if (config.type === 'loose-tenon') {
      // Loose tenons (Dominoes) are dado mortises in BOTH boards
      const isTouchX = touchAxis === 'x';
      const isTouchY = touchAxis === 'y';

      newBoardA.operations.push({
        id: `op_tenon_A_${fId}`,
        type: 'dado',
        face: contactFaceA,
        direction: distAxis,
        width: 0.3125, // 5/16" thick
        length: 1.25,  // 1.25" long tenon width
        depth: 0.75,
        offset: 0,
        lengthOffset: offsetValA,
        source: 'smart-fastener'
      });

      newBoardB.operations.push({
        id: `op_tenon_B_${fId}`,
        type: 'dado',
        face: contactFaceB,
        direction: distAxis,
        width: 0.3125,
        length: 1.25,
        depth: 0.75,
        offset: 0,
        lengthOffset: offsetValB,
        source: 'smart-fastener'
      });

      // Spawn visual Domino (Birch material)
      // Set size depending on touchAxis to align flat faces nicely
      let tenonSize = [1.25, 0.3125, 1.5];
      if (isTouchX) tenonSize = [1.5, 0.3125, 1.25];
      else if (isTouchY) tenonSize = [1.25, 1.5, 0.3125];

      newFastenerBoards.push({
        id: fId,
        name: `Domino Tenon ${idx + 1}`,
        parentId: jointGroupId,
        size: tenonSize,
        position: fastenerPos,
        material: 'birch', // Birch wood material
        joint: 'None',
        shape: 'box',
        operations: [],
        edgeJoints: [],
        meta: { isFastenerElement: true }
      });
    } else if (config.type === 'screws') {
      const screwLength = 1.5;
      const screwDiam = 0.18;

      let screwSize;
      if (touchAxis === 'x') screwSize = [screwLength, screwDiam, screwDiam];
      else if (touchAxis === 'y') screwSize = [screwDiam, screwLength, screwDiam];
      else screwSize = [screwDiam, screwDiam, screwLength];

      if (touchAxis === 'y') {
        // Find which board is higher (the Slat) and which is lower (the Apron)
        const isA_Slat = boardA.position[1] > boardB.position[1];
        const slatBoard = isA_Slat ? newBoardA : newBoardB;
        const apronBoard = isA_Slat ? newBoardB : newBoardA;
        const slatBoardOrig = isA_Slat ? boardA : boardB;
        const apronBoardOrig = isA_Slat ? boardB : boardA;
        const slatOffsetVal = isA_Slat ? offsetValA : offsetValB;
        const apronOffsetVal = isA_Slat ? offsetValB : offsetValA;
        const slatLocalOffsetY = isA_Slat ? localOffsetY_A : localOffsetY_B;
        const apronLocalOffsetY = isA_Slat ? localOffsetY_B : localOffsetY_A;
        const slatFaces = faceOffsetsFor(slatBoardOrig, 'top', distAxisIdx, slatOffsetVal, slatLocalOffsetY);
        const apronFaces = faceOffsetsFor(apronBoardOrig, 'top', distAxisIdx, apronOffsetVal, apronLocalOffsetY);

        // clearance/countersink hole on the Slat, from 'top' face going all the way down
        slatBoard.operations.push({
          id: `op_screw_clear_${fId}`,
          type: 'hole',
          face: 'top',
          axis: 'y',
          radius: 0.125, // countersink clearance
          depth: isA_Slat ? boardA.size[1] : boardB.size[1], // full thickness of Slat
          offset: slatFaces.offset,
          offsetY: slatFaces.offsetY,
          source: 'smart-fastener'
        });

        // pilot hole on the Apron, from 'top' face going down
        apronBoard.operations.push({
          id: `op_screw_pilot_${fId}`,
          type: 'hole',
          face: 'top',
          axis: 'y',
          radius: 0.08, // thin pilot hole
          depth: 1.0,
          offset: apronFaces.offset,
          offsetY: apronFaces.offsetY,
          source: 'smart-fastener'
        });

        // Position the screw flush with the top of the Slat
        const slatThickness = isA_Slat ? boardA.size[1] : boardB.size[1];
        const slatTopY = (isA_Slat ? boardA.position[1] : boardB.position[1]) + slatThickness / 2;
        
        // Center of the screw along Y is top of the Slat minus half the screw length
        fastenerPos[1] = slatTopY - screwLength / 2;
      } else {
        // Fallback for X/Z axes: standard pilot & clearance behavior along the touchAxis
        const screwFacesA = faceOffsetsFor(boardA, contactFaceA, distAxisIdx, offsetValA, localOffsetY_A);
        const screwFacesB = faceOffsetsFor(boardB, contactFaceB, distAxisIdx, offsetValB, localOffsetY_B);
        newBoardA.operations.push({
          id: `op_screw_pilot_${fId}`,
          type: 'hole',
          face: contactFaceA,
          axis: touchAxis,
          radius: 0.08,
          depth: 1.0,
          offset: screwFacesA.offset,
          offsetY: screwFacesA.offsetY,
          source: 'smart-fastener'
        });

        newBoardB.operations.push({
          id: `op_screw_clear_${fId}`,
          type: 'hole',
          face: contactFaceB,
          axis: touchAxis,
          radius: 0.125,
          depth: 0.5,
          offset: screwFacesB.offset,
          offsetY: screwFacesB.offsetY,
          source: 'smart-fastener'
        });
      }

      // Spawn beautiful premium steel visual metal screws
      newFastenerBoards.push({
        id: fId,
        name: `Wood Screw ${idx + 1}`,
        parentId: jointGroupId,
        size: screwSize,
        position: fastenerPos,
        material: { type: 'color', hex: '#8e9296' }, // beautiful premium steel paint color
        joint: 'None',
        shape: 'cylinder',
        cylinder: {
          radius: 0.09,
          axis: touchAxis
        },
        operations: [],
        edgeJoints: [],
        meta: { isFastenerElement: true }
      });
    }
  });

  // 5. Establish mathematical Glue Constraint for rigid linking
  const constraintId = `glue_fastener_${Date.now()}`;
  nextConstraints[constraintId] = {
    type: 'Glue',
    boardAId: boardA.id.toString(),
    boardBId: boardB.id.toString(),
    offset: [
      boardB.position[0] - boardA.position[0],
      boardB.position[1] - boardA.position[1],
      boardB.position[2] - boardA.position[2]
    ],
    enabled: true
  };

  // Glue each visual fastener board to Board A rigidly so it follows movement
  newFastenerBoards.forEach(fb => {
    const fGlueId = `glue_fastener_visual_${fb.id}`;
    nextConstraints[fGlueId] = {
      type: 'Glue',
      boardAId: fb.id.toString(),
      boardBId: boardA.id.toString(),
      offset: [
        boardA.position[0] - fb.position[0],
        boardA.position[1] - fb.position[1],
        boardA.position[2] - fb.position[2]
      ],
      enabled: true
    };
  });

  // Swap original boards with modified copies, add new visual elements
  const finalBoards = cleanBoards.map(b => {
    if (b.id === boardA.id) return newBoardA;
    if (b.id === boardB.id) return newBoardB;
    return b;
  }).concat(newFastenerBoards);

  return {
    success: true,
    newBoards: finalBoards,
    nextGroups,
    nextConstraints
  };
};
