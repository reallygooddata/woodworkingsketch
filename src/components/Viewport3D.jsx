import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera, OrthographicCamera, Html } from '@react-three/drei';
import useStore from '../store/useStore';

// Extracted Components
import { GizmoControls } from './GizmoControls';
import { GridEnvironment } from './GridEnvironment';
import BoardRenderer from './BoardRenderer';
import { PersistentControls } from './PersistentControls';
import { PrintCaptureHandler } from './PrintCaptureHandler';
import { AnimationDriver } from './AnimationDriver';
import { SceneLights } from './SceneLights';
import { ConstraintVisualizer } from './ConstraintVisualizer';
import { BoundingBoxVisualizer } from './BoundingBoxVisualizer';
import { MeasurementOverlay } from './MeasurementOverlay';
import { MeasureSnapPreview } from './MeasureSnapPreview';
import { MeasureDragHandler } from './MeasureDragHandler';
import BuilderPreviewRenderer from './BuilderPreviewRenderer';
import { MiterCutVisualizer } from './MiterCutVisualizer';
import TransformGizmo from './TransformGizmo';
import { LiveDistanceOverlay } from './LiveDistanceOverlay';

// ── Custom Pivot Snapping Preview ───────────────────────────────────────────
function PivotSnapPreview() {
  const pivotHoverSnap = useStore(s => s.pivotHoverSnap);
  if (!pivotHoverSnap) return null;
  return (
    <mesh position={pivotHoverSnap} raycast={() => null}>
      <sphereGeometry args={[0.15, 16, 16]} />
      <meshBasicMaterial color="#ff00ff" depthTest={false} transparent opacity={0.6} />
    </mesh>
  );
}

