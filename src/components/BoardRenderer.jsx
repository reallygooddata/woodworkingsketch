import React, { useMemo, useEffect, Suspense, useState, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useTexture, useGLTF, Edges, Html, Line } from '@react-three/drei';
import useStore from '../store/useStore';
import { checkConstraintConflict, propagateMove, getFaceWorldPos } from '../utils/constraintSolver';
import { computeWorldAABB, collectChildBoards, calculateGroupAABB } from '../utils/sceneGraph';
import { getGridStep } from '../utils/units';
import { WOOD_CATALOGUE, WOOD_TEXTURE_URLS, normalizeMaterial } from '../utils/materialCatalogue';
import { buildTaperGeometry, normalizeTaper } from '../utils/geometryBuilders';
import { computeHardwareTransform } from '../utils/hardwareCatalogue';
import { computeSnapPoints, findNearestSnap } from '../utils/snapHelpers';
import { getFaceTriangles, getFaceLabel } from '../utils/faceMeasurement';
import CSGGeometry from './CSGGeometry';


const getSemanticFace = (e, b) => {
  const hasBoxFaces = !b.shape || b.shape === 'taper';
  if (hasBoxFaces && e.faceIndex !== undefined) {
    return ['x+', 'x-', 'y+', 'y-', 'z+', 'z-'][Math.floor(e.faceIndex / 2)];
  }
  // For curved geometries (cylinder/disc), convert click to local space
  // and find closest AABB plane.
  if (e.point && e.object) {
    const localPt = e.object.worldToLocal(e.point.clone());
    const hw = b.size[0] / 2;
    const hh = b.size[1] / 2;
    const hd = b.size[2] / 2;
    const dists = {
      'x+': Math.abs(hw - localPt.x),
      'x-': Math.abs(-hw - localPt.x),
      'y+': Math.abs(hh - localPt.y),
      'y-': Math.abs(-hh - localPt.y),
      'z+': Math.abs(hd - localPt.z),
      'z-': Math.abs(-hd - localPt.z),
    };
    let bestFace = null;
    let minDist = Infinity;
    for (const [face, d] of Object.entries(dists)) {
      if (d < minDist) {
        minDist = d;
        bestFace = face;
      }
    }
    return bestFace;
  }
  return null;
};

// ── Convert a local face string to its world-facing direction ────────────
// Used when storing constraint faces so the solver (which works in world
// space) snaps on the correct axis.  For unoriented boards this is identity.
const localFaceToWorld = (localFace, orientation) => {
  if (!localFace) return localFace;
  const [rx, ry, rz] = orientation || [0, 0, 0];
  if (rx === 0 && ry === 0 && rz === 0) return localFace;

  const axisIdx = localFace[0] === 'x' ? 0 : localFace[0] === 'y' ? 1 : 2;
  const sign = localFace[1] === '+' ? 1 : -1;
  const localN = [0, 0, 0];
  localN[axisIdx] = sign;

  // Three.js YXZ Euler order: a=cos(x),b=sin(x),c=cos(y),d=sin(y),e=cos(z),f=sin(z)
  const a = Math.cos(rx), b = Math.sin(rx);
  const c = Math.cos(ry), d = Math.sin(ry);
  const e = Math.cos(rz), f = Math.sin(rz);
  const ce = c*e, cf = c*f, de = d*e, df = d*f;
  // Row-major rotation matrix (from Three.js makeRotationFromEuler YXZ)
  const R = [
    [ce+df*b,  de*b-cf,  a*d ],
    [a*f,      a*e,     -b   ],
    [cf*b-de,  df+ce*b,  a*c ],
  ];
  const worldN = [
    R[0][0] * localN[0] + R[0][1] * localN[1] + R[0][2] * localN[2],
    R[1][0] * localN[0] + R[1][1] * localN[1] + R[1][2] * localN[2],
    R[2][0] * localN[0] + R[2][1] * localN[1] + R[2][2] * localN[2],
  ];

  let bestAxis = 0, bestAbs = 0;
  for (let i = 0; i < 3; i++) {
    const a2 = Math.abs(worldN[i]);
    if (a2 > bestAbs) { bestAbs = a2; bestAxis = i; }
  }
  return ['x', 'y', 'z'][bestAxis] + (worldN[bestAxis] > 0 ? '+' : '-');
};

// ── Hardware attachment renderer ─────────────────────────────────────────────
const HardwareAttachment = ({ hw, boardSize, boardId }) => {
  const { selectedHardwareId, setSelectedHardwareId, setSelectedItemIds, updateHardware } = useStore();
  const { scene } = useGLTF(hw.modelUrl);
  const clonedScene = useMemo(() => scene.clone(true), [scene]);
  const { position, rotation } = computeHardwareTransform(boardSize, hw.face, hw.offset);
  const isSelected = selectedHardwareId === hw.id;

  // Auto-scale on first load: if scale is still 1 and model is very small/large relative to board,
  // compute a sensible default. Models from Sketchfab are typically in meters, boards are in inches.
  useEffect(() => {
    if (hw.scale && hw.scale !== 1) return; // user already set a custom scale
    const box = new THREE.Box3().setFromObject(clonedScene);
    const modelSize = new THREE.Vector3();
    box.getSize(modelSize);
    const maxModelDim = Math.max(modelSize.x, modelSize.y, modelSize.z);
    if (maxModelDim <= 0) return;

    // Target: hardware should be roughly 1/3 the board's smallest face dimension
    const targetSize = Math.min(...boardSize) * 0.8;
    const autoScale = targetSize / maxModelDim;

    // Only auto-adjust if the ratio is very off (model is >5x too big or too small)
    if (autoScale < 0.2 || autoScale > 5) {
      const rounded = parseFloat(autoScale.toFixed(2));
      updateHardware(boardId, hw.id, { scale: rounded });
    }
  }, [clonedScene]); // only on first load

  // Combine face rotation with user-specified rotation
  const finalRotation = [
    rotation[0] + (hw.rotation?.[0] || 0),
    rotation[1] + (hw.rotation?.[1] || 0),
    rotation[2] + (hw.rotation?.[2] || 0),
  ];

  // Apply emissive highlight when selected
  useEffect(() => {
    clonedScene.traverse((child) => {
      if (child.isMesh && child.material) {
        const mat = child.material.clone();
        mat.emissive = new THREE.Color(isSelected ? '#bc8a5f' : '#000000');
        mat.emissiveIntensity = isSelected ? 0.6 : 0;
        child.material = mat;
      }
    });
  }, [clonedScene, isSelected]);

  return (
    <group
      position={position}
      rotation={finalRotation}
      scale={hw.scale || 1}
      userData={{ isHardware: true }}
      name={hw.name || hw.type || 'hardware'}
      onClick={(e) => {
        e.stopPropagation();
        setSelectedItemIds([boardId.toString()]);
        setSelectedHardwareId(hw.id);
      }}
      onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = 'auto'; }}
    >
      <primitive object={clonedScene} />
    </group>
  );
};

