import React from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import useStore from '../store/useStore';
import { computeWorldAABB } from '../utils/sceneGraph';

export function PersistentControls() {
  const { camera, gl } = useThree();
  const cameraState = useStore(s => s.cameraState);
  const setCameraState = useStore(s => s.setCameraState);

  const controlsRef = React.useRef(null);
  // Track which cameraState object we last applied so we don't re-apply
  // the same value (which would fight user interaction).
  const appliedRef = React.useRef(null);
  // Set by the wheel listener below; consumed (and cleared) on the next
  // frame, after OrbitControls' own zoom math has already run.
  const zoomPendingRef = React.useRef(false);

  // When cameraState changes (e.g. workspace load), apply it.
  React.useEffect(() => {
    const ctrls = controlsRef.current;
    if (ctrls && cameraState && appliedRef.current !== cameraState) {
      camera.position.set(...cameraState.position);
      ctrls.target.set(...cameraState.target);
      ctrls.update();
      appliedRef.current = cameraState;
    }
  }, [camera, cameraState]);

  // Flag every wheel/zoom tick on the canvas. We don't react to this
  // immediately — see the useFrame below — so panning/orbiting never
  // triggers the re-leveling, only an actual zoom does.
  React.useEffect(() => {
    const el = gl.domElement;
    const onWheel = () => { zoomPendingRef.current = true; };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, [gl]);

  // Runs every frame at the default priority, i.e. *after* drei's
  // OrbitControls (-1 priority) has already applied that tick's zoom. If a
  // wheel event happened, re-level the pivot's height to the vertical
  // center of whatever boards currently exist (read fresh here, not a
  // stale prop) — only the Y axis, so where you're panned to left/right/
  // front/back is never disturbed, just how the floor sits in frame.
  // This is what makes "zoom out -> floor rises, zoom in -> floor drops"
  // happen, and it reflects the *current* model every time, including
  // boards added/moved since the last zoom.
  useFrame(() => {
    if (!zoomPendingRef.current) return;
    zoomPendingRef.current = false;
    const ctrls = controlsRef.current;
    if (!ctrls) return;
    const { boards, autoCenterCamera } = useStore.getState();
    if (!autoCenterCamera || boards.length === 0) return;
    const aabb = computeWorldAABB(boards);
    if (!isFinite(aabb.minY)) return;
    const centerY = (aabb.minY + aabb.maxY) / 2;
    const deltaY = centerY - ctrls.target.y;
    if (Math.abs(deltaY) < 1e-6) return;
    camera.position.y += deltaY;
    ctrls.target.y += deltaY;
    ctrls.update();
  });

  const handleEnd = React.useCallback((e) => {
    const ctrls = e.target;
    if (!ctrls) return;
    const newState = {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target:   [ctrls.target.x,    ctrls.target.y,    ctrls.target.z],
    };
    appliedRef.current = newState;
    setCameraState(newState);
  }, [camera, setCameraState]);

  // Ref-callback: fires once when OrbitControls mounts.
  // Sets the orbit target from persisted state (position is already
  // correct because the declarative camera read it from the store).
  const initRef = React.useCallback((ctrls) => {
    controlsRef.current = ctrls;
    if (ctrls && cameraState && appliedRef.current !== cameraState) {
      camera.position.set(...cameraState.position);
      ctrls.target.set(...cameraState.target);
      ctrls.update();
      appliedRef.current = cameraState;
    }
  }, [camera, cameraState]);

  const isDraggingMeasure = useStore(s => s.measureMode?.dragging);
  const dKeyPressed = useStore(s => s.dKeyPressed);
  const isGizmoDragging = useStore(s => s.isGizmoDragging);
  const zoomToCursor = useStore(s => s.zoomToCursor);

  // screenSpacePanning=false keeps the orbit pivot pinned to the plane it was
  // already on when zoomToCursor recalculates it — otherwise every zoom near
  // the top of a tall model drags the pivot upward with it, and subsequent
  // orbiting makes the floor swing wildly since it's now far from the pivot.
  return <OrbitControls ref={initRef} makeDefault onEnd={handleEnd} enableDamping={true} dampingFactor={0.15} zoomToCursor={zoomToCursor} screenSpacePanning={false} enabled={!isDraggingMeasure && !dKeyPressed && !isGizmoDragging} />;
}