export default function Viewport3D() {
  const {
    boards,
    groups,
    selectedItemIds,
    setSelectedItemIds,
    toggleSelection,
    gridSnap,
    theme,
    globalBounds,
    showEdges,
    showMeasurements,
    measurements,
    showBoundingBox,
    units,
    constraintTargetMode,
    constraints,
    lighting,
    isOrtho,
    showGrid,
    cameraState,
    measureMode,
    setMeasureMode,
    printCapture
  } = useStore();

  const [hoveredFaceData, setHoveredFaceData] = useState(null);
  const [modifierActive, setModifierActive] = useState(false);

  // Read the persisted camera position once on mount so the declarative
  // <PerspectiveCamera> / <OrthographicCamera> starts at the saved position.
  const _defaultCamPos = [30, 20, 40];
  const _cameraPos = cameraState?.position ?? _defaultCamPos;

  useEffect(() => {
    const handleKey = (e) => {
      setModifierActive(e.shiftKey || e.altKey);
      
      const isInput = e.target.closest('input, textarea, select');
      if (!isInput) {
        if (e.key.toLowerCase() === 'd') {
          if (e.type === 'keydown') {
            const wasPressed = useStore.getState().dKeyPressed;
            if (!wasPressed) {
              useStore.getState().setDKeyPressed(true);
              useStore.getState().showToast('🧲 Smart Snapping: Click and drag any selected board to position it.');
            }
          } else if (e.type === 'keyup') {
            useStore.getState().setDKeyPressed(false);
          }
        }

        // Mouse transform gizmo: G = move, R = rotate (Blender-style).
        if (e.type === 'keydown' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (e.key.toLowerCase() === 'g') {
            useStore.getState().setGizmoMode('translate');
            useStore.getState().setGizmoEnabled(true);
          } else if (e.key.toLowerCase() === 'r') {
            useStore.getState().setGizmoMode('rotate');
            useStore.getState().setGizmoEnabled(true);
          }
        }
      }

      if (e.key === 'Escape') {
        const state = useStore.getState();
        let acted = false;
        if (measureMode?.active) {
          setMeasureMode(null);
          acted = true;
        }
        if (state.measureFaceAnglesActive) {
          state.setMeasureFaceAnglesActive(false);
          state.clearFaceSelection();
          acted = true;
        }
        if (state.measureEdgesActive) {
          state.setMeasureEdgesActive(false);
          state.clearEdgeSelection();
          acted = true;
        }
        if (state.miterSawBoardId) {
          state.closeMiterSawMode();
          acted = true;
        }
        if (state.definePlaneActive) {
          state.setDefinePlaneActive(false);
          acted = true;
        }
        if (acted) e.preventDefault();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        const { selectedMeasurementId, removeMeasurement, setSelectedMeasurementId } = useStore.getState();
        if (selectedMeasurementId) {
          e.preventDefault();
          removeMeasurement(selectedMeasurementId);
          setSelectedMeasurementId(null);
        }
      }
    };
    const handleBlur = () => {
      setModifierActive(false);
      useStore.getState().setDKeyPressed(false);
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keyup', handleKey);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('keyup', handleKey);
      window.removeEventListener('blur', handleBlur);
    };
  }, [measureMode, setMeasureMode]);

  const storeWorkspaceSize = useStore(s => s.workspaceSize) || 120;

  const workspaceSize = useMemo(() => {
    const physicalBoards = boards.filter(b => b.shape !== 'plane');
    if (physicalBoards.length === 0) return storeWorkspaceSize;
    const maxBoundary = Math.max(...physicalBoards.map(b => {
      const xBoundary = Math.abs(b.position[0]) + b.size[0] / 2;
      const zBoundary = Math.abs(b.position[2]) + b.size[2] / 2;
      return Math.max(xBoundary, zBoundary);
    }));
    const requiredSize = Math.ceil(maxBoundary * 2);
    // Add a safe 24-inch margin and round up to a clean foot multiple
    const targetSize = Math.max(storeWorkspaceSize, requiredSize + 24);
    return Math.ceil(targetSize / 12) * 12;
  }, [storeWorkspaceSize, boards]);

  return (
    <div className="viewport-container" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas shadows={lighting?.shadows ? 'soft' : false} onPointerMissed={() => setSelectedItemIds([])}>
        <SceneLights lighting={lighting} />

        <GizmoControls />

        {isOrtho ? (
          <OrthographicCamera makeDefault position={_cameraPos} zoom={12} near={0.1} far={1000} />
        ) : (
          <PerspectiveCamera makeDefault position={_cameraPos} near={0.1} far={1000} />
        )}

        <PersistentControls />
        <AnimationDriver />
        <MeasureDragHandler />
        <PrintCaptureHandler />

        <GridEnvironment 
          showGrid={showGrid}
          printCapture={printCapture}
          theme={theme}
          workspaceSize={workspaceSize}
          gridSnap={gridSnap}
          lighting={lighting}
          units={units}
        />

        {globalBounds?.enabled && !printCapture && (
          <mesh position={[0, globalBounds.y / 2, 0]} raycast={() => null}>
            <boxGeometry args={[globalBounds.x, globalBounds.y, globalBounds.z]} />
            <meshBasicMaterial color={theme === 'dark' ? '#bc8a5f' : '#FF9500'} wireframe transparent opacity={0.3} />
          </mesh>
        )}

        <Suspense fallback={
          <Html center>
            <div style={{ color: '#bc8a5f', fontSize: '1rem', fontWeight: 'bold', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
              Loading textures…
            </div>
          </Html>
        }>
          <BoardRenderer
            boards={boards}
            groups={groups}
            selectedItemIds={selectedItemIds}
            toggleSelection={toggleSelection}
            showEdges={showEdges}
            showMeasurements={showMeasurements}
            measurements={measurements}
            measureMode={measureMode}
            showBoundingBox={showBoundingBox}
            units={units}
            theme={theme}
            constraintTargetMode={constraintTargetMode}
            hoveredFaceData={hoveredFaceData}
            setHoveredFaceData={setHoveredFaceData}
            modifierActive={modifierActive}
            constraints={constraints}
          />
        </Suspense>

        <ConstraintVisualizer boards={boards} groups={groups} selectedItemIds={selectedItemIds} constraints={constraints} />
        <BoundingBoxVisualizer boards={boards} groups={groups} selectedItemIds={selectedItemIds} showBoundingBox={showBoundingBox} theme={theme} />
        <MeasurementOverlay boards={boards} selectedItemIds={selectedItemIds} showMeasurements={showMeasurements} measurements={measurements} units={units} theme={theme} />
        <MeasureSnapPreview boards={boards} measureMode={measureMode} />
        <PivotSnapPreview />
        <MiterCutVisualizer />
        <BuilderPreviewRenderer />
        <TransformGizmo />
        <LiveDistanceOverlay />
      </Canvas>
    </div>
  );
}