const FaceHighlightMesh = ({ parentGeometry, normal, localPt, color, opacity }) => {
  const geom = useMemo(() => {
    if (!parentGeometry || !normal || !localPt) return null;
    const matchIndices = getFaceTriangles(parentGeometry, new THREE.Vector3(...normal), new THREE.Vector3(...localPt));
    if (matchIndices.length === 0) return null;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', parentGeometry.getAttribute('position'));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(matchIndices), 1));
    return g;
  }, [parentGeometry, normal, localPt]);

  useEffect(() => {
    return () => {
      if (geom) geom.dispose();
    };
  }, [geom]);

  if (!geom) return null;

  return (
    <mesh geometry={geom} raycast={() => null}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} depthTest={false} side={THREE.DoubleSide} />
    </mesh>
  );
};

const getGeometryFeatures = (geometry, localPt, thresholdCorner = 0.35, thresholdEdge = 0.15) => {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) return null;

  const indexAttr = geometry.index;
  const vertexCount = posAttr.count;

  let closestVertex = null;
  let minVertexDist = Infinity;

  const tempV = new THREE.Vector3();
  for (let i = 0; i < vertexCount; i++) {
    tempV.fromBufferAttribute(posAttr, i);
    const dist = tempV.distanceTo(localPt);
    if (dist < minVertexDist) {
      minVertexDist = dist;
      closestVertex = tempV.clone();
    }
  }

  let closestEdgeStart = null;
  let closestEdgeEnd = null;
  let minEdgeDist = Infinity;

  const getDistanceToSegment = (P, A, B) => {
    const ab = new THREE.Vector3().subVectors(B, A);
    const ap = new THREE.Vector3().subVectors(P, A);
    const abLenSq = ab.lengthSq();
    if (abLenSq < 0.0001) return P.distanceTo(A);
    let t = ap.dot(ab) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const closest = A.clone().addScaledVector(ab, t);
    return P.distanceTo(closest);
  };

  const processEdge = (A, B) => {
    if (A.distanceTo(B) < 0.001) return;
    const dist = getDistanceToSegment(localPt, A, B);
    if (dist < minEdgeDist) {
      minEdgeDist = dist;
      closestEdgeStart = A.clone();
      closestEdgeEnd = B.clone();
    }
  };

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  if (indexAttr) {
    const indexCount = indexAttr.count;
    for (let i = 0; i < indexCount; i += 3) {
      const idxA = indexAttr.getX(i);
      const idxB = indexAttr.getX(i + 1);
      const idxC = indexAttr.getX(i + 2);

      vA.fromBufferAttribute(posAttr, idxA);
      vB.fromBufferAttribute(posAttr, idxB);
      vC.fromBufferAttribute(posAttr, idxC);

      processEdge(vA, vB);
      processEdge(vB, vC);
      processEdge(vC, vA);
    }
  } else {
    for (let i = 0; i < vertexCount; i += 3) {
      vA.fromBufferAttribute(posAttr, i);
      vB.fromBufferAttribute(posAttr, i + 1);
      vC.fromBufferAttribute(posAttr, i + 2);

      processEdge(vA, vB);
      processEdge(vB, vC);
      processEdge(vC, vA);
    }
  }

  if (minVertexDist < thresholdCorner) {
    return { type: 'corner', point: closestVertex, dist: minVertexDist };
  }

  if (minEdgeDist < thresholdEdge) {
    return { type: 'edge', start: closestEdgeStart, end: closestEdgeEnd, dist: minEdgeDist };
  }

  return null;
};

const PlaneMesh = ({ b, selectedItemIds }) => {
  const toggleSelection = useStore(s => s.toggleSelection);
  if (b.visible === false) return null;
  const isSelected = selectedItemIds.includes(b.id.toString());
  const euler = new THREE.Euler(...(b.orientation || [0, 0, 0]), 'YXZ');
  const quaternion = new THREE.Quaternion().setFromEuler(euler);

  return (
    <mesh
      position={b.position}
      quaternion={quaternion}
      onClick={(e) => {
        e.stopPropagation();
        toggleSelection(b.id.toString(), e.shiftKey || e.ctrlKey || e.metaKey);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'auto';
      }}
    >
      <planeGeometry args={[48, 48]} />
      <meshBasicMaterial
        color="#00ffff"
        transparent
        opacity={isSelected ? 0.25 : 0.1}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
      <Edges color={isSelected ? '#00ffff' : 'rgba(0, 243, 255, 0.4)'} scale={1} />
      <gridHelper
        args={[48, 24, '#00ffff', isSelected ? 'rgba(0, 243, 255, 0.25)' : 'rgba(0, 243, 255, 0.1)']}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <axesHelper args={[12]} />
    </mesh>
  );
};

