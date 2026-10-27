import React from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import useStore from '../store/useStore';

export function PersistentControls() {
  const { camera } = useThree();
  const cameraState = useStore(s => s.cameraState);
  const setCameraState = useStore(s => s.setCameraState);

  const controlsRef = React.useRef(null);
  // Track which cameraState object we last applied so we don't re-apply
  // the same value (which would fight user interaction).
  const appliedRef = React.useRef(null);

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

  return <OrbitControls ref={initRef} makeDefault onEnd={handleEnd} enableDamping={true} dampingFactor={0.15} enabled={!isDraggingMeasure && !dKeyPressed && !isGizmoDragging} />;
}