const BoardMesh = ({ b, selectedItemIds, toggleSelection, textures, showEdges, constraintTargetMode, hoveredFaceData, setHoveredFaceData, modifierActive }) => {
  const isSelected = selectedItemIds.includes(b.id.toString());
  
  const boards = useStore(s => s.boards);
  const meshRef = useRef();
  const measureFaceAnglesActive = useStore(s => s.measureFaceAnglesActive);
  const selectedFaces = useStore(s => s.selectedFaces);
  const measureEdgesActive = useStore(s => s.measureEdgesActive);
  const selectedEdges = useStore(s => s.selectedEdges);
  const dKeyPressed = useStore(s => s.dKeyPressed);
  const [draggingInfo, setDraggingInfo] = useState(null);
  const [snappedAxes, setSnappedAxes] = useState({ x: false, y: false, z: false });
  const isSnapped = snappedAxes.x || snappedAxes.y || snappedAxes.z;
  const { camera, gl } = useThree();



  // Premium per-board cloned texture layout optimizer
  const matDesc = useMemo(() => normalizeMaterial(b.material), [b.material]);
  const baseTex = textures[matDesc.id] ?? textures['pine'];
  const [clonedTex, setClonedTex] = useState(null);

  useEffect(() => {
    if (!baseTex) return;
    const tex = baseTex.clone();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.center.set(0.5, 0.5);

    const sizeX = b.size[0] || 1;
    const sizeY = b.size[1] || 1;
    const sizeZ = b.size[2] || 1;
    const maxDim = Math.max(sizeX, sizeY, sizeZ);
    // Physically scale texture repeat every 16 inches of board length to prevent stretching
    const repeatVal = Math.max(1, Math.round(maxDim / 16));
    
    // Determine which axis represents the board's length
    const maxDimIndex = b.size.indexOf(maxDim);
    const isWidth = b.grainDirection === 'width';
    
    let rotateTexture = false;
    if (maxDimIndex === 1) {
      // For vertical boards (longest along Y), grain along length needs 90° rotation, grain along width needs 0°
      rotateTexture = !isWidth;
    } else {
      // For horizontal/depth-wise boards (longest along X or Z), grain along length needs 0° rotation, grain along width needs 90°
      rotateTexture = isWidth;
    }
    
    if (rotateTexture) {
      tex.rotation = Math.PI / 2;
      tex.repeat.set(1.5, repeatVal);
    } else {
      tex.rotation = 0;
      tex.repeat.set(repeatVal, 1.5);
    }
    
    tex.needsUpdate = true;
    setClonedTex(tex);
    
    return () => {
      tex.dispose();
    };
  }, [baseTex, b.grainDirection, b.size[0], b.size[1], b.size[2]]);

  useEffect(() => {
    if (draggingInfo) {
      document.body.style.cursor = 'grabbing';
    } else if (dKeyPressed && isSelected) {
      document.body.style.cursor = 'grab';
    } else {
      document.body.style.cursor = 'auto';
    }
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [dKeyPressed, isSelected, draggingInfo]);

  useEffect(() => {
    if (!draggingInfo) return;

    const raycaster = new THREE.Raycaster();

    const onMove = (e) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);

      const intersection = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(draggingInfo.plane, intersection)) {
        const delta = intersection.clone().sub(draggingInfo.startPoint);

        const newPos = [
          draggingInfo.initialPosition[0] + delta.x,
          draggingInfo.initialPosition[1] + delta.y,
          draggingInfo.initialPosition[2] + delta.z
        ];

        const snapThreshold = 1.0; // 1 inch snapping threshold
        let snappedPos = [...newPos];
        const activeSnaps = { x: false, y: false, z: false };

        const { setBoards, constraints, boards: latestBoards } = useStore.getState();

        for (let axis = 0; axis < 3; axis++) {
          let closestSnapDelta = Infinity;
          let targetSnapVal = null;

          const b_size = b.size[axis];
          const b_pos = newPos[axis];

          const b_faces = [
            { name: 'min', val: b_pos - b_size / 2, offset: b_size / 2 },
            { name: 'center', val: b_pos, offset: 0 },
            { name: 'max', val: b_pos + b_size / 2, offset: -b_size / 2 }
          ];

          for (const other of latestBoards) {
            if (other.id === b.id) continue;
            if (other.visible === false) continue;

            const o_size = other.size[axis];
            const o_pos = other.position[axis];

            const o_faces = [
              { name: 'min', val: o_pos - o_size / 2 },
              { name: 'center', val: o_pos },
              { name: 'max', val: o_pos + o_size / 2 }
            ];

            for (const bf of b_faces) {
              for (const ofc of o_faces) {
                const diff = bf.val - ofc.val;
                if (Math.abs(diff) < snapThreshold && Math.abs(diff) < Math.abs(closestSnapDelta)) {
                  closestSnapDelta = diff;
                  targetSnapVal = ofc.val + bf.offset;
                }
              }
            }
          }

          if (targetSnapVal !== null) {
            snappedPos[axis] = targetSnapVal;
            if (axis === 0) activeSnaps.x = true;
            if (axis === 1) activeSnaps.y = true;
            if (axis === 2) activeSnaps.z = true;
          }
        }

        setSnappedAxes(activeSnaps);

        const glueConstraints = Object.fromEntries(
          Object.entries(constraints).filter(([_, c]) => c.type === 'Glue')
        );
        const deltaVec = [
          snappedPos[0] - draggingInfo.initialPosition[0],
          snappedPos[1] - draggingInfo.initialPosition[1],
          snappedPos[2] - draggingInfo.initialPosition[2]
        ];
        const moveMap = propagateMove([b.id.toString()], deltaVec, glueConstraints);

        setBoards(latestBoards.map(bd => {
          const bdIdStr = bd.id.toString();
          if (moveMap.has(bdIdStr)) {
            const initialPos = draggingInfo.allInitialPositions?.get(bdIdStr) || bd.position;
            const d = moveMap.get(bdIdStr);
            return {
              ...bd,
              position: [
                initialPos[0] + d[0],
                initialPos[1] + d[1],
                initialPos[2] + d[2]
              ]
            };
          }
          return bd;
        }));
      }
    };

    const onUp = (e) => {
      try { gl.domElement.releasePointerCapture(draggingInfo.pointerId); } catch (_) {}

      const { pushHistory, setLiveDragBoardIds } = useStore.getState();
      const currentPos = b.position;
      const initialPos = draggingInfo.initialPosition;
      const moved = Math.abs(currentPos[0] - initialPos[0]) > 0.001 ||
                    Math.abs(currentPos[1] - initialPos[1]) > 0.001 ||
                    Math.abs(currentPos[2] - initialPos[2]) > 0.001;

      if (moved) {
        pushHistory();
      }

      setLiveDragBoardIds([]);
      setDraggingInfo(null);
      setSnappedAxes({ x: false, y: false, z: false });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingInfo, boards, b, gl, camera]);

  if (b.visible === false) return null;

  const handleDragPointerDown = (e) => {
    if (!dKeyPressed) return;
    e.stopPropagation();
    gl.domElement.setPointerCapture(e.pointerId);
    useStore.getState().setLiveDragBoardIds([b.id.toString()]);

    const dragPlane = new THREE.Plane();
    const normal = new THREE.Vector3();
    e.camera.getWorldDirection(normal);
    normal.negate(); // face the camera
    dragPlane.setFromNormalAndCoplanarPoint(normal, e.point);

    setDraggingInfo({
      initialPosition: [...b.position],
      allInitialPositions: new Map(boards.map(bd => [bd.id.toString(), [...bd.position]])),
      startPoint: e.point.clone(),
      plane: dragPlane,
      pointerId: e.pointerId
    });
  };

  // Pivot offset in LOCAL board space (default [0,0,0] = center)
  const pivot = b.pivot || [0, 0, 0];
  const hasPivot = pivot[0] !== 0 || pivot[1] !== 0 || pivot[2] !== 0;

  // Face labels are in LOCAL board space — orientation is handled by the mesh transform
  const faceLabels = {
    'x+': 'right', 'x-': 'left',
    'y+': 'top',   'y-': 'bottom',
    'z+': 'front', 'z-': 'back'
  };
  return (
    <group
      position={b.position}
      rotation={b.orientation ? [...b.orientation, 'YXZ'] : [0, 0, 0, 'YXZ']}
      name={b.name}
    >
      <mesh
        ref={meshRef}
        position={[-pivot[0], -pivot[1], -pivot[2]]}
        raycast={(modifierActive && constraintTargetMode?.active) ? () => null : undefined}
        castShadow
        receiveShadow
        userData={{ isBoard: true }}
        name={b.name}
        onClick={(e) => {
          e.stopPropagation();

          // ── Define Plane Mode ──
          const { definePlaneActive, definePlaneFeatures, addDefinePlaneFeature } = useStore.getState();
          if (definePlaneActive) {
            if (e.object?.geometry) {
              const localPt = e.object.worldToLocal(e.point.clone());
              const feature = getGeometryFeatures(e.object.geometry, localPt, 0.35, 0.25);
              if (feature) {
                if (feature.type === 'corner') {
                  const worldPt = feature.point.clone().applyMatrix4(meshRef.current.matrixWorld).toArray();
                  addDefinePlaneFeature({
                    type: 'point',
                    pos: worldPt,
                    boardId: b.id.toString(),
                    localPos: [feature.point.x, feature.point.y, feature.point.z]
                  });
                } else if (feature.type === 'edge') {
                  const worldStart = feature.start.clone().applyMatrix4(meshRef.current.matrixWorld).toArray();
                  const worldEnd = feature.end.clone().applyMatrix4(meshRef.current.matrixWorld).toArray();
                  addDefinePlaneFeature({
                    type: 'edge',
                    start: worldStart,
                    end: worldEnd,
                    boardId: b.id.toString(),
                    localStart: [feature.start.x, feature.start.y, feature.start.z],
                    localEnd: [feature.end.x, feature.end.y, feature.end.z]
                  });
                }
              }
            }
            return;
          }

          // ── Pivot Mode ──
          const { pivotMode, setPivotMode, gridSnap, setCustomPivot, setPivotHoverSnap, units } = useStore.getState();
          if (pivotMode?.active && pivotMode.boardId === b.id.toString()) {
            const gridStep = getGridStep(gridSnap, units) || 0.125;
            const pt = e.point.clone();
            const euler = new THREE.Euler(...(b.orientation || [0, 0, 0]), 'YXZ');
            pt.sub(new THREE.Vector3(...b.position));
            pt.applyEuler(new THREE.Euler(-euler.x, -euler.y, -euler.z, 'ZXY'));

            const snx = Math.round(pt.x / gridStep) * gridStep;
            const sny = Math.round(pt.y / gridStep) * gridStep;
            const snz = Math.round(pt.z / gridStep) * gridStep;

            setCustomPivot(b.id, [snx, sny, snz]);
            setPivotMode(null);
            setPivotHoverSnap(null);
            useStore.getState().showToast('Pivot point set successfully.');
            return;
          }

          // ── Measure Face Angles Mode ──
          const { measureFaceAnglesActive, toggleFaceSelection } = useStore.getState();
          if (measureFaceAnglesActive) {
            if (e.face && e.face.normal && e.point && e.object) {
              const localPt = e.object.worldToLocal(e.point.clone());
              const norm = e.face.normal;
              const label = getFaceLabel([norm.x, norm.y, norm.z]);
              toggleFaceSelection(b.id.toString(), [norm.x, norm.y, norm.z], [localPt.x, localPt.y, localPt.z], label);
            }
            return;
          }

          // ── Measure Edge Relationships Mode ──
          const { measureEdgesActive: activeEdges, toggleEdgeSelection: toggleEdge } = useStore.getState();
          if (activeEdges) {
            console.log("Edge measure click detected on board", b.name);
            if (e.object?.geometry) {
              const localPt = e.object.worldToLocal(e.point.clone());
              console.log("localPt:", localPt);
              // Disable corner threshold (set to 0) to guarantee edge detection, using wider 5.0 inch threshold for click ease
              const feature = getGeometryFeatures(e.object.geometry, localPt, 0, 5.0);
              console.log("Detected feature:", feature);
              if (feature && feature.type === 'edge') {
                console.log("Toggling edge:", feature.start, feature.end);
                toggleEdge(
                  b.id.toString(),
                  [feature.start.x, feature.start.y, feature.start.z],
                  [feature.end.x, feature.end.y, feature.end.z]
                );
              } else {
                console.log("No edge feature found within threshold");
              }
            }
            return;
          }

          // ── Measure Mode: first point only ──
          const { measureMode, setMeasureMode } = useStore.getState();
          if (measureMode?.active) {
            if (!measureMode.firstPoint) {
              const hitWorld = [e.point.x, e.point.y, e.point.z];
              const snap = findNearestSnap(hitWorld, b);
              const point = snap
                ? { localOffset: snap.localOffset, boardId: b.id.toString(), snapType: snap.type }
                : { localOffset: [e.point.x - b.position[0], e.point.y - b.position[1], e.point.z - b.position[2]], boardId: b.id.toString(), snapType: 'surface' };
              setMeasureMode({ active: true, firstPoint: point });
            }
            // Second point is handled by onPointerDown (drag mode)
            return;
          }

          const localFace = getSemanticFace(e, b);
          const faceStr = localFaceToWorld(localFace, b.orientation);
          toggleSelection(b.id.toString(), e.shiftKey || e.ctrlKey || e.metaKey, faceStr);
        }}
        onPointerDown={(e) => {
          // ── Define Plane Mode ──
          const { definePlaneActive } = useStore.getState();
          if (definePlaneActive) {
            e.stopPropagation();
            return;
          }

          // ── Pivot Mode Click Snapping ──
          const { pivotMode, setPivotMode, gridSnap, setCustomPivot, setPivotHoverSnap, units } = useStore.getState();
          if (pivotMode?.active && pivotMode.boardId === b.id.toString()) {
            e.stopPropagation();
            const gridStep = getGridStep(gridSnap, units) || 0.125;
            const pt = e.point.clone();
            const euler = new THREE.Euler(...(b.orientation || [0, 0, 0]), 'YXZ');
            pt.sub(new THREE.Vector3(...b.position));
            pt.applyEuler(new THREE.Euler(-euler.x, -euler.y, -euler.z, 'ZXY'));

            const snx = Math.round(pt.x / gridStep) * gridStep;
            const sny = Math.round(pt.y / gridStep) * gridStep;
            const snz = Math.round(pt.z / gridStep) * gridStep;

            setCustomPivot(b.id, [snx, sny, snz]);
            setPivotMode(null);
            setPivotHoverSnap(null);
            useStore.getState().showToast('Pivot point set successfully.');
            return;
          }

          if (dKeyPressed) {
            handleDragPointerDown(e);
            return;
          }
          // ── Measure Mode: second point starts drag ──
          const { measureMode, setMeasureMode } = useStore.getState();
          if (measureMode?.active && measureMode.firstPoint && !measureMode.dragging) {
            e.stopPropagation();
            const hitWorld = [e.point.x, e.point.y, e.point.z];
            const snap = findNearestSnap(hitWorld, b);
            const point = snap
              ? { localOffset: snap.localOffset, boardId: b.id.toString(), snapType: snap.type }
              : { localOffset: [e.point.x - b.position[0], e.point.y - b.position[1], e.point.z - b.position[2]], boardId: b.id.toString(), snapType: 'surface' };

            // Prevent zero-length
            const fp = measureMode.firstPoint;
            if (fp.boardId === point.boardId &&
                Math.abs(fp.localOffset[0] - point.localOffset[0]) < 0.1 &&
                Math.abs(fp.localOffset[1] - point.localOffset[1]) < 0.1 &&
                Math.abs(fp.localOffset[2] - point.localOffset[2]) < 0.1) {
              setMeasureMode({ active: true, firstPoint: null });
              return;
            }

            // Compute offset direction: perpendicular to measurement line
            // Use camera forward crossed with measurement direction for a natural perpendicular
            const fpBoard = useStore.getState().boards.find(x => x.id.toString() === fp.boardId);
            if (!fpBoard) return;
            const euler1 = new THREE.Euler(...(fpBoard.orientation || [0, 0, 0]), 'YXZ');
            const pivot1 = fpBoard.pivot || [0, 0, 0];
            const pt1 = new THREE.Vector3(fp.localOffset[0]-pivot1[0], fp.localOffset[1]-pivot1[1], fp.localOffset[2]-pivot1[2]);
            pt1.applyEuler(euler1);
            const wA = new THREE.Vector3(pt1.x+fpBoard.position[0], pt1.y+fpBoard.position[1], pt1.z+fpBoard.position[2]);

            const euler2 = new THREE.Euler(...(b.orientation || [0, 0, 0]), 'YXZ');
            const pivot2 = b.pivot || [0, 0, 0];
            const pt2 = new THREE.Vector3(point.localOffset[0]-pivot2[0], point.localOffset[1]-pivot2[1], point.localOffset[2]-pivot2[2]);
            pt2.applyEuler(euler2);
            const wB = new THREE.Vector3(pt2.x+b.position[0], pt2.y+b.position[1], pt2.z+b.position[2]);

            const measDir = new THREE.Vector3().subVectors(wB, wA).normalize();
            // OffsetDirA: world-axis perpendicular (default drag direction)
            let offsetDirA;
            if (Math.abs(measDir.y) > 0.9) {
              offsetDirA = Math.abs(measDir.x) < Math.abs(measDir.z)
                ? new THREE.Vector3(1, 0, 0)
                : new THREE.Vector3(0, 0, 1);
            } else {
              offsetDirA = new THREE.Vector3(0, 1, 0);
            }

            // OffsetDirB: face normal of the clicked board (perpendicular to face)
            let offsetDirB = new THREE.Vector3(0, 1, 0); // fallback
            if (e.face && e.face.normal) {
              // Transform local face normal to world space using the board's rotation
              offsetDirB = e.face.normal.clone().applyEuler(euler2).normalize();
            }
            // Ensure it's not parallel to the measurement direction
            if (Math.abs(offsetDirB.dot(measDir)) > 0.95) {
              offsetDirB = offsetDirA.clone(); // fallback to axis perpendicular
            }

            setMeasureMode({
              active: true,
              firstPoint: measureMode.firstPoint,
              secondPoint: point,
              dragging: true,
              dragOffset: 0,
              offsetDir: [offsetDirA.x, offsetDirA.y, offsetDirA.z],
              offsetDirA: [offsetDirA.x, offsetDirA.y, offsetDirA.z],
              offsetDirB: [offsetDirB.x, offsetDirB.y, offsetDirB.z],
            });
          }
        }}
        onPointerMove={(e) => {
          // ── Define Plane Hover Snapping ──
          const { definePlaneActive } = useStore.getState();
          if (definePlaneActive && e.object?.geometry) {
            e.stopPropagation();
            const localPt = e.object.worldToLocal(e.point.clone());
            const feature = getGeometryFeatures(e.object.geometry, localPt, 0.35, 0.25);
            
            let hoverType = null;
            let hoverKey = null;
            let cornerPos = null;
            let edgeStart = null;
            let edgeEnd = null;
            
            if (feature) {
              hoverType = feature.type;
              hoverKey = feature.type;
              if (feature.type === 'corner') {
                cornerPos = [feature.point.x, feature.point.y, feature.point.z];
              } else if (feature.type === 'edge') {
                edgeStart = [feature.start.x, feature.start.y, feature.start.z];
                edgeEnd = [feature.end.x, feature.end.y, feature.end.z];
              }
              document.body.style.cursor = 'pointer';
            } else {
              document.body.style.cursor = 'auto';
            }
            
            const needsUpdate = !hoveredFaceData || 
              hoveredFaceData.id !== b.id.toString() || 
              hoveredFaceData.hoverType !== hoverType || 
              hoveredFaceData.hoverKey !== hoverKey ||
              (hoverType === 'corner' && JSON.stringify(hoveredFaceData.cornerPos) !== JSON.stringify(cornerPos)) ||
              (hoverType === 'edge' && (
                JSON.stringify(hoveredFaceData.edgeStart) !== JSON.stringify(edgeStart) ||
                JSON.stringify(hoveredFaceData.edgeEnd) !== JSON.stringify(edgeEnd)
              ));
              
            if (needsUpdate) {
              setHoveredFaceData({ 
                id: b.id.toString(), 
                hoverType, 
                hoverKey,
                cornerPos,
                edgeStart,
                edgeEnd
              });
            }
            return;
          }

          // ── Pivot Mode hover snap tracking ──
          const { pivotMode, setPivotHoverSnap, gridSnap, units } = useStore.getState();
          if (pivotMode?.active && pivotMode.boardId === b.id.toString()) {
            e.stopPropagation();
            const gridStep = getGridStep(gridSnap, units) || 0.125;
            const pt = e.point.clone();
            const euler = new THREE.Euler(...(b.orientation || [0, 0, 0]), 'YXZ');
            pt.sub(new THREE.Vector3(...b.position));
            pt.applyEuler(new THREE.Euler(-euler.x, -euler.y, -euler.z, 'ZXY'));

            const snx = Math.round(pt.x / gridStep) * gridStep;
            const sny = Math.round(pt.y / gridStep) * gridStep;
            const snz = Math.round(pt.z / gridStep) * gridStep;

            const worldPt = new THREE.Vector3(snx, sny, snz);
            worldPt.applyEuler(euler);
            worldPt.add(new THREE.Vector3(...b.position));

            setPivotHoverSnap([worldPt.x, worldPt.y, worldPt.z]);
            return;
          }

          // ── Hover tracking for arbitrary face angle measurement ──
          const { measureFaceAnglesActive } = useStore.getState();
          if (measureFaceAnglesActive) {
            e.stopPropagation();
            if (e.face && e.face.normal && e.point && e.object) {
              const localPt = e.object.worldToLocal(e.point.clone());
              const norm = e.face.normal;
              if (!hoveredFaceData || 
                  hoveredFaceData.id !== b.id.toString() || 
                  !hoveredFaceData.isArbitraryFace ||
                  Math.abs(hoveredFaceData.normal[0] - norm.x) > 0.01 ||
                  Math.abs(hoveredFaceData.normal[1] - norm.y) > 0.01 ||
                  Math.abs(hoveredFaceData.normal[2] - norm.z) > 0.01 ||
                  Math.abs(hoveredFaceData.localPt[0] - localPt.x) > 0.05 ||
                  Math.abs(hoveredFaceData.localPt[1] - localPt.y) > 0.05 ||
                  Math.abs(hoveredFaceData.localPt[2] - localPt.z) > 0.05) {
                setHoveredFaceData({
                  id: b.id.toString(),
                  isArbitraryFace: true,
                  normal: [norm.x, norm.y, norm.z],
                  localPt: [localPt.x, localPt.y, localPt.z]
                });
              }
            }
            return;
          }

          // ── Hover snap tracking for measure mode ──
          const { measureMode: mm, setMeasureHoverSnap, measureHoverSnap } = useStore.getState();
          if (mm?.active && !mm.dragging) {
            e.stopPropagation();
            const hitWorld = [e.point.x, e.point.y, e.point.z];
            const snap = findNearestSnap(hitWorld, b);
            if (snap) {
              // Only update if different snap point
              if (!measureHoverSnap ||
                  measureHoverSnap.boardId !== b.id.toString() ||
                  measureHoverSnap.localOffset[0] !== snap.localOffset[0] ||
                  measureHoverSnap.localOffset[1] !== snap.localOffset[1] ||
                  measureHoverSnap.localOffset[2] !== snap.localOffset[2]) {
                setMeasureHoverSnap({ ...snap, boardId: b.id.toString() });
              }
            } else if (measureHoverSnap && measureHoverSnap.boardId === b.id.toString()) {
              setMeasureHoverSnap(null);
            }
          }

          const isActiveMode = (constraintTargetMode && constraintTargetMode.active) || measureEdgesActive;
          if ((isSelected || isActiveMode) && e.object?.geometry) {
            e.stopPropagation();
            const localPt = e.object.worldToLocal(e.point.clone());
            
            const feature = getGeometryFeatures(e.object.geometry, localPt, measureEdgesActive ? 0 : 0.35);
            
            let hoverType = 'face';
            let hoverKey = '';
            let cornerPos = null;
            let edgeStart = null;
            let edgeEnd = null;
            
            if (feature) {
              hoverType = feature.type;
              hoverKey = feature.type;
              if (feature.type === 'corner') {
                cornerPos = [feature.point.x, feature.point.y, feature.point.z];
              } else if (feature.type === 'edge') {
                edgeStart = [feature.start.x, feature.start.y, feature.start.z];
                edgeEnd = [feature.end.x, feature.end.y, feature.end.z];
              }
            } else {
              const hw = b.size[0] / 2;
              const hh = b.size[1] / 2;
              const hd = b.size[2] / 2;
              const nx = localPt.x / hw;
              const ny = localPt.y / hh;
              const nz = localPt.z / hd;
              const absX = Math.abs(nx);
              const absY = Math.abs(ny);
              const absZ = Math.abs(nz);
              const signXStr = nx >= 0 ? '+' : '-';
              const signYStr = ny >= 0 ? '+' : '-';
              const signZStr = nz >= 0 ? '+' : '-';
              
              const maxVal = Math.max(absX, absY, absZ);
              if (maxVal === absX) {
                hoverKey = `x${signXStr}`;
              } else if (maxVal === absY) {
                hoverKey = `y${signYStr}`;
              } else {
                hoverKey = `z${signZStr}`;
              }
            }
            
            const needsUpdate = !hoveredFaceData || 
              hoveredFaceData.id !== b.id.toString() || 
              hoveredFaceData.hoverType !== hoverType || 
              hoveredFaceData.hoverKey !== hoverKey ||
              (hoverType === 'corner' && JSON.stringify(hoveredFaceData.cornerPos) !== JSON.stringify(cornerPos)) ||
              (hoverType === 'edge' && (
                JSON.stringify(hoveredFaceData.edgeStart) !== JSON.stringify(edgeStart) ||
                JSON.stringify(hoveredFaceData.edgeEnd) !== JSON.stringify(edgeEnd)
              ));
              
            if (needsUpdate) {
              setHoveredFaceData({ 
                id: b.id.toString(), 
                hoverType, 
                hoverKey,
                cornerPos,
                edgeStart,
                edgeEnd,
                faceStr: hoverType === 'face' ? hoverKey : null
              });
            }
          }
        }}
        onPointerOut={(e) => {
          if (draggingInfo) return; // skip pointer out when dragging
          // Clear measure and pivot hover snap when leaving this board
          const { measureMode: mm, setMeasureHoverSnap, pivotMode, setPivotHoverSnap, definePlaneActive } = useStore.getState();
          if (mm?.active) setMeasureHoverSnap(null);
          if (pivotMode?.active) setPivotHoverSnap(null);
          if (definePlaneActive) {
            document.body.style.cursor = 'auto';
          }
          if (hoveredFaceData && hoveredFaceData.id === b.id.toString()) {
            setHoveredFaceData(null);
          }
        }}
        onPointerUp={null}
      >
        <CSGGeometry b={b} />
        {measureFaceAnglesActive && meshRef.current?.geometry && (
          <group>
            {hoveredFaceData && hoveredFaceData.id === b.id.toString() && hoveredFaceData.isArbitraryFace && (
              <FaceHighlightMesh
                parentGeometry={meshRef.current.geometry}
                normal={hoveredFaceData.normal}
                localPt={hoveredFaceData.localPt}
                color="#00ffff"
                opacity={0.45}
              />
            )}
            {selectedFaces.map((f, idx) => {
              if (f.boardId !== b.id.toString()) return null;
              return (
                <FaceHighlightMesh
                  key={`select-${idx}`}
                  parentGeometry={meshRef.current.geometry}
                  normal={f.normal}
                  localPt={f.localPt}
                  color={idx === 0 ? "#af40ff" : "#ffcc00"}
                  opacity={0.55}
                />
              );
            })}
          </group>
        )}
        {measureEdgesActive && (
          <group>
            {selectedEdges.map((edge, idx) => {
              if (edge.boardId !== b.id.toString()) return null;
              return (
                <Line
                  key={`select-edge-${idx}`}
                  points={[edge.edgeStart, edge.edgeEnd]}
                  color={idx === 0 ? "#af40ff" : "#ffcc00"}
                  lineWidth={4}
                  transparent
                  opacity={0.9}
                  depthTest={false}
                />
              );
            })}
          </group>
        )}
        {(() => {
          const matDesc = normalizeMaterial(b.material);
          const matKey = matDesc.type === 'color' ? `color-${matDesc.hex}` : `wood-${matDesc.id}`;
          const commonProps = {
            emissive: isSelected ? (dKeyPressed ? (isSnapped ? '#22c55e' : '#00f3ff') : '#bc8a5f') : '#000000',
            emissiveIntensity: isSelected ? (dKeyPressed ? 0.75 : 0.4) : 0,
          };
          if (matDesc.type === 'color') {
            return (
              <meshStandardMaterial
                key={matKey}
                color={matDesc.hex}
                roughness={0.85}
                {...commonProps}
              />
            );
          }
          const spec = WOOD_CATALOGUE[matDesc.id] ?? WOOD_CATALOGUE['pine'];
          return (
            <meshStandardMaterial
              key={matKey}
              color="#ffffff"
              map={clonedTex || baseTex}
              roughness={spec.roughness}
              {...commonProps}
            />
          );
        })()}
        {showEdges && <Edges scale={1} threshold={15} color={isSelected ? (dKeyPressed ? (isSnapped ? '#22c55e' : '#00f3ff') : '#ffffff') : '#222222'} />}
        {/* Axes helper on the mesh (at board center, not pivot) */}
        {isSelected && <axesHelper args={[Math.max(...b.size) * 0.75 + 2.25]} />}
        {((isSelected || (constraintTargetMode && constraintTargetMode.active) || measureEdgesActive) && hoveredFaceData && hoveredFaceData.id === b.id.toString()) && (() => {
          const { hoverType = 'face', hoverKey, cornerPos, edgeStart, edgeEnd } = hoveredFaceData;
          if (!hoverKey) return null;

          if (hoverType === 'corner' && cornerPos) {
            return (
              <mesh position={cornerPos} raycast={() => null}>
                <sphereGeometry args={[0.15, 16, 16]} />
                <meshBasicMaterial color="#00ffff" transparent opacity={0.65} depthTest={false} />
              </mesh>
            );
          }

          if (hoverType === 'edge' && edgeStart && edgeEnd) {
            return (
              <Line
                points={[edgeStart, edgeEnd]}
                color="#00ffff"
                lineWidth={3}
                transparent
                opacity={0.85}
                depthTest={false}
              />
            );
          }

          // Fallback to face highlighting
          const faceStr = hoverKey;
          let pos = [0, 0, 0], rot = [0, 0, 0];
          const w = b.size[0] / 2 + 0.01;
          const h = b.size[1] / 2 + 0.01;
          const d = b.size[2] / 2 + 0.01;
          if (faceStr === 'x+') { pos = [w, 0, 0]; rot = [0, Math.PI / 2, 0]; }
          if (faceStr === 'x-') { pos = [-w, 0, 0]; rot = [0, -Math.PI / 2, 0]; }
          if (faceStr === 'y+') { pos = [0, h, 0]; rot = [-Math.PI / 2, 0, 0]; }
          if (faceStr === 'y-') { pos = [0, -h, 0]; rot = [Math.PI / 2, 0, 0]; }
          if (faceStr === 'z+') { pos = [0, 0, d]; rot = [0, 0, 0]; }
          if (faceStr === 'z-') { pos = [0, 0, -d]; rot = [0, Math.PI, 0]; }
          
          let planeW = faceStr.startsWith('x') ? b.size[2] : b.size[0];
          let planeH = faceStr.startsWith('y') ? b.size[2] : b.size[1];
          if (faceStr.startsWith('x')) planeH = b.size[1];
          if (faceStr.startsWith('z')) planeH = b.size[1];

          const tooltipLabel = faceLabels[faceStr] || faceStr;

          return (
            <group>
              <mesh position={pos} rotation={rot} raycast={() => null}>
                <planeGeometry args={[planeW, planeH]} />
                <meshBasicMaterial color="#00ffff" transparent opacity={0.4} depthTest={false} side={THREE.DoubleSide} />
              </mesh>
              <Html position={pos} center style={{ pointerEvents: 'none', zIndex: 10 }}>
                <div style={{
                  background: 'rgba(0, 0, 0, 0.75)',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.5)'
                }}>
                  {tooltipLabel}
                </div>
              </Html>
            </group>
          );
        })()}
        {/* ── Hardware attachments ─────────────────────────────────────────── */}
        {(b.hardware || []).length > 0 && (
          <Suspense fallback={null}>
            {(b.hardware || []).map(hw => (
              <HardwareAttachment key={hw.id} hw={hw} boardSize={b.size} boardId={b.id} />
            ))}
          </Suspense>
        )}
      </mesh>

      {/* ── Pivot Visualizer ───────────────────────────────────────────────── */}
      {/* Shown when board is selected and pivot is not at center.              */}
      {/* The pivot point is at the group origin (0,0,0); the board center     */}
      {/* is at (-pivot). We draw a sphere at origin and a dashed line to it.  */}
      {isSelected && hasPivot && (
        <group>
          {/* Pivot sphere — magenta, always visible */}
          <mesh raycast={() => null}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshBasicMaterial color="#ff00ff" transparent opacity={0.85} depthTest={false} />
          </mesh>
          {/* Dashed line from pivot to board center */}
          <Line
            points={[[0, 0, 0], [-pivot[0], -pivot[1], -pivot[2]]]}
            color="#ff00ff"
            lineWidth={2}
            dashed
            dashScale={8}
            dashSize={1}
            dashOffset={0}
          />
          {/* Pivot label */}
          <Html center style={{ pointerEvents: 'none' }}>
            <div style={{
              background: 'rgba(180, 0, 180, 0.8)',
              color: 'white',
              padding: '2px 6px',
              borderRadius: '10px',
              fontSize: '0.65rem',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              transform: 'translateY(-14px)',
            }}>
              ⊕ Pivot
            </div>
          </Html>
        </group>
      )}
    </group>
  );
};

const RecursiveNode = ({ nodeId, groups, boards, selectedItemIds, toggleSelection, textures, showEdges, constraintTargetMode, hoveredFaceData, setHoveredFaceData, modifierActive }) => {
  const isGroup = groups[nodeId] !== undefined;

  if (!isGroup) {
    const b = boards.find(x => x.id.toString() === nodeId);
    if (!b) return null;
    if (b.shape === 'plane') {
      return (
        <PlaneMesh
          b={b}
          selectedItemIds={selectedItemIds}
        />
      );
    }
    return (
      <BoardMesh
        b={b}
        selectedItemIds={selectedItemIds}
        toggleSelection={toggleSelection}
        textures={textures}
        showEdges={showEdges}
        constraintTargetMode={constraintTargetMode}
        hoveredFaceData={hoveredFaceData}
        setHoveredFaceData={setHoveredFaceData}
        modifierActive={modifierActive}
      />
    );
  }

  const g = groups[nodeId];
  if (g.visible === false) return null;

  const childGroups = Object.keys(groups).filter(k => groups[k].parentId === nodeId);
  const childBoards = boards.filter(b => b.parentId === nodeId);

  // Group proxy bounding box for constraint targeting
  let groupProxyBounds = null;
  if (constraintTargetMode?.active) {
    groupProxyBounds = calculateGroupAABB(nodeId, boards, groups);
  }

  return (
    <group name={g.name || nodeId}>
      {groupProxyBounds && (
        <mesh
          position={[groupProxyBounds.centerX, groupProxyBounds.centerY, groupProxyBounds.centerZ]}
          raycast={!modifierActive ? () => null : undefined}
          onClick={(e) => {
            if (!modifierActive) return;
            e.stopPropagation();
            const faceStr = e.faceIndex !== undefined ? ['x+', 'x-', 'y+', 'y-', 'z+', 'z-'][Math.floor(e.faceIndex / 2)] : null;
            toggleSelection(nodeId, e.shiftKey || e.ctrlKey || e.metaKey, faceStr);
          }}
          onPointerMove={(e) => {
            if (!modifierActive) return;
            e.stopPropagation();
            if (e.faceIndex !== undefined) {
              const fStr = ['x+', 'x-', 'y+', 'y-', 'z+', 'z-'][Math.floor(e.faceIndex / 2)];
              if (!hoveredFaceData || hoveredFaceData.id !== nodeId || hoveredFaceData.faceStr !== fStr) {
                setHoveredFaceData({ id: nodeId, faceStr: fStr });
              }
            }
          }}
          onPointerOut={(e) => {
            if (hoveredFaceData && hoveredFaceData.id === nodeId) {
              setHoveredFaceData(null);
            }
          }}
        >
          <boxGeometry args={[groupProxyBounds.width + 0.05, groupProxyBounds.height + 0.05, groupProxyBounds.depth + 0.05]} />
          <meshBasicMaterial color="#bc8a5f" transparent opacity={modifierActive ? 0.3 : 0} depthTest={false} wireframe={true} />
          
          {(modifierActive && hoveredFaceData && hoveredFaceData.id === nodeId) && (() => {
             const faceStr = hoveredFaceData.faceStr;
             let pos = [0, 0, 0], rot = [0, 0, 0];
             const w = groupProxyBounds.width / 2 + 0.05;
             const h = groupProxyBounds.height / 2 + 0.05;
             const d = groupProxyBounds.depth / 2 + 0.05;
             if (faceStr === 'x+') { pos = [w, 0, 0]; rot = [0, Math.PI / 2, 0]; }
             if (faceStr === 'x-') { pos = [-w, 0, 0]; rot = [0, -Math.PI / 2, 0]; }
             if (faceStr === 'y+') { pos = [0, h, 0]; rot = [-Math.PI / 2, 0, 0]; }
             if (faceStr === 'y-') { pos = [0, -h, 0]; rot = [Math.PI / 2, 0, 0]; }
             if (faceStr === 'z+') { pos = [0, 0, d]; rot = [0, 0, 0]; }
             if (faceStr === 'z-') { pos = [0, 0, -d]; rot = [0, Math.PI, 0]; }
             
             let planeW = faceStr.startsWith('x') ? groupProxyBounds.depth : groupProxyBounds.width;
             let planeH = faceStr.startsWith('y') ? groupProxyBounds.depth : groupProxyBounds.height;
             if (faceStr.startsWith('x')) planeH = groupProxyBounds.height;
             if (faceStr.startsWith('z')) planeH = groupProxyBounds.height;
             return (
               <mesh position={pos} rotation={rot} raycast={() => null}>
                 <planeGeometry args={[planeW, planeH]} />
                 <meshBasicMaterial color="#bc8a5f" transparent opacity={0.6} depthTest={false} side={THREE.DoubleSide} />
               </mesh>
             );
          })()}
        </mesh>
      )}

      {childGroups.map(k => (
        <RecursiveNode key={k} nodeId={k} groups={groups} boards={boards} selectedItemIds={selectedItemIds} toggleSelection={toggleSelection} textures={textures} showEdges={showEdges} constraintTargetMode={constraintTargetMode} hoveredFaceData={hoveredFaceData} setHoveredFaceData={setHoveredFaceData} modifierActive={modifierActive} />
      ))}
      {childBoards.map(b => (
        <RecursiveNode key={`b_${b.id}`} nodeId={b.id.toString()} groups={groups} boards={boards} selectedItemIds={selectedItemIds} toggleSelection={toggleSelection} textures={textures} showEdges={showEdges} constraintTargetMode={constraintTargetMode} hoveredFaceData={hoveredFaceData} setHoveredFaceData={setHoveredFaceData} modifierActive={modifierActive} />
      ))}
    </group>
  );
};

function WoodJoint({ boards, groups, selectedItemIds, toggleSelection, showEdges, showMeasurements, measurements, showBoundingBox, units, theme, constraintTargetMode, hoveredFaceData, setHoveredFaceData, modifierActive, constraints, measureMode }) {
  const definePlaneActive = useStore(s => s.definePlaneActive);
  const definePlaneFeatures = useStore(s => s.definePlaneFeatures || []);

  const planePoints = React.useMemo(() => {
    const pts = [];
    definePlaneFeatures.forEach(f => {
      if (f.type === 'point') pts.push(new THREE.Vector3(...f.pos));
      if (f.type === 'edge') {
        pts.push(new THREE.Vector3(...f.start));
        pts.push(new THREE.Vector3(...f.end));
      }
    });
    return pts;
  }, [definePlaneFeatures]);

  const isPlaneEstablished = planePoints.length >= 3;

  const planeVisual = React.useMemo(() => {
    if (!isPlaneEstablished) return null;
    const p0 = planePoints[0];
    const p1 = planePoints[1];
    const p2 = planePoints[2];

    const centroid = new THREE.Vector3().add(p0).add(p1).add(p2).multiplyScalar(1 / 3);
    const v1 = new THREE.Vector3().subVectors(p1, p0);
    const v2 = new THREE.Vector3().subVectors(p2, p0);
    const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();

    if (normal.lengthSq() < 0.0001) return null;

    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    return { centroid, quaternion, normal };
  }, [planePoints, isPlaneEstablished]);

  // WOOD_TEXTURE_URLS is a stable module-level object — safe to pass to useTexture()
  const textures = useTexture(WOOD_TEXTURE_URLS);

  Object.values(textures).forEach(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  });

  const rootGroups = Object.keys(groups).filter(k => groups[k].parentId === null);
  const rootBoards = boards.filter(b => b.parentId === 'Workspace');

  // Orphaned boards: parentId references a group that doesn't exist in the groups map.
  // Render them as root-level boards so they're never invisible.
  const allGroupIds = new Set(Object.keys(groups));
  allGroupIds.add('Workspace');
  const orphanedBoards = boards.filter(b => !allGroupIds.has(b.parentId));

  const setThreeModelGroup = useStore(s => s.setThreeModelGroup);
  const groupRef = React.useRef();

  React.useEffect(() => {
    if (setThreeModelGroup && groupRef.current) {
      setThreeModelGroup(groupRef.current);
    }
    return () => {
      if (setThreeModelGroup) setThreeModelGroup(null);
    };
  }, [setThreeModelGroup]);

  return (
    <group ref={groupRef}>
      {rootGroups.map(k => (
        <RecursiveNode key={k} nodeId={k} groups={groups} boards={boards} selectedItemIds={selectedItemIds} toggleSelection={toggleSelection} textures={textures} showEdges={showEdges} constraintTargetMode={constraintTargetMode} hoveredFaceData={hoveredFaceData} setHoveredFaceData={setHoveredFaceData} modifierActive={modifierActive} />
      ))}
      {rootBoards.map(b => (
        b.shape === 'plane' ? (
          <PlaneMesh key={`root_${b.id}`} b={b} selectedItemIds={selectedItemIds} />
        ) : (
          <BoardMesh key={`root_${b.id}`} b={b} selectedItemIds={selectedItemIds} toggleSelection={toggleSelection} textures={textures} showEdges={showEdges} constraintTargetMode={constraintTargetMode} hoveredFaceData={hoveredFaceData} setHoveredFaceData={setHoveredFaceData} modifierActive={modifierActive} />
        )
      ))}
      {orphanedBoards.map(b => (
        b.shape === 'plane' ? (
          <PlaneMesh key={`orphan_${b.id}`} b={b} selectedItemIds={selectedItemIds} />
        ) : (
          <BoardMesh key={`orphan_${b.id}`} b={b} selectedItemIds={selectedItemIds} toggleSelection={toggleSelection} textures={textures} showEdges={showEdges} constraintTargetMode={constraintTargetMode} hoveredFaceData={hoveredFaceData} setHoveredFaceData={setHoveredFaceData} modifierActive={modifierActive} />
        )
      ))}

      {/* ── Define Plane Visualization ── */}
      {definePlaneActive && (
        <group>
          {/* If plane is not established, render the selected features */}
          {!isPlaneEstablished && definePlaneFeatures.map((f, idx) => {
            if (f.type === 'point') {
              return (
                <mesh position={f.pos} key={`plane-feat-pt-${idx}`} raycast={() => null}>
                  <sphereGeometry args={[0.2, 16, 16]} />
                  <meshBasicMaterial color="#ffcc00" depthTest={false} transparent opacity={0.9} />
                </mesh>
              );
            }
            if (f.type === 'edge') {
              return (
                <Line
                  points={[f.start, f.end]}
                  color="#ffcc00"
                  lineWidth={4}
                  depthTest={false}
                  transparent
                  opacity={0.9}
                  key={`plane-feat-edge-${idx}`}
                />
              );
            }
            return null;
          })}

          {/* If plane is established, render the semi-transparent cyan plane */}
          {isPlaneEstablished && planeVisual && (
            <mesh position={planeVisual.centroid} quaternion={planeVisual.quaternion} raycast={() => null}>
              <planeGeometry args={[48, 48]} />
              <meshBasicMaterial color="#00ffff" transparent opacity={0.125} side={THREE.DoubleSide} depthWrite={false} />
              <Edges color="#00ffff" scale={1} />
              <gridHelper args={[48, 24, '#00ffff', 'rgba(0, 243, 255, 0.2)']} rotation={[Math.PI / 2, 0, 0]} />
              <axesHelper args={[12]} />
            </mesh>
          )}
        </group>
      )}
    </group>
  );
}

export default WoodJoint;
